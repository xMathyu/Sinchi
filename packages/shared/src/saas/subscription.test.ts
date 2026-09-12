import { describe, expect, it } from 'vitest';
import {
  SAAS_GRACE_DAYS,
  SAAS_TIER_PRICES,
  evaluateSaas,
  freeUntilFrom,
  saasNotice,
  saasPrice,
  tierForMembers,
  type SaasInput,
} from './subscription.js';
import { addDays, plainDate } from '../time/plain-date.js';

const SIGNUP = plainDate(2026, 9, 2);
const FREE_MONTH_ENDS = plainDate(2026, 10, 2);

/**
 * Un gimnasio recien dado de alta: dentro de su mes gratis y sin pagar nada.
 *
 * Con escalon de pago, que es donde todas estas reglas aplican. El plan gratis
 * las esquiva enteras y tiene su propio bloque.
 */
function inFreeMonth(overrides: Partial<SaasInput> = {}): SaasInput {
  return {
    tier: 'up_to_60',
    freeUntil: FREE_MONTH_ENDS,
    nextBillingDate: FREE_MONTH_ENDS,
    today: SIGNUP,
    periodPaid: false,
    ...overrides,
  };
}

describe('freeUntilFrom', () => {
  it('regala un mes desde el alta', () => {
    expect(freeUntilFrom(SIGNUP)).toEqual(FREE_MONTH_ENDS);
  });

  it('recorta el dia en meses cortos, como el cobro del alumno', () => {
    // El alta del 31 de enero vence el 28 de febrero. Es el caso que obligaria
    // a escribir aritmetica de fechas a mano si no reusara `advanceBillingDate`.
    expect(freeUntilFrom(plainDate(2026, 1, 31))).toEqual(plainDate(2026, 2, 28));
    expect(freeUntilFrom(plainDate(2024, 1, 30))).toEqual(plainDate(2024, 2, 29));
  });

  it('cruza el fin de ano', () => {
    expect(freeUntilFrom(plainDate(2026, 12, 15))).toEqual(plainDate(2027, 1, 15));
  });
});

describe('tierForMembers', () => {
  it('parte en 10, en 60 y en 150', () => {
    expect(tierForMembers(0)).toBe('free');
    expect(tierForMembers(10)).toBe('free');
    expect(tierForMembers(11)).toBe('up_to_60');
    expect(tierForMembers(60)).toBe('up_to_60');
    expect(tierForMembers(61)).toBe('up_to_150');
    expect(tierForMembers(150)).toBe('up_to_150');
    expect(tierForMembers(151)).toBe('unlimited');
  });

  it('cobra los precios del MD 3, y nada por el plan gratis', () => {
    expect(saasPrice('free')).toBe(0);
    expect(saasPrice('up_to_60')).toBe(14_900);
    expect(saasPrice('up_to_150')).toBe(29_900);
    expect(saasPrice('unlimited')).toBe(49_900);
    expect(SAAS_TIER_PRICES.up_to_60).toBe(14_900);
  });
});

describe('evaluateSaas durante el mes gratis', () => {
  it('el dia del alta escribe y sale en el directorio', () => {
    const state = evaluateSaas(inFreeMonth());

    expect(state.status).toBe('trialing');
    expect(state.canWrite).toBe(true);
    expect(state.listed).toBe(true);
    expect(state.freeDaysLeft).toBe(30);
  });

  it('descuenta los dias que quedan', () => {
    expect(evaluateSaas(inFreeMonth({ today: plainDate(2026, 9, 27) })).freeDaysLeft).toBe(5);
  });

  /**
   * El ultimo dia sigue siendo mes gratis. Sin esto caia al motor del alumno,
   * que ese dia responde `active` —vence hoy, no esta atrasado— y el dueno leia
   * "suscripcion al dia" justo el dia que tenia que pagar.
   */
  it('el ultimo dia dice que termina hoy, no que esta al dia', () => {
    const state = evaluateSaas(inFreeMonth({ today: FREE_MONTH_ENDS }));

    expect(state.status).toBe('trialing');
    expect(state.freeDaysLeft).toBe(0);
    expect(saasNotice(state, saasPrice('up_to_60')).title).toBe('Tu mes gratis termina hoy');
  });

  it('pagar durante el mes gratis lo pasa a al dia', () => {
    const state = evaluateSaas(inFreeMonth({ periodPaid: true }));

    expect(state.status).toBe('active');
    expect(state.canWrite).toBe(true);
  });
});

