/**
 * El bloque de horario tal como lo escribe el dueno, antes de existir.
 *
 * Los horarios eran lo ultimo del producto que solo sabia escribir un script
 * nuestro (`db:seed`), y eso dejaba al gimnasio que se da de alta desde la app
 * en un callejon sin salida silencioso: nacia con sus planes pero con CERO
 * bloques, y sin bloques su ficha publica no tiene ni una hora que reservar. La
 * tarjeta del directorio le ofrece "1 clase gratis" a quien la abre, la pantalla
 * le contesta "este gimnasio todavia no publico sus horarios", y el dueno no
 * tenia ninguna pantalla donde arreglarlo. La unica via de alta que empieza
 * fuera del local estaba muerta para todos los locales nuevos.
 *
 * Misma forma que `checkPlanDraft`: devuelve el MOTIVO o `null`, para que el
 * formulario apague el boton por la misma razon por la que la api rechazaria el
 * POST. Un "horario invalido" a secas no le dice a nadie que corregir.
 */
import { ISO_WEEKDAYS, minutesSinceMidnight, type IsoWeekday } from '../time/plain-date.js';

export const SCHEDULE_NAME_MIN = 2;
export const SCHEDULE_NAME_MAX = 60;
export const SCHEDULE_INSTRUCTOR_MAX = 60;

/**
 * Tope de aforo: 500.
 *
 * No es una regla de negocio, es un cazador de tipeos, igual que el tope de
 * precio de un plan. Un tatami con aforo de 5000 es un cero de mas.
 */
export const SCHEDULE_CAPACITY_MAX = 500;

/**
 * Duracion minima de un bloque: 15 minutos.
 *
 * Un bloque de cero minutos —la misma hora de inicio y de fin, que es lo que
 * sale de tocar "guardar" sin mover la hora de fin— no es una clase: no se puede
 * marcar entrada dentro de el y no genera ni un cupo reservable. Se rechaza
 * aqui para que el dueno lo vea al escribirlo y no al no ver visitas.
 */
export const SCHEDULE_MIN_MINUTES = 15;

export interface ScheduleDraft {
  readonly name: string;
  readonly weekday: number;
  /** `HH:MM` en hora local del gimnasio. */
  readonly startTime: string;
  readonly endTime: string;
  /** Aforo del bloque, o `null` cuando el local no lo limita. */
  readonly capacity: number | null;
  readonly instructor: string | null;
}

export type ScheduleDenial =
  | 'name_too_short'
  | 'name_too_long'
  | 'weekday_invalid'
  | 'time_malformed'
  | 'ends_before_start'
  | 'too_short'
  | 'capacity_not_integer'
  | 'capacity_out_of_range'
  | 'instructor_too_long';

/** Minutos desde medianoche, o `null` si la hora no tiene forma `HH:MM`. */
function readTime(time: string): number | null {
  try {
    return minutesSinceMidnight(time);
  } catch {
    return null;
  }
}

/** `null` si el bloque se puede guardar; el motivo si no. */
export function checkScheduleDraft(draft: ScheduleDraft): ScheduleDenial | null {
  const name = draft.name.trim();
  if (name.length < SCHEDULE_NAME_MIN) return 'name_too_short';
  if (name.length > SCHEDULE_NAME_MAX) return 'name_too_long';

  if (!ISO_WEEKDAYS.includes(draft.weekday as IsoWeekday)) return 'weekday_invalid';

  const start = readTime(draft.startTime);
  const end = readTime(draft.endTime);
  if (start === null || end === null) return 'time_malformed';
  // Sin cruce de medianoche a proposito: un bloque que termina al dia siguiente
  // pertenece a dos dias de la semana y `upcomingClassSlots` lo colocaria en el
  // equivocado. Un dojo que cierra a la 01:00 parte el bloque en dos.
  if (end < start) return 'ends_before_start';
  if (end - start < SCHEDULE_MIN_MINUTES) return 'too_short';

  if (draft.capacity !== null) {
    if (!Number.isInteger(draft.capacity)) return 'capacity_not_integer';
    if (draft.capacity < 1 || draft.capacity > SCHEDULE_CAPACITY_MAX) {
      return 'capacity_out_of_range';
    }
  }

  if ((draft.instructor ?? '').trim().length > SCHEDULE_INSTRUCTOR_MAX) {
    return 'instructor_too_long';
  }

  return null;
}

export const isValidScheduleDraft = (draft: ScheduleDraft): boolean =>
  checkScheduleDraft(draft) === null;

export function scheduleDenialMessage(reason: ScheduleDenial): string {
  switch (reason) {
    case 'name_too_short':
      return `Ponle un nombre de al menos ${SCHEDULE_NAME_MIN} letras: es lo que verá quien busque dónde entrenar.`;
    case 'name_too_long':
      return `El nombre no puede pasar de ${SCHEDULE_NAME_MAX} caracteres.`;
    case 'weekday_invalid':
      return 'Elige un día de lunes a domingo.';
    case 'time_malformed':
      return 'Las horas van en formato HH:MM, de 00:00 a 23:59.';
    case 'ends_before_start':
      return 'La clase no puede terminar antes de empezar. Si cruza la medianoche, pártela en dos bloques.';
    case 'too_short':
      return `Una clase dura al menos ${SCHEDULE_MIN_MINUTES} minutos.`;
    case 'capacity_not_integer':
      return 'El aforo va en personas enteras.';
    case 'capacity_out_of_range':
      return `El aforo va de 1 a ${SCHEDULE_CAPACITY_MAX} personas. Déjalo vacío si no lo limitas.`;
    case 'instructor_too_long':
      return `El nombre del profesor no puede pasar de ${SCHEDULE_INSTRUCTOR_MAX} caracteres.`;
  }
}

/**
 * Como se lee un bloque en una linea: `"Lun 19:00 – 20:30"`.
 *
 * Vive aqui y no en la pantalla porque lo dicen dos sitios —la lista del dueno y
 * la ficha publica— y en los dos tiene que significar lo mismo. El dia se pasa
 * ya escrito para no meter el idioma en el dominio.
 */
export function scheduleRange(schedule: {
  readonly startTime: string;
  readonly endTime: string;
}): string {
  return `${schedule.startTime} – ${schedule.endTime}`;
}

/**
 * Dos bloques del mismo dia que se pisan.
 *
 * No lo impide la base y no siempre es un error —un local con dos tatamis da
 * dos clases a las 19:00—, asi que no es un `ScheduleDenial`: es lo que la
 * pantalla usa para AVISAR. Tocarse en el borde (una acaba 20:00 y la otra
 * empieza 20:00) no es pisarse.
 */
export function schedulesOverlap(
  a: { readonly weekday: number; readonly startTime: string; readonly endTime: string },
  b: { readonly weekday: number; readonly startTime: string; readonly endTime: string },
): boolean {
  if (a.weekday !== b.weekday) return false;

  const aStart = readTime(a.startTime);
  const aEnd = readTime(a.endTime);
  const bStart = readTime(b.startTime);
  const bEnd = readTime(b.endTime);
  if (aStart === null || aEnd === null || bStart === null || bEnd === null) return false;

  return aStart < bEnd && bStart < aEnd;
}
