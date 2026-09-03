import { describe, expect, it } from 'vitest';
import { MAX_PERIODS_OWED, applyPayment, computeReceivable } from './receivable.js';
import { evaluateDelinquency } from './dunning.js';
import { fromSoles } from '../money/cents.js';
import { plainDate } from '../time/plain-date.js';
import { asId } from '../domain/types.js';
import { makeDropInPlan, makeSubscription, makeWeeklyPlan } from '../testing/fixtures.js';

const ANIVERSARIO = { mode: 'anniversary' } as const;
const plan = makeWeeklyPlan(2); // S/ 120

const suscripcion = makeSubscription({
  planId: plan.id,
  periodStart: plainDate(2026, 7, 12),
  nextBillingDate: plainDate(2026, 8, 12),
});

describe('computeReceivable', () => {
  it('no debe nada antes de la fecha de cobro', () => {
    const r = computeReceivable({
      subscription: suscripcion,
      plan,
      policy: ANIVERSARIO,
      today: plainDate(2026, 8, 11),
    });
    expect(r.due).toBe(false);
    expect(r.amountCents).toBe(0);
  });

  it('debe el periodo completo el mismo dia del cobro: se paga por adelantado', () => {
    const r = computeReceivable({
      subscription: suscripcion,
      plan,
      policy: ANIVERSARIO,
      today: plainDate(2026, 8, 12),
    });
    expect(r.due).toBe(true);
    expect(r.periodsOwed).toBe(1);
    expect(r.amountCents).toBe(fromSoles(120));
    expect(r.daysPastDue).toBe(0);
    expect(r.throughDate).toEqual(plainDate(2026, 9, 12));
  });

  it('acumula el segundo mes recien cuando vence', () => {
    const unMes = computeReceivable({
      subscription: suscripcion,
      plan,
      policy: ANIVERSARIO,
      today: plainDate(2026, 9, 11),
    });
    expect(unMes.periodsOwed).toBe(1);

    const dosMeses = computeReceivable({
      subscription: suscripcion,
      plan,
      policy: ANIVERSARIO,
      today: plainDate(2026, 9, 12),
    });
    expect(dosMeses.periodsOwed).toBe(2);
    expect(dosMeses.amountCents).toBe(fromSoles(240));
    expect(dosMeses.daysPastDue).toBe(31);
  });

  it('topa la deuda: el que desaparecio ocho meses dejo de ser alumno', () => {
    const r = computeReceivable({
      subscription: suscripcion,
      plan,
      policy: ANIVERSARIO,
      today: plainDate(2027, 4, 12),
    });
    expect(r.periodsOwed).toBe(MAX_PERIODS_OWED);
    expect(r.capped).toBe(true);
    expect(r.amountCents).toBe(fromSoles(360));
  });

  it('una suscripcion cancelada no genera deuda', () => {
    const r = computeReceivable({
      subscription: makeSubscription({
        planId: plan.id,
        status: 'canceled',
        nextBillingDate: plainDate(2026, 8, 12),
      }),
      plan,
      policy: ANIVERSARIO,
      today: plainDate(2026, 10, 1),
    });
    expect(r.due).toBe(false);
  });
});

describe('applyPayment', () => {
  it('un pago manual extiende la renovacion y reactiva', () => {
    const r = applyPayment({
      subscription: makeSubscription({
        status: 'suspended',
        nextBillingDate: plainDate(2026, 8, 12),
      }),
      policy: ANIVERSARIO,
      periodsPaid: 1,
    });
    expect(r.status).toBe('active');
    expect(r.periodStart).toEqual(plainDate(2026, 8, 12));
    expect(r.nextBillingDate).toEqual(plainDate(2026, 9, 12));
  });

  it('pagar dos periodos salta dos renovaciones', () => {
    const r = applyPayment({
      subscription: makeSubscription({ nextBillingDate: plainDate(2026, 8, 12) }),
      policy: ANIVERSARIO,
      periodsPaid: 2,
    });
    expect(r.periodStart).toEqual(plainDate(2026, 9, 12));
    expect(r.nextBillingDate).toEqual(plainDate(2026, 10, 12));
  });

  it('aplica el downgrade guardado al renovar', () => {
    const r = applyPayment({
      subscription: makeSubscription({
        planId: asId('plan-3x'),
        pendingPlanId: asId('plan-2x'),
        nextBillingDate: plainDate(2026, 8, 12),
      }),
      policy: ANIVERSARIO,
      periodsPaid: 1,
    });
    expect(r.planId).toBe('plan-2x');
    expect(r.pendingPlanId).toBeNull();
  });

  it('rechaza pagos de cero periodos', () => {
    expect(() =>
      applyPayment({ subscription: suscripcion, policy: ANIVERSARIO, periodsPaid: 0 }),
    ).toThrow(RangeError);
  });
});

describe('deuda y pago se cierran entre si', () => {
  it('pagar el total deja la deuda en cero', () => {
    const hoy = plainDate(2026, 9, 20);
    const antes = computeReceivable({
      subscription: suscripcion,
      plan,
      policy: ANIVERSARIO,
      today: hoy,
    });
    expect(antes.periodsOwed).toBe(2);

    const aplicado = applyPayment({
      subscription: suscripcion,
      policy: ANIVERSARIO,
      periodsPaid: antes.periodsOwed,
    });
    const despues = computeReceivable({
      subscription: { ...suscripcion, ...aplicado },
      plan,
      policy: ANIVERSARIO,
      today: hoy,
    });
    expect(despues.due).toBe(false);
    expect(despues.amountCents).toBe(0);
  });
});

describe('clase suelta', () => {
  const dropIn = makeDropInPlan();

  it('no debe nada aunque la fecha de cobro este vencida hace meses', () => {
    const r = computeReceivable({
      subscription: suscripcion,
      plan: dropIn,
      policy: ANIVERSARIO,
      today: plainDate(2027, 3, 1),
    });
    expect(r.due).toBe(false);
    expect(r.amountCents).toBe(0);
    expect(r.periodsOwed).toBe(0);
    expect(r.daysPastDue).toBe(0);
  });

  /**
   * Es la consecuencia que importa y por eso se prueba aqui y no solo en
   * `dunning`: los tres llamadores de `evaluateDelinquency` le pasan
   * `periodPaid: !receivable.due`, asi que cortar la deuda es lo unico que hace
   * falta para que a un alumno de clase suelta no se le pueda suspender.
   */
  it('de ahi sale que nunca caiga en mora', () => {
    const r = computeReceivable({
      subscription: suscripcion,
      plan: dropIn,
      policy: ANIVERSARIO,
      today: plainDate(2027, 3, 1),
    });
    const estado = evaluateDelinquency({
      nextBillingDate: suscripcion.nextBillingDate,
      today: plainDate(2027, 3, 1),
      graceDays: 5,
      periodPaid: !r.due,
    });
    expect(estado.status).toBe('active');
    expect(estado.canTrain).toBe(true);
  });

  it('el mismo alumno con un plan mensual si debe: la excepcion es del plan, no de la fecha', () => {
    const r = computeReceivable({
      subscription: suscripcion,
      plan,
      policy: ANIVERSARIO,
      today: plainDate(2026, 8, 12),
    });
    expect(r.due).toBe(true);
  });
});
