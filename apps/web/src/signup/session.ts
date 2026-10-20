/**
 * La credencial del alta, entre el paso de la cuenta y el del gimnasio.
 *
 * El alta son dos pantallas —primero la cuenta, después el local— y entre las
 * dos hay que guardar el ID token de Firebase con el que se firma
 * `POST /gyms/signup`. Va en una cookie `httpOnly` y no en el estado del
 * navegador por lo mismo que la sesión del panel (`src/panel/session.ts`): un
 * token que abre una identidad no se deja al alcance de `document.cookie`. Y
 * además así recargar la página no pierde el paso: el servidor lee la cookie y
 * pinta el formulario del gimnasio directamente.
 *
 * Dura menos que el token. Firebase firma por una hora; una cookie que
 * sobreviviera al token mandaría a la api una firma vencida y el alta rebotaría
 * con un 401 que el dueño no entiende. Vencida la cookie, la página vuelve al
 * primer paso y lo dice.
 */
import 'server-only';
import { cookies } from 'next/headers';

const COOKIE = 'sinchi_alta';

/** Firebase firma por 60 minutos; el margen es para llenar el formulario. */
const MAX_AGE_SECONDS = 50 * 60;

export interface SignupIdentity {
  readonly idToken: string;
  /** Para decir «registrando como…». Con Google viene siempre; con correo también. */
  readonly email: string | null;
  /** Para dejar el nombre ya puesto. Solo lo da Google. */
  readonly displayName: string | null;
  readonly provider: 'google' | 'email';
}

interface StoredIdentity extends SignupIdentity {
  /** Epoch en milisegundos. */
  readonly expiresAt: number;
}

export async function readSignupIdentity(): Promise<SignupIdentity | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (raw === undefined) return null;

  try {
    const stored = JSON.parse(raw) as StoredIdentity;
    if (Date.now() >= stored.expiresAt) return null;
    return stored;
  } catch {
    // Una cookie ilegible es de otra versión del alta: se trata como no tenerla.
    return null;
  }
}

export async function writeSignupIdentity(identity: SignupIdentity): Promise<void> {
  const stored: StoredIdentity = { ...identity, expiresAt: Date.now() + MAX_AGE_SECONDS * 1000 };

  (await cookies()).set(COOKIE, JSON.stringify(stored), {
    httpOnly: true,
    sameSite: 'lax',
    // En local se sirve por http: una cookie `secure` no se guardaría y el
    // segundo paso rebotaría al primero sin decir por qué.
    secure: process.env.NODE_ENV === 'production',
    path: '/registrar',
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function clearSignupIdentity(): Promise<void> {
  // Con el mismo `path` con el que se escribió, o el navegador borra otra.
  (await cookies()).set(COOKIE, '', { path: '/registrar', maxAge: 0 });
}
