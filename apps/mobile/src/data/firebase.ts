/**
 * Intercambio del token de Google por un ID token de Firebase.
 *
 * Se usa la api REST de Identity Toolkit en vez del SDK de Firebase. El SDK
 * completo son varios megabytes en el bundle para usar exactamente un endpoint —
 * y ese endpoint está documentado y es estable.
 *
 * SOBRE LA `apiKey`. En Firebase **no es un secreto**: identifica el proyecto,
 * igual que un id de cliente OAuth, y no autoriza nada por sí sola. Viaja dentro
 * de `google-services.json`, de `GoogleService-Info.plist` y del binario
 * publicado — cualquiera la extrae de un APK descargado. Rotarla no cambiaría eso.
 *
 * Lo que sí protege es **restringirla**, y está restringida a las dos únicas APIs
 * que la app usa: `identitytoolkit` (el intercambio de abajo) y `securetoken`.
 * Venía de Firebase habilitada para 27, incluidas Firestore, Storage y
 * `sqladmin`; eso sí era una superficie innecesaria.
 *
 * Aun así no va escrita aquí, por dos razones prácticas:
 *
 *  · el escáner de secretos de GitHub la marca en cada commit, y un aviso que
 *    siempre es falso entrena a ignorar los avisos;
 *  · desarrollo y producción deberían usar proyectos de Firebase distintos, y un
 *    valor por defecto en el código hace fácil publicar apuntando al equivocado.
 *
 * Los valores están en `.env.example`. No son secretos: se pueden copiar tal cual.
 */

export interface FirebaseConfig {
  readonly apiKey: string;
  readonly projectId: string;
  readonly authDomain: string;
}

export const firebaseConfig: FirebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? '',
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? '',
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
};

/** `true` cuando hay configuración de Firebase con la que trabajar. */
export const firebaseConfigured = (): boolean =>
  firebaseConfig.apiKey.length > 0 && firebaseConfig.projectId.length > 0;

/**
 * Ids de cliente OAuth de Google.
 *
 * Los crea la consola de Firebase al habilitar el proveedor de Google, y hay uno
 * por plataforma. Sin ellos el botón de "entrar con Google" no puede ni abrir el
 * navegador, así que `googleAuthReady()` lo comprueba antes de mostrarlo — es
 * mejor decir "falta configurar" que abrir una pantalla que falla.
 */
export const googleClientIds = {
  web: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_WEB,
  ios: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS,
  android: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_ANDROID,
} as const;

export const googleAuthReady = (): boolean =>
  firebaseConfigured() &&
  Object.values(googleClientIds).some((id) => typeof id === 'string' && id.length > 0);

export class FirebaseAuthError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
  ) {
    super(message);
    this.name = 'FirebaseAuthError';
  }
}

interface SignInWithIdpResponse {
  readonly idToken?: string;
  readonly error?: { readonly message?: string; readonly code?: number };
}

/**
 * Cambia el ID token de Google por uno de Firebase.
 *
 * El de Google identifica a la persona ante Google; el de Firebase la identifica
 * ante *nuestro proyecto*, y es el único que la api sabe verificar. Sin este
 * paso, `/auth/google` rechazaría el token con 401 — el `aud` no coincidiría.
 */
export async function exchangeGoogleToken(googleIdToken: string): Promise<string> {
  if (!firebaseConfigured()) {
    throw new FirebaseAuthError(
      'Falta la configuración de Firebase en este build (ver .env.example).',
      'SIN_CONFIGURAR',
    );
  }

  const url =
    'https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=' +
    encodeURIComponent(firebaseConfig.apiKey);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        postBody: `id_token=${encodeURIComponent(googleIdToken)}&providerId=google.com`,
        // Identity Toolkit lo exige aunque no haya redirección real; con el flujo
        // nativo cualquier URI válida sirve.
        requestUri: `https://${firebaseConfig.authDomain}`,
        returnSecureToken: true,
        returnIdpCredential: true,
      }),
    });
  } catch {
    throw new FirebaseAuthError('No se pudo conectar con Google para verificar tu cuenta.', null);
  }

  const payload = (await response.json()) as SignInWithIdpResponse;

  if (!response.ok || typeof payload.idToken !== 'string') {
    const raw = payload.error?.message ?? 'ERROR_DESCONOCIDO';
    throw new FirebaseAuthError(humanize(raw), raw);
  }

  return payload.idToken;
}

/**
 * Traduce los códigos de Identity Toolkit.
 *
 * Los mensajes de Google son para desarrolladores (`OPERATION_NOT_ALLOWED`), y
 * mostrárselos a un alumno en la puerta del gimnasio no ayuda a nadie.
 */
function humanize(code: string): string {
  if (code.startsWith('OPERATION_NOT_ALLOWED')) {
    return 'El acceso con Google no está habilitado todavía. Avísale al gimnasio.';
  }
  if (code.startsWith('INVALID_IDP_RESPONSE') || code.startsWith('INVALID_ID_TOKEN')) {
    return 'La respuesta de Google no se pudo verificar. Intenta de nuevo.';
  }
  if (code.startsWith('USER_DISABLED')) {
    return 'Esta cuenta está deshabilitada.';
  }
  return 'No se pudo entrar con Google. Intenta de nuevo.';
}
