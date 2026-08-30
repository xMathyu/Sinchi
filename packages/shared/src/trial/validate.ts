/**
 * Quien puede reservar la clase gratis, y por que no.
 *
 * Misma forma que `validateCheckIn`: devuelve un MOTIVO ESTRUCTURADO en vez de
 * un booleano. "No se pudo reservar" deja al interesado sin saber si el problema
 * es que ya la uso, que el gimnasio no la ofrece o que eligio una clase que ya
 * paso — y cada uno tiene una salida distinta.
 *
 * Es una funcion pura y la corren los dos lados: la app para no ofrecer lo que
 * va a fallar, la api para no confiar en que la app lo hizo.
 */
import { weekdayName } from '../checkin/messages.js';
import { isoWeekday, type PlainDate } from '../time/plain-date.js';
import type { TrialSlot } from './slots.js';
import { findSlot } from './slots.js';

export type TrialDenialCode =
  | 'gym_unavailable'
  | 'not_offered'
  | 'already_member'
  | 'already_booked'
  | 'slot_not_available';

export type TrialDenialReason =
  | { readonly code: 'gym_unavailable' }
  | { readonly code: 'not_offered' }
  | { readonly code: 'already_member' }
  | {
      readonly code: 'already_booked';
      /** La que ya tiene: se la recuerda en vez de decirle que no y ya. */
      readonly date: PlainDate;
      readonly startTime: string;
      readonly className: string;
    }
  | { readonly code: 'slot_not_available' };

export type TrialBookingResult =
  | { readonly allowed: true; readonly slot: TrialSlot }
  | { readonly allowed: false; readonly reason: TrialDenialReason };

/** La reserva que ya existe, mirada desde aqui. */
export interface ExistingTrial {
  readonly date: PlainDate;
  readonly startTime: string;
  readonly className: string;
}

export interface TrialBookingContext {
  /** `false` cuando el gimnasio esta suspendido: no recibe alumnos nuevos. */
  readonly gymActive: boolean;
  /** El gimnasio ofrece la clase gratis. Es configuracion suya, no del producto. */
  readonly trialOffered: boolean;
  /** Ya entrena aqui: la clase gratis es para conocer el local, no un descuento. */
  readonly alreadyMember: boolean;
  /** Reserva vigente en ESTE gimnasio, si la hay. Una por persona y local. */
  readonly existing: ExistingTrial | null;
  /** Las opciones reales, de `upcomingClassSlots`. */
  readonly slots: readonly TrialSlot[];
  /** Lo que el alumno eligio. */
  readonly scheduleId: string;
  readonly date: PlainDate;
}

/**
 * El orden importa y es el mismo criterio que en la puerta: primero lo que no
 * depende de la eleccion —el gimnasio, el derecho a la clase— y solo al final
 * la clase elegida. Al reves, a alguien que ya uso su clase gratis se le diria
 * "esa clase ya no esta disponible", que no es el problema.
 */
export function validateTrialBooking(context: TrialBookingContext): TrialBookingResult {
  if (!context.gymActive) return { allowed: false, reason: { code: 'gym_unavailable' } };
  if (!context.trialOffered) return { allowed: false, reason: { code: 'not_offered' } };
  if (context.alreadyMember) return { allowed: false, reason: { code: 'already_member' } };

  if (context.existing !== null) {
    return {
      allowed: false,
      reason: {
        code: 'already_booked',
        date: context.existing.date,
        startTime: context.existing.startTime,
        className: context.existing.className,
      },
    };
  }

  const slot = findSlot(context.slots, context.scheduleId, context.date);
  if (slot === null) return { allowed: false, reason: { code: 'slot_not_available' } };

  return { allowed: true, slot };
}

export interface TrialMessage {
  readonly title: string;
  readonly detail: string;
}

/**
 * El rechazo, dicho en la voz del interesado.
 *
 * Vive con la regla y no en la pantalla por lo mismo que `accessMessage`: la
 * app y el correo del gimnasio tienen que contar el mismo hecho igual.
 */
export function trialMessage(reason: TrialDenialReason): TrialMessage {
  switch (reason.code) {
    case 'gym_unavailable':
      return {
        title: 'Este gimnasio no está recibiendo alumnos',
        detail: 'Vuelve a intentarlo más adelante o escoge otro de la lista.',
      };
    case 'not_offered':
      return {
        title: 'Este gimnasio no ofrece clase gratis',
        detail: 'Puedes ver sus planes y precios, y escribirles para ir de todas formas.',
      };
    case 'already_member':
      return {
        title: 'Ya entrenas aquí',
        detail: 'La clase gratis es para conocer un gimnasio nuevo. El tuyo ya está en tu billetera.',
      };
    case 'already_booked':
      return {
        title: 'Ya tienes tu clase gratis reservada',
        detail: `${reason.className}, ${weekdayName(isoWeekday(reason.date))} ${reason.date.day} a las ${reason.startTime}. Es una por gimnasio.`,
      };
    case 'slot_not_available':
      return {
        title: 'Esa clase ya no está disponible',
        detail: 'Puede que acabe de empezar o que el gimnasio haya cambiado su horario. Elige otra.',
      };
  }
}
