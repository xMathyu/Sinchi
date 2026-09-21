/**
 * Quien viene mucho y quien se esta yendo.
 *
 * Son las dos mitades de la misma pregunta —«¿como esta usando el gimnasio mi
 * gente?»— y solo una se puede contestar contando. La otra no, y conviene
 * decirlo antes de que alguien la «arregle»:
 *
 *   **Ordenar de menos a mas asistencias NO da los que se estan yendo.**
 *
 * Da tres cosas mezcladas que piden acciones distintas:
 *
 *  1. el que se inscribio anteayer y todavia no ha venido — no esta a la fuga,
 *     es nuevo, y llamarlo para preguntarle por que no viene es ridiculo;
 *  2. el de 2 veces por semana que vino 8 veces en el mes — uso su plan al
 *     100%, y aparece debajo del de ilimitado que vino 12 y esta flojeando.
 *     Contar sin mirar el plan compara cosas que no son comparables;
 *  3. el que si dejo de venir.
 *
 * Asi que la lista de riesgo se ordena por **dias sin aparecer**, que es lo que
 * de verdad predice una baja, y cada fila trae su MOTIVO —nunca vino, o dejo de
 * venir—, que es lo que decide si se le escribe «¿te esperamos el martes?» o
 * «¿todo bien?». Un booleano «en riesgo» dejaria al dueño sin saber a quien
 * llamar primero ni que decirle.
 *
 * El top, en cambio, si es contar: «alumno del mes» significa quien mas vino, y
 * todo el mundo lo entiende asi. Lleva al lado su uso del cupo para que el dueño
 * pueda ver que el segundo puesto con plan de 2x rindio mas que el primero.
 */
import {
  addDays,
  compareDates,
  daysBetween,
  isAfter,
  isBefore,
  type PlainDate,
} from '../time/plain-date.js';

/**
 * Dias de margen antes de considerar que alguien «dejo de venir».
 *
 * Catorce y no siete: un alumno que se inscribio el lunes y viene los sabados
 * lleva seis dias sin aparecer y esta perfectamente. Por debajo de este margen
 * la ausencia no se distingue de la agenda normal de alguien que acaba de
 * entrar, y una lista de riesgo llena de recien llegados se deja de mirar.
 */
export const NEW_MEMBER_GRACE_DAYS = 14;

/**
 * Dias sin aparecer a partir de los cuales la fila sale en la lista.
 *
 * Diez cubre dos semanas de un plan de 2x: quien no vino en diez dias se salto
 * tres sesiones seguidas, y eso ya no es «esta semana ando ocupado».
 *
 * Es un umbral unico y no uno por plan a proposito. Calcularlo contra el cupo
 * —al de ilimitado se le avisaria a los 4 dias, al de 2x a los 12— da una lista
 * mas fina y una que el dueño no puede explicarse a si mismo: dos alumnos con
 * la misma ausencia, uno en la lista y el otro no. Un numero que se entiende se
 * usa; uno que no, se ignora.
 */
export const FADING_AFTER_DAYS = 10;

/** Un alumno con lo que hizo en el rango. Lo arma quien tenga la base delante. */
export interface AttendanceRecord {
  readonly membershipId: string;
  readonly name: string;
  /** Asistencias DENTRO del rango. */
  readonly checkIns: number;
  /**
   * El ultimo dia que vino, mirando todo su historial y no solo el rango.
   *
   * Todo el historial a proposito: si solo se mirara el rango, quien vino por
   * ultima vez el dia antes de `from` saldria como «nunca vino», que es una
   * acusacion falsa y ademas la que peor se recibe de un sistema.
   */
  readonly lastVisit: PlainDate | null;
  /** Desde cuando es alumno de este local. */
  readonly since: PlainDate;
  /** Lo que su plan le permite por semana. `null` cuando es ilimitado. */
  readonly weeklyLimit: number | null;
}

export interface RankingInput {
  readonly records: readonly AttendanceRecord[];
  readonly from: PlainDate;
  readonly through: PlainDate;
  /** Hoy en la zona del gimnasio. Contra esto se miden los dias sin aparecer. */
  readonly today: PlainDate;
  /** Cuantas filas trae cada lista. */
  readonly limit?: number;
}

export interface RegularMember {
  readonly membershipId: string;
  readonly name: string;
  readonly checkIns: number;
  readonly lastVisit: PlainDate | null;
  /** Veces por semana en el rango, con un decimal. */
  readonly perWeek: number;
  /**
   * Que fraccion de su cupo uso: `1` es haber venido justo lo que paga.
   *
   * `null` en un plan ilimitado, y no `1`: ahi no hay cupo contra el que medir,
   * y fingir uno pondria a todo el mundo al 100% o al 0% segun se redondee.
   */
  readonly quotaUse: number | null;
}

