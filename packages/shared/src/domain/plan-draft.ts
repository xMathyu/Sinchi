/**
 * El plan tal como lo escribe el dueno, antes de existir.
 *
 * Hasta ahora los planes solo nacian de un script nuestro (`db:seed:kaizen`), y
 * ahi la unica validacion posible era leer bien el archivo. Desde que el dueno
 * los escribe en su telefono hacen falta reglas, y hacen falta EN UN SOLO SITIO:
 * el formulario tiene que poder apagar el boton por el mismo motivo por el que
 * la api va a rechazar el POST, o el dueno llena tres campos para que le digan
 * que no al final.
 *
 * Es la misma forma que `checkRuc`: devuelve el MOTIVO o `null`, no un booleano.
 * "Plan invalido" a secas no le dice a nadie que corregir.
 *
 * Estas reglas son las mismas que la restriccion `plans_type_consistent` de la
 * base. Que esten repetidas no es descuido: la base es la que no se puede
 * saltar, y esto es lo que evita que el usuario llegue hasta ella para
 * enterarse.
 */
import { ISO_WEEKDAYS, type IsoWeekday } from '../time/plain-date.js';
import type { PlanType } from './types.js';

export const PLAN_NAME_MIN = 2;
export const PLAN_NAME_MAX = 60;

/**
 * Tope de precio: S/ 10 000.
 *
 * No es una regla de negocio, es un cazador de tipeos. El campo se llena en
 * soles y el que escribe "15000" queriendo decir S/ 150,00 se lleva un plan de
 * quince mil soles que despues cobra el mostrador sin mirar.
 */
export const PLAN_PRICE_MAX_CENTS = 1_000_000;

export interface PlanDraft {
  readonly name: string;
  readonly type: PlanType;
  /** Solo para `sessions_per_week`; `null` en los demas. */
  readonly sessionsPerWeek: number | null;
  /** Dias ISO permitidos, o `null` para cualquier dia. */
  readonly allowedDays: readonly number[] | null;
  /** Del periodo; de UNA clase cuando el tipo es `drop_in`. */
  readonly priceCents: number;
}

export type PlanDenial =
  | 'name_too_short'
  | 'name_too_long'
  | 'price_negative'
  | 'price_not_integer'
  | 'price_too_high'
  | 'sessions_required'
  | 'sessions_out_of_range'
  | 'sessions_not_allowed'
  | 'days_required'
  | 'days_invalid';

function checkDays(days: readonly number[] | null): PlanDenial | null {
  if (days === null) return null;
  if (days.length === 0 || days.length > ISO_WEEKDAYS.length) return 'days_invalid';
  if (days.some((day) => !ISO_WEEKDAYS.includes(day as IsoWeekday))) return 'days_invalid';
  // Un lunes repetido hace que `fixed_days` calcule un cupo de dos sesiones
  // para un solo dia de entrenamiento.
  if (new Set(days).size !== days.length) return 'days_invalid';
  return null;
}

/** `null` si el plan se puede guardar; el motivo si no. */
export function checkPlanDraft(draft: PlanDraft): PlanDenial | null {
  const name = draft.name.trim();
  if (name.length < PLAN_NAME_MIN) return 'name_too_short';
  if (name.length > PLAN_NAME_MAX) return 'name_too_long';

  if (!Number.isInteger(draft.priceCents)) return 'price_not_integer';
  if (draft.priceCents < 0) return 'price_negative';
  if (draft.priceCents > PLAN_PRICE_MAX_CENTS) return 'price_too_high';

  const days = checkDays(draft.allowedDays);
  if (days !== null) return days;

  switch (draft.type) {
    case 'sessions_per_week':
      if (draft.sessionsPerWeek === null) return 'sessions_required';
      if (!Number.isInteger(draft.sessionsPerWeek)) return 'sessions_out_of_range';
      if (draft.sessionsPerWeek < 1 || draft.sessionsPerWeek > 7) return 'sessions_out_of_range';
      return null;

    case 'fixed_days':
      // Sin dias, `weeklyLimit` devuelve null y el plan de "martes y jueves" deja
      // entrenar los siete dias. El cupo de este tipo SON los dias.
      if (draft.allowedDays === null) return 'days_required';
      return draft.sessionsPerWeek === null ? null : 'sessions_not_allowed';

    case 'unlimited':
    case 'drop_in':
      return draft.sessionsPerWeek === null ? null : 'sessions_not_allowed';
  }
}

export const isValidPlanDraft = (draft: PlanDraft): boolean => checkPlanDraft(draft) === null;

export function planDenialMessage(reason: PlanDenial): string {
  switch (reason) {
    case 'name_too_short':
      return `Ponle un nombre de al menos ${PLAN_NAME_MIN} letras: es lo que verá el alumno.`;
    case 'name_too_long':
      return `El nombre no puede pasar de ${PLAN_NAME_MAX} caracteres.`;
    case 'price_negative':
      return 'El precio no puede ser negativo.';
    case 'price_not_integer':
      return 'El precio va en céntimos enteros.';
    case 'price_too_high':
      return `El precio no puede pasar de S/ ${PLAN_PRICE_MAX_CENTS / 100}. ¿Lo escribiste en céntimos?`;
    case 'sessions_required':
      return 'Di cuántas veces por semana entrena.';
    case 'sessions_out_of_range':
      return 'Las sesiones por semana van de 1 a 7.';
    case 'sessions_not_allowed':
      return 'Este tipo de plan no lleva sesiones por semana.';
    case 'days_required':
      return 'Un plan de días fijos necesita al menos un día.';
    case 'days_invalid':
      return 'Los días van de lunes a domingo y sin repetir.';
  }
}

/**
 * Como se lee un plan en una linea.
 *
 * Vive aqui y no en la pantalla porque lo dicen tres sitios —la lista del dueno,
 * el alta de un alumno y el cambio de plan— y en los tres tiene que significar
 * lo mismo. `precio` se pasa hecho para no meter el formato de moneda en el
 * dominio.
 */
export function planShape(plan: {
  readonly type: PlanType;
  readonly sessionsPerWeek: number | null;
}): string {
  switch (plan.type) {
    case 'unlimited':
      return 'Sin límite de sesiones';
    case 'sessions_per_week':
      return plan.sessionsPerWeek === 1
        ? '1 vez por semana'
        : `${plan.sessionsPerWeek ?? '?'} veces por semana`;
    case 'fixed_days':
      return 'Días fijos';
    case 'drop_in':
      return 'Se cobra por clase';
  }
}

/** Si el precio del plan se lee "al mes" o "por clase". */
export const planPriceUnit = (type: PlanType): string =>
  type === 'drop_in' ? 'por clase' : 'al mes';
