/**
 * El evento tal como lo escribe el dueno, antes de existir.
 *
 * Misma forma que `checkPlanDraft`: devuelve el MOTIVO o `null`, y la usan los
 * dos lados. El formulario apaga el boton por la razon exacta por la que la api
 * habria respondido 400, en vez de dejar al dueno llenar seis campos para que le
 * digan que no al final.
 */
import { PLAN_PRICE_MAX_CENTS } from '../domain/plan-draft.js';
import { minutesSinceMidnight, type LocalTime, type PlainDate } from '../time/plain-date.js';
import { compareDates } from '../time/plain-date.js';

export const EVENT_NAME_MIN = 3;
export const EVENT_NAME_MAX = 80;
export const EVENT_DESCRIPTION_MAX = 600;

/** Mismo tope que los planes: es el mismo cazador de tipeos, en soles. */
export const EVENT_PRICE_MAX_CENTS = PLAN_PRICE_MAX_CENTS;

/** Un seminario de mil plazas no es un seminario, es un tipeo. */
export const EVENT_CAPACITY_MAX = 1000;

export interface EventDraft {
  readonly name: string;
  readonly description: string | null;
  readonly instructor: string | null;
  readonly date: PlainDate;
  readonly startTime: LocalTime;
  readonly endTime: LocalTime;
  /** `null` = sin limite de plazas. */
  readonly capacity: number | null;
  readonly memberPriceCents: number;
  readonly guestPriceCents: number;
}

export type EventDenial =
  | 'name_too_short'
  | 'name_too_long'
  | 'description_too_long'
  | 'price_negative'
  | 'price_not_integer'
  | 'price_too_high'
  | 'capacity_not_positive'
  | 'capacity_too_high'
  | 'ends_before_it_starts'
  | 'date_in_the_past';

/**
 * `today` es opcional porque editar un evento que ya paso es legitimo: se
 * corrige el nombre del invitado despues del seminario y la lista de asistentes
 * sigue valiendo. Solo al CREARLO se exige que no sea pasado.
 */
export function checkEventDraft(draft: EventDraft, today?: PlainDate): EventDenial | null {
  const name = draft.name.trim();
  if (name.length < EVENT_NAME_MIN) return 'name_too_short';
  if (name.length > EVENT_NAME_MAX) return 'name_too_long';

  if (draft.description !== null && draft.description.trim().length > EVENT_DESCRIPTION_MAX) {
    return 'description_too_long';
  }

  for (const price of [draft.memberPriceCents, draft.guestPriceCents]) {
    if (!Number.isInteger(price)) return 'price_not_integer';
    if (price < 0) return 'price_negative';
    if (price > EVENT_PRICE_MAX_CENTS) return 'price_too_high';
  }

  if (draft.capacity !== null) {
    if (!Number.isInteger(draft.capacity) || draft.capacity < 1) return 'capacity_not_positive';
    if (draft.capacity > EVENT_CAPACITY_MAX) return 'capacity_too_high';
  }

  // Sin esto, un evento de 19:00 a 18:00 pasa y despues nadie entiende por que
  // no sale en la lista de "lo que viene".
  if (minutesSinceMidnight(draft.endTime) <= minutesSinceMidnight(draft.startTime)) {
    return 'ends_before_it_starts';
  }

  if (today !== undefined && compareDates(draft.date, today) < 0) return 'date_in_the_past';

  return null;
}

export const isValidEventDraft = (draft: EventDraft, today?: PlainDate): boolean =>
  checkEventDraft(draft, today) === null;

export function eventDenialMessage(reason: EventDenial): string {
  switch (reason) {
    case 'name_too_short':
      return `Ponle un nombre de al menos ${EVENT_NAME_MIN} letras: es lo que va a leer la gente.`;
    case 'name_too_long':
      return `El nombre no puede pasar de ${EVENT_NAME_MAX} caracteres.`;
    case 'description_too_long':
      return `La descripción no puede pasar de ${EVENT_DESCRIPTION_MAX} caracteres.`;
    case 'price_negative':
      return 'Un precio no puede ser negativo.';
    case 'price_not_integer':
      return 'Los precios van en céntimos enteros.';
    case 'price_too_high':
      return `Un precio no puede pasar de S/ ${EVENT_PRICE_MAX_CENTS / 100}. ¿Lo escribiste en céntimos?`;
    case 'capacity_not_positive':
      return 'El cupo es de al menos una plaza. Déjalo vacío si no quieres limitarlo.';
    case 'capacity_too_high':
      return `El cupo no puede pasar de ${EVENT_CAPACITY_MAX} plazas.`;
    case 'ends_before_it_starts':
      return 'La hora de fin va después de la de inicio.';
    case 'date_in_the_past':
      return 'Esa fecha ya pasó. Un evento se publica antes de que ocurra.';
  }
}
