/**
 * Salud de una membresia, resumida en un nivel y una etiqueta.
 *
 * Es distinto del resultado de un check-in: el check-in responde "puede entrar
 * ahora"; esto responde "como esta esta membresia". La lista de gimnasios del
 * alumno y el padron del staff muestran esto, no aquello.
 *
 * Vive en `shared` porque la app y el panel web pintan el mismo chip. Calcularlo
 * dos veces es como termina un alumno viendose "al dia" en una pantalla y
 * "moroso" en la otra.
 */
import { formatPENShort } from '../money/cents.js';
import type { AccessLevel } from '../checkin/validate.js';
import type { QuotaState } from '../checkin/quota.js';
import type { DelinquencyState } from '../billing/dunning.js';
import type { Receivable } from '../billing/receivable.js';

export interface MembershipStatusView {
  readonly level: AccessLevel;
  /** Texto del chip. Corto: tiene que caber al lado del nombre. */
  readonly badge: string;
}

export interface MembershipStatusInput {
  readonly delinquency: DelinquencyState;
  readonly receivable: Receivable;
  readonly quota: QuotaState;
}

/**
 * El orden es el que importa al alumno, de peor a mejor: plata primero, cupo
 * despues. Una deuda pendiente pesa mas que un cupo agotado porque una se
 * resuelve pagando y la otra se resuelve esperando al lunes.
 *
 * La etiqueta dice el hecho concreto ("DEBES S/ 120") antes que el estado
 * abstracto: es lo unico que el alumno lee de reojo al abrir la app.
 */
export function membershipStatus(input: MembershipStatusInput): MembershipStatusView {
  const { delinquency, receivable, quota } = input;

  if (delinquency.status === 'canceled') return { level: 'blocked', badge: 'CANCELADA' };
  if (delinquency.status === 'suspended') return { level: 'blocked', badge: 'SUSPENDIDA' };
  if (receivable.due) {
    return { level: 'warn', badge: `DEBES ${formatPENShort(receivable.amountCents)}` };
  }
  if (quota.exhausted && quota.limit !== null) {
    return { level: 'alert', badge: `${quota.used} / ${quota.limit}` };
  }
  if (quota.isLastSession) return { level: 'warn', badge: '1 SESIÓN' };
  return { level: 'ok', badge: 'AL DÍA' };
}
