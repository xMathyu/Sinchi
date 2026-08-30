/**
 * Cuando se puede ir a la clase gratis.
 *
 * El horario del gimnasio dice DIA DE LA SEMANA y hora ("martes 19:00"); quien
 * reserva necesita una FECHA ("martes 2 de setiembre, 19:00"). Traducir de lo
 * uno a lo otro es aritmetica de calendario, y por eso vive aqui y no en la
 * pantalla: la app la usa para pintar las opciones y la api para comprobar que
 * la que llego es una de ellas. Escrita dos veces, el alumno reserva un horario
 * que el servidor no reconoce.
 *
 * Se cuenta en fecha civil de la ZONA DEL GIMNASIO, no del telefono: un alumno
 * mirando desde Madrid a las 03:00 tiene que ver los mismos martes que uno
 * mirando desde Lima.
 */
import type { ClassSchedule, ClassScheduleId } from '../domain/types.js';
import {
  addDays,
  compareDates,
  formatPlainDate,
  isoWeekday,
  minutesSinceMidnight,
  type LocalTime,
  type PlainDate,
} from '../time/plain-date.js';

/** Una clase concreta, con fecha. Es lo que el alumno elige y lo que se guarda. */
export interface TrialSlot {
  readonly scheduleId: ClassScheduleId;
  readonly name: string;
  readonly instructor: string | null;
  readonly date: PlainDate;
  readonly startTime: LocalTime;
  readonly endTime: LocalTime;
}

/**
 * Dos semanas de opciones.
 *
 * Suficiente para que entre cualquier clase, incluida la que solo se dicta los
 * sabados, y corto para que la lista siga siendo elegible de un vistazo. Mas
 * lejos tampoco sirve: nadie decide hoy a que clase de prueba ira en un mes.
 */
export const TRIAL_WINDOW_DAYS = 14;

/**
 * Una clase que empieza en menos de una hora ya no se puede reservar.
 *
 * El aviso al gimnasio es el producto: si la reserva llega cuando el alumno ya
 * esta en la puerta, el dueno se entera al mismo tiempo que lo ve entrar y la
 * lista de interesados no le sirve para prepararse.
 */
export const TRIAL_LEAD_MINUTES = 60;

export interface UpcomingSlotsInput {
  /** Horarios ACTIVOS del gimnasio. Vacio = no publica horarios y no hay que ofrecer. */
  readonly schedules: readonly ClassSchedule[];
  /** Hoy, en la zona del gimnasio. */
  readonly today: PlainDate;
  /** Hora local del gimnasio, `HH:MM`. */
  readonly now: LocalTime;
  readonly days?: number;
  readonly leadMinutes?: number;
}

/**
 * Las proximas clases, en orden.
 *
 * Ordenadas por fecha y hora y no agrupadas por dia de la semana: quien no
 * conoce el gimnasio piensa en "el martes que viene", no en "los martes".
 */
export function upcomingClassSlots(input: UpcomingSlotsInput): readonly TrialSlot[] {
  const days = input.days ?? TRIAL_WINDOW_DAYS;
  const lead = input.leadMinutes ?? TRIAL_LEAD_MINUTES;
  const minutesNow = minutesSinceMidnight(input.now);

  const slots: TrialSlot[] = [];

  for (let offset = 0; offset < days; offset++) {
    const date = addDays(input.today, offset);
    const weekday = isoWeekday(date);

    for (const schedule of input.schedules) {
      if (schedule.weekday !== weekday) continue;
      // Hoy solo cuentan las clases que todavia dan margen para avisar.
      if (offset === 0 && minutesSinceMidnight(schedule.startTime) - minutesNow < lead) continue;

      slots.push({
        scheduleId: schedule.id,
        name: schedule.name,
        instructor: schedule.instructor,
        date,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
      });
    }
  }

  return slots.sort(
    (a, b) =>
      compareDates(a.date, b.date) ||
      minutesSinceMidnight(a.startTime) - minutesSinceMidnight(b.startTime) ||
      a.name.localeCompare(b.name),
  );
}

/**
 * La opcion que el alumno eligio, o `null` si ya no existe.
 *
 * Se busca por horario Y fecha: el `scheduleId` solo no basta —un horario se
 * repite cada semana— y la fecha sola tampoco —un dia tiene varias clases—. El
 * par es lo unico que identifica una clase concreta.
 */
export function findSlot(
  slots: readonly TrialSlot[],
  scheduleId: string,
  date: PlainDate,
): TrialSlot | null {
  const iso = formatPlainDate(date);
  return (
    slots.find(
      (slot) => slot.scheduleId === scheduleId && formatPlainDate(slot.date) === iso,
    ) ?? null
  );
}
