/**
 * Validacion de check-in. Funcion pura, el corazon de la puerta.
 *
 * Devuelve un MOTIVO ESTRUCTURADO cuando rechaza (MD 4.3): "acceso denegado"
 * a secas es inutil frente al alumno. El staff necesita saber si el problema
 * es plata, dia o cupo, porque cada uno tiene una accion distinta.
 *
 * Corre igual en el servidor y en el dispositivo de staff sin conexion. El
 * servidor reconcilia despues y es la autoridad final (MD 4.6).
 */
import type { Cents } from '../money/cents.js';
import type {
  Attendance,
  ClassSchedule,
  ClassScheduleId,
  Plan,
  QuotaOverflowPolicy,
  Subscription,
  SubscriptionStatus,
} from '../domain/types.js';
import {
  isoWeekday,
  minutesSinceMidnight,
  type IsoWeekday,
  type LocalTime,
  type PlainDate,
} from '../time/plain-date.js';
import { computeQuota, type QuotaState } from './quota.js';

/**
 * Semaforo de acceso: un solo lenguaje entre dominio y UI.
 *
 *  - `ok`      pasa. Suscripcion al dia y cupo disponible.
 *  - `warn`    pasa con aviso. Ultima sesion o periodo de gracia.
 *  - `alert`   hoy no. Esta al dia pero cupo agotado o dia no permitido.
 *  - `blocked` suspension por mora.
 *
 * Que el nivel lo decida el dominio y no la pantalla evita que la app del
 * alumno y la del staff pinten colores distintos para el mismo hecho.
 */
export type AccessLevel = 'ok' | 'warn' | 'alert' | 'blocked';

/**
 * Codigos de rechazo. Corresponden a los del MD 4.3:
 * `morosidad` -> `delinquent`, `dia_no_permitido` -> `day_not_allowed`,
 * `cupo_agotado` -> `quota_exhausted`, `fuera_de_horario` -> `outside_schedule`.
 */
export type DenialCode =
  | 'no_subscription'
  | 'delinquent'
  | 'day_not_allowed'
  | 'quota_exhausted'
  | 'outside_schedule';

export type DenialReason =
  | { readonly code: 'no_subscription'; readonly level: 'blocked' }
  | {
      readonly code: 'delinquent';
      readonly level: 'blocked';
      readonly status: SubscriptionStatus;
      readonly daysPastDue: number;
      readonly debtCents: Cents | null;
    }
  | {
      readonly code: 'day_not_allowed';
      readonly level: 'alert';
      readonly allowedDays: readonly IsoWeekday[];
      readonly todayIs: IsoWeekday;
    }
  | {
      readonly code: 'quota_exhausted';
      readonly level: 'alert';
      readonly limit: number;
      readonly used: number;
      /** MD 8.2 sigue abierto: el motor informa, el gimnasio decide. */
      readonly offerDropIn: boolean;
      readonly dropInPriceCents: Cents | null;
    }
  | {
      readonly code: 'outside_schedule';
      readonly level: 'alert';
      readonly time: LocalTime;
      readonly nextClass: { readonly name: string; readonly startTime: LocalTime } | null;
    };

/** Motivo por el que un ingreso permitido igual merece aviso al staff. */
export type AccessWarning =
  | { readonly code: 'last_session'; readonly remaining: 1 }
  | { readonly code: 'in_grace'; readonly graceDaysLeft: number };

export type CheckInResult =
  | {
      readonly allowed: true;
      readonly level: 'ok' | 'warn';
      readonly warning: AccessWarning | null;
      readonly quota: QuotaState;
      readonly classScheduleId: ClassScheduleId | null;
    }
  | {
      readonly allowed: false;
      readonly level: AccessLevel;
      readonly reason: DenialReason;
      readonly quota: QuotaState | null;
    };

export interface CheckInContext {
  readonly subscription: Subscription | null;
  readonly plan: Plan | null;
  /** Asistencias conocidas del alumno; se filtran por semana ISO adentro. */
  readonly attendances: readonly Attendance[];
  /**
   * Cupo ya calculado, si el llamador lo tiene.
   *
   * El servidor cuenta el consumo semanal en SQL (`count(*) group by`) para
   * armar el padron completo sin un N+1, y seria absurdo que esta funcion lo
   * volviera a contar sobre una lista vacia y concluyera que nadie entreno.
   * Cuando viene, manda sobre `attendances`.
   */
  readonly quotaOverride?: QuotaState;
  /** Horarios del tenant. Vacio = el gimnasio no controla horarios. */
  readonly schedules: readonly ClassSchedule[];
  readonly today: PlainDate;
  readonly time: LocalTime;
  /** Tolerancia antes del inicio y despues del fin de clase, en minutos. */
  readonly toleranceMinutes?: number;
  readonly graceDays: number;
  readonly quotaOverflowPolicy: QuotaOverflowPolicy;
  readonly dropInPriceCents?: Cents | null;
  readonly debtCents?: Cents | null;
  /** Dias transcurridos desde `nextBillingDate`; 0 si esta al dia. */
  readonly daysPastDue?: number;
}

