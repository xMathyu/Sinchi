/**
 * Orquestación del login.
 *
 * Tres saltos, y cada uno responde algo distinto:
 *
 *   Google      ──> ¿quién eres ante Google?
 *   Firebase    ──> ¿quién eres ante ESTE proyecto?
 *   Sinchi      ──> ¿qué puedes hacer y en qué gimnasio?
 *
 * El último es el que importa para la app: el token de Sinchi lleva el rol y el
 * gimnasio. Los dos primeros solo sirven para llegar a él.
 *
 * El caso interesante es el cuarto resultado posible: la cuenta es válida pero no
 * está vinculada a ninguna ficha del padrón. No es un error — es el estado normal
 * del alumno que acaba de instalar la app, y lo resuelve la recepcionista.
 */
import * as SecureStore from 'expo-secure-store';
import { openShift, signInWithGoogle, staffForDevice, type ShiftCandidate } from './api';
import { exchangeGoogleToken } from './firebase';
import {
  clearSession,
  forgetDeviceToken,
  saveDeviceToken,
  saveSession,
  setUnlinked,
} from './session';
import { forgetSecret, storeSecret } from './crypto';

export type SignInOutcome =
  | { readonly kind: 'signed_in' }
  /** Falta que recepción confirme el código. */
  | { readonly kind: 'needs_link'; readonly code: string }
  | { readonly kind: 'error'; readonly message: string };

/**
 * Entra con el ID token que devolvió Google.
 *
 * No abre el navegador: eso lo hace la pantalla con `expo-auth-session`, porque
 * necesita hooks de React. Aquí queda todo lo que no es interfaz, que es lo que
 * se puede razonar y probar por separado.
 */
export async function completeGoogleSignIn(googleIdToken: string): Promise<SignInOutcome> {
  try {
    const firebaseIdToken = await exchangeGoogleToken(googleIdToken);
    const result = await signInWithGoogle(firebaseIdToken);

    if (!result.linked) {
      setUnlinked(result.claim.code, new Date(result.claim.expiresAt).getTime());
      return { kind: 'needs_link', code: result.claim.code };
    }

    await saveSession({
      accessToken: result.accessToken,
      expiresInSeconds: result.expiresInSeconds,
      role: result.role,
      userId: result.userId,
      tenantId: result.tenantId,
    });

    return { kind: 'signed_in' };
  } catch (error) {
    return { kind: 'error', message: describe(error) };
  }
}

// ---------------------------------------------------------------------------
// Turno del staff
// ---------------------------------------------------------------------------

/**
 * Quiénes pueden abrir turno en este equipo.
 *
 * Devuelve `null` si el equipo no está registrado, que es distinto de "la lista
 * está vacía": lo primero pide registrar el equipo, lo segundo pide asignar PIN.
 */
export async function shiftCandidates(): Promise<readonly ShiftCandidate[] | null> {
  try {
    return await staffForDevice();
  } catch {
    return null;
  }
}

export async function startShift(staffId: string, pin: string): Promise<SignInOutcome> {
  try {
    const result = await openShift(staffId, pin);
    await saveSession({
      accessToken: result.accessToken,
      expiresInSeconds: result.expiresInSeconds,
      role: result.role,
      userId: result.userId,
      tenantId: result.tenantId,
    });
    return { kind: 'signed_in' };
  } catch (error) {
    return { kind: 'error', message: describe(error) };
  }
}

/**
 * Registra este equipo con el token que dio el dueño.
 *
 * El token se pega una sola vez, al montar la tablet en el mostrador. Después
 * sobrevive a todos los cambios de turno: es del aparato, no de la persona.
 */
export async function registerThisDevice(deviceToken: string): Promise<SignInOutcome> {
  await saveDeviceToken(deviceToken.trim());
  const candidates = await shiftCandidates();

  if (candidates === null) {
    await forgetDeviceToken();
    return { kind: 'error', message: 'Ese token no corresponde a ningún gimnasio.' };
  }
  return { kind: 'signed_in' };
}

// ---------------------------------------------------------------------------
// Salir
// ---------------------------------------------------------------------------

/**
 * Cierra el turno o la sesión del alumno.
 *
 * `forgetTotpSecret` decide algo que no es obvio: al cerrar turno el secreto NO
 * se borra —el equipo del mostrador no tiene ninguno— pero cuando un alumno sale
 * de su cuenta sí, porque si presta el teléfono el siguiente no debe poder
 * generar su QR.
 */
export async function signOut(options: { readonly forgetTotpSecret: boolean }): Promise<void> {
  await clearSession();
  if (options.forgetTotpSecret) await forgetSecret();
}

// ---------------------------------------------------------------------------
// Secreto del QR
// ---------------------------------------------------------------------------

const LINKED_USER_KEY = 'sinchi.totp.owner.v1';

/**
 * Guarda el secreto TOTP que sembró la api, atado a su dueño.
 *
 * Se guarda también de QUIÉN es. Sin eso, un teléfono donde entraron dos
 * personas distintas seguiría generando el QR de la primera: el secreto es del
 * llavero del dispositivo, no de la sesión.
 */
export async function adoptTotpSecret(secretBase64: string, userId: string): Promise<void> {
  await storeSecret(secretBase64);
  await SecureStore.setItemAsync(LINKED_USER_KEY, userId);
}

/** `true` si el secreto guardado pertenece a quien tiene la sesión abierta. */
export async function totpSecretBelongsTo(userId: string): Promise<boolean> {
  const owner = await SecureStore.getItemAsync(LINKED_USER_KEY);
  return owner === userId;
}

function describe(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return 'Algo falló al iniciar sesión. Intenta de nuevo.';
}
