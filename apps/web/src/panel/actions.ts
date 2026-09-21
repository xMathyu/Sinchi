'use server';

/**
 * Lo que el panel ESCRIBE.
 *
 * Todo pasa por Server Actions y no por endpoints propios, y eso sale del mismo
 * sitio que la cookie `httpOnly`: si el navegador no puede mandar el token a la
 * api, quien lo manda es el servidor. Una Route Handler haria lo mismo a cambio
 * de inventar un segundo contrato HTTP —el del panel con su propio servidor—
 * que habria que documentar, versionar y validar aparte.
 *
 * Cada accion devuelve un `FormState` con el motivo, nunca un booleano. Es la
 * misma regla que el CLAUDE.md pide para el dominio: «no se pudo» deja a quien
 * lo lee sin saber que corregir. Aqui el motivo ya viene escrito en español
 * desde la api, asi que se deja pasar tal cual.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, api } from './api';
import { FirebaseAuthError, exchangeGoogleToken, signInWithEmail } from './firebase';
import { clearSession, writeSession } from './session';
import type { FormState } from './form-state';
import type { WireRoutineView } from './types';


/**
 * La respuesta de `/auth/google`, que tiene dos formas.
 *
 * `linked: false` es una cuenta de Firebase real sin ficha en ningun padron. En
 * la app eso lleva a la billetera vacia con «Explorar gimnasios»; aqui es un
 * callejon —el panel no tiene nada que enseñarle— asi que se contesta con la
 * frase que dice que hacer, que es abrir la app.
 */
type AuthResponse =
  | {
      readonly linked: true;
      readonly accessToken: string;
      readonly expiresInSeconds: number;
      readonly role: 'owner' | 'front_desk' | 'student';
      readonly userId: string;
      readonly tenantId: string | null;
    }
  | { readonly linked: false };

export async function entrar(_previous: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get('email') ?? '').trim();
  const password = String(form.get('password') ?? '');

  if (email.length === 0 || password.length === 0) {
    return { error: 'Escribe tu correo y tu contraseña.' };
  }

  return abrirSesion(() => signInWithEmail(email, password));
}

/**
 * Entrar con Google.
 *
 * Recibe la credencial que Google Identity Services le dio al navegador —no hay
 * forma de que la obtenga el servidor: el botón y el consentimiento son suyos—
 * y desde ahí todo pasa aquí. Al navegador no vuelve ni el token de Firebase ni
 * el de Sinchi.
 *
 * No es una Server Action de formulario porque no hay formulario: GIS llama a un
 * callback de JavaScript con la credencial, así que la firma es una función
 * normal que el componente de cliente invoca. El `credential` que llega es un
 * dato del navegador y por tanto no se cree nada de él: lo verifica Google al
 * canjearlo en `signInWithIdp`, y lo que sale de ahí lo vuelve a verificar la
 * api. Aquí solo se acota el tamaño para no mandar basura de 2 MB a Identity
 * Toolkit.
 */
export async function entrarConGoogle(credential: string): Promise<FormState> {
  if (typeof credential !== 'string' || credential.length < 100 || credential.length > 4096) {
    return { error: 'La respuesta de Google no se pudo leer. Intenta de nuevo.' };
  }

  return abrirSesion(() => exchangeGoogleToken(credential));
}

/**
 * De un ID token de Firebase a la cookie del panel.
 *
 * Es el tramo común de las dos puertas, y está en un solo sitio a propósito: lo
 * que decide aquí —que la cuenta tenga ficha, que sea dueño, cuánto dura la
 * cookie— tiene que valer igual entre por Google o por correo. Dos copias de
 * esta comprobación es como una de las dos puertas acaba dejando entrar a
 * recepción.
 */
