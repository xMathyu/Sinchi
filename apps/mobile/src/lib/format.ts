/**
 * Formateo de fechas en espanol, sin `Intl`.
 *
 * Igual que el formateo de moneda en `@sinchi/shared`: el idioma es siempre
 * espanol y la zona siempre Lima, asi que la tabla de locales no aporta nada y
 * `Intl` no esta garantizado en Hermes.
 */
import {
  TZ_LIMA,
  isoWeekday,
  localTimeInZone,
  plainDateInZone,
  weekdayName,
  type PlainDate,
} from '@sinchi/shared';

const MONTH_SHORT = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'set',
  'oct',
  'nov',
  'dic',
] as const;

const MONTH_LONG = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'setiembre',
  'octubre',
  'noviembre',
  'diciembre',
] as const;

/** `3 set` */
export function formatShortDate(date: PlainDate): string {
  return `${date.day} ${MONTH_SHORT[date.month - 1] ?? ''}`;
}

/** `3 de setiembre` */
export function formatLongDate(date: PlainDate): string {
  return `${date.day} de ${MONTH_LONG[date.month - 1] ?? ''}`;
}

/**
 * `dom 20 set` — cuándo es un evento.
 *
 * Lleva el día de la semana porque un seminario se decide por ahí («¿trabajo
 * ese sábado?»), y va corta porque comparte fila con el precio y el invitado.
 * Vive aquí y no en la pantalla porque lo dicen tres superficies —la lista del
 * dueño, el día del evento y el directorio— y en las tres tiene que leerse
 * igual.
 */
export function formatEventDate(date: PlainDate): string {
  const dia = weekdayName(isoWeekday(date)).slice(0, 3);
  return `${dia} ${date.day} ${MONTH_SHORT[date.month - 1] ?? ''}`;
}

/** `Jueves 20` con la inicial en mayuscula, como en el historial del diseno. */
export function formatWeekdayAndDay(date: PlainDate): string {
  const name = weekdayName(isoWeekday(date));
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${date.day}`;
}

/** `Jueves 20 · 19:00` */
export function formatCheckInMoment(instant: Date): string {
  const date = plainDateInZone(instant, TZ_LIMA);
  return `${formatWeekdayAndDay(date)} · ${localTimeInZone(instant, TZ_LIMA)}`;
}

/** `19:04` en hora de Lima. */
export const formatClock = (instant: Date): string => localTimeInZone(instant, TZ_LIMA);

/** `MQ` a partir de "Mathyu Quispe". */
export function initials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0);
  const first = parts[0]?.charAt(0) ?? '';
  const second = parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? '') : '';
  return `${first}${second}`.toUpperCase();
}

/** Parte el nombre del gimnasio en marca y distrito: "Nova BJJ" + "Surco". */
export function splitGymName(name: string): { readonly brand: string; readonly area: string } {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return { brand: name, area: '' };
  return { brand: parts.slice(0, -1).join(' '), area: parts[parts.length - 1] ?? '' };
}

/**
 * El nivel de una rutina, dicho en una palabra.
 *
 * `null` es «para cualquiera», y ahi se devuelve `null` en vez de esa frase: en
 * una linea que ya lleva los pasos y el estado, «Para cualquiera» ocupa sitio
 * para no decir nada. La ausencia de nivel ya significa eso.
 */
export function nivelCorto(
  level: 'beginner' | 'intermediate' | 'advanced' | null,
): string | null {
  switch (level) {
    case 'beginner':
      return 'Básico';
    case 'intermediate':
      return 'Intermedio';
    case 'advanced':
      return 'Avanzado';
    case null:
      return null;
  }
}

/** `3 set` a partir de un instante ISO. Para «actualizada el …». */
export function formatIsoDay(iso: string): string {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return '';
  return formatShortDate(plainDateInZone(fecha, TZ_LIMA));
}
