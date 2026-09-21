/**
 * La sesión del panel de SINCHI, en su propia cookie.
 *
 * Cookie aparte de la del panel del dueño (`sinchi_panel`) y no un campo más
 * dentro de ella. Son dos poderes distintos y separarlos tiene consecuencias
 * concretas:
 *
 *  - entrar a administrar Sinchi no cierra la sesión del gimnasio que tengas
 *    abierta, ni al revés. La misma persona puede ser dueña de un dojo Y
 *    administrar la plataforma, y eso no es un caso raro aquí: es el caso;
 *  - una cookie con dos sesiones dentro es una donde un día alguien lee el
 *    token equivocado. Aquí no hay elección posible: cada `api()` lee la suya.
 *
 * Por lo demás es idéntica a la del dueño, por lo mismo (`src/panel/session.ts`):
 * `httpOnly`, porque en un navegador no hay sitio seguro donde guardar un token,
 * y el que guarda esta abre la red entera.
 */
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

/** Sin prefijo `__Host-`: se sirve en local por http, donde el prefijo no vale. */
const COOKIE = 'sinchi_admin';

export interface AdminSession {
  readonly accessToken: string;
  readonly adminId: string;
  readonly email: string;
  readonly name: string | null;
}

interface StoredSession extends AdminSession {
  /** Epoch en milisegundos. El mismo `exp` que lleva el token dentro. */
  readonly expiresAt: number;
}

export async function readAdminSession(): Promise<AdminSession | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (raw === undefined) return null;

  try {
    const stored = JSON.parse(raw) as StoredSession;
    if (Date.now() >= stored.expiresAt) return null;
    return stored;
  } catch {
    // Una cookie ilegible es una de otra versión del panel: se trata como no
    // tener sesión, que lleva al login en vez de a una pantalla rota.
    return null;
  }
}

export async function writeAdminSession(
  session: AdminSession,
  expiresInSeconds: number,
): Promise<void> {
  const stored: StoredSession = { ...session, expiresAt: Date.now() + expiresInSeconds * 1000 };

  (await cookies()).set(COOKIE, JSON.stringify(stored), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    // Acotada a `/admin`: la cookie del panel de Sinchi no tiene nada que hacer
    // viajando en cada petición de la landing ni del panel del dueño.
    path: '/admin',
    maxAge: expiresInSeconds,
  });
}

export async function clearAdminSession(): Promise<void> {
  (await cookies()).delete({ name: COOKIE, path: '/admin' });
}

/**
 * La sesión de quien puede estar aquí, o al login.
 *
 * Aquí no hay comprobación de rol como en `requireOwner`: el token del panel de
 * Sinchi no existe en otra forma —o es de quien administra la plataforma, o no
 * es— y la api vuelve a comprobar en CADA petición que el acceso siga vigente.
 * Lo que esta cookie sostiene es no tener que volver a entrar en cada página.
 */
export async function requireAdmin(): Promise<AdminSession> {
  const session = await readAdminSession();
  if (session === null) redirect('/admin/entrar');
  return session;
}