/**
 * Por que esta en la lista de riesgo.
 *
 * `never_came` y `absent` piden llamadas distintas: al primero le fallo el alta
 * —nadie le explico como entrar, o se inscribio por alguien mas— y al segundo
 * le paso algo despues. Meterlos en el mismo saco es como se manda el mensaje
 * equivocado a la mitad de la lista.
 */
export type FadingReason = 'never_came' | 'absent';

export interface FadingMember {
  readonly membershipId: string;
  readonly name: string;
  readonly reason: FadingReason;
  /** Dias desde su ultima vez; desde que se inscribio si nunca vino. */
  readonly daysAway: number;
  readonly checkIns: number;
  readonly lastVisit: PlainDate | null;
}

export interface AttendanceRanking {
  /** Los que mas vinieron, de mas a menos. Solo quien vino al menos una vez. */
  readonly regulars: readonly RegularMember[];
  /** Los que llevan mas tiempo sin aparecer, de mas a menos. */
  readonly fading: readonly FadingMember[];
  /** Asistencias totales del rango. */
  readonly totalCheckIns: number;
  /** Cuantos alumnos pisaron el local en el rango. */
  readonly activeMembers: number;
  /** Cuantos no pisaron ninguna vez, vengan o no de antes. */
  readonly absentMembers: number;
}

/** Semanas del rango, con los dos extremos dentro. Minimo una. */
function weeksIn(from: PlainDate, through: PlainDate): number {
  return Math.max(1, (daysBetween(from, through) + 1) / 7);
}

const round1 = (value: number): number => Math.round(value * 10) / 10;

/**
 * Las dos listas.
 *
 * Recibe el padron entero y recorta dentro, como `computeRevenue`: la regla de
 * quien entra en cada lista es negocio, no un `where`, y tiene que poder
 * probarse sin levantar Postgres.
 */
export function computeAttendanceRanking(input: RankingInput): AttendanceRanking {
  const { records, from, through, today } = input;
  const limit = input.limit ?? 5;
  const weeks = weeksIn(from, through);

  const regulars = records
    // Quien no vino ninguna vez no es un regular con cero: no pertenece a esta
    // lista. Su sitio es la otra, que es la que dice que hacer con el.
    .filter((record) => record.checkIns > 0)
    .map<RegularMember>((record) => {
      const perWeek = record.checkIns / weeks;
      return {
        membershipId: record.membershipId,
        name: record.name,
        checkIns: record.checkIns,
        lastVisit: record.lastVisit,
        perWeek: round1(perWeek),
        quotaUse:
          record.weeklyLimit === null || record.weeklyLimit === 0
            ? null
            : round1(perWeek / record.weeklyLimit),
      };
    })
    .sort(
      (a, b) =>
        b.checkIns - a.checkIns ||
        // Empate: primero quien vino hace menos. Entre dos de 12 asistencias,
        // el que estuvo ayer es mas «alumno del mes» que el que lleva un mes.
        compareLastVisit(b.lastVisit, a.lastVisit) ||
        a.name.localeCompare(b.name, 'es'),
    )
    .slice(0, limit);

  const fading = records
    .flatMap<FadingMember>((record) => {
      // Recien inscrito: no esta a la fuga, acaba de llegar.
      if (daysBetween(record.since, today) < NEW_MEMBER_GRACE_DAYS) return [];

      const daysAway =
        record.lastVisit === null
          ? daysBetween(record.since, today)
          : daysBetween(record.lastVisit, today);

      if (daysAway < FADING_AFTER_DAYS) return [];

      return [
        {
          membershipId: record.membershipId,
          name: record.name,
          reason: record.lastVisit === null ? ('never_came' as const) : ('absent' as const),
          daysAway,
          checkIns: record.checkIns,
          lastVisit: record.lastVisit,
        },
      ];
    })
    .sort((a, b) => b.daysAway - a.daysAway || a.name.localeCompare(b.name, 'es'))
    .slice(0, limit);

  return {
    regulars,
    fading,
    totalCheckIns: records.reduce((sum, record) => sum + record.checkIns, 0),
    activeMembers: records.filter((record) => record.checkIns > 0).length,
    absentMembers: records.filter((record) => record.checkIns === 0).length,
  };
}

/** `null` (nunca vino) va siempre al final. */
function compareLastVisit(a: PlainDate | null, b: PlainDate | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return compareDates(a, b);
}

/**
 * Si un dia cae dentro del rango, extremos incluidos.
 *
 * Se exporta porque quien arma los `AttendanceRecord` tiene que recortar con el
 * MISMO criterio con el que despues se cuenta: dos recortes distintos es como
 * se llega a un total que no cuadra con la suma de sus filas.
 */
export const withinRange = (day: PlainDate, from: PlainDate, through: PlainDate): boolean =>
  !isBefore(day, from) && !isAfter(day, through);

/** El rango de los ultimos `days` dias, hoy incluido. El de la pantalla. */
export function lastDays(today: PlainDate, days: number): {
  readonly from: PlainDate;
  readonly through: PlainDate;
} {
  return { from: addDays(today, -(days - 1)), through: today };
}