describe('evaluateSaas cuando el mes gratis vencio', () => {
  const overdue = (days: number, overrides: Partial<SaasInput> = {}): SaasInput =>
    inFreeMonth({ today: addDays(FREE_MONTH_ENDS, days), ...overrides });

  it('entra en gracia al dia siguiente y sigue escribiendo', () => {
    const state = evaluateSaas(overdue(1));

    expect(state.status).toBe('in_grace');
    expect(state.daysPastDue).toBe(1);
    expect(state.canWrite).toBe(true);
    expect(state.listed).toBe(true);
  });

  it('el ultimo dia de gracia todavia escribe', () => {
    const state = evaluateSaas(overdue(SAAS_GRACE_DAYS));

    expect(state.status).toBe('in_grace');
    expect(state.canWrite).toBe(true);
  });

  it('pasada la gracia cae a solo lectura y sale del directorio', () => {
    const state = evaluateSaas(overdue(SAAS_GRACE_DAYS + 1));

    expect(state.status).toBe('read_only');
    expect(state.canWrite).toBe(false);
    expect(state.listed).toBe(false);
    expect(state.readOnlyOn).toEqual(plainDate(2026, 10, 9));
  });

  it('pagar despues del corte lo devuelve a escribir', () => {
    // Es el caso que decide si el cliente vuelve o se va: el corte tiene que
    // levantarse solo con registrar el pago, sin tocar nada a mano.
    const state = evaluateSaas(overdue(30, { periodPaid: true }));

    expect(state.status).toBe('active');
    expect(state.canWrite).toBe(true);
    expect(state.listed).toBe(true);
  });

  it('la gracia del gimnasio no es la que el gimnasio le da a sus alumnos', () => {
    // `graceDays` entra por parametro y por defecto son los 7 de Sinchi, no los
    // 5 de `tenants.grace_days`: si saliera de ahi, el cliente se regalaria su
    // propia gracia subiendola en su configuracion.
    expect(evaluateSaas(overdue(6, { graceDays: 5 })).status).toBe('read_only');
    expect(evaluateSaas(overdue(6)).status).toBe('in_grace');
  });
});

describe('el plan gratis', () => {
  /**
   * La regla que sostiene el escalon: un local de diez alumnos no debe nada, y
   * por tanto no hay corte que aplicarle por mucho que su fecha haya pasado.
   */
  it('no se corta nunca, aunque su mes gratis venciera hace medio ano', () => {
    const state = evaluateSaas(
      inFreeMonth({ tier: 'free', today: plainDate(2027, 4, 2) }),
    );

    expect(state.status).toBe('free');
    expect(state.canWrite).toBe(true);
    expect(state.listed).toBe(true);
    expect(state.daysPastDue).toBe(0);
  });

  it('el mismo gimnasio en escalon de pago si se corta', () => {
    // Es la comparacion que demuestra que lo que cambia es el escalon y no otra
    // cosa: mismas fechas, mismo dia, distinto precio.
    expect(evaluateSaas(inFreeMonth({ tier: 'up_to_60', today: plainDate(2027, 4, 2) })).status).toBe(
      'read_only',
    );
  });

  it('cancelar pesa mas que el plan gratis', () => {
    expect(evaluateSaas(inFreeMonth({ tier: 'free', canceled: true })).status).toBe('canceled');
  });

  it('lo dice sin hablar de meses gratis ni de deuda', () => {
    const notice = saasNotice(evaluateSaas(inFreeMonth({ tier: 'free' })), saasPrice('free'));

    expect(notice.tone).toBe('info');
    expect(notice.title).toBe('Plan gratis');
    expect(notice.detail).toContain('Hasta 10 alumnos');
  });
});

describe('evaluateSaas con la cuenta cancelada', () => {
  it('no escribe ni sale en el directorio', () => {
    const state = evaluateSaas(inFreeMonth({ canceled: true }));

    expect(state.status).toBe('canceled');
    expect(state.canWrite).toBe(false);
    expect(state.listed).toBe(false);
  });
});

describe('saasNotice', () => {
  it('avisa con tono de alerta en la ultima semana', () => {
    expect(saasNotice(evaluateSaas(inFreeMonth()), saasPrice('up_to_60')).tone).toBe('info');
    expect(
      saasNotice(evaluateSaas(inFreeMonth({ today: plainDate(2026, 9, 27) })), saasPrice('up_to_60'))
        .tone,
    ).toBe('warn');
  });

  it('dice el precio en soles enteros', () => {
    const notice = saasNotice(evaluateSaas(inFreeMonth()), saasPrice('up_to_150'));

    expect(notice.title).toBe('Te quedan 30 días de tu mes gratis');
    expect(notice.detail).toBe('Después, Sinchi cuesta S/ 299 al mes.');
  });

  it('en solo lectura promete que la puerta sigue', () => {
    const state = evaluateSaas(inFreeMonth({ today: plainDate(2026, 11, 2) }));
    const notice = saasNotice(state, saasPrice('up_to_60'));

    expect(notice.tone).toBe('blocked');
    expect(notice.detail).toContain('La puerta sigue funcionando');
  });

  it('singulariza el dia', () => {
    const oneDay = evaluateSaas(inFreeMonth({ today: plainDate(2026, 10, 1) }));
    expect(saasNotice(oneDay, saasPrice('up_to_60')).title).toBe('Te queda 1 día de tu mes gratis');

    const oneDayOverdue = evaluateSaas(inFreeMonth({ today: plainDate(2026, 10, 3) }));
    expect(saasNotice(oneDayOverdue, saasPrice('up_to_60')).title).toBe(
      'Tu suscripción venció hace 1 día',
    );
  });
});