const DEFAULT_TOLERANCE_MINUTES = 30;

function dayIsAllowed(plan: Plan, day: IsoWeekday): boolean {
  return plan.allowedDays === null || plan.allowedDays.includes(day);
}

function currentClass(
  schedules: readonly ClassSchedule[],
  day: IsoWeekday,
  time: LocalTime,
  tolerance: number,
): ClassSchedule | null {
  const now = minutesSinceMidnight(time);
  for (const schedule of schedules) {
    if (schedule.weekday !== day) continue;
    const opens = minutesSinceMidnight(schedule.startTime) - tolerance;
    const closes = minutesSinceMidnight(schedule.endTime) + tolerance;
    if (now >= opens && now <= closes) return schedule;
  }
  return null;
}

function nextClassOfDay(
  schedules: readonly ClassSchedule[],
  day: IsoWeekday,
  time: LocalTime,
): ClassSchedule | null {
  const now = minutesSinceMidnight(time);
  return (
    schedules
      .filter((s) => s.weekday === day && minutesSinceMidnight(s.startTime) > now)
      .sort((a, b) => minutesSinceMidnight(a.startTime) - minutesSinceMidnight(b.startTime))[0] ??
    null
  );
}

/**
 * Valida un intento de ingreso.
 *
 * El orden importa y es el del MD 4.3: suscripcion al dia -> dia permitido ->
 * cupo semanal -> hay clase. Reordenarlo cambia el motivo que ve el staff: a
 * un moroso hay que decirle que debe plata, no que hoy no es su dia.
 */
export function validateCheckIn(ctx: CheckInContext): CheckInResult {
  const { subscription, plan, today, time } = ctx;

  if (subscription === null || plan === null || subscription.status === 'canceled') {
    return {
      allowed: false,
      level: 'blocked',
      reason: { code: 'no_subscription', level: 'blocked' },
      quota: null,
    };
  }

  // 1. Suscripcion al dia. `in_grace` SI puede entrenar (MD 4.4).
  if (subscription.status === 'suspended') {
    return {
      allowed: false,
      level: 'blocked',
      reason: {
        code: 'delinquent',
        level: 'blocked',
        status: subscription.status,
        daysPastDue: ctx.daysPastDue ?? 0,
        debtCents: ctx.debtCents ?? null,
      },
      quota: null,
    };
  }

  const day = isoWeekday(today);
  const quota = ctx.quotaOverride ?? computeQuota(plan, ctx.attendances, today);

  // 2. Dia permitido.
  if (!dayIsAllowed(plan, day)) {
    return {
      allowed: false,
      level: 'alert',
      reason: {
        code: 'day_not_allowed',
        level: 'alert',
        allowedDays: plan.allowedDays ?? [],
        todayIs: day,
      },
      quota,
    };
  }

  // 3. Cupo semanal.
  if (quota.exhausted && quota.limit !== null) {
    return {
      allowed: false,
      level: 'alert',
      reason: {
        code: 'quota_exhausted',
        level: 'alert',
        limit: quota.limit,
        used: quota.used,
        offerDropIn: ctx.quotaOverflowPolicy === 'offer_drop_in',
        dropInPriceCents: ctx.dropInPriceCents ?? null,
      },
      quota,
    };
  }

  // 4. Hay clase en este horario. Sin horarios cargados no se bloquea a nadie:
  //    un gimnasio de horario libre no tiene por que configurarlos.
  let classScheduleId: ClassScheduleId | null = null;
  if (ctx.schedules.length > 0) {
    const tolerance = ctx.toleranceMinutes ?? DEFAULT_TOLERANCE_MINUTES;
    const schedule = currentClass(ctx.schedules, day, time, tolerance);
    if (schedule === null) {
      const next = nextClassOfDay(ctx.schedules, day, time);
      return {
        allowed: false,
        level: 'alert',
        reason: {
          code: 'outside_schedule',
          level: 'alert',
          time,
          nextClass: next === null ? null : { name: next.name, startTime: next.startTime },
        },
        quota,
      };
    }
    classScheduleId = schedule.id;
  }

  // Permitido. Queda decidir si merece aviso.
  if (subscription.status === 'in_grace') {
    return {
      allowed: true,
      level: 'warn',
      warning: {
        code: 'in_grace',
        graceDaysLeft: Math.max(0, ctx.graceDays - (ctx.daysPastDue ?? 0)),
      },
      quota,
      classScheduleId,
    };
  }

  if (quota.isLastSession) {
    return {
      allowed: true,
      level: 'warn',
      warning: { code: 'last_session', remaining: 1 },
      quota,
      classScheduleId,
    };
  }

  return { allowed: true, level: 'ok', warning: null, quota, classScheduleId };
}
