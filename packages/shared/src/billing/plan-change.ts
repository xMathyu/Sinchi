/**
 * Cambio de plan (MD 4.2).
 *
 *  - Upgrade: se cobra el diferencial prorrateado HOY como cargo unico contra
 *    la tarjeta guardada, el plan cambia de inmediato y `nextBillingDate` no se
 *    toca.
 *  - Downgrade: no se cobra nada. Se guarda en `pendingPlanId` y se aplica en
 *    la proxima renovacion. Asi nunca hay devoluciones.
 *
 * El caso de precio igual (cambiar los dias fijos sin cambiar de tarifa) se
 * aplica de inmediato y sin cargo: no mueve plata, y diferirlo dejaria al
 * alumno un mes entero con los dias equivocados.
 */
import { ZERO, subtract, type Cents } from '../money/cents.js';
import type { Plan, PlanId, Subscription } from '../domain/types.js';
import type { PlainDate } from '../time/plain-date.js';
import { prorateUpgrade, type ProrationResult } from './proration.js';

export type PlanChangeDecision =
  | {
      readonly kind: 'upgrade';
      readonly planId: PlanId;
      readonly applyNow: true;
      readonly chargeTodayCents: Cents;
      readonly proration: ProrationResult;
      /** Se conserva tal cual: el upgrade no reinicia el ciclo. */
      readonly nextBillingDate: PlainDate;
    }
  | {
      readonly kind: 'lateral';
      readonly planId: PlanId;
      readonly applyNow: true;
      readonly chargeTodayCents: Cents;
      readonly nextBillingDate: PlainDate;
    }
  | {
      readonly kind: 'downgrade';
      readonly pendingPlanId: PlanId;
      readonly applyNow: false;
      readonly chargeTodayCents: Cents;
      /** Fecha en la que el plan pendiente entra en vigor. */
      readonly appliesOn: PlainDate;
      readonly monthlySavingsCents: Cents;
    }
  | { readonly kind: 'no_change'; readonly planId: PlanId };

export interface PlanChangeInput {
  readonly subscription: Subscription;
  readonly currentPlan: Plan;
  readonly targetPlan: Plan;
  readonly today: PlainDate;
}

export function decidePlanChange(input: PlanChangeInput): PlanChangeDecision {
  const { subscription, currentPlan, targetPlan, today } = input;

  if (targetPlan.id === currentPlan.id) {
    return { kind: 'no_change', planId: currentPlan.id };
  }
  if (!targetPlan.active) {
    throw new Error(`El plan destino "${targetPlan.name}" no esta activo.`);
  }
  if (targetPlan.tenantId !== currentPlan.tenantId) {
    throw new Error('No se puede mover una suscripcion a un plan de otro gimnasio.');
  }

  const difference = subtract(targetPlan.priceCents, currentPlan.priceCents);

  if (difference > 0) {
    const proration = prorateUpgrade({
      periodStart: subscription.periodStart,
      periodEnd: subscription.nextBillingDate,
      today,
      currentPriceCents: currentPlan.priceCents,
      newPriceCents: targetPlan.priceCents,
    });
    return {
      kind: 'upgrade',
      planId: targetPlan.id,
      applyNow: true,
      chargeTodayCents: proration.amountCents,
      proration,
      nextBillingDate: subscription.nextBillingDate,
    };
  }

  if (difference === 0) {
    return {
      kind: 'lateral',
      planId: targetPlan.id,
      applyNow: true,
      chargeTodayCents: ZERO,
      nextBillingDate: subscription.nextBillingDate,
    };
  }

  return {
    kind: 'downgrade',
    pendingPlanId: targetPlan.id,
    applyNow: false,
    chargeTodayCents: ZERO,
    appliesOn: subscription.nextBillingDate,
    monthlySavingsCents: subtract(currentPlan.priceCents, targetPlan.priceCents),
  };
}

/**
 * Plan con el que se debe cobrar la proxima renovacion.
 *
 * Es el punto donde el downgrade guardado se hace efectivo. Lo llama el cron
 * de renovacion, no la UI.
 */
export function planForRenewal(
  subscription: Subscription,
  plans: readonly Plan[],
): { readonly plan: Plan; readonly appliesPending: boolean } {
  const find = (id: PlanId): Plan => {
    const plan = plans.find((p) => p.id === id);
    if (plan === undefined) throw new Error(`Plan ${id} no encontrado al renovar.`);
    return plan;
  };

  if (subscription.pendingPlanId !== null) {
    return { plan: find(subscription.pendingPlanId), appliesPending: true };
  }
  return { plan: find(subscription.planId), appliesPending: false };
}
