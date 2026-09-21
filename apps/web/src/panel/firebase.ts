/**
 * Cambio de correo y contraseña por un ID token de Firebase.
 *
 * Es la misma api REST de Identity Toolkit que usa la app
 * (`apps/mobile/src/data/firebase.ts`), y por la misma razon: el SDK de Firebase
 * son varios megabytes para usar exactamente un endpoint documentado y estable.
 *
 * La diferencia con la app es donde corre. Aqui la llamada la hace el SERVIDOR
 * de Next, no el navegador, y eso no es un detalle de implementacion: el ID
 * token de Firebase nunca toca el cliente, se canjea en el mismo proceso por la
 * sesion de Sinchi y lo que vuelve al navegador es una cookie `httpOnly`. El
 * formulario del login manda correo y contraseña por POST y no ve ningun token.
 *
 * SOBRE LA `apiKey`: en Firebase no es un secreto —identifica el proyecto, como
 * un id de cliente OAuth— y esta restringida a `identitytoolkit` y `securetoken`.
 * El razonamiento completo esta en `docs/autenticacion.md`. Aqui va igualmente
 * por variable de entorno y sin defecto en el codigo, por lo mismo que en la
 * app: desarrollo y produccion deberian apuntar a proyectos distintos.
 */
import 'server-only';

export class FirebaseAuthError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
  ) {
    super(message);
    this.name = 'FirebaseAuthError';
  }
}

const apiKey = (): string => process.env.FIREBASE_API_KEY ?? '';

/** `true` cuando hay con que autenticar. El login lo dice en pantalla si no. */
export const firebaseConfigured = (): boolean => apiKey().length > 0;

interface SignInResponse {
  readonly idToken?: string;
  readonly error?: { readonly message?: string };
}

/**
 * Entra con correo y contraseña, y devuelve el ID token de Firebase.
 *
 * Solo `signIn`: aqui no se crean cuentas. El dueño de un gimnasio llega al
 * panel con la cuenta que ya tiene —la registramos nosotros al dar de alta el
 * local, en la reunion de venta, y es con la que su vinculo automatico por
 * `email_verified` funciona (`docs/autenticacion.md`)—. Un «crear cuenta» aqui
 * daria de alta a una persona sin gimnasio detras, que aterriza en un panel
 * vacio sin nada que hacer.
 */
export async function signInWithEmail(email: string, password: string): Promise<string> {
  if (!firebaseConfigured()) {
    throw new FirebaseAuthError(
      'Falta configurar el acceso en este despliegue (ver .env.example).',
      'SIN_CONFIGURAR',
    );
  }

  let response: Response;
  try {
    response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey())}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password,
          returnSecureToken: true,
        }),
      },
    );
  } catch {
    throw new FirebaseAuthError('No se pudo contactar al servicio de acceso.', null);
  }

  const payload = (await response.json()) as SignInResponse;

  if (!response.ok || typeof payload.idToken !== 'string') {
    const raw = payload.error?.message ?? 'ERROR_DESCONOCIDO';
    throw new FirebaseAuthError(humanize(raw), raw);
  }

  return payload.idToken;
}

/**
 * Cambia la credencial de Google por un ID token de Firebase.
 *
 * Son dos tokens distintos y el paso no se puede saltar: el de Google identifica
 * a la persona ante GOOGLE; el de Firebase la identifica ante NUESTRO proyecto,
 * y es el único que la api sabe verificar. Mandando el de Google a
 * `/auth/google` el `aud` no coincide y responde 401.
 *
 * Quien obtiene la credencial es el navegador —Google Identity Services dibuja
 * su propio botón y no hay forma de que lo haga el servidor— pero el intercambio
 * y todo lo que sigue pasan aquí. Al navegador nunca vuelve el token de Firebase
 * ni el de Sinchi: vuelve la cookie `httpOnly` y nada más.
 */
