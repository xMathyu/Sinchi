'use server';

/**
 * Lo que el panel de Sinchi ESCRIBE.
 *
 * Todo por Server Actions, igual que el panel del dueño y por el mismo motivo:
 * si el navegador no puede mandar el token a la api, quien lo manda es el
 * servidor de Next. Aquí importa el doble — este token suspende y elimina
 * gimnasios.
 *
 * Cada acción devuelve el MOTIVO y nunca un booleano, y el motivo ya viene
 * escrito en español desde la api, así que se deja pasar tal cual.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, adminApi } from './api';
import { exchangeGoogleToken, FirebaseAuthError } from '../panel/firebase';
import { clearAdminSession, writeAdminSession } from './session';
import type { FormState } from '../panel/form-state';
import type { DeletionState } from './deletion-state';
import type { WireDeletionOutcome, WireGymDetail } from './types';

interface WireAdminSession {
  readonly accessToken: string;
  readonly expiresInSeconds: number;
  readonly adminId: string;
  readonly email: string;
  readonly name: string | null;
}

/**
 * Entrar, solo con Google.
 *
 * No hay puerta de correo y contraseña como en el panel del dueño, y no es una
 * simplificación: la api RECHAZA cualquier otra forma de entrar aquí
 * (`PlatformAdminService.signIn`). Dibujar un formulario que la api va a negar
 * es el defecto que este producto ya se conoce — una acción que invita a algo
 * que después no pasa.
 */
export async function entrarAlPanelDeSinchi(credential: string): Promise<FormState> {
  if (typeof credential !== 'string' || credential.length < 100 || credential.length > 4096) {
    return { error: 'La respuesta de Google no se pudo leer. Intenta de nuevo.' };
  }

  let session: WireAdminSession;
  try {
    const idToken = await exchangeGoogleToken(credential);
    // `fetch` directo y no `adminApi()`: esa exige sesión, y esta es justo la
    // petición que la crea.
    session = await exchange(idToken);
  } catch (error) {
    if (error instanceof FirebaseAuthError) return { error: error.message };
    if (error instanceof ApiError) return { error: error.message };
    return { error: 'No se pudo entrar. Intenta de nuevo.' };
  }

  await writeAdminSession(
    {
      accessToken: session.accessToken,
      adminId: session.adminId,
      email: session.email,
      name: session.name,
    },
    session.expiresInSeconds,
  );

  redirect('/admin');
}

