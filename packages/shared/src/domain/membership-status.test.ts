import { describe, expect, it } from 'vitest';
import { membershipStatus } from './membership-status.js';
import { ZERO, fromSoles } from '../money/cents.js';
import { plainDate } from '../time/plain-date.js';
import type { DelinquencyState } from '../billing/dunning.js';
import type { Receivable } from '../billing/receivable.js';
import type { QuotaState } from '../checkin/quota.js';

const alDia: DelinquencyState = {
  status: 'active',
  daysPastDue: 0,
  graceDaysLeft: 5,
  suspensionDate: plainDate(2026, 9, 17),
  canTrain: true,
};

const sinDeuda: Receivable = {
  due: false,
  periodsOwed: 0,
  amountCents: ZERO,
  perPeriodCents: fromSoles(120),
  fromDate: plainDate(2026, 9, 12),
  throughDate: plainDate(2026, 10, 12),
  daysPastDue: 0,
  capped: false,
};

const cupoLibre: QuotaState = {
  limit: 3,
  used: 0,
  remaining: 3,
  exhausted: false,
  isLastSession: false,
  isoWeek: '2026-W34',
};

describe('membershipStatus', () => {
  it('al dia y con cupo', () => {
    expect(membershipStatus({ delinquency: alDia, receivable: sinDeuda, quota: cupoLibre })).toEqual(
      { level: 'ok', badge: 'AL DÍA' },
    );
  });

  it('avisa en la ultima sesion', () => {
    const status = membershipStatus({
      delinquency: alDia,
      receivable: sinDeuda,
      quota: { ...cupoLibre, used: 2, remaining: 1, isLastSession: true },
    });
    expect(status).toEqual({ level: 'warn', badge: '1 SESIÓN' });
  });

  it('marca el cupo agotado con el conteo', () => {
    const status = membershipStatus({
      delinquency: alDia,
      receivable: sinDeuda,
      quota: { ...cupoLibre, used: 3, remaining: 0, exhausted: true },
    });
    expect(status).toEqual({ level: 'alert', badge: '3 / 3' });
  });

  it('el plan ilimitado nunca muestra cupo', () => {
    const status = membershipStatus({
      delinquency: alDia,
      receivable: sinDeuda,
      quota: {
        limit: null,
        used: 12,
        remaining: null,
        exhausted: false,
        isLastSession: false,
        isoWeek: '2026-W34',
      },
    });
    expect(status.badge).toBe('AL DÍA');
  });

  it('la deuda dice el monto', () => {
    const status = membershipStatus({
      delinquency: { ...alDia, status: 'in_grace', daysPastDue: 2, graceDaysLeft: 3 },
      receivable: { ...sinDeuda, due: true, periodsOwed: 1, amountCents: fromSoles(120) },
      quota: cupoLibre,
    });
    expect(status).toEqual({ level: 'warn', badge: 'DEBE S/ 120' });
  });

  it('la plata pesa mas que el cupo', () => {
    // Se resuelve pagando; el cupo se resuelve esperando al lunes.
    const status = membershipStatus({
      delinquency: { ...alDia, status: 'in_grace' },
      receivable: { ...sinDeuda, due: true, periodsOwed: 1, amountCents: fromSoles(120) },
      quota: { ...cupoLibre, used: 3, remaining: 0, exhausted: true },
    });
    expect(status.badge).toBe('DEBE S/ 120');
  });

  it('la suspension pesa mas que todo', () => {
    const status = membershipStatus({
      delinquency: { ...alDia, status: 'suspended', daysPastDue: 12, canTrain: false },
      receivable: { ...sinDeuda, due: true, periodsOwed: 1, amountCents: fromSoles(120) },
      quota: { ...cupoLibre, used: 3, remaining: 0, exhausted: true },
    });
    expect(status).toEqual({ level: 'blocked', badge: 'SUSPENDIDA' });
  });

  it('cancelada se distingue de suspendida', () => {
    const status = membershipStatus({
      delinquency: { ...alDia, status: 'canceled', canTrain: false },
      receivable: sinDeuda,
      quota: cupoLibre,
    });
    expect(status).toEqual({ level: 'blocked', badge: 'CANCELADA' });
  });
});