async function abrirSesion(getIdToken: () => Promise<string>): Promise<FormState> {
  let session: AuthResponse;
  try {
    const idToken = await getIdToken();
    // `fetch` directo y no `api()`: `api()` exige sesion, y esta es justo la
    // peticion que la crea.
    session = await exchange(idToken);
  } catch (error) {
    if (error instanceof FirebaseAuthError) return { error: error.message };
    if (error instanceof ApiError) return { error: error.message };
    return { error: 'No se pudo entrar. Intenta de nuevo.' };
  }

  if (!session.linked) {
    return {
      error:
        'Esta cuenta todavía no está en ningún gimnasio. Si acabas de registrarte, abre la app de Sinchi para dar de alta tu local.',
    };
  }

  if (session.role !== 'owner' || session.tenantId === null) {
    // Recepcion tiene su sitio y es la app, de pie en el mostrador. Se dice, en
    // vez de dejarla entrar a un menu cuyas rutas le van a responder 403.
    return {
      error: 'El panel es para dueños. Si trabajas en recepción, entra desde la app de Sinchi.',
    };
  }

  await writeSession(
    {
      accessToken: session.accessToken,
      role: session.role,
      tenantId: session.tenantId,
      userId: session.userId,
      tenantName: await nombreDelLocal(session.accessToken, session.tenantId),
    },
    session.expiresInSeconds,
  );

  redirect('/panel');
}

/**
 * Cómo se llama el local, preguntado una sola vez.
 *
 * Sale de `/auth/modes`, que ya devuelve los puestos con el nombre del local
 * puesto — existe justo para que nadie tenga que elegir entre dos uuid. Es la
 * única ruta que da el nombre sin arrastrar el padrón entero detrás.
 *
 * Si falla, la sesión se abre igual con el nombre en blanco: quedarse fuera del
 * panel porque la barra lateral no sabe cómo titularse sería absurdo.
 */
async function nombreDelLocal(accessToken: string, tenantId: string): Promise<string> {
  const base = process.env.SINCHI_API_URL ?? 'http://localhost:3000/v1';

  try {
    const response = await fetch(`${base}/auth/modes`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });
    if (!response.ok) return 'Tu local';

    const modes = (await response.json()) as {
      readonly staff?: readonly { readonly tenantId: string; readonly tenantName: string | null }[];
    };
    const puesto = modes.staff?.find((post) => post.tenantId === tenantId);
    return puesto?.tenantName ?? 'Tu local';
  } catch {
    return 'Tu local';
  }
}

