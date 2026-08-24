import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GRACE_DAYS,
  MAX_ATTEMPTS,
  canTrain,
  classifyPaymentError,
  evaluateDelinquency,
  paymentErrorMessage,
  planRetry,
  retrySchedule,
} from './dunning.js';
import { plainDate } from '../time/plain-date.js';

const PRIMER_FALLO = plainDate(2026, 8, 16);

describe('calendario de reintentos', () => {
  it('reintenta en dia 0, +3 y +7 desde el primer fallo', () => {
    expect(retrySchedule(PRIMER_FALLO)).toEqual([
      plainDate(2026, 8, 16),
      plainDate(2026, 8, 19),
      plainDate(2026, 8, 23),
    ]);
  });

  it('son tres intentos en total', () => {
    expect(MAX_ATTEMPTS).toBe(3);
  });

  it('se ancla al primer fallo, no al ultimo', () => {
    // Da igual cuando corra el cron: la ventana total sigue siendo 7 dias.
    const segundo = planRetry({
      firstFailureOn: PRIMER_FALLO,
      attemptsMade: 1,
      lastErrorCode: 'insufficient_funds',
    });
    expect(segundo).toEqual({
      action: 'retry',
      date: plainDate(2026, 8, 19),
      attempt: 2,
    });

    const tercero = planRetry({
      firstFailureOn: PRIMER_FALLO,
      attemptsMade: 2,
      lastErrorCode: 'insufficient_funds',
    });
    expect(tercero).toEqual({
      action: 'retry',
      date: plainDate(2026, 8, 23),
      attempt: 3,
    });
  });

  it('se agota tras el tercer intento', () => {
    expect(
      planRetry({
        firstFailureOn: PRIMER_FALLO,
        attemptsMade: 3,
        lastErrorCode: 'insufficient_funds',
      }),
    ).toEqual({ action: 'exhausted' });
  });
});

describe('politica por codigo de error', () => {
  it('fondos insuficientes se reintenta', () => {
    expect(classifyPaymentError('insufficient_funds')).toBe('transient');
    expect(paymentErrorMessage('insufficient_funds')).toBe('Fondos insuficientes');
  });

  it('tarjeta vencida pide tarjeta nueva sin reintentar', () => {
    expect(classifyPaymentError('expired_card')).toBe('needs_new_card');
    expect(
      planRetry({ firstFailureOn: PRIMER_FALLO, attemptsMade: 1, lastErrorCode: 'expired_card' }),
    ).toEqual({ action: 'request_new_card', deactivatePaymentMethod: false });
  });

  it('tarjeta bloqueada desactiva el metodo de pago', () => {
    expect(classifyPaymentError('blocked_card')).toBe('terminal');
    expect(
      planRetry({ firstFailureOn: PRIMER_FALLO, attemptsMade: 1, lastErrorCode: 'stolen_card' }),
    ).toEqual({ action: 'request_new_card', deactivatePaymentMethod: true });
  });

  it('un codigo desconocido se reintenta: mejor gastar intentos que suspender de mas', () => {
    expect(classifyPaymentError('codigo_que_culqi_no_documento')).toBe('transient');
    expect(classifyPaymentError(null)).toBe('transient');
  });
});

describe('evaluateDelinquency', () => {
  const base = {
    nextBillingDate: plainDate(2026, 8, 12),
    graceDays: DEFAULT_GRACE_DAYS,
    periodPaid: false,
  };

  it('al dia mientras no llega la fecha de cobro', () => {
    const r = evaluateDelinquency({ ...base, today: plainDate(2026, 8, 10) });
    expect(r.status).toBe('active');
    expect(r.canTrain).toBe(true);
  });

  it('pagado el periodo, queda activa aunque haya pasado la fecha', () => {
    const r = evaluateDelinquency({
      ...base,
      periodPaid: true,
      today: plainDate(2026, 8, 20),
    });
    expect(r.status).toBe('active');
  });

  it('durante la gracia SI puede entrenar', () => {
    const r = evaluateDelinquency({ ...base, today: plainDate(2026, 8, 15) });
    expect(r.status).toBe('in_grace');
    expect(r.canTrain).toBe(true);
    expect(r.daysPastDue).toBe(3);
    expect(r.graceDaysLeft).toBe(2);
  });

  it('el ultimo dia de gracia todavia entrena', () => {
    const r = evaluateDelinquency({ ...base, today: plainDate(2026, 8, 17) });
    expect(r.status).toBe('in_grace');
    expect(r.graceDaysLeft).toBe(0);
    expect(r.canTrain).toBe(true);
  });

  it('vencida la gracia se suspende y el check-in deja de validar', () => {
    const r = evaluateDelinquency({ ...base, today: plainDate(2026, 8, 18) });
    expect(r.status).toBe('suspended');
    expect(r.canTrain).toBe(false);
    expect(r.suspensionDate).toEqual(plainDate(2026, 8, 17));
  });

  it('respeta la gracia configurada por el gimnasio', () => {
    const sinGracia = evaluateDelinquency({
      ...base,
      graceDays: 0,
      today: plainDate(2026, 8, 13),
    });
    expect(sinGracia.status).toBe('suspended');

    const graciaLarga = evaluateDelinquency({
      ...base,
      graceDays: 15,
      today: plainDate(2026, 8, 25),
    });
    expect(graciaLarga.status).toBe('in_grace');
  });

  it('cancelada no entrena', () => {
    const r = evaluateDelinquency({ ...base, today: plainDate(2026, 8, 13), canceled: true });
    expect(r.status).toBe('canceled');
    expect(r.canTrain).toBe(false);
  });
});

describe('canTrain', () => {
  it('solo activa y en gracia', () => {
    expect(canTrain('active')).toBe(true);
    expect(canTrain('in_grace')).toBe(true);
    expect(canTrain('suspended')).toBe(false);
    expect(canTrain('canceled')).toBe(false);
  });
});
