/**
 * Sesión: el token de Sinchi y quién es su dueño.
 *
 * Va en el llavero del dispositivo (Keychain en iOS, Keystore en Android), no en
 * `AsyncStorage`. Con ese token cualquiera lee el historial de pagos del alumno y
 * genera su QR; guardarlo en almacenamiento plano lo deja legible para cualquier
 * copia de seguridad sin cifrar del teléfono.
 *
 * El estado vive fuera de React, igual que el store, y se notifica por
 * suscripción. Así el enrutado por rol no depende de que un contexto esté montado.
 */
import * as SecureStore from 'expo-secure-store';
import type { AppRole } from '@sinchi/shared';

const TOKEN_KEY = 'sinchi.session.token.v1';
const META_KEY = 'sinchi.session.meta.v1';
/** Token del equipo del mostrador. Sobrevive a los cambios de turno. */
const DEVICE_KEY = 'sinchi.device.token.v1';
/**
 * Nombre y celular de quien todavía no tiene ficha.
 *
 * Se guardan en el dispositivo porque del otro lado viven con el código
 * pendiente, y ese **caduca a los diez minutos**: registrarse, cerrar la app y
 * volver a entrar los perdía, y la reserva volvía a preguntar justo lo que la
 * persona ya había escrito. Aquí no son un secreto —son sus propios datos, en su
 * propio teléfono— pero van al mismo llavero que el resto por no abrir un
 * almacén más.
 */
const DETAILS_KEY = 'sinchi.account.details.v1';
/**
 * Refresh token de Firebase de quien todavía no tiene ficha.
 *
 * Es LA credencial de esa persona. Quien ya está vinculado tiene un token de
 * Sinchi guardado y con eso vuelve a entrar solo; quien no, no tiene ninguno —
 * su sesión es la de Firebase— y sin guardar esto volvía al login cada vez que
 * se cerraba la app o Metro recargaba. Se guarda en el mismo llavero que el
 * token de sesión porque es exactamente lo mismo: una llave de larga vida.
 */
const PROSPECT_KEY = 'sinchi.account.firebase.v1';

export interface Session {
  readonly accessToken: string;
  readonly role: AppRole;
  readonly userId: string;
  readonly tenantId: string | null;
  /** Cuándo caduca, para no mandar un token muerto y comerse un 401. */
  readonly expiresAt: number;
}

export type SessionState =
  | { readonly status: 'loading' }
  | { readonly status: 'signed_out' }
  /**
   * La cuenta de Google es válida pero no está vinculada a ninguna ficha del
   * padrón. No es un error: es el estado normal del alumno nuevo, y lo resuelve
   * la recepcionista confirmando el código.
   */
  | {
      readonly status: 'unlinked';
      readonly code: string;
      readonly expiresAt: number;
      /**
       * El ID token de Firebase con el que entró.
       *
       * Se conserva porque es la única credencial que tiene quien todavía no
       * está vinculado, y con ella puede hacer lo único que le queda por hacer:
       * explorar gimnasios y reservar una clase gratis. Sin esto, el estado
       * `unlinked` es una pantalla con un código y ninguna salida.
       *
       * Solo en memoria, igual que el código: dura una hora y volver a entrar lo
       * renueva. Guardarlo en el llavero sería persistir una credencial de
       * Google para ahorrarse un toque.
       */
      readonly idToken: string;
      /**
       * Lo que escribió al crear la cuenta.
       *
       * Vive aquí para que reservar una clase gratis no vuelva a preguntárselo:
       * si la app ya lo sabe, el formulario de la reserva no aparece.
       */
      readonly fullName: string | null;
      readonly phone: string | null;
    }
  | { readonly status: 'signed_in'; readonly session: Session }
  /**
   * Recorrer la app sin api ni sesión, contra los datos de demostración.
   *
   * Solo existe en desarrollo (`__DEV__`), y `enterDemoMode` lo comprueba: en un
   * build de producción `__DEV__` es `false` y esta rama es inalcanzable. Sirve
   * para revisar las pantallas en un teléfono real sin depender de que la
   * autenticación con Google esté configurada.
   */
  | { readonly status: 'demo' };

let state: SessionState = { status: 'loading' };
const listeners = new Set<() => void>();

function emit(next: SessionState): void {
  state = next;
  for (const listener of listeners) listener();
}

