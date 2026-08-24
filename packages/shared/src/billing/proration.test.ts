import { describe, expect, it } from 'vitest';
import { prorateFirstPeriod, prorateUpgrade } from './proration.js';
import { fromSoles } from '../money/cents.js';
import { plainDate } from '../time/plain-date.js';

const PERIODO = {
  periodStart: plainDate(2026, 8, 12),
  periodEnd: plainDate(2026, 9, 12), // 31 dias
} as const;

describe('prorateUpgrade', () => {
  it('cobra el diferencial completo si el upgrade es el primer dia del periodo', () => {
    const r = prorateUpgrade({
      ...PERIODO,
      today: plainDate(2026, 8, 12),
      currentPriceCents: fromSoles(120),
      newPriceCents: fromSoles(150),
    });
    expect(r.daysInPeriod).toBe(31);
    expect(r.daysRemaining).toBe(31);
    expect(r.amountCents).toBe(fromSoles(30));
  });

  it('cobra solo la fraccion que queda del periodo', () => {
    // 15 dias de 31, sobre un diferencial de S/ 30: 3000 * 15 / 31 = 1451.6
    const r = prorateUpgrade({
      ...PERIODO,
      today: plainDate(2026, 8, 28),
      currentPriceCents: fromSoles(120),
      newPriceCents: fromSoles(150),
    });
    expect(r.daysRemaining).toBe(15);
    expect(r.amountCents).toBe(1_452);
  });

  it('no cobra nada si el diferencial es negativo: eso es un downgrade', () => {
    const r = prorateUpgrade({
      ...PERIODO,
      today: plainDate(2026, 8, 20),
      currentPriceCents: fromSoles(180),
      newPriceCents: fromSoles(120),
    });
    expect(r.amountCents).toBe(0);
    expect(r.monthlyDifferenceCents).toBe(fromSoles(-60));
  });

  it('no cobra nada si el precio es el mismo', () => {
    const r = prorateUpgrade({
      ...PERIODO,
      today: plainDate(2026, 8, 20),
      currentPriceCents: fromSoles(150),
      newPriceCents: fromSoles(150),
    });
    expect(r.amountCents).toBe(0);
  });

  it('no cobra nada el dia de la renovacion: ese cargo lo hace la renovacion', () => {
    const r = prorateUpgrade({
      ...PERIODO,
      today: plainDate(2026, 9, 12),
      currentPriceCents: fromSoles(120),
      newPriceCents: fromSoles(180),
    });
    expect(r.daysRemaining).toBe(0);
    expect(r.amountCents).toBe(0);
  });

  it('nunca cobra mas que el diferencial mensual completo', () => {
    // Un `today` anterior al inicio del periodo no puede inflar el cargo.
    const r = prorateUpgrade({
      ...PERIODO,
      today: plainDate(2026, 7, 1),
      currentPriceCents: fromSoles(120),
      newPriceCents: fromSoles(150),
    });
    expect(r.amountCents).toBe(fromSoles(30));
  });

  it('rechaza periodos invertidos', () => {
    expect(() =>
      prorateUpgrade({
        periodStart: plainDate(2026, 9, 12),
        periodEnd: plainDate(2026, 8, 12),
        today: plainDate(2026, 8, 20),
        currentPriceCents: fromSoles(120),
        newPriceCents: fromSoles(150),
      }),
    ).toThrow(RangeError);
  });

  it('febrero de 28 dias cobra mas por dia que un mes de 31', () => {
    const febrero = prorateUpgrade({
      periodStart: plainDate(2026, 2, 1),
      periodEnd: plainDate(2026, 3, 1),
      today: plainDate(2026, 2, 15),
      currentPriceCents: fromSoles(120),
      newPriceCents: fromSoles(150),
    });
    // 14 de 28 = exactamente la mitad.
    expect(febrero.amountCents).toBe(fromSoles(15));
  });
});

describe('prorateFirstPeriod', () => {
  it('cobra la fraccion del mes que el alumno va a usar', () => {
    // 23 dias de un mes de referencia de 31, sobre S/ 150.
    const monto = prorateFirstPeriod({
      start: plainDate(2026, 8, 20),
      end: plainDate(2026, 9, 12),
      monthlyPeriodLengthInDays: 31,
      monthlyPriceCents: fromSoles(150),
    });
    expect(monto).toBe(11_129); // 15000 * 23 / 31 = 11129.03
  });

  it('un periodo completo se cobra completo', () => {
    const monto = prorateFirstPeriod({
      start: plainDate(2026, 8, 12),
      end: plainDate(2026, 9, 12),
      monthlyPeriodLengthInDays: 31,
      monthlyPriceCents: fromSoles(150),
    });
    expect(monto).toBe(fromSoles(150));
  });

  it('rechaza periodos vacios', () => {
    expect(() =>
      prorateFirstPeriod({
        start: plainDate(2026, 8, 12),
        end: plainDate(2026, 8, 12),
        monthlyPeriodLengthInDays: 31,
        monthlyPriceCents: fromSoles(150),
      }),
    ).toThrow(RangeError);
  });
});
