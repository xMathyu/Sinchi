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
 * `true` solo si de verdad no sabemos quién es.
 *
 * Con identidad Sinchi los datos ya están en el padrón. Sin ficha, están en lo
 * que escribió al crear la cuenta. Preguntar otra vez lo que la persona acaba de
 * dar es la forma más rápida de que la reserva parezca un trámite — y de dejar
 * dos versiones de la misma persona en la lista del gimnasio.
 */
export function necesitaDatos(): boolean {
  if (cuentaParaReservar().kind !== 'guest') return false;

  const datos = currentAccountDetails();
  return (
    datos === null ||
    (datos.fullName ?? '').trim().length < 2 ||
    (datos.phone ?? '').trim().length < 6
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
const dato = (valor: string | null | undefined): string | null => {
  const limpio = (valor ?? '').trim();
  return limpio.length === 0 ? null : limpio;
};

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

  // Lo que la pantalla haya recogido manda; si no recogió nada, se usa lo que la
  // persona escribió al registrarse — y si tampoco, la api lo resuelve por su
  // cuenta contra el código pendiente.
  const guardado = currentAccountDetails();
  const fullName = dato(input.fullName) ?? dato(guardado?.fullName) ?? '';
  const phone = dato(input.phone) ?? dato(guardado?.phone) ?? '';

  // Se recuerdan en el dispositivo: si esta vez hubo que preguntarlos —porque la
  // cuenta se creó fuera del formulario de registro, o entró con Google sin
  // escribir su celular— la siguiente reserva, en este gimnasio o en otro, ya no
  // pregunta nada.
  await saveAccountDetails({ fullName: dato(fullName), phone: dato(phone) });

  return bookTrialAsGuest({
    slug: input.slug,
    idToken: cuenta.idToken,
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
export async function reservarPlazaEnEvento(input: {
  readonly slug: string;
  readonly eventId: string;
  /** Solo se usan como invitado. Con sesión se ignoran: ya los sabemos. */
  readonly fullName?: string;
  readonly phone?: string;
}): Promise<BookEventDto> {
  const cuenta = cuentaParaReservar();

  if (cuenta.kind === 'session') {
    return bookEvent({ slug: input.slug, eventId: input.eventId });
  }
  if (cuenta.kind === 'none') throw new SinCuenta();

  const guardado = currentAccountDetails();
  const fullName = dato(input.fullName) ?? dato(guardado?.fullName) ?? '';
  const phone = dato(input.phone) ?? dato(guardado?.phone) ?? '';

  // Se recuerdan en el dispositivo, igual que en la clase gratis: la siguiente
  // reserva, aqui o en otro gimnasio, ya no pregunta nada.
  await saveAccountDetails({ fullName: dato(fullName), phone: dato(phone) });

  return bookEventAsGuest({
    slug: input.slug,
    eventId: input.eventId,
    idToken: cuenta.idToken,
    fullName,
    phone,
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