export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const getSessionState = (): SessionState => state;

/** El token, o `null`. Es lo que consume el cliente HTTP. */
export function currentToken(): string | null {
  if (state.status !== 'signed_in') return null;
  // Un token vencido no se manda: el 401 obligaría a distinguir "expiró" de
  // "el servidor lo rechazó", y son dos problemas distintos.
  if (state.session.expiresAt <= Date.now()) return null;
  return state.session.accessToken;
}

export const currentSession = (): Session | null =>
  state.status === 'signed_in' ? state.session : null;

// ---------------------------------------------------------------------------
// Persistencia
// ---------------------------------------------------------------------------

interface StoredMeta {
  readonly role: AppRole;
  readonly userId: string;
  readonly tenantId: string | null;
  readonly expiresAt: number;
}

/**
 * Recupera la sesión al abrir la app.
 *
 * Si el token venció, se descarta en silencio y la app muestra el login. No se
 * intenta renovar: no hay refresh token porque el de Google se puede volver a
 * pedir sin fricción, y guardar uno más solo suma superficie que proteger.
 */
export async function restoreSession(
  recuperarCuentaSinFicha?: () => Promise<boolean>,
): Promise<void> {
  /**
   * Antes de darse por vencido, el intento de la cuenta sin ficha.
   *
   * Va aquí dentro y no en el arranque para no pasar por `signed_out`: emitirlo
   * y corregirlo después manda la app al login y la saca un instante más tarde,
   * que se ve como un parpadeo y se lee como que la sesión se cayó.
   */
  const caer = async (): Promise<void> => {
    if (recuperarCuentaSinFicha !== undefined && (await recuperarCuentaSinFicha())) return;
    emit({ status: 'signed_out' });
  };

  try {
    const [token, rawMeta] = await Promise.all([
      SecureStore.getItemAsync(TOKEN_KEY),
      SecureStore.getItemAsync(META_KEY),
    ]);

    if (token === null || rawMeta === null) {
      await caer();
      return;
    }

    const meta = JSON.parse(rawMeta) as StoredMeta;
    if (meta.expiresAt <= Date.now()) {
      // Se tira el token vencido pero NO la credencial de Firebase: con ella se
      // puede pedir una sesión nueva sin volver a pedirle la contraseña.
      await Promise.all([
        SecureStore.deleteItemAsync(TOKEN_KEY),
        SecureStore.deleteItemAsync(META_KEY),
      ]);
      await caer();
      return;
    }

    emit({
      status: 'signed_in',
      session: {
        accessToken: token,
        role: meta.role,
        userId: meta.userId,
        tenantId: meta.tenantId,
        expiresAt: meta.expiresAt,
      },
    });
  } catch {
    // Un llavero ilegible (dispositivo recién restaurado, permisos raros) no
    // debe dejar la app en `loading` para siempre.
    await caer();
  }
}

/** La credencial con la que vuelve a entrar quien no tiene ficha. */
export const loadFirebaseCredential = (): Promise<string | null> =>
  SecureStore.getItemAsync(PROSPECT_KEY);

export async function saveFirebaseCredential(refreshToken: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(PROSPECT_KEY, refreshToken);
  } catch {
    // Sin llavero, la sesión dura lo que dure la app. No es motivo para fallar
    // el login que acaba de funcionar.
  }
}

export async function saveSession(input: {
  readonly accessToken: string;
  readonly expiresInSeconds: number;
  readonly role: AppRole;
  readonly userId: string;
  readonly tenantId: string | null;
}): Promise<void> {
  const expiresAt = Date.now() + input.expiresInSeconds * 1000;
  const meta: StoredMeta = {
    role: input.role,
    userId: input.userId,
    tenantId: input.tenantId,
    expiresAt,
  };

  await Promise.all([
    SecureStore.setItemAsync(TOKEN_KEY, input.accessToken),
    SecureStore.setItemAsync(META_KEY, JSON.stringify(meta)),
  ]);

  // `meta` primero: ya lleva `expiresAt`, y ponerlo dos veces deja al lector
  // adivinando cual gana.
  emit({
    status: 'signed_in',
    session: { ...meta, accessToken: input.accessToken },
  });
}

/**
 * Entra en modo demostración.
 *
 * La comprobación de `__DEV__` no es decorativa: sin ella, un fallo de enrutado en
 * producción podría dejar a alguien dentro de la app sin sesión, viendo datos
 * inventados como si fueran suyos.
 */
