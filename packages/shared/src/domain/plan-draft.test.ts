import { describe, expect, it } from 'vitest';
import {
  checkPlanDraft,
  planDenialMessage,
  planPriceUnit,
  planShape,
  PLAN_PRICE_MAX_CENTS,
  type PlanDraft,
} from './plan-draft.js';
import { fromSoles } from '../money/cents.js';

function borrador(overrides: Partial<PlanDraft> = {}): PlanDraft {
  return {
    name: '3 veces por semana',
    type: 'sessions_per_week',
    sessionsPerWeek: 3,
    allowedDays: null,
    priceCents: fromSoles(150),
    ...overrides,
  };
}

describe('nombre', () => {
  it('acepta uno normal', () => {
    expect(checkPlanDraft(borrador())).toBeNull();
  });

  it('rechaza el vacio y el de una letra', () => {
    expect(checkPlanDraft(borrador({ name: '   ' }))).toBe('name_too_short');
    expect(checkPlanDraft(borrador({ name: 'A' }))).toBe('name_too_short');
  });

  it('no cuenta los espacios de los bordes', () => {
    expect(checkPlanDraft(borrador({ name: '  Ilimitado  ' }))).toBeNull();
  });

  it('rechaza el que no cabe en la columna', () => {
    expect(checkPlanDraft(borrador({ name: 'x'.repeat(61) }))).toBe('name_too_long');
  });
});

describe('precio', () => {
  it('acepta cero: hay gimnasios con un plan de cortesia', () => {
    expect(checkPlanDraft(borrador({ priceCents: 0 }))).toBeNull();
  });

  it('rechaza negativo', () => {
    expect(checkPlanDraft(borrador({ priceCents: -1 }))).toBe('price_negative');
  });

  it('rechaza centimos con decimales', () => {
    expect(checkPlanDraft(borrador({ priceCents: 150.5 }))).toBe('price_not_integer');
  });

  it('caza el tipeo de soles escritos como centimos', () => {
    expect(checkPlanDraft(borrador({ priceCents: PLAN_PRICE_MAX_CENTS + 1 }))).toBe(
      'price_too_high',
    );
  });
});

describe('sesiones por semana', () => {
  it('las exige cuando el tipo las lleva', () => {
    expect(checkPlanDraft(borrador({ sessionsPerWeek: null }))).toBe('sessions_required');
  });

  it('las acota a la semana', () => {
    expect(checkPlanDraft(borrador({ sessionsPerWeek: 0 }))).toBe('sessions_out_of_range');
    expect(checkPlanDraft(borrador({ sessionsPerWeek: 8 }))).toBe('sessions_out_of_range');
    expect(checkPlanDraft(borrador({ sessionsPerWeek: 7 }))).toBeNull();
  });

  it('las rechaza en los tipos que no las llevan', () => {
    for (const type of ['unlimited', 'fixed_days', 'drop_in'] as const) {
      const draft = borrador({
        type,
        sessionsPerWeek: 3,
        allowedDays: type === 'fixed_days' ? [1, 3] : null,
      });
      expect(checkPlanDraft(draft)).toBe('sessions_not_allowed');
    }
  });
});

describe('dias', () => {
  it('un plan de dias fijos sin dias no limita nada', () => {
    expect(
      checkPlanDraft(borrador({ type: 'fixed_days', sessionsPerWeek: null, allowedDays: null })),
    ).toBe('days_required');
  });

  it('acepta dias fijos con dias', () => {
    expect(
      checkPlanDraft(
        borrador({ type: 'fixed_days', sessionsPerWeek: null, allowedDays: [2, 4] }),
      ),
    ).toBeNull();
  });

  it('rechaza un dia repetido: contaria dos sesiones para un solo dia', () => {
    expect(
      checkPlanDraft(
        borrador({ type: 'fixed_days', sessionsPerWeek: null, allowedDays: [2, 2] }),
      ),
    ).toBe('days_invalid');
  });

  it('rechaza el arreglo vacio y los dias fuera de rango', () => {
    expect(checkPlanDraft(borrador({ allowedDays: [] }))).toBe('days_invalid');
    expect(checkPlanDraft(borrador({ allowedDays: [0] }))).toBe('days_invalid');
    expect(checkPlanDraft(borrador({ allowedDays: [8] }))).toBe('days_invalid');
  });

  it('deja restringir los dias de un plan por sesiones (MD 4.3)', () => {
    expect(checkPlanDraft(borrador({ sessionsPerWeek: 2, allowedDays: [1, 2, 3, 4, 5] }))).toBeNull();
  });
});

describe('clase suelta', () => {
  it('vale sin sesiones ni dias', () => {
    const draft = borrador({ type: 'drop_in', sessionsPerWeek: null, priceCents: fromSoles(25) });
    expect(checkPlanDraft(draft)).toBeNull();
  });

  it('puede restringir los dias en que se ofrece', () => {
    const draft = borrador({
      type: 'drop_in',
      sessionsPerWeek: null,
      allowedDays: [6, 7],
      priceCents: fromSoles(30),
    });
    expect(checkPlanDraft(draft)).toBeNull();
  });

  it('su precio se lee por clase y no al mes', () => {
    expect(planPriceUnit('drop_in')).toBe('por clase');
    expect(planPriceUnit('unlimited')).toBe('al mes');
  });
});

describe('como se lee un plan', () => {
  it('dice la forma de cada tipo', () => {
    expect(planShape({ type: 'unlimited', sessionsPerWeek: null })).toBe('Sin límite de sesiones');
    expect(planShape({ type: 'sessions_per_week', sessionsPerWeek: 1 })).toBe('1 vez por semana');
    expect(planShape({ type: 'sessions_per_week', sessionsPerWeek: 3 })).toBe('3 veces por semana');
    expect(planShape({ type: 'fixed_days', sessionsPerWeek: null })).toBe('Días fijos');
    expect(planShape({ type: 'drop_in', sessionsPerWeek: null })).toBe('Se cobra por clase');
  });
});

describe('mensajes', () => {
  it('todo motivo tiene texto y ninguno queda vacio', () => {
    const motivos = [
      'name_too_short',
      'name_too_long',
      'price_negative',
      'price_not_integer',
      'price_too_high',
      'sessions_required',
      'sessions_out_of_range',
      'sessions_not_allowed',
      'days_required',
      'days_invalid',
    ] as const;
    for (const motivo of motivos) {
      expect(planDenialMessage(motivo).length).toBeGreaterThan(10);
    }
  });
});