async function exchange(idToken: string): Promise<WireAdminSession> {
  const base = process.env.SINCHI_API_URL ?? 'http://localhost:3000/v1';
  const response = await fetch(`${base}/admin/session`, {
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
  return body as WireAdminSession;
}

export async function salirDelPanelDeSinchi(): Promise<void> {
  await clearAdminSession();
  redirect('/admin/entrar');
}

// ---------------------------------------------------------------------------
// Gimnasios
// ---------------------------------------------------------------------------

/** Refresca todo lo que enseña un gimnasio. Se toca en tres pantallas. */
function revalidarGimnasio(tenantId: string): void {
  revalidatePath('/admin');
  revalidatePath('/admin/gimnasios');
  revalidatePath(`/admin/gimnasios/${tenantId}`);
}

/**
 * Edita un gimnasio.
 *
 * Solo viajan los campos que CAMBIARON. El formulario trae los valores actuales
 * como `data-*` para poder compararlos: mandar el formulario entero haría que
 * abrir la pantalla y guardar sin tocar nada apareciera en el registro como una
 * edición de doce campos, y el registro dejaría de servir para encontrar qué
 * cambió de verdad.
 */
export async function guardarGimnasio(
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  const tenantId = String(form.get('tenantId') ?? '');
  if (tenantId.length === 0) return { error: 'Falta el gimnasio.' };

  const texto = (campo: string): string | undefined => {
    const valor = String(form.get(campo) ?? '').trim();
    const antes = String(form.get(`${campo}__antes`) ?? '').trim();
    return valor === antes ? undefined : valor;
  };

  const entero = (campo: string): number | undefined => {
    const valor = texto(campo);
    if (valor === undefined) return undefined;
    const numero = Number(valor);
    return Number.isFinite(numero) ? numero : undefined;
  };

  /** Soles escritos a mano → céntimos. El campo se llena en soles, siempre. */
  const soles = (campo: string): number | undefined => {
    const valor = texto(campo);
    if (valor === undefined) return undefined;
    const numero = Number(valor);
    return Number.isFinite(numero) ? Math.round(numero * 100) : undefined;
  };

  const trialAntes = String(form.get('trialClassEnabled__antes') ?? '') === 'true';
  const trialAhora = form.get('trialClassEnabled') !== null;

  const patch = {
    ...(texto('name') === undefined ? {} : { name: texto('name') }),
    ...(texto('slug') === undefined ? {} : { slug: texto('slug') }),
    ...(texto('address') === undefined ? {} : { address: texto('address') || null }),
    ...(texto('taxId') === undefined ? {} : { taxId: texto('taxId') || null }),
    ...(texto('timezone') === undefined ? {} : { timezone: texto('timezone') }),
    ...(texto('saasTier') === undefined ? {} : { saasTier: texto('saasTier') }),
    ...(entero('graceDays') === undefined ? {} : { graceDays: entero('graceDays') }),
    ...(soles('dropInPrice') === undefined ? {} : { dropInPriceCents: soles('dropInPrice') }),
    ...(soles('enrollmentFee') === undefined
      ? {}
      : { enrollmentFeeCents: soles('enrollmentFee') }),
    ...(soles('trialClassPrice') === undefined
      ? {}
      : { trialClassPriceCents: soles('trialClassPrice') }),
    ...(trialAntes === trialAhora ? {} : { trialClassEnabled: trialAhora }),
  };

  if (Object.keys(patch).length === 0) return { error: null, ok: 'No cambiaste nada.' };

  try {
    await adminApi<WireGymDetail>(`/admin/gyms/${tenantId}`, { method: 'POST', body: patch });
  } catch (error) {
    return { error: mensaje(error) };
  }

  revalidarGimnasio(tenantId);
  return { error: null, ok: 'Guardado.' };
}

export async function suspenderGimnasio(
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  const tenantId = String(form.get('tenantId') ?? '');
  const reason = String(form.get('reason') ?? '').trim();

  try {
    await adminApi(`/admin/gyms/${tenantId}/suspend`, { method: 'POST', body: { reason } });
  } catch (error) {
    return { error: mensaje(error) };
  }

  revalidarGimnasio(tenantId);
  return { error: null, ok: 'Suspendido.' };
}

export async function reactivarGimnasio(tenantId: string): Promise<FormState> {
  try {
    await adminApi(`/admin/gyms/${tenantId}/restore`, { method: 'POST' });
  } catch (error) {
    return { error: mensaje(error) };
  }

  revalidarGimnasio(tenantId);
  return { error: null, ok: 'Reactivado.' };
}

/**
 * Elimina un gimnasio, con su identificador escrito a mano.
 *
 * Lo que se teclea viaja tal cual y lo compara la api: comprobarlo aquí y mandar
 * un «confirmado: true» convertiría la cerradura en una formalidad del
 * navegador. La misma regla vive en `@sinchi/shared` para poder apagar el botón
 * mientras no coincida, pero quien decide es el servidor.
 */
export async function eliminarGimnasio(
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  const tenantId = String(form.get('tenantId') ?? '');
  const slug = String(form.get('slug') ?? '').trim();

  try {
    await adminApi(`/admin/gyms/${tenantId}`, { method: 'DELETE', body: { slug } });
  } catch (error) {
    return { error: mensaje(error) };
  }

  revalidatePath('/admin');
  revalidatePath('/admin/gimnasios');
  redirect('/admin/gimnasios');
}

/** Registra lo que el gimnasio le pagó a Sinchi. El mismo camino que `saas:pay`. */
export async function registrarPago(_previous: FormState, form: FormData): Promise<FormState> {
  const tenantId = String(form.get('tenantId') ?? '');
  const rail = String(form.get('rail') ?? 'bank_transfer');
  const reference = String(form.get('reference') ?? '').trim();
  const amount = String(form.get('amount') ?? '').trim();

  let outcome: { readonly alreadyRecorded: boolean };
  try {
    outcome = await adminApi(`/admin/gyms/${tenantId}/payments`, {
      method: 'POST',
      body: {
        rail,
        reference: reference.length > 0 ? reference : null,
        // Sin monto, la api cobra la tarifa del escalón. Mandarle uno inventado
        // desde aquí es cómo se descuadra la caja de la empresa.
        ...(amount.length === 0 ? {} : { amountCents: Math.round(Number(amount) * 100) }),
      },
    });
  } catch (error) {
    return { error: mensaje(error) };
  }

  revalidarGimnasio(tenantId);
  return outcome.alreadyRecorded
    ? {
        error: null,
        // No es un error: el índice único lo paró. Es la red que evita
        // regalarle un mes al gimnasio cuando dos personas miran el mismo
        // correo del banco.
        ok: 'Ese periodo ya estaba pagado. No se registró nada.',
      }
    : { error: null, ok: 'Pago registrado.' };
}

// ---------------------------------------------------------------------------
// Códigos
// ---------------------------------------------------------------------------

export async function crearCodigo(_previous: FormState, form: FormData): Promise<FormState> {
  const code = String(form.get('code') ?? '').trim();
  const freeMonths = Number(String(form.get('freeMonths') ?? '1'));
  const sinTope = form.get('sinTope') !== null;
  const maxRaw = String(form.get('maxRedemptions') ?? '').trim();
  const expiresOn = String(form.get('expiresOn') ?? '').trim();
  const note = String(form.get('note') ?? '').trim();

  // Sin tope tiene que ser una casilla marcada a propósito, no un campo en
  // blanco: un código sin tope regala meses a todo el que lo reciba.
  if (!sinTope && maxRaw.length === 0) {
    return { error: 'Escribe el tope de usos, o marca «sin tope» a propósito.' };
  }

  try {
    await adminApi('/admin/promos', {
      method: 'POST',
      body: {
        code,
        freeMonths,
        maxRedemptions: sinTope ? null : Number(maxRaw),
        expiresOn: expiresOn.length > 0 ? expiresOn : null,
        note: note.length > 0 ? note : null,
      },
    });
  } catch (error) {
    return { error: mensaje(error) };
  }

  revalidatePath('/admin/codigos');
  return { error: null, ok: 'Código creado.' };
}

export async function cambiarEstadoCodigo(
  promoId: string,
  active: boolean,
): Promise<FormState> {
  try {
    await adminApi(`/admin/promos/${promoId}/status`, { method: 'POST', body: { active } });
  } catch (error) {
    return { error: mensaje(error) };
  }

  revalidatePath('/admin/codigos');
  return { error: null, ok: active ? 'Encendido.' : 'Apagado.' };
}

// ---------------------------------------------------------------------------
// El equipo
// ---------------------------------------------------------------------------

export async function invitarAdministrador(
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  const email = String(form.get('email') ?? '').trim();
  const name = String(form.get('name') ?? '').trim();

  try {
    await adminApi('/admin/admins', {
      method: 'POST',
      body: { email, ...(name.length > 0 ? { name } : {}) },
    });
  } catch (error) {
    return { error: mensaje(error) };
  }

  revalidatePath('/admin/equipo');
  return { error: null, ok: `${email} ya puede entrar con su cuenta de Google.` };
}

export async function quitarAdministrador(adminId: string): Promise<FormState> {
  try {
    await adminApi(`/admin/admins/${adminId}`, { method: 'DELETE' });
  } catch (error) {
    return { error: mensaje(error) };
  }

  revalidatePath('/admin/equipo');
  return { error: null, ok: 'Acceso retirado.' };
}

// ---------------------------------------------------------------------------
// Personas
// ---------------------------------------------------------------------------

/** La ruta de la api y la del panel para una persona, con o sin ficha. */
function rutas(kind: string, id: string): { readonly api: string; readonly panel: string } {
  return kind === 'account'
    ? { api: `/admin/accounts/${id}`, panel: `/admin/usuarios/cuenta/${id}` }
    : { api: `/admin/people/${id}`, panel: `/admin/usuarios/${id}` };
}

/**
 * Corrige la ficha. Manda los cuatro campos: la regla los juzga juntos
 * (`checkPersonDetails`), y un formulario que mandara solo lo cambiado haría
 * que el celular se validara sin el resto.
 */
export async function guardarPersona(_previous: FormState, form: FormData): Promise<FormState> {
  const userId = String(form.get('userId') ?? '');

  try {
    await adminApi(`/admin/people/${userId}`, {
      method: 'POST',
      body: {
        name: String(form.get('name') ?? ''),
        phone: String(form.get('phone') ?? ''),
        documentId: String(form.get('documentId') ?? ''),
        email: String(form.get('email') ?? ''),
      },
    });
  } catch (error) {
    return { error: mensaje(error) };
  }

  revalidatePath(`/admin/usuarios/${userId}`);
  revalidatePath('/admin/usuarios');
  return { error: null, ok: 'Guardado. Sus gimnasios ya ven los datos nuevos.' };
}

export async function banearPersona(_previous: FormState, form: FormData): Promise<FormState> {
  const kind = String(form.get('kind') ?? 'identity');
  const id = String(form.get('id') ?? '');
  const reason = String(form.get('reason') ?? '').trim();
  const { api, panel } = rutas(kind, id);

  try {
    await adminApi(`${api}/ban`, { method: 'POST', body: { reason } });
  } catch (error) {
    return { error: mensaje(error) };
  }

  revalidatePath(panel);
  revalidatePath('/admin/usuarios');
  return { error: null, ok: 'Baneada. Pierde la app en menos de un minuto en todos los servidores.' };
}

export async function levantarBaneo(
  banId: string,
  kind: string,
  id: string,
): Promise<FormState> {
  try {
    await adminApi(`/admin/bans/${banId}/lift`, { method: 'POST' });
  } catch (error) {
    return { error: mensaje(error) };
  }

  revalidatePath(rutas(kind, id).panel);
  revalidatePath('/admin/usuarios');
  return { error: null, ok: 'Baneo levantado.' };
}

/**
 * Elimina la cuenta, con lo escrito tal cual.
 *
 * Devuelve el RESULTADO y no redirige, y es a propósito: lo que la pantalla
 * tiene que enseñar después —cuántas fichas se fueron, cuántos cobros se
 * quedaron sin nombre y, sobre todo, si su usuario de Firebase se pudo borrar—
 * no cabe en una redirección. Si Firebase quedó sin borrar, falta un paso a mano
 * y quien lo hizo tiene que leerlo en ese momento.
 *
 * No revalida la ficha: ya no existe, y volver a pintarla daría un 404 encima
 * del resultado que había que leer.
 */
export async function eliminarPersona(
  _previous: DeletionState,
  form: FormData,
): Promise<DeletionState> {
  const kind = String(form.get('kind') ?? 'identity');
  const id = String(form.get('id') ?? '');
  const confirm = String(form.get('confirm') ?? '').trim();

  let outcome: WireDeletionOutcome;
  try {
    outcome = await adminApi<WireDeletionOutcome>(rutas(kind, id).api, {
      method: 'DELETE',
      body: { confirm },
    });
  } catch (error) {
    return { error: mensaje(error), outcome: null };
  }

  revalidatePath('/admin/usuarios');
  revalidatePath('/admin');
  return { error: null, outcome };
}

/**
 * El motivo, en la frase que ya venía escrita.
 *
 * El 401 se traduce porque aquí significa dos cosas distintas y las dos llevan
 * al mismo sitio: o la sesión venció, o alguien te retiró el acceso mientras
 * mirabas. «Vuelve a entrar» sirve para las dos — si fue lo segundo, no vas a
 * poder.
 */
function mensaje(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.isUnauthorized) return 'Tu sesión ya no vale. Vuelve a entrar.';
    return error.message;
  }
  return 'No se pudo completar la operación.';
}
