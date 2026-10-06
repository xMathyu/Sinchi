/**
 * Revocar «Entrar con Apple» cuando se borra la cuenta.
 *
 * Apple lo espera junto a la 5.1.1(v): quien creó su cuenta con Apple y la
 * borra tiene que quedar también desvinculado en Apple —que la app desaparezca
 * de «Apps que usan tu Apple ID»—, y eso solo lo hace su REST API. Borrar el
 * usuario de Firebase no lo hace.
 *
 * SIN GUARDAR TOKENS DE APPLE. La revocación necesita un token de Apple, y la
 * forma corriente de tenerlo es canjear y guardar uno al entrar. Aquí se pide en
 * el momento de la baja: la app le pide a Apple un código nuevo (la misma hoja
 * de «Continuar con Apple»), la api lo canjea por un token y lo revoca en la
 * misma petición. No queda en la base una credencial de Apple de cada persona,
 * que es lo que habría que proteger, rotar y borrar con su dueña.
 *
 * NADA AQUÍ PUEDE IMPEDIR UNA BAJA. Si Apple no contesta, el código venció o la
 * llave no está configurada, la cuenta se borra igual y queda escrito: borrar es
 * el derecho de la persona; revocar, una limpieza que le debemos.
 */
import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { sign } from 'node:crypto';
import { loadEnv } from '../config/env';

/** Qué pasó con el acceso de Apple. */
export type AppleRevocationOutcome =
  /** Canjeado y revocado: la app ya no figura en su Apple ID. */
  | 'revoked'
  /** Se intentó y Apple no lo aceptó (código vencido, Apple caída). */
  | 'failed'
  /** Sin la llave de Sign in with Apple en este despliegue. */
  | 'not_configured'
  /** La cuenta es de Apple pero la app no pudo pedir el código (Android). */
  | 'skipped';

/** Lo que manda la app junto a la baja. */
export interface AppleConsent {
  /** El `authorizationCode` de una autorización recién hecha. Vale cinco minutos. */
  readonly authorizationCode?: string | undefined;
  /** `true` cuando el teléfono no puede pedirlo: Apple no ofrece la hoja en Android. */
  readonly unavailable?: boolean | undefined;
}

const APPLE = 'https://appleid.apple.com';

/**
 * El `client_secret` que Apple pide: un JWT ES256 firmado con la llave de Sign
 * in with Apple. Cinco minutos de vida; se arma en cada baja.
 *
 * Exportada para probarla sin red: la firma ES256 en formato `ieee-p1363` es lo
 * que se equivoca (la de Node por defecto es DER y Apple la rechaza).
 */
export function appleClientSecret(input: {
  readonly teamId: string;
  readonly keyId: string;
  readonly clientId: string;
  readonly privateKey: string;
  readonly now?: number;
}): string {
  const iat = Math.floor((input.now ?? Date.now()) / 1000);
  const b64 = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = b64({ alg: 'ES256', kid: input.keyId });
  const payload = b64({
    iss: input.teamId,
    iat,
    exp: iat + 300,
    aud: APPLE,
    sub: input.clientId,
  });
  const signature = sign('sha256', Buffer.from(`${header}.${payload}`), {
    // En Secret Manager el PEM a veces llega con `\n` escritos en vez de saltos.
    key: input.privateKey.replace(/\\n/g, '\n'),
    dsaEncoding: 'ieee-p1363',
  });
  return `${header}.${payload}.${signature.toString('base64url')}`;
}

@Injectable()
export class AppleRevocation {
  private readonly logger = new Logger(AppleRevocation.name);

  /** Si este despliegue tiene la llave. Sin ella, a nadie se le pide el código. */
  get configured(): boolean {
    const env = loadEnv();
    return (
      env.APPLE_TEAM_ID !== undefined &&
      env.APPLE_SIGNIN_KEY_ID !== undefined &&
      env.APPLE_SIGNIN_PRIVATE_KEY !== undefined
    );
  }

  /**
   * Lo que una baja tiene que hacer con Apple, antes de borrar nada.
   *
   * - La cuenta no es de Apple: nada (`null`).
   * - Es de Apple y llega el código: se revoca.
   * - Es de Apple, no llega el código y el teléfono podía pedirlo: 409 con
   *   `apple_authorization_required`, y la app abre la hoja de Apple y repite.
   *
   * El 409 va ANTES de borrar a propósito: después ya no habría cuenta con la
   * que volver a pedir el código.
   */
  async settle(input: {
    readonly isApple: boolean;
    readonly consent: AppleConsent;
  }): Promise<AppleRevocationOutcome | null> {
    if (!input.isApple) return null;
    if (!this.configured) return 'not_configured';

    const code = input.consent.authorizationCode;
    if (code === undefined || code.length === 0) {
      if (input.consent.unavailable === true) return 'skipped';
      throw new ConflictException({
        code: 'apple_authorization_required',
        message: 'Tu cuenta es de Apple: confirma con Apple para borrarla también de tu Apple ID.',
      });
    }
    return this.revokeWithCode(code);
  }

  /** Canjea el código y revoca el token que sale de él. No lanza. */
  async revokeWithCode(authorizationCode: string): Promise<AppleRevocationOutcome> {
    const env = loadEnv();
    if (!this.configured) return 'not_configured';

    try {
      const clientSecret = appleClientSecret({
        teamId: env.APPLE_TEAM_ID!,
        keyId: env.APPLE_SIGNIN_KEY_ID!,
        clientId: env.APPLE_CLIENT_ID,
        privateKey: env.APPLE_SIGNIN_PRIVATE_KEY!,
      });
      const form = (fields: Record<string, string>) => ({
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields).toString(),
        signal: AbortSignal.timeout(10_000),
      });

      const exchanged = await fetch(
        `${APPLE}/auth/token`,
        form({
          client_id: env.APPLE_CLIENT_ID,
          client_secret: clientSecret,
          code: authorizationCode,
          grant_type: 'authorization_code',
        }),
      );
      if (!exchanged.ok) {
        this.logger.warn(`Apple no canjeó el código para revocar: ${exchanged.status} ${await exchanged.text()}`);
        return 'failed';
      }
      const tokens = (await exchanged.json()) as { refresh_token?: string; access_token?: string };
      // El de refresco es el que corta la autorización entera; el de acceso, si
      // Apple no devolvió el otro, al menos el que acaba de emitir.
      const token = tokens.refresh_token ?? tokens.access_token;
      if (token === undefined) return 'failed';

      const revoked = await fetch(
        `${APPLE}/auth/revoke`,
        form({
          client_id: env.APPLE_CLIENT_ID,
          client_secret: clientSecret,
          token,
          token_type_hint: tokens.refresh_token === undefined ? 'access_token' : 'refresh_token',
        }),
      );
      if (!revoked.ok) {
        this.logger.warn(`Apple no revocó el token: ${revoked.status} ${await revoked.text()}`);
        return 'failed';
      }
      return 'revoked';
    } catch (error) {
      this.logger.warn(
        `No se pudo revocar el acceso de Apple: ${error instanceof Error ? error.message : error}`,
      );
      return 'failed';
    }
  }
}
