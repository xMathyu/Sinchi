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

const ALTA = plainDate(2026, 9, 2);
const FIN_DEL_MES_GRATIS = plainDate(2026, 10, 2);

/** Un gimnasio recien dado de alta: dentro de su mes gratis y sin pagar nada. */
function enMesGratis(overrides: Partial<SaasInput> = {}): SaasInput {
  return {
    freeUntil: FIN_DEL_MES_GRATIS,
    nextBillingDate: FIN_DEL_MES_GRATIS,
    today: ALTA,
    periodPaid: false,
    ...overrides,
  };
}

describe('freeUntilFrom', () => {
  it('regala un mes desde el alta', () => {
    expect(freeUntilFrom(ALTA)).toEqual(FIN_DEL_MES_GRATIS);
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
  it('parte en 60 y en 150', () => {
    expect(tierForMembers(0)).toBe('up_to_60');
    expect(tierForMembers(60)).toBe('up_to_60');
    expect(tierForMembers(61)).toBe('up_to_150');
    expect(tierForMembers(150)).toBe('up_to_150');
    expect(tierForMembers(151)).toBe('unlimited');
  });

  it('cobra los precios del MD 3', () => {
    expect(saasPrice('up_to_60')).toBe(14_900);
    expect(saasPrice('up_to_150')).toBe(29_900);
    expect(saasPrice('unlimited')).toBe(49_900);
    expect(SAAS_TIER_PRICES.up_to_60).toBe(14_900);
  });
});

describe('evaluateSaas durante el mes gratis', () => {
  it('el dia del alta escribe y sale en el directorio', () => {
    const estado = evaluateSaas(enMesGratis());

    expect(estado.status).toBe('trialing');
    expect(estado.canWrite).toBe(true);
    expect(estado.listed).toBe(true);
    expect(estado.freeDaysLeft).toBe(30);
  });

  it('descuenta los dias que quedan', () => {
    expect(evaluateSaas(enMesGratis({ today: plainDate(2026, 9, 27) })).freeDaysLeft).toBe(5);
  });

  /**
   * El ultimo dia sigue siendo mes gratis. Sin esto caia al motor del alumno,
   * que ese dia responde `active` —vence hoy, no esta atrasado— y el dueno leia
   * "suscripcion al dia" justo el dia que tenia que pagar.
   */
  it('el ultimo dia dice que termina hoy, no que esta al dia', () => {
    const estado = evaluateSaas(enMesGratis({ today: FIN_DEL_MES_GRATIS }));

    expect(estado.status).toBe('trialing');
    expect(estado.freeDaysLeft).toBe(0);
    expect(saasNotice(estado, saasPrice('up_to_60')).title).toBe('Tu mes gratis termina hoy');
  });

  it('pagar durante el mes gratis lo pasa a al dia', () => {
    const estado = evaluateSaas(enMesGratis({ periodPaid: true }));

    expect(estado.status).toBe('active');
    expect(estado.canWrite).toBe(true);
  });
});

describe('evaluateSaas cuando el mes gratis vencio', () => {
  const vencido = (dias: number, overrides: Partial<SaasInput> = {}): SaasInput =>
    enMesGratis({ today: addDays(FIN_DEL_MES_GRATIS, dias), ...overrides });

  it('entra en gracia al dia siguiente y sigue escribiendo', () => {
    const estado = evaluateSaas(vencido(1));

    expect(estado.status).toBe('in_grace');
    expect(estado.daysPastDue).toBe(1);
    expect(estado.canWrite).toBe(true);
    expect(estado.listed).toBe(true);
  });

  it('el ultimo dia de gracia todavia escribe', () => {
    const estado = evaluateSaas(vencido(SAAS_GRACE_DAYS));

    expect(estado.status).toBe('in_grace');
    expect(estado.canWrite).toBe(true);
  });

  it('pasada la gracia cae a solo lectura y sale del directorio', () => {
    const estado = evaluateSaas(vencido(SAAS_GRACE_DAYS + 1));

    expect(estado.status).toBe('read_only');
    expect(estado.canWrite).toBe(false);
    expect(estado.listed).toBe(false);
    expect(estado.readOnlyOn).toEqual(plainDate(2026, 10, 9));
  });

  it('pagar despues del corte lo devuelve a escribir', () => {
    // Es el caso que decide si el cliente vuelve o se va: el corte tiene que
    // levantarse solo con registrar el pago, sin tocar nada a mano.
    const estado = evaluateSaas(vencido(30, { periodPaid: true }));

    expect(estado.status).toBe('active');
    expect(estado.canWrite).toBe(true);
    expect(estado.listed).toBe(true);
  });

  it('la gracia del gimnasio no es la que el gimnasio le da a sus alumnos', () => {
    // `graceDays` entra por parametro y por defecto son los 7 de Sinchi, no los
    // 5 de `tenants.grace_days`: si saliera de ahi, el cliente se regalaria su
    // propia gracia subiendola en su configuracion.
    expect(evaluateSaas(vencido(6, { graceDays: 5 })).status).toBe('read_only');
    expect(evaluateSaas(vencido(6)).status).toBe('in_grace');
  });
});

describe('evaluateSaas con la cuenta cancelada', () => {
  it('no escribe ni sale en el directorio', () => {
    const estado = evaluateSaas(enMesGratis({ canceled: true }));

    expect(estado.status).toBe('canceled');
    expect(estado.canWrite).toBe(false);
    expect(estado.listed).toBe(false);
  });
});

describe('saasNotice', () => {
  it('avisa con tono de alerta en la ultima semana', () => {
    expect(saasNotice(evaluateSaas(enMesGratis()), saasPrice('up_to_60')).tone).toBe('info');
    expect(
      saasNotice(evaluateSaas(enMesGratis({ today: plainDate(2026, 9, 27) })), saasPrice('up_to_60'))
        .tone,
    ).toBe('warn');
  });

  it('dice el precio en soles enteros', () => {
    const aviso = saasNotice(evaluateSaas(enMesGratis()), saasPrice('up_to_150'));

    expect(aviso.title).toBe('Te quedan 30 días de tu mes gratis');
    expect(aviso.detail).toBe('Después, Sinchi cuesta S/ 299 al mes.');
  });

  it('en solo lectura promete que la puerta sigue', () => {
    const estado = evaluateSaas(enMesGratis({ today: plainDate(2026, 11, 2) }));
    const aviso = saasNotice(estado, saasPrice('up_to_60'));

    expect(aviso.tone).toBe('blocked');
    expect(aviso.detail).toContain('La puerta sigue funcionando');
  });

  it('singulariza el dia', () => {
    const unDia = evaluateSaas(enMesGratis({ today: plainDate(2026, 10, 1) }));
    expect(saasNotice(unDia, saasPrice('up_to_60')).title).toBe('Te queda 1 día de tu mes gratis');

    const unDiaVencido = evaluateSaas(enMesGratis({ today: plainDate(2026, 10, 3) }));
    expect(saasNotice(unDiaVencido, saasPrice('up_to_60')).title).toBe(
      'Tu suscripción venció hace 1 día',
    );
  });
});
