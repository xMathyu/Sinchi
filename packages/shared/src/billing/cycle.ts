/**
 * Ciclo de cobro.
 *
 * Reglas (MD 4.1):
 *  - se cobra POR ADELANTADO, en la fecha de renovacion, por el periodo que
 *    empieza. Nunca al final del periodo consumido;
 *  - toda fecha de corte se evalua en hora local de Lima;
 *  - el job de cobro es idempotente: el indice unico
 *    `(subscription_id, period_start)` para cargos `renewal` lo garantiza en
 *    base de datos, y esta funcion es la que decide cual es ese `period_start`.
 */
import {
  addMonthsClamped,
  daysBetween,
  daysInMonth,
  isAfterOrEqual,
  isBeforeOrEqual,
  plainDate,
  type PlainDate,
} from '../time/plain-date.js';
import type { BillingDatePolicy } from '../domain/types.js';

export interface Period {
  readonly start: PlainDate;
  /** Exclusivo: es tambien el `nextBillingDate` del periodo siguiente. */
  readonly end: PlainDate;
}

export const MAX_FIXED_BILLING_DAY = 28;

/**
 * Dia fijo tope 28: con 29, 30 o 31 el cobro se corre en febrero y el periodo
 * deja de ser mensual limpio. Es una restriccion explicita, no un recorte
 * silencioso.
 */
export function assertValidPolicy(policy: BillingDatePolicy): void {
  if (policy.mode !== 'fixed_day') return;
  const { dayOfMonth } = policy;
  if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > MAX_FIXED_BILLING_DAY) {
    throw new RangeError(
      `Dia fijo de cobro invalido: ${dayOfMonth}. Debe estar entre 1 y ${MAX_FIXED_BILLING_DAY}.`,
    );
  }
}

/** Primera ocurrencia del dia fijo estrictamente posterior a `from`. */
function nextFixedDay(from: PlainDate, dayOfMonth: number): PlainDate {
  const thisMonth = plainDate(
    from.year,
    from.month,
    Math.min(dayOfMonth, daysInMonth(from.year, from.month)),
  );
  if (daysBetween(from, thisMonth) > 0) return thisMonth;

  const next = addMonthsClamped(plainDate(from.year, from.month, 1), 1);
  return plainDate(next.year, next.month, Math.min(dayOfMonth, daysInMonth(next.year, next.month)));
}

/** Fecha de la renovacion siguiente a `from`. */
export function advanceBillingDate(from: PlainDate, policy: BillingDatePolicy): PlainDate {
  assertValidPolicy(policy);
  return policy.mode === 'anniversary'
    ? addMonthsClamped(from, 1)
    : nextFixedDay(from, policy.dayOfMonth);
}

/** Periodo que empieza en `start` segun la politica del tenant. */
export function periodStartingAt(start: PlainDate, policy: BillingDatePolicy): Period {
  return { start, end: advanceBillingDate(start, policy) };
}

/**
 * Primer periodo de una suscripcion nueva.
 *
 * Con politica `anniversary` el primer periodo es completo desde el dia de
 * inscripcion. Con `fixed_day` es corto y se cobra prorrateado, para que el
 * alumno se enganche al calendario comun sin pagar un mes de mas (MD 8.1 sigue
 * abierto sobre cual de las dos adopta el producto).
 */
export function firstPeriod(
  startDate: PlainDate,
  policy: BillingDatePolicy,
): { readonly period: Period; readonly prorated: boolean } {
  const period = periodStartingAt(startDate, policy);
  if (policy.mode === 'anniversary') return { period, prorated: false };

  // Un periodo tan largo como un mes completo no necesita prorrateo: la
  // inscripcion cayo justo en el dia de cobro.
  const length = daysBetween(period.start, period.end);
  return { period, prorated: length < 28 };
}

/** Toca cobrar cuando `today >= nextBillingDate`. */
export function isDue(nextBillingDate: PlainDate, today: PlainDate): boolean {
  return isAfterOrEqual(today, nextBillingDate);
}

/** Dias de mora: 0 si esta al dia. */
export function daysPastDue(nextBillingDate: PlainDate, today: PlainDate): number {
  return Math.max(0, daysBetween(nextBillingDate, today));
}

/** Si la fecha cae dentro del periodo `[start, end)`. */
export function periodContains(period: Period, date: PlainDate): boolean {
  return isAfterOrEqual(date, period.start) && !isBeforeOrEqual(period.end, date);
}

/**
 * Llave de idempotencia del cargo de renovacion.
 *
 * Respalda el indice unico `(subscription_id, period_start)` del MD 4.1: si el
 * cron corre dos veces, el segundo insert choca y no cobra dos veces.
 */
export function renewalIdempotencyKey(subscriptionId: string, periodStart: PlainDate): string {
  const mm = periodStart.month < 10 ? `0${periodStart.month}` : periodStart.month;
  const dd = periodStart.day < 10 ? `0${periodStart.day}` : periodStart.day;
  return `renewal:${subscriptionId}:${periodStart.year}-${mm}-${dd}`;
}
