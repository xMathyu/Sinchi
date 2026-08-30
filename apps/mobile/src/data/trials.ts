/**
 * Explorar gimnasios y reservar la clase gratis.
 *
 * Va aparte de `actions.ts` —que son las escrituras del staff— porque atiende a
 * otra persona: alguien que todavía no es alumno de ningún gimnasio y muchas
 * veces ni siquiera tiene ficha en Sinchi.
 *
 * El criterio para decidir por dónde va cada llamada es el mismo que en
 * `actions.ts`: **el estado de la sesión**, no una bandera de configuración.
 *
 *   sesión de Sinchi  ──> `/me/trials`, que ya sabe quién es
 *   solo cuenta de Google ──> `/gyms/...` firmando con el ID token de Firebase
 *
 * La segunda existe porque el estado `unlinked` —cuenta válida, sin ficha en
 * ningún padrón— era hasta ahora una pantalla con un código de seis dígitos y
 * ninguna salida. Es exactamente la persona que este producto quiere: la que
 * todavía no entrena en ningún sitio.
 */
import { formatPlainDate, type TrialSlot } from '@sinchi/shared';
import {
  bookTrial,
  bookTrialAsGuest,
  cancelGuestTrial,
  cancelTrial,
  fetchGuestTrials,
  fetchMyTrials,
  type BookTrialDto,
  type TrialBookingDto,
} from './api';
import { currentFirebaseToken, getSessionState } from './session';

/** Con qué credencial se puede reservar ahora mismo. */
export type CuentaParaReservar =
  | { readonly kind: 'session' }
  | { readonly kind: 'guest'; readonly idToken: string }
  /** Nadie ha entrado: hay que pasar por el login antes de poder reservar. */
  | { readonly kind: 'none' };

export function cuentaParaReservar(): CuentaParaReservar {
  const estado = getSessionState();
  if (estado.status === 'signed_in') return { kind: 'session' };

  const idToken = currentFirebaseToken();
  return idToken === null ? { kind: 'none' } : { kind: 'guest', idToken };
}

/**
 * `true` si hará falta preguntarle el nombre y el celular.
 *
 * Con identidad Sinchi ya se saben, y volver a preguntarlos dejaría dos
 * versiones de la misma persona en la lista del gimnasio.
 */
export const necesitaDatos = (): boolean => cuentaParaReservar().kind === 'guest';

export class SinCuenta extends Error {
  constructor() {
    super('Entra con tu correo o con Google para reservar tu clase gratis.');
    this.name = 'SinCuenta';
  }
}

export async function reservarClaseGratis(input: {
  readonly slug: string;
  readonly slot: TrialSlot;
  /** Solo se usan como invitado. Con sesión se ignoran: ya los sabemos. */
  readonly fullName?: string;
  readonly phone?: string;
}): Promise<BookTrialDto> {
  const cuenta = cuentaParaReservar();
  const date = formatPlainDate(input.slot.date);

  if (cuenta.kind === 'session') {
    return bookTrial({ slug: input.slug, classScheduleId: input.slot.scheduleId, date });
  }
  if (cuenta.kind === 'none') throw new SinCuenta();

  return bookTrialAsGuest({
    slug: input.slug,
    idToken: cuenta.idToken,
    fullName: (input.fullName ?? '').trim(),
    phone: (input.phone ?? '').trim(),
    classScheduleId: input.slot.scheduleId,
    date,
  });
}

/** Las clases gratis que tiene reservadas, vengan por donde vengan. */
export async function misClasesGratis(): Promise<readonly TrialBookingDto[]> {
  const cuenta = cuentaParaReservar();
  if (cuenta.kind === 'session') return fetchMyTrials();
  if (cuenta.kind === 'none') return [];
  return fetchGuestTrials(cuenta.idToken);
}

export async function cancelarClaseGratis(bookingId: string): Promise<void> {
  const cuenta = cuentaParaReservar();
  if (cuenta.kind === 'session') {
    await cancelTrial(bookingId);
    return;
  }
  if (cuenta.kind === 'none') throw new SinCuenta();
  await cancelGuestTrial(bookingId, cuenta.idToken);
}
