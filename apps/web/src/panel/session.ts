/**
 * La sesion del panel, en una cookie que el navegador no puede leer.
 *
 * El JWT de Sinchi lleva `tenantId`, `staffId` y `role` firmados: con el se abre
 * el padron, la caja y la biblioteca del gimnasio entero. En la app vive en el
 * llavero del telefono, que es lo mas parecido a un sitio seguro que hay ahi.
 * En un navegador no existe ese sitio — `localStorage` y `sessionStorage` los lee
 * cualquier script que llegue a la pagina—, asi que aqui va en cookie `httpOnly`.
 *
 * La consecuencia que da forma a todo el panel: una cookie `httpOnly` de
 * `sinchi.fit` tampoco viaja a Cloud Run, que esta en otro dominio. Quien habla
 * con la api es SIEMPRE el servidor de Next (`src/panel/api.ts`). El navegador
 * no ve el token ni la URL de la api, y no hace falta abrir CORS a nadie.
 */
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

/** Sin prefijo `__Host-`: se sirve en local por http, donde el prefijo no vale. */
const COOKIE = 'sinchi_panel';

export interface PanelSession {
  readonly accessToken: string;
  readonly role: 'owner' | 'front_desk' | 'student';
  readonly tenantId: string | null;
  readonly userId: string;
  /**
   * Como se llama el local, para la carcasa.
   *
   * Se resuelve UNA vez al entrar y viaja con la sesion. La alternativa era
   * pedirlo en cada pagina —no hay ruta que devuelva solo el tenant, habria que
   * traerse el padron entero— y eso es un viaje a Cloud Run por navegacion para
   * pintar una linea de la barra lateral. Si el dueño le cambia el nombre a su
   * local, la barra se entera cuando vuelva a entrar; el resto del panel, al
   * instante.
   */
  readonly tenantName: string;
}

/**
 * Lo que se guarda en la cookie.
 *
 * El rol y el gimnasio van DUPLICADOS junto al token, y no es que se confie en
 * ellos: la api vuelve a leerlos del JWT firmado en cada peticion. Estan aqui
 * solo para que la carcasa del panel sepa a quien esta pintando sin gastar un
 * viaje a la api en cada navegacion. Si alguien edita la cookie para decir que
 * es `owner`, lo unico que consigue es ver un menu cuyas rutas le responden 403.
 */
interface StoredSession extends PanelSession {
  /** Epoch en milisegundos. El mismo `exp` que lleva el token dentro. */
  readonly expiresAt: number;
}

export async function readSession(): Promise<PanelSession | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (raw === undefined) return null;

  try {
    const stored = JSON.parse(raw) as StoredSession;
    // Vencida en el reloj de aqui: no se manda a la api para que la rechace. El
    // viaje costaria un arranque en frio de Cloud Run para un no seguro.
    if (Date.now() >= stored.expiresAt) return null;
    return stored;
  } catch {
    // Una cookie ilegible es una cookie de otra version del panel. Se trata como
    // no tener sesion, que es lo que lleva al login en vez de a una pantalla rota.
    return null;
  }
}

export async function writeSession(
  session: PanelSession,
  expiresInSeconds: number,
): Promise<void> {
  const stored: StoredSession = { ...session, expiresAt: Date.now() + expiresInSeconds * 1000 };

  (await cookies()).set(COOKIE, JSON.stringify(stored), {
    httpOnly: true,
    sameSite: 'lax',
    // En local se sirve por http y una cookie `secure` no se guardaria: el login
    // parecia funcionar y la siguiente pagina rebotaba al login otra vez.
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: expiresInSeconds,
  });
}

export async function clearSession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

/**
 * La sesion de quien puede estar aqui, o al login.
 *
 * El panel es del DUENO. Recepcion tiene su sitio y es la app: cobra, marca la
 * puerta y responde mensajes desde el telefono, de pie en el mostrador. Dejarla
 * entrar aqui le enseñaria un menu entero —ganancias, materiales— cuyas rutas la
 * api le va a negar con 403, que es el defecto que este producto ya se conoce:
 * una accion que invita a algo que la api va a rechazar.
 *
 * El alumno con sesion de alumno tampoco: su superficie es su billetera.
 */
export async function requireOwner(): Promise<PanelSession & { readonly tenantId: string }> {
  const session = await readSession();
  if (session === null) redirect('/panel/entrar');

  if (session.role !== 'owner' || session.tenantId === null) {
    redirect('/panel/entrar?motivo=solo-duenos');
  }

  return { ...session, tenantId: session.tenantId };
}
