import { describe, expect, it } from 'vitest';
import {
  advanceBillingDate,
  assertValidPolicy,
  daysPastDue,
  firstPeriod,
  isDue,
  periodContains,
  periodStartingAt,
  renewalIdempotencyKey,
} from './cycle.js';
import { plainDate } from '../time/plain-date.js';

const ANIVERSARIO = { mode: 'anniversary' } as const;
const DIA_12 = { mode: 'fixed_day', dayOfMonth: 12 } as const;

describe('advanceBillingDate con politica de aniversario', () => {
  it('avanza un mes', () => {
    expect(advanceBillingDate(plainDate(2026, 8, 12), ANIVERSARIO)).toEqual(plainDate(2026, 9, 12));
  });

  it('recorta el dia en meses cortos', () => {
    expect(advanceBillingDate(plainDate(2026, 1, 31), ANIVERSARIO)).toEqual(plainDate(2026, 2, 28));
  });
});

describe('advanceBillingDate con politica de dia fijo', () => {
  it('salta al dia fijo del mes siguiente si ya paso', () => {
    expect(advanceBillingDate(plainDate(2026, 8, 12), DIA_12)).toEqual(plainDate(2026, 9, 12));
    expect(advanceBillingDate(plainDate(2026, 8, 20), DIA_12)).toEqual(plainDate(2026, 9, 12));
  });

  it('usa el dia fijo del mismo mes si todavia no llego', () => {
    expect(advanceBillingDate(plainDate(2026, 8, 3), DIA_12)).toEqual(plainDate(2026, 8, 12));
  });

  it('cruza el fin de anio', () => {
    expect(advanceBillingDate(plainDate(2026, 12, 20), DIA_12)).toEqual(plainDate(2027, 1, 12));
  });

  it('rechaza dias que no existen en todos los meses', () => {
    expect(() => assertValidPolicy({ mode: 'fixed_day', dayOfMonth: 31 })).toThrow(RangeError);
    expect(() => assertValidPolicy({ mode: 'fixed_day', dayOfMonth: 0 })).toThrow(RangeError);
    expect(() => assertValidPolicy({ mode: 'fixed_day', dayOfMonth: 28 })).not.toThrow();
  });
});

describe('periodStartingAt', () => {
  it('el fin es exclusivo y coincide con el inicio del siguiente', () => {
    const agosto = periodStartingAt(plainDate(2026, 8, 12), ANIVERSARIO);
    const setiembre = periodStartingAt(agosto.end, ANIVERSARIO);
    expect(agosto.end).toEqual(setiembre.start);
  });

  it('contiene el inicio pero no el fin', () => {
    const periodo = periodStartingAt(plainDate(2026, 8, 12), ANIVERSARIO);
    expect(periodContains(periodo, plainDate(2026, 8, 12))).toBe(true);
    expect(periodContains(periodo, plainDate(2026, 9, 11))).toBe(true);
    expect(periodContains(periodo, plainDate(2026, 9, 12))).toBe(false);
    expect(periodContains(periodo, plainDate(2026, 8, 11))).toBe(false);
  });
});

describe('firstPeriod', () => {
  it('con aniversario el primer periodo es completo', () => {
    const { period, prorated } = firstPeriod(plainDate(2026, 8, 20), ANIVERSARIO);
    expect(prorated).toBe(false);
    expect(period.end).toEqual(plainDate(2026, 9, 20));
  });

  it('con dia fijo el primer periodo es corto y va prorrateado', () => {
    const { period, prorated } = firstPeriod(plainDate(2026, 8, 20), DIA_12);
    expect(prorated).toBe(true);
    expect(period.end).toEqual(plainDate(2026, 9, 12));
  });

  it('con dia fijo, inscribirse el dia despues del corte da un mes completo', () => {
    const { prorated } = firstPeriod(plainDate(2026, 8, 13), DIA_12);
    expect(prorated).toBe(false);
  });
});

describe('isDue y daysPastDue', () => {
  it('cobra el mismo dia de la renovacion, no despues', () => {
    const renovacion = plainDate(2026, 9, 12);
    expect(isDue(renovacion, plainDate(2026, 9, 11))).toBe(false);
    expect(isDue(renovacion, plainDate(2026, 9, 12))).toBe(true);
    expect(isDue(renovacion, plainDate(2026, 9, 13))).toBe(true);
  });

  it('la mora es cero mientras esta al dia', () => {
    expect(daysPastDue(plainDate(2026, 9, 12), plainDate(2026, 9, 10))).toBe(0);
    expect(daysPastDue(plainDate(2026, 9, 12), plainDate(2026, 9, 12))).toBe(0);
    expect(daysPastDue(plainDate(2026, 9, 12), plainDate(2026, 9, 20))).toBe(8);
  });
});

describe('renewalIdempotencyKey', () => {
  it('es estable para el mismo periodo', () => {
    const a = renewalIdempotencyKey('sub-1', plainDate(2026, 9, 12));
    const b = renewalIdempotencyKey('sub-1', plainDate(2026, 9, 12));
    expect(a).toBe(b);
    expect(a).toBe('renewal:sub-1:2026-09-12');
  });

  it('cambia al cambiar de periodo', () => {
    expect(renewalIdempotencyKey('sub-1', plainDate(2026, 9, 12))).not.toBe(
      renewalIdempotencyKey('sub-1', plainDate(2026, 10, 12)),
    );
  });
});
