/**
 * Quien puede coger plaza en un evento, y por que no.
 *
 * Misma forma que `validateTrialBooking` y `validateCheckIn`: un MOTIVO
 * estructurado, no un booleano. "No se pudo reservar" deja a la persona sin
 * saber si llego tarde, si ya tiene su plaza o si se llenó, y cada uno tiene una
 * salida distinta — volver el mes que viene, mirar su reserva, o nada.
 *
 * Funcion pura que corren los dos lados: la app para no ofrecer lo que va a
 * fallar, la api para no confiar en que la app lo hizo.
 */
import type { Cents } from '../money/cents.js';
import { eventPriceFor, type GymEvent } from '../domain/types.js';
import { compareDates, type PlainDate } from '../time/plain-date.js';

export type EventBookingDenialCode =
  | 'gym_unavailable'
  | 'not_published'
  | 'event_canceled'
  | 'already_over'
  | 'already_registered'
  | 'sold_out';

export type EventBookingDenial =
  | { readonly code: 'gym_unavailable' }
  | { readonly code: 'not_published' }
  | { readonly code: 'event_canceled' }
  | { readonly code: 'already_over' }
  | {
      readonly code: 'already_registered';
      /** Si ya la pagó. Se le recuerda en vez de decirle que no y ya. */
      readonly paid: boolean;
    }
  | { readonly code: 'sold_out'; readonly capacity: number };

export type EventBookingResult =
  | { readonly allowed: true; readonly priceCents: Cents }
  | { readonly allowed: false; readonly reason: EventBookingDenial };

export interface EventBookingContext {
  /** `false` cuando el gimnasio esta suspendido o fuera del directorio. */
  readonly gymActive: boolean;
  readonly event: GymEvent;
  /** Plazas ya ocupadas: reservas vivas, pagadas o no. */
  readonly seatsTaken: number;
  /** Su plaza en ESTE evento, si ya la tiene. */
  readonly existing: { readonly paid: boolean } | null;
  /** Entrena en este local: decide cual de los dos precios le toca. */
  readonly isMember: boolean;
  readonly today: PlainDate;
}

/**
 * El orden es el mismo criterio de siempre: primero lo que no depende de la
 * persona —el gimnasio, el evento, la fecha— y al final lo suyo. Al reves, a
 * quien ya tiene su plaza en un evento lleno se le diria "no quedan plazas", que
 * no es su problema.
 */
export function validateEventBooking(ctx: EventBookingContext): EventBookingResult {
  if (!ctx.gymActive) return { allowed: false, reason: { code: 'gym_unavailable' } };
  if (ctx.event.status === 'canceled') {
    return { allowed: false, reason: { code: 'event_canceled' } };
  }
  if (ctx.event.status !== 'published') {
    return { allowed: false, reason: { code: 'not_published' } };
  }

  // Por dia y no por hora: quien mira la lista a las 19:05 de un evento que
  // empezo a las 19:00 sigue llegando a tiempo, y cortarlo al minuto convierte
  // una plaza vendida en una discusion en la puerta.
  if (compareDates(ctx.event.date, ctx.today) < 0) {
    return { allowed: false, reason: { code: 'already_over' } };
  }

  if (ctx.existing !== null) {
    return { allowed: false, reason: { code: 'already_registered', paid: ctx.existing.paid } };
  }

  if (ctx.event.capacity !== null && ctx.seatsTaken >= ctx.event.capacity) {
    return { allowed: false, reason: { code: 'sold_out', capacity: ctx.event.capacity } };
  }

  return { allowed: true, priceCents: eventPriceFor(ctx.event, ctx.isMember) };
}

/** Plazas libres, o `null` si el evento no limita el cupo. */
export const seatsLeft = (event: GymEvent, seatsTaken: number): number | null =>
  event.capacity === null ? null : Math.max(0, event.capacity - seatsTaken);

/** Nombre largo a proposito: `eventDenialMessage` ya es el del borrador. */
export function eventBookingDenialMessage(reason: EventBookingDenial): string {
  switch (reason.code) {
    case 'gym_unavailable':
      return 'Este gimnasio no está recibiendo reservas ahora mismo.';
    case 'not_published':
      return 'Este evento todavía no está publicado.';
    case 'event_canceled':
      return 'El gimnasio canceló este evento.';
    case 'already_over':
      return 'Este evento ya pasó.';
    case 'already_registered':
      return reason.paid
        ? 'Ya tienes tu plaza y está pagada. Te esperamos.'
        : 'Ya tienes tu plaza. Págala en el mostrador para asegurarla.';
    case 'sold_out':
      return `Se agotaron las ${reason.capacity} plazas.`;
  }
}