export function enterDemoMode(): void {
  if (!__DEV__) {
    console.warn('El modo demostración no existe fuera de desarrollo.');
    return;
  }
  emit({ status: 'demo' });
}

export function setUnlinked(input: {
  readonly code: string;
  readonly expiresAt: number;
  readonly idToken: string;
  readonly fullName: string | null;
  readonly phone: string | null;
}): void {
  // No se persiste: el código dura diez minutos y el servidor devuelve el mismo
  // mientras siga vivo, así que volver a entrar lo recupera — con sus datos.
  emit({ status: 'unlinked', ...input });
}

/** Nombre y celular de quien todavía no tiene ficha. `null` si no los dio. */
export const currentAccountDetails = (): AccountDetails | null =>
  state.status === 'unlinked' ? { fullName: state.fullName, phone: state.phone } : null;

export interface AccountDetails {
  readonly fullName: string | null;
  readonly phone: string | null;
}

/**
 * Lo que esta persona dijo de sí misma, guardado en el dispositivo.
 *
 * Sobrevive a cerrar la app, que es justo lo que el código pendiente no hace.
 * Se manda en cada login para que el servidor lo tenga otra vez.
 */
export async function loadAccountDetails(): Promise<AccountDetails> {
  try {
    const raw = await SecureStore.getItemAsync(DETAILS_KEY);
    if (raw === null) return { fullName: null, phone: null };
    return JSON.parse(raw) as AccountDetails;
  } catch {
    return { fullName: null, phone: null };
  }
}

/**
 * Guarda lo que falte, sin borrar lo que ya había, y lo refleja en la sesión.
 *
 * Lo segundo importa dentro de la misma sesión: quien escribe su nombre al
 * reservar en un gimnasio no debería volver a escribirlo al abrir el siguiente,
 * y la pantalla decide eso mirando la sesión, no el llavero.
 */
export async function saveAccountDetails(details: AccountDetails): Promise<void> {
  const previo = await loadAccountDetails();
  const merged: AccountDetails = {
    fullName: details.fullName ?? previo.fullName,
    phone: details.phone ?? previo.phone,
  };

  if (merged.fullName === null && merged.phone === null) return;

  if (state.status === 'unlinked') {
    emit({ ...state, fullName: merged.fullName, phone: merged.phone });
  }

  try {
    await SecureStore.setItemAsync(DETAILS_KEY, JSON.stringify(merged));
  } catch {
    // Un llavero que no acepta escrituras no puede impedir una reserva: lo peor
    // que pasa es que la próxima vez se pregunte otra vez.
  }
}

/**
 * La credencial de quien entró pero todavía no tiene ficha.
 *
 * Es lo que firma la reserva de una clase gratis. `null` en cualquier otro
 * estado: con sesión de Sinchi se usa el token de Sinchi, que dice mucho más.
 */
export const currentFirebaseToken = (): string | null =>
  state.status === 'unlinked' ? state.idToken : null;

export async function clearSession(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(TOKEN_KEY),
    SecureStore.deleteItemAsync(META_KEY),
    // Salir de la cuenta también borra sus datos y su credencial: el siguiente
    // que entre en este teléfono no debe encontrar el nombre, el celular ni la
    // sesión de otro.
    SecureStore.deleteItemAsync(DETAILS_KEY),
    SecureStore.deleteItemAsync(PROSPECT_KEY),
  ]);
  emit({ status: 'signed_out' });
}

// ---------------------------------------------------------------------------
// Token del equipo del mostrador
// ---------------------------------------------------------------------------

/**
 * El token del equipo NO se borra al cerrar turno.
 *
 * Es del aparato, no de la persona: la tablet sigue siendo la tablet del dojo
 * cuando Ana se va y entra Carlos. Solo lo borra revocar el equipo desde el
 * panel del dueño.
 */
export const getDeviceToken = (): Promise<string | null> =>
  SecureStore.getItemAsync(DEVICE_KEY);

export const saveDeviceToken = (token: string): Promise<void> =>
  SecureStore.setItemAsync(DEVICE_KEY, token);

export const forgetDeviceToken = (): Promise<void> =>
  SecureStore.deleteItemAsync(DEVICE_KEY);
