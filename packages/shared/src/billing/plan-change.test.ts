import { describe, expect, it } from 'vitest';
import { decidePlanChange, planForRenewal } from './plan-change.js';
import { fromSoles } from '../money/cents.js';
import { plainDate } from '../time/plain-date.js';
import { asId } from '../domain/types.js';
import {
  makeFixedDaysPlan,
  makeSubscription,
  makeUnlimitedPlan,
  makeWeeklyPlan,
} from '../testing/fixtures.js';

const HOY = plainDate(2026, 8, 28);
const plan2x = makeWeeklyPlan(2); // S/ 120
const plan3x = makeWeeklyPlan(3); // S/ 150
const ilimitado = makeUnlimitedPlan(); // S/ 180

const suscripcion = makeSubscription({
  planId: plan2x.id,
  periodStart: plainDate(2026, 8, 12),
  nextBillingDate: plainDate(2026, 9, 12),
});

describe('upgrade', () => {
  const decision = decidePlanChange({
    subscription: suscripcion,
    currentPlan: plan2x,
    targetPlan: plan3x,
    today: HOY,
  });

  it('se aplica de inmediato', () => {
    expect(decision.kind).toBe('upgrade');
    if (decision.kind !== 'upgrade') return;
    expect(decision.applyNow).toBe(true);
    expect(decision.planId).toBe(plan3x.id);
  });

  it('cobra hoy el diferencial prorrateado', () => {
    if (decision.kind !== 'upgrade') throw new Error('esperaba upgrade');
    // 3000 centimos de diferencia, 15 de 31 dias restantes.
    expect(decision.chargeTodayCents).toBe(1_452);
  });

  it('NO mueve la fecha de renovacion', () => {
    if (decision.kind !== 'upgrade') throw new Error('esperaba upgrade');
    expect(decision.nextBillingDate).toEqual(suscripcion.nextBillingDate);
  });
});

describe('downgrade', () => {
  const decision = decidePlanChange({
    subscription: makeSubscription({
      planId: ilimitado.id,
      periodStart: plainDate(2026, 8, 12),
      nextBillingDate: plainDate(2026, 9, 12),
    }),
    currentPlan: ilimitado,
    targetPlan: plan2x,
    today: HOY,
  });

  it('no cobra nada: asi nunca hay devoluciones', () => {
    expect(decision.kind).toBe('downgrade');
    if (decision.kind !== 'downgrade') return;
    expect(decision.chargeTodayCents).toBe(0);
  });

  it('queda pendiente y se aplica en la proxima renovacion', () => {
    if (decision.kind !== 'downgrade') throw new Error('esperaba downgrade');
    expect(decision.applyNow).toBe(false);
    expect(decision.pendingPlanId).toBe(plan2x.id);
    expect(decision.appliesOn).toEqual(plainDate(2026, 9, 12));
    expect(decision.monthlySavingsCents).toBe(fromSoles(60));
  });
});

describe('cambio lateral', () => {
  it('mismo precio, distinto plan: se aplica ya y sin cargo', () => {
    // Cambiar los dias fijos no mueve plata, y diferirlo dejaria al alumno un
    // mes entero con los dias equivocados.
    const lunesMiercoles = makeFixedDaysPlan([1, 3], {
      id: asId('plan-lm'),
      priceCents: plan2x.priceCents,
    });
    const martesJueves = makeFixedDaysPlan([2, 4], {
      id: asId('plan-mj'),
      priceCents: plan2x.priceCents,
    });

    const decision = decidePlanChange({
      subscription: makeSubscription({ planId: lunesMiercoles.id }),
      currentPlan: lunesMiercoles,
      targetPlan: martesJueves,
      today: HOY,
    });

    expect(decision.kind).toBe('lateral');
    if (decision.kind !== 'lateral') return;
    expect(decision.applyNow).toBe(true);
    expect(decision.chargeTodayCents).toBe(0);
  });
});

describe('casos borde', () => {
  it('el mismo plan no es un cambio', () => {
    const decision = decidePlanChange({
      subscription: suscripcion,
      currentPlan: plan2x,
      targetPlan: plan2x,
      today: HOY,
    });
    expect(decision.kind).toBe('no_change');
  });

  it('rechaza un plan inactivo', () => {
    expect(() =>
      decidePlanChange({
        subscription: suscripcion,
        currentPlan: plan2x,
        targetPlan: makeWeeklyPlan(3, { active: false }),
        today: HOY,
      }),
    ).toThrow(/no esta activo/);
  });

  it('rechaza un plan de otro gimnasio', () => {
    expect(() =>
      decidePlanChange({
        subscription: suscripcion,
        currentPlan: plan2x,
        targetPlan: makeWeeklyPlan(3, { tenantId: asId('tenant-2') }),
        today: HOY,
      }),
    ).toThrow(/otro gimnasio/);
  });
});

describe('planForRenewal', () => {
  it('aplica el plan pendiente al renovar', () => {
    const { plan, appliesPending } = planForRenewal(
      makeSubscription({ planId: ilimitado.id, pendingPlanId: plan2x.id }),
      [ilimitado, plan2x, plan3x],
    );
    expect(appliesPending).toBe(true);
    expect(plan.id).toBe(plan2x.id);
  });

  it('sin pendiente renueva con el plan vigente', () => {
    const { plan, appliesPending } = planForRenewal(
      makeSubscription({ planId: plan3x.id }),
      [ilimitado, plan2x, plan3x],
    );
    expect(appliesPending).toBe(false);
    expect(plan.id).toBe(plan3x.id);
  });

  it('falla ruidosamente si el plan no existe', () => {
    expect(() => planForRenewal(makeSubscription({ planId: asId('plan-fantasma') }), [])).toThrow(
      /no encontrado/,
    );
  });
});
