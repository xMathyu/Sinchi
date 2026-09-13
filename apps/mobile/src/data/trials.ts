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
  bookEvent,
  bookEventAsGuest,
  bookTrial,
  bookTrialAsGuest,
  cancelGuestTrial,
  cancelTrial,
  fetchGuestTrials,
  fetchMyTrials,
  rescheduleGuestTrial,
  rescheduleTrial,
  type BookEventDto,
  type BookTrialDto,
  type TrialBookingDto,
} from './api';
import {
  currentAccountDetails,
  currentFirebaseToken,
  getSessionState,
  saveAccountDetails,
} from './session';

/** Con qué credencial se puede reservar ahora mismo. */
export type BookingCredential =
  | { readonly kind: 'session' }
  | { readonly kind: 'guest'; readonly idToken: string }
  /** Nadie ha entrado: hay que pasar por el login antes de poder reservar. */
  | { readonly kind: 'none' };

export function bookingCredential(): BookingCredential {
  const state = getSessionState();
  if (state.status === 'signed_in') return { kind: 'session' };

  const idToken = currentFirebaseToken();
  return idToken === null ? { kind: 'none' } : { kind: 'guest', idToken };
}

/**
 * `true` solo si de verdad no sabemos quién es.
 *
 * Con identidad Sinchi los datos ya están en el padrón. Sin ficha, están en lo
 * que escribió al crear la cuenta. Preguntar otra vez lo que la persona acaba de
 * dar es la forma más rápida de que la reserva parezca un trámite — y de dejar
 * dos versiones de la misma persona en la lista del gimnasio.
 */
export function askForDetails(): boolean {
  if (bookingCredential().kind !== 'guest') return false;

  const details = currentAccountDetails();
  return (
    details === null ||
    (details.fullName ?? '').trim().length < 2 ||
    (details.phone ?? '').trim().length < 6
  );
}

/**
 * Vacío es AUSENTE.
 *
 * `??` solo cae con `null` y `undefined`, así que una cadena vacía —que es lo
 * que trae un campo que ni se enseñó— pasaba como si fuera un dato y tapaba lo
 * que sí sabíamos. Se coló entera hasta la api, que rechazó la reserva por
 * «nombre demasiado corto», y de paso dejó guardado un celular de tres
 * caracteres encima del bueno.
 */
export const present = (value: string | null | undefined): string | null => {
  const trimmed = (value ?? '').trim();
  return trimmed.length === 0 ? null : trimmed;
};

export class NoAccountError extends Error {
  constructor() {
    super('Entra con tu correo o con Google para reservar tu clase gratis.');
    this.name = 'SinCuenta';
  }
}

export async function bookTrialClass(input: {
  readonly slug: string;
  readonly slot: TrialSlot;
  /** Solo se usan como invitado. Con sesión se ignoran: ya los sabemos. */
  readonly fullName?: string;
  readonly phone?: string;
}): Promise<BookTrialDto> {
  const credential = bookingCredential();
  const date = formatPlainDate(input.slot.date);

  if (credential.kind === 'session') {
    return bookTrial({ slug: input.slug, classScheduleId: input.slot.scheduleId, date });
  }
  if (credential.kind === 'none') throw new NoAccountError();

  // Lo que la pantalla haya recogido manda; si no recogió nada, se usa lo que la
  // persona escribió al registrarse — y si tampoco, la api lo resuelve por su
  // cuenta contra el código pendiente.
  const guardado = currentAccountDetails();
  const fullName = present(input.fullName) ?? present(guardado?.fullName) ?? '';
  const phone = present(input.phone) ?? present(guardado?.phone) ?? '';

  // Se recuerdan en el dispositivo: si esta vez hubo que preguntarlos —porque la
  // cuenta se creó fuera del formulario de registro, o entró con Google sin
  // escribir su celular— la siguiente reserva, en este gimnasio o en otro, ya no
  // pregunta nada.
  await saveAccountDetails({ fullName: present(fullName), phone: present(phone) });

  return bookTrialAsGuest({
    slug: input.slug,
    idToken: credential.idToken,
    fullName,
    phone,
    classScheduleId: input.slot.scheduleId,
    date,
  });
}

/**
 * Coge plaza en un evento, venga con sesion o solo con su cuenta de Google.
 *
 * Vive aqui, junto a la clase gratis, porque es exactamente el mismo problema:
 * alguien que mira el directorio y puede no ser de ningun gimnasio todavia. Los
 * dos caminos —sesion y cuenta— se resuelven igual, y lo unico que cambia es que
 * al invitado a veces hay que preguntarle su nombre.
 */
export async function bookEventSeat(input: {
  readonly slug: string;
  readonly eventId: string;
  /** Solo se usan como invitado. Con sesión se ignoran: ya los sabemos. */
  readonly fullName?: string;
  readonly phone?: string;
}): Promise<BookEventDto> {
  const credential = bookingCredential();

  if (credential.kind === 'session') {
    return bookEvent({ slug: input.slug, eventId: input.eventId });
  }
  if (credential.kind === 'none') throw new NoAccountError();

  const guardado = currentAccountDetails();
  const fullName = present(input.fullName) ?? present(guardado?.fullName) ?? '';
  const phone = present(input.phone) ?? present(guardado?.phone) ?? '';

  // Se recuerdan en el dispositivo, igual que en la clase gratis: la siguiente
  // reserva, aqui o en otro gimnasio, ya no pregunta nada.
  await saveAccountDetails({ fullName: present(fullName), phone: present(phone) });

  return bookEventAsGuest({
    slug: input.slug,
    eventId: input.eventId,
    idToken: credential.idToken,
    fullName,
    phone,
  });
}

/** Las clases gratis que tiene reservadas, vengan por donde vengan. */
export async function myTrialClasses(): Promise<readonly TrialBookingDto[]> {
  const credential = bookingCredential();
  if (credential.kind === 'session') return fetchMyTrials();
  if (credential.kind === 'none') return [];
  return fetchGuestTrials(credential.idToken);
}

/**
 * Cambia la hora de una reserva que ya existe.
 *
 * Mismo criterio que todo lo de este archivo: con sesión va por `/me/trials`,
 * que ya sabe quién es; con solo cuenta de Google, por la ruta pública firmando
 * con el ID token.
 */
export async function rescheduleTrialClass(input: {
  readonly bookingId: string;
  readonly slot: TrialSlot;
}): Promise<BookTrialDto> {
  const credential = bookingCredential();
  const date = formatPlainDate(input.slot.date);

  if (credential.kind === 'session') {
    return rescheduleTrial({
      bookingId: input.bookingId,
      classScheduleId: input.slot.scheduleId,
      date,
    });
  }
  if (credential.kind === 'none') throw new NoAccountError();

  return rescheduleGuestTrial({
    bookingId: input.bookingId,
    idToken: credential.idToken,
    classScheduleId: input.slot.scheduleId,
    date,
  });
}

export async function cancelTrialClass(bookingId: string): Promise<void> {
  const credential = bookingCredential();
  if (credential.kind === 'session') {
    await cancelTrial(bookingId);
    return;
  }
  if (credential.kind === 'none') throw new NoAccountError();
  await cancelGuestTrial(bookingId, credential.idToken);
}