async function exchange(idToken: string): Promise<AuthResponse> {
  const base = process.env.SINCHI_API_URL ?? 'http://localhost:3000/v1';
  const response = await fetch(`${base}/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
    cache: 'no-store',
  });

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = (body as { message?: unknown } | null)?.message;
    throw new ApiError(
      response.status,
      typeof message === 'string' ? message : 'No se pudo abrir la sesión.',
      body,
    );
  }
  return body as AuthResponse;
}

export async function salir(): Promise<void> {
  await clearSession();
  redirect('/panel/entrar');
}

// ---------------------------------------------------------------------------
// Alumnos
// ---------------------------------------------------------------------------

/**
 * Cobra en el panel.
 *
 * El mismo `POST /staff/payments` que usa el mostrador, con el mismo efecto:
 * crea el cargo, adelanta la renovacion y libera la puerta. No hay una ruta
 * «del panel» porque no hay un cobro «del panel» — es el mismo hecho, y dos
 * caminos para escribir dinero son dos sitios donde comprobar la idempotencia.
 */
export async function cobrar(_previous: FormState, form: FormData): Promise<FormState> {
  const membershipId = String(form.get('membershipId') ?? '');
  const type = String(form.get('type') ?? 'renewal');
  const rail = String(form.get('rail') ?? 'cash');
  const amount = String(form.get('amountCents') ?? '').trim();

  if (membershipId.length === 0) return { error: 'Falta el alumno.' };

  try {
    await api('/staff/payments', {
      method: 'POST',
      body: {
        membershipId,
        type,
        rail,
        // La matrícula y la clase suelta no tienen tarifa derivable: van con
        // monto. La mensualidad lo calcula la api contra lo que se debe, y
        // mandarle uno inventado desde aquí es cómo se cuadra mal una caja.
        ...(type === 'renewal' || amount.length === 0
          ? {}
          : { amountCents: Math.round(Number(amount) * 100) }),
      },
    });
  } catch (error) {
    return { error: mensaje(error) };
  }

  revalidatePath(`/panel/alumnos/${membershipId}`);
  revalidatePath('/panel/alumnos');
  revalidatePath('/panel');
  return { error: null, ok: 'Cobro registrado.' };
}

/** Alta de un alumno. El ancla es el documento: si ya existe, reutiliza la identidad. */
export async function inscribir(_previous: FormState, form: FormData): Promise<FormState> {
  const documentId = String(form.get('documentId') ?? '').trim();
  const planId = String(form.get('planId') ?? '');
  const name = String(form.get('name') ?? '').trim();
  const phone = String(form.get('phone') ?? '').trim();
  const email = String(form.get('email') ?? '').trim();

  if (documentId.length < 6) return { error: 'El documento es obligatorio.' };
  if (planId.length === 0) return { error: 'Elige un plan.' };

  let created: { readonly membership?: { readonly id?: string } };
  try {
    created = await api('/staff/members', {
      method: 'POST',
      body: {
        documentId,
        planId,
        ...(name.length > 0 ? { name } : {}),
        ...(phone.length > 0 ? { phone } : {}),
        ...(email.length > 0 ? { email } : {}),
      },
    });
  } catch (error) {
    return { error: mensaje(error) };
  }

  revalidatePath('/panel/alumnos');
  revalidatePath('/panel');

  const id = created.membership?.id;
  if (typeof id === 'string') redirect(`/panel/alumnos/${id}`);
  redirect('/panel/alumnos');
}

// ---------------------------------------------------------------------------
// Materiales de clase
// ---------------------------------------------------------------------------

/** Publica una rutina o la devuelve a borrador. */
export async function cambiarEstadoRutina(
  routineId: string,
  status: 'draft' | 'published',
): Promise<FormState> {
  try {
    await api(`/staff/routines/${routineId}/status`, { method: 'POST', body: { status } });
  } catch (error) {
    return { error: mensaje(error) };
  }

  revalidatePath('/panel/materiales');
  revalidatePath(`/panel/materiales/${routineId}`);
  return { error: null, ok: status === 'published' ? 'Publicada.' : 'Vuelta a borrador.' };
}

/** De escaparate a contenido de alumnos, y al revés. */
export async function cambiarVisibilidadRutina(
  routineId: string,
  visibility: 'public' | 'members',
): Promise<FormState> {
  try {
    await api(`/staff/routines/${routineId}/visibility`, { method: 'POST', body: { visibility } });
  } catch (error) {
    return { error: mensaje(error) };
  }

  revalidatePath('/panel/materiales');
  revalidatePath(`/panel/materiales/${routineId}`);
  return { error: null };
}

/**
 * Crea o reescribe una rutina entera, pasos incluidos.
 *
 * La api recibe la rutina COMPLETA y no un parche, así que aquí se manda lo que
 * el formulario tenga. Es lo correcto para un editor de una sola pantalla: un
 * parche por campo abriría la puerta a guardar media rutina.
 */
export async function guardarRutina(_previous: FormState, form: FormData): Promise<FormState> {
  const routineId = String(form.get('routineId') ?? '').trim();
  const title = String(form.get('title') ?? '').trim();
  const summary = String(form.get('summary') ?? '').trim();
  const level = String(form.get('level') ?? '').trim();
  const visibility = String(form.get('visibility') ?? 'members');
  const videoUrl = String(form.get('videoUrl') ?? '').trim();

  if (title.length < 2) return { error: 'La rutina necesita un título.' };

  const videoAssetId = String(form.get('videoAssetId') ?? '').trim();

  const body = {
    title,
    summary: summary.length > 0 ? summary : null,
    level: level.length > 0 ? level : null,
    visibility,
    // O enlace, o archivo, o nada: lo fuerza un CHECK en la base, así que
    // mandar los dos no es un formulario tolerante sino un 400 garantizado.
    videoUrl: videoAssetId.length > 0 || videoUrl.length === 0 ? null : videoUrl,
    videoAssetId: videoAssetId.length > 0 ? videoAssetId : null,
    // Se conserva el estado que ya tenía: publicar y volver a borrador es una
    // ruta propia, con su botón. Un editor que despublica al guardar es la
    // sorpresa que hace que nadie se atreva a corregir una falta de ortografía.
    published: String(form.get('published') ?? '') === 'true',
    items: leerPasos(form),
  };

  let saved: WireRoutineView;
  try {
    saved = await api<WireRoutineView>(
      routineId.length > 0 ? `/staff/routines/${routineId}` : '/staff/routines',
      { method: 'POST', body },
    );
  } catch (error) {
    return { error: mensaje(error) };
  }

  revalidatePath('/panel/materiales');
  if (routineId.length > 0) {
    revalidatePath(`/panel/materiales/${routineId}`);
    return { error: null, ok: 'Guardada.' };
  }

  if (saved.unlocked) redirect(`/panel/materiales/${saved.card.routine.id}`);
  redirect('/panel/materiales');
}

/**
 * Los pasos, leídos de campos repetidos del formulario.
 *
 * `getAll` conserva el orden del DOM, que es el que el editor enseña, y ese
 * orden ES la `position`: numerarlos aparte permitiría que la lista guardada no
 * coincidiera con la que la persona acaba de ordenar.
 */
function leerPasos(form: FormData): readonly {
  readonly title: string;
  readonly instructions: string | null;
  readonly videoUrl: string | null;
  readonly prescription: string | null;
}[] {
  const titles = form.getAll('itemTitle').map(String);
  const instructions = form.getAll('itemInstructions').map(String);
  const videos = form.getAll('itemVideoUrl').map(String);
  const prescriptions = form.getAll('itemPrescription').map(String);

  return titles
    .map((title, i) => ({
      title: title.trim(),
      instructions: (instructions[i] ?? '').trim() || null,
      videoUrl: (videos[i] ?? '').trim() || null,
      prescription: (prescriptions[i] ?? '').trim() || null,
    }))
    // Una fila en blanco es la que el editor deja al final para escribir la
    // siguiente. Guardarla crearía un paso sin nombre en la app del alumno.
    .filter((item) => item.title.length > 0);
}

export async function borrarRutina(routineId: string): Promise<FormState> {
  try {
    await api(`/staff/routines/${routineId}`, { method: 'DELETE' });
  } catch (error) {
    return { error: mensaje(error) };
  }

  revalidatePath('/panel/materiales');
  redirect('/panel/materiales');
}

/**
 * Firma la subida de un video y devuelve a dónde mandar el archivo.
 *
 * El archivo NO pasa por aquí ni por la api: el navegador hace `PUT` contra el
 * almacenamiento con las cabeceras firmadas tal cual. Meter 300 MB por una
 * Server Action es la forma conocida de tumbar el proceso, y encima se pagaría
 * el tráfico dos veces.
 */
export async function firmarSubidaDeVideo(input: {
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly originalName: string;
}): Promise<
  | {
      readonly ok: true;
      readonly assetId: string;
      readonly uploadUrl: string;
      readonly headers: Readonly<Record<string, string>>;
    }
  | { readonly ok: false; readonly error: string }
> {
  try {
    const signed = await api<{
      assetId: string;
      uploadUrl: string;
      headers: Record<string, string>;
    }>('/staff/routines/videos', { method: 'POST', body: input });
    return { ok: true, ...signed };
  } catch (error) {
    return { ok: false, error: mensaje(error) };
  }
}

/**
 * Confirma que el archivo llegó.
 *
 * No se cree lo que dice el navegador: la api le pregunta al almacenamiento por
 * el tamaño real del objeto. «Ya subí» es justo lo que diría quien no subió
 * nada, y una rutina publicada contra un objeto inexistente es un reproductor en
 * negro que el dueño descubre por un alumno.
 */
export async function confirmarVideo(assetId: string): Promise<FormState> {
  try {
    await api(`/staff/routines/videos/${assetId}/ready`, { method: 'POST' });
  } catch (error) {
    return { error: mensaje(error) };
  }
  return { error: null, ok: 'Video listo.' };
}

/**
 * El motivo, en la frase que ya venía escrita.
 *
 * La api contesta en español y pensado para leerse. Taparlo con un «algo salió
 * mal» es tirar la única frase que decía qué corregir. El 401 sí se traduce:
 * «Sesión inválida» no le dice a nadie que tiene que volver a entrar.
 */
function mensaje(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.isUnauthorized) return 'Tu sesión venció. Vuelve a entrar.';
    if (error.isForbidden) return 'Esto es solo para el dueño del local.';
    return error.message;
  }
  return 'No se pudo completar la operación.';
}
