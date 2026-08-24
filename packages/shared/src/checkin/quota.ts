/**
 * Cupo semanal de asistencia.
 *
 * Reglas (MD 4.3):
 *  - el cupo es semanal, no mensual: "3 veces por semana" no es "12 al mes";
 *  - semana ISO, lunes a domingo, en hora de Lima;
 *  - las sesiones no usadas NO se acumulan. Si se acumulan, revienta el aforo
 *    del sabado.
 *
 * El consumo se DERIVA contando asistencias de la semana. No existe contador
 * mutable: un contador se desincroniza y nadie sabe reconstruirlo.
 */
import type { Attendance, Plan } from '../domain/types.js';
import { isoWeekOf } from '../time/iso-week.js';
import type { PlainDate } from '../time/plain-date.js';

export interface QuotaState {
  /** `null` cuando el plan es ilimitado. */
  readonly limit: number | null;
  readonly used: number;
  /** `null` cuando el plan es ilimitado. */
  readonly remaining: number | null;
  readonly exhausted: boolean;
  /** Ultima sesion disponible: la UI la pinta en ambar (semaforo `warn`). */
  readonly isLastSession: boolean;
  readonly isoWeek: string;
}

/** Limite de sesiones semanales que impone el plan, o `null` si no impone. */
export function weeklyLimit(plan: Plan): number | null {
  switch (plan.type) {
    case 'unlimited':
      return null;
    case 'sessions_per_week':
      return plan.sessionsPerWeek ?? null;
    case 'fixed_days':
      // El limite lo da la cantidad de dias fijos asignados: un plan de lunes
      // y miercoles no puede rendir tres sesiones.
      return plan.allowedDays?.length ?? null;
  }
}

/**
 * Estado del cupo a partir del consumo ya contado.
 *
 * Existe separada de `computeQuota` para que el servidor pueda contar en SQL
 * (`count(*) group by membership_id`) al armar el padron de un gimnasio: con 150
 * alumnos, traer las asistencias de cada uno para contarlas en memoria es un
 * N+1 que se nota en la puerta.
 */
export function quotaFromCount(plan: Plan, used: number, isoWeek: string): QuotaState {
  const limit = weeklyLimit(plan);

  if (limit === null) {
    return {
      limit: null,
      used,
      remaining: null,
      exhausted: false,
      isLastSession: false,
      isoWeek,
    };
  }

  const remaining = Math.max(0, limit - used);
  return {
    limit,
    used,
    remaining,
    exhausted: remaining === 0,
    isLastSession: remaining === 1,
    isoWeek,
  };
}

/**
 * Estado del cupo para la semana ISO de `today`.
 *
 * `attendances` puede venir de la semana completa o del padron en cache del
 * dispositivo de staff: el filtro por semana se hace aqui para que el llamador
 * no tenga que acordarse.
 */
export function computeQuota(
  plan: Plan,
  attendances: readonly Attendance[],
  today: PlainDate,
): QuotaState {
  const key = isoWeekOf(today).key;
  const used = attendances.filter((a) => a.isoWeek === key).length;
  return quotaFromCount(plan, used, key);
}
