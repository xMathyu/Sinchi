/**
 * Verificación del ID token de Firebase.
 *
 * Se usa `firebase-admin` y no una verificación de JWT escrita a mano. La
 * tentación existe —son unas cuarenta líneas: comprobar `iss`, `aud`, la firma
 * RS256 contra las claves públicas de Google— pero esta es la frontera que
 * decide quién entra al sistema. La implementación de referencia maneja la
 * rotación de claves, el desfase de reloj y los casos raros del formato; una
 * propia los maneja hasta el día que no.
 *
 * Lo que este archivo NO hace: emitir la sesión. Firebase verifica *quién es el
 * humano*; el token de Sinchi lleva *qué puede hacer y en qué gimnasio*
 * (`tenantId`, `staffId`, `role`). Son dos preguntas distintas y se responden
 * por separado — así el guard, los roles y `assertStaffSession` siguen
 * funcionando igual, y cambiar de proveedor de identidad no toca la
 * autorización.
 */
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';
import { loadEnv } from '../config/env';

export interface VerifiedIdentity {
  /** UID de Firebase. Es la llave estable de la cuenta. */
  readonly uid: string;
  readonly email: string | null;
  /** `true` solo si el proveedor verificó el correo. */
  readonly emailVerified: boolean;
  readonly displayName: string | null;
  /** `google.com`, `apple.com`, `phone`... */
  readonly provider: string;
}

@Injectable()
export class FirebaseVerifier {
  private readonly logger = new Logger(FirebaseVerifier.name);
  private app: App | null = null;

  /**
   * La app de Firebase se crea perezosamente.
   *
   * Si se creara en el constructor, un proyecto mal configurado tumbaría el
   * arranque de toda la api —incluido `/health`— y el diagnóstico se volvería
   * "el servicio no responde" en vez de "la autenticación no está configurada".
   */
  private getApp(): App {
    if (this.app !== null) return this.app;

    const env = loadEnv();
    const projectId = env.FIREBASE_PROJECT_ID;
    if (projectId === undefined) {
      throw new UnauthorizedException(
        'La autenticación con Firebase no está configurada: falta FIREBASE_PROJECT_ID.',
      );
    }

    const existing = getApps().find((app) => app.name === 'sinchi');
    if (existing !== undefined) {
      this.app = existing;
      return existing;
    }

    // Verificar un ID token solo necesita el projectId: las claves públicas de
    // Google se descargan por HTTP. No hacen falta credenciales de servicio, y
    // no pedirlas es una cuenta de servicio menos que administrar.
    const credentials = env.FIREBASE_SERVICE_ACCOUNT_JSON;
    this.app = initializeApp(
      credentials === undefined
        ? { projectId }
        : { projectId, credential: cert(JSON.parse(credentials) as object) },
      'sinchi',
    );
    this.logger.log(`Firebase Auth listo para el proyecto ${projectId}`);
    return this.app;
  }

  /**
   * Verifica el token y devuelve la identidad.
   *
   * `checkRevoked: false` a propósito: comprobarlo cuesta una llamada a la api
   * de Firebase en cada petición. El token de Sinchi que se emite después tiene
   * su propia vida corta, así que revocar en Firebase corta el acceso al
   * renovar, no al instante. Para un producto donde el corte de acceso se mide
   * en días de gracia, la diferencia no importa.
   */
  async verify(idToken: string): Promise<VerifiedIdentity> {
    let decoded: DecodedIdToken;
    try {
      decoded = await getAuth(this.getApp()).verifyIdToken(idToken, false);
    } catch (error) {
      // Sin detalle hacia afuera: distinguir "expirado" de "firma inválida" le
      // dice a quien prueba si acertó algo.
      this.logger.debug(
        `ID token rechazado: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new UnauthorizedException('Sesión de Google inválida o expirada.');
    }

    const provider =
      typeof decoded.firebase?.sign_in_provider === 'string'
        ? decoded.firebase.sign_in_provider
        : 'unknown';

    return {
      uid: decoded.uid,
      email: typeof decoded.email === 'string' ? decoded.email.toLowerCase() : null,
      emailVerified: decoded.email_verified === true,
      displayName: typeof decoded.name === 'string' ? decoded.name : null,
      provider,
    };
  }
}
