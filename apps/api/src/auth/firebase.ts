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
import { AccountBans } from './account-bans';

/** Qué pasó al intentar borrar la cuenta de Firebase de alguien. */
export type FirebaseDeletion = 'deleted' | 'not_found' | 'unavailable';

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

  constructor(private readonly bans: AccountBans) {}

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
    const identity = await this.decode(idToken);

    /**
     * El baneo muerde AQUÍ, y es el único sitio donde puede hacerlo bien.
     *
     * Todo lo que entra con un token de Google pasa por esta línea: el login, la
     * reserva desde el directorio, el chat con un gimnasio, el alta de un local.
     * Son dieciocho llamadas repartidas por los controladores; comprobar el baneo
     * en cada una serían dieciocho sitios donde olvidarlo, y el olvido no falla:
     * deja entrar. Ver `AccountBans`.
     *
     * Se mira el correo además del uid porque borrar al usuario de Firebase hace
     * que la misma cuenta de Google vuelva con un uid nuevo.
     */
    await this.bans.assertNotBanned({
      firebaseUid: identity.uid,
      email: identity.emailVerified ? identity.email : null,
    });

    return identity;
  }

  /**
   * Solo la parte de Google: firma, caducidad y a quién pertenece el token.
   *
   * Aparte de `verify` para que las pruebas puedan falsear ESTO —lo único que de
   * verdad necesita a Google— y seguir probando el baneo de verdad.
   */
  async decode(idToken: string): Promise<VerifiedIdentity> {
    // `getApp()` va FUERA del try a proposito. Dentro, su excepcion de
    // configuracion —"falta FIREBASE_PROJECT_ID"— la capturaba el catch de
    // abajo y salia como "sesion invalida o expirada": el mensaje acusaba al
    // token de un fallo del despliegue, que es justo lo que la inicializacion
    // perezosa pretendia evitar.
    const app = this.getApp();

    let decoded: DecodedIdToken;
    try {
      decoded = await getAuth(app).verifyIdToken(idToken, false);
    } catch (error) {
      // Sin detalle hacia afuera: distinguir "expirado" de "firma inválida" le
      // dice a quien prueba si acertó algo.
      this.logger.warn(
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

  /**
   * Borra el usuario de Firebase. Lo intenta, y dice qué pasó.
   *
   * La política publicada promete borrar «la cuenta con la que entras», y esa
   * vive en Firebase, no en nuestra base. Pero borrarla necesita credenciales que
   * ESCRIBEN en Firebase, y este servicio nació solo para verificar: en un
   * despliegue sin ellas, esto no puede hacerse desde aquí.
   *
   * Por eso NO lanza. Lo nuestro —la ficha, el historial, la cuenta sin ficha—
   * ya se borró en la base, y que falle Firebase no puede dejarlo a medias ni
   * devolver un error a quien acaba de cumplir una baja. Lo que hace es decir
   * qué pasó, y el panel lo enseña: si quedó `unavailable`, falta borrarlo a
   * mano en la consola de Firebase.
   */
  async deleteAccount(uid: string): Promise<{ readonly outcome: FirebaseDeletion; readonly detail?: string }> {
    try {
      await getAuth(this.getApp()).deleteUser(uid);
      return { outcome: 'deleted' };
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      if (code === 'auth/user-not-found') return { outcome: 'not_found' };
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.warn(`No se pudo borrar el usuario de Firebase ${uid}: ${detail}`);
      return { outcome: 'unavailable', detail };
    }
  }
}
