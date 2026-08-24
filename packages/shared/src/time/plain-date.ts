/**
 * Fecha civil sin hora ni zona: lo que el negocio llama "fecha".
 *
 * Toda fecha de corte del producto se evalua en hora local de Lima (MD 4.1).
 * Modelarla como fecha civil evita la clase de bug donde un `Date` de
 * medianoche UTC cae en el dia anterior visto desde Lima.
 *
 * La aritmetica es entera y pura (algoritmos days-from-civil de Howard
 * Hinnant): sin `Date`, sin `Intl`, sin dependencias.
 */
import { offsetMinutes, type IanaTimeZone } from './zone.js';

export interface PlainDate {
  readonly year: number;
  /** 1..12 */
  readonly month: number;
  /** 1..31 */
  readonly day: number;
}

/** Dia de la semana ISO: 1 = lunes .. 7 = domingo. */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const ISO_WEEKDAYS: readonly IsoWeekday[] = [1, 2, 3, 4, 5, 6, 7];

/** Hora local del dia, `HH:MM`, como la guardan los horarios de clase. */
export type LocalTime = string;

const MS_PER_DAY = 86_400_000;
const MS_PER_MINUTE = 60_000;

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  switch (month) {
    case 1:
    case 3:
    case 5:
    case 7:
    case 8:
    case 10:
    case 12:
      return 31;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    case 2:
      return isLeapYear(year) ? 29 : 28;
    default:
      throw new RangeError(`Mes fuera de rango: ${month}`);
  }
}

export function plainDate(year: number, month: number, day: number): PlainDate {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new RangeError(`Fecha no entera: ${year}-${month}-${day}`);
  }
  if (month < 1 || month > 12) throw new RangeError(`Mes fuera de rango: ${month}`);
  const max = daysInMonth(year, month);
  if (day < 1 || day > max) {
    throw new RangeError(`Dia fuera de rango: ${year}-${month}-${day} (el mes tiene ${max} dias)`);
  }
  return { year, month, day };
}

/** Dias transcurridos desde 1970-01-01. */
export function toEpochDay(d: PlainDate): number {
  const y = d.month <= 2 ? d.year - 1 : d.year;
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400;
  const dayOfYear = Math.floor((153 * (d.month + (d.month > 2 ? -3 : 9)) + 2) / 5) + d.day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146_097 + dayOfEra - 719_468;
}

export function fromEpochDay(epochDay: number): PlainDate {
  const z = epochDay + 719_468;
  const era = Math.floor(z / 146_097);
  const dayOfEra = z - era * 146_097;
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1460) +
      Math.floor(dayOfEra / 36_524) -
      Math.floor(dayOfEra / 146_096)) /
      365,
  );
  const y = yearOfEra + era * 400;
  const dayOfYear =
    dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const mp = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp + (mp < 10 ? 3 : -9);
  return { year: month <= 2 ? y + 1 : y, month, day };
}

const pad2 = (n: number): string => (n < 10 ? `0${n}` : String(n));

/** Formato `YYYY-MM-DD`: el mismo que la columna `date` de Postgres. */
export function formatPlainDate(d: PlainDate): string {
  return `${String(d.year).padStart(4, '0')}-${pad2(d.month)}-${pad2(d.day)}`;
}

export function parsePlainDate(iso: string): PlainDate {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new RangeError(`Fecha invalida, se esperaba YYYY-MM-DD: "${iso}"`);
  return plainDate(Number(m[1]), Number(m[2]), Number(m[3]));
}

export function compareDates(a: PlainDate, b: PlainDate): -1 | 0 | 1 {
  const da = toEpochDay(a);
  const db = toEpochDay(b);
  return da < db ? -1 : da > db ? 1 : 0;
}

export const isSameDay = (a: PlainDate, b: PlainDate): boolean => compareDates(a, b) === 0;
export const isBefore = (a: PlainDate, b: PlainDate): boolean => compareDates(a, b) === -1;
export const isAfter = (a: PlainDate, b: PlainDate): boolean => compareDates(a, b) === 1;
export const isBeforeOrEqual = (a: PlainDate, b: PlainDate): boolean => compareDates(a, b) <= 0;
export const isAfterOrEqual = (a: PlainDate, b: PlainDate): boolean => compareDates(a, b) >= 0;

export function addDays(d: PlainDate, days: number): PlainDate {
  if (!Number.isInteger(days)) throw new RangeError(`Dias no entero: ${days}`);
  return fromEpochDay(toEpochDay(d) + days);
}

/** `b - a` en dias. Positivo si `b` es posterior. */
export function daysBetween(a: PlainDate, b: PlainDate): number {
  return toEpochDay(b) - toEpochDay(a);
}

/**
 * Suma meses recortando el dia al ultimo del mes destino.
 *
 * 31-ene + 1 mes = 28-feb (29 en bisiesto). Es la semantica que espera
 * cualquier suscripcion mensual: sin el recorte, el alumno inscrito un 31
 * salta a marzo y se le regala un mes.
 */
export function addMonthsClamped(d: PlainDate, months: number): PlainDate {
  if (!Number.isInteger(months)) throw new RangeError(`Meses no entero: ${months}`);
  const total = d.year * 12 + (d.month - 1) + months;
  const year = Math.floor(total / 12);
  const month = total - year * 12 + 1;
  return { year, month, day: Math.min(d.day, daysInMonth(year, month)) };
}

/** 1 = lunes .. 7 = domingo. */
export function isoWeekday(d: PlainDate): IsoWeekday {
  // 1970-01-01 fue jueves; el +3 alinea el modulo con lunes = 0.
  const index = (((toEpochDay(d) + 3) % 7) + 7) % 7;
  return (index + 1) as IsoWeekday;
}

/** Fecha civil que corresponde a `instant` observado en `tz`. */
export function plainDateInZone(instant: Date, tz: IanaTimeZone): PlainDate {
  const ms = instant.getTime() + offsetMinutes(tz, instant) * MS_PER_MINUTE;
  return fromEpochDay(Math.floor(ms / MS_PER_DAY));
}

/** Instante UTC de la medianoche local de `d` en `tz`. */
export function startOfDayInZone(d: PlainDate, tz: IanaTimeZone): Date {
  const nominal = toEpochDay(d) * MS_PER_DAY;
  const firstGuess = offsetMinutes(tz, new Date(nominal));
  const candidate = new Date(nominal - firstGuess * MS_PER_MINUTE);
  const secondGuess = offsetMinutes(tz, candidate);
  return secondGuess === firstGuess
    ? candidate
    : new Date(nominal - secondGuess * MS_PER_MINUTE);
}

/** Minutos desde medianoche. `"19:30"` -> 1170. */
export function minutesSinceMidnight(time: LocalTime): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!m) throw new RangeError(`Hora invalida, se esperaba HH:MM: "${time}"`);
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) throw new RangeError(`Hora fuera de rango: "${time}"`);
  return hours * 60 + minutes;
}

export function localTimeInZone(instant: Date, tz: IanaTimeZone): LocalTime {
  const ms = instant.getTime() + offsetMinutes(tz, instant) * MS_PER_MINUTE;
  const withinDay = ((ms % MS_PER_DAY) + MS_PER_DAY) % MS_PER_DAY;
  const total = Math.floor(withinDay / MS_PER_MINUTE);
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}