export async function exchangeGoogleToken(googleIdToken: string): Promise<string> {
  if (!firebaseConfigured()) {
    throw new FirebaseAuthError(
      'Falta configurar el acceso en este despliegue (ver .env.example).',
      'SIN_CONFIGURAR',
    );
  }

  let response: Response;
  try {
    response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${encodeURIComponent(apiKey())}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postBody: `id_token=${encodeURIComponent(googleIdToken)}&providerId=google.com`,
          // Identity Toolkit lo exige aunque no haya redirección real. Va el
          // dominio de auth del proyecto, igual que en la app.
          requestUri: `https://${process.env.FIREBASE_AUTH_DOMAIN ?? 'localhost'}`,
          returnSecureToken: true,
          returnIdpCredential: true,
        }),
      },
    );
  } catch {
    throw new FirebaseAuthError('No se pudo contactar a Google para verificar tu cuenta.', null);
  }

  const payload = (await response.json()) as SignInResponse;

  if (!response.ok || typeof payload.idToken !== 'string') {
    const raw = payload.error?.message ?? 'ERROR_DESCONOCIDO';
    throw new FirebaseAuthError(humanizeGoogle(raw), raw);
  }

  return payload.idToken;
}

/**
 * Si este despliegue puede ofrecer Google.
 *
 * Se comprueba, no se asume, y por lo mismo que en la app (`googleAuthReady`):
 * Google necesita un cliente OAuth que solo se crea desde la consola de Firebase
 * —no hay api pública, y el rodeo de IAP que existía Google lo apagó en marzo de
 * 2026—. Mientras no esté, el botón no se dibuja. Enseñar uno que lleva a
 * «OPERATION_NOT_ALLOWED» es la forma más cara de decir «falta configurar».
 *
 * El id de cliente es público —viaja en el HTML de cualquier sitio que use
 * Google Sign-In— así que va con `NEXT_PUBLIC_`. La `apiKey` no hace falta que
 * viaje: el intercambio corre en el servidor.
 */
export const googleReady = (): boolean =>
  firebaseConfigured() && (process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? '').length > 0;

/** Los códigos del proveedor de identidad hablan de otra cosa que los de correo. */
function humanizeGoogle(code: string): string {
  if (code.startsWith('OPERATION_NOT_ALLOWED')) {
    return 'El acceso con Google no está habilitado todavía en este proyecto.';
  }
  if (code.startsWith('INVALID_IDP_RESPONSE') || code.startsWith('INVALID_ID_TOKEN')) {
    return 'La respuesta de Google no se pudo verificar. Intenta de nuevo.';
  }
  if (code.startsWith('USER_DISABLED')) return 'Esta cuenta está deshabilitada.';
  return 'No se pudo entrar con Google. Intenta de nuevo.';
}

/**
 * La frase que lee la persona.
 *
 * Los codigos de Identity Toolkit estan en ingles y hablan de la implementacion
 * (`INVALID_LOGIN_CREDENTIALS`). Se traducen igual que en la app, y una cuenta
 * que no existe y una contraseña equivocada dicen LO MISMO a proposito: la
 * diferencia le dice a quien prueba correos al azar cual de ellos tiene cuenta.
 */
function humanize(code: string): string {
  if (
    code.startsWith('INVALID_LOGIN_CREDENTIALS') ||
    code.startsWith('INVALID_PASSWORD') ||
    code.startsWith('EMAIL_NOT_FOUND')
  ) {
    return 'Correo o contraseña incorrectos.';
  }
  if (code.startsWith('INVALID_EMAIL')) return 'Ese correo no parece válido.';
  if (code.startsWith('TOO_MANY_ATTEMPTS')) return 'Demasiados intentos. Espera unos minutos.';
  if (code.startsWith('USER_DISABLED')) return 'Esta cuenta está deshabilitada.';
  if (code.startsWith('OPERATION_NOT_ALLOWED')) {
    return 'El acceso con correo no está habilitado en este proyecto.';
  }
  return 'No se pudo entrar. Intenta de nuevo.';
}
