/**
 * Semana ISO (lunes a domingo) en hora de Lima.
 *
 * El cupo de asistencia es semanal, no mensual: "3 veces por semana" no es
 * "12 al mes" (MD 4.3). La semana es la unidad de calculo, y el consumo se
 * deriva contando asistencias — nunca de un contador mutable.
 */
import {
  addDays,
  daysBetween,
  formatPlainDate,
  isoWeekday,
  plainDate,
  type PlainDate,
} from './plain-date.js';

export interface IsoWeek {
  /** Anio ISO: puede diferir del calendario en los bordes de enero/diciembre. */
  readonly year: number;
  /** 1..53 */
  readonly week: number;
  /** Clave estable `YYYY-Www`, la que se guarda en `attendance.iso_week`. */
  readonly key: string;
}

const pad2 = (n: number): string => (n < 10 ? `0${n}` : String(n));

export function startOfIsoWeek(d: PlainDate): PlainDate {
  return addDays(d, -(isoWeekday(d) - 1));
}

export function endOfIsoWeek(d: PlainDate): PlainDate {
  return addDays(startOfIsoWeek(d), 6);
}

/**
 * Semana ISO de una fecha. El anio ISO lo define el jueves de esa semana, que
 * es lo que hace que el 29-dic-2025 caiga en 2026-W01.
 */
export function isoWeekOf(d: PlainDate): IsoWeek {
  const monday = startOfIsoWeek(d);
  const thursday = addDays(monday, 3);
  const year = thursday.year;
  const firstWeekMonday = startOfIsoWeek(plainDate(year, 1, 4));
  const week = Math.floor(daysBetween(firstWeekMonday, monday) / 7) + 1;
  return { year, week, key: `${year}-W${pad2(week)}` };
}

export function isSameIsoWeek(a: PlainDate, b: PlainDate): boolean {
  return isoWeekOf(a).key === isoWeekOf(b).key;
}

export interface IsoWeekRange {
  readonly monday: PlainDate;
  readonly sunday: PlainDate;
  /** Cadenas `YYYY-MM-DD`, listas para un `BETWEEN` en SQL. */
  readonly from: string;
  readonly to: string;
}

export function isoWeekRange(d: PlainDate): IsoWeekRange {
  const monday = startOfIsoWeek(d);
  const sunday = addDays(monday, 6);
  return {
    monday,
    sunday,
    from: formatPlainDate(monday),
    to: formatPlainDate(sunday),
  };
}
