/**
 * La suscripcion del GIMNASIO a Sinchi.
 *
 * Ojo con el nombre: `trial` en este repo es la clase gratis del ALUMNO
 * (`TrialBooking`, `trial_bookings`, `trialClassEnabled`). Esto es otra cosa —el
 * mes gratis del gimnasio— y por eso no reusa esa palabra. Ver `docs/glosario.md`.
 *
 * Reglas (MD 3, MD 11 fase 5):
 *  - todo gimnasio entra con UN MES GRATIS contado desde su alta;
 *  - al vencer se cobra por adelantado, igual que al alumno, con la tarifa de su
 *    escalon;
 *  - impagado, la cuenta cae a SOLO LECTURA. La puerta nunca se cierra: el
 *    check-in del alumno que si le pago a su gimnasio no es la palanca de cobro
 *    de Sinchi, y cortarlo castiga a quien no debe nada.
 *
 * Es el mismo motor que le cobra al alumno —`advanceBillingDate` para la fecha,
 * `evaluateDelinquency` para el corte— y eso es deliberado: el dogfooding del MD
 * 3 dice que si el cobro recurrente falla, nos tiene que fallar a nosotros
 * primero. Aqui no se reimplementa ninguna de las dos.
 */
import { cents, type Cents } from '../money/cents.js';
import {
  addDays,
  daysBetween,
  isBeforeOrEqual,
  type PlainDate,
} from '../time/plain-date.js';
import { advanceBillingDate } from '../billing/cycle.js';
import { evaluateDelinquency } from '../billing/dunning.js';
import type { SaasTier } from '../domain/types.js';

/**
 * Estado de la cuenta del gimnasio.
 *
 * `read_only` y no `suspended` a proposito, aunque el motor del alumno use esa
 * palabra: son cortes distintos. Al alumno suspendido no lo dejan entrenar; al
 * gimnasio impago no se le cierra nada de lo que ya tiene, se le impide crear
 * mas. Llamarlos igual invita a copiar el comportamiento equivocado.
 */
export type SaasStatus =
  /** Hasta 10 alumnos: no paga, y por tanto no se le puede cortar. */
  | 'free'
  | 'trialing'
  | 'active'
  | 'in_grace'
  | 'read_only'
  | 'canceled';

/** Meses de regalo al dar de alta un gimnasio. */
export const SAAS_FREE_MONTHS = 1;

/**
 * Dias entre el vencimiento y el corte a solo lectura.
 *
 * Siete y no los cinco del alumno: el gimnasio paga por transferencia y a un
 * dueno que vence un viernes hay que dejarle el fin de semana. No sale de
 * `tenants.grace_days`, que es la gracia que el gimnasio le da a SUS alumnos:
 * mezclarlas dejaria que el cliente se regale su propia gracia.
 */
export const SAAS_GRACE_DAYS = 7;

/** Hasta cuantos alumnos activos el gimnasio no paga nada. */
export const SAAS_FREE_TIER_LIMIT = 10;

/** Tarifa mensual por escalon (MD 3). Precio fijo, nunca porcentaje. */
export const SAAS_TIER_PRICES: Readonly<Record<SaasTier, Cents>> = {
  free: cents(0),
  up_to_60: cents(14_900),
  up_to_150: cents(29_900),
  unlimited: cents(49_900),
};

export const SAAS_TIER_LABELS: Readonly<Record<SaasTier, string>> = {
  free: `Hasta ${SAAS_FREE_TIER_LIMIT} alumnos`,
  up_to_60: `De ${SAAS_FREE_TIER_LIMIT + 1} a 60 alumnos`,
  up_to_150: 'De 61 a 150 alumnos',
  unlimited: 'Más de 150 alumnos',
};

/** El escalon en el que el gimnasio no paga nada. */
export const isFreeTier = (tier: SaasTier): boolean => SAAS_TIER_PRICES[tier] === 0;

export function saasPrice(tier: SaasTier): Cents {
  return SAAS_TIER_PRICES[tier];
}

/**
 * Escalon que le toca a un gimnasio por su padron.
 *
 * Se DERIVA del padron, no se confia en la columna: `tenants.saas_tier` se fija
 * a mano al dar de alta y nadie vuelve a tocarla, asi que un dojo que crecio de
 * 40 a 200 alumnos seguiria pagando el escalon mas barato para siempre.
 */
export function tierForMembers(activeMembers: number): SaasTier {
  if (activeMembers <= SAAS_FREE_TIER_LIMIT) return 'free';
  if (activeMembers <= 60) return 'up_to_60';
  if (activeMembers <= 150) return 'up_to_150';
  return 'unlimited';
}

/**
 * Fin del mes gratis de un gimnasio dado de alta en `startDate`.
 *
 * Usa el mismo `advanceBillingDate` que el cobro del alumno, asi que el alta del
 * 31 de enero vence el 28 de febrero sin ningun caso especial aqui.
 */
export function freeUntilFrom(startDate: PlainDate): PlainDate {
  let end = startDate;
  for (let month = 0; month < SAAS_FREE_MONTHS; month += 1) {
    end = advanceBillingDate(end, { mode: 'anniversary' });
  }
  return end;
}

export interface SaasInput {
  /**
   * Escalon vigente, derivado del padron.
   *
   * Obligatorio y no opcional con valor por defecto: si faltara, un gimnasio del
   * plan gratis pasaria por el motor de cobro y acabaria cortado por no pagar
   * algo que no cuesta nada.
   */
  readonly tier: SaasTier;
  /** Primer dia en que el gimnasio ya tiene que haber pagado. */
  readonly freeUntil: PlainDate;
  /** Inicio del periodo no pagado. Durante el mes gratis coincide con `freeUntil`. */
  readonly nextBillingDate: PlainDate;
  readonly today: PlainDate;
  readonly graceDays?: number;
  /** `true` si el periodo vigente ya se cobro. */
  readonly periodPaid: boolean;
  readonly canceled?: boolean;
}

export interface SaasState {
  readonly status: SaasStatus;
  /** Dias que le quedan de regalo. 0 en cuanto el mes gratis termino. */
  readonly freeDaysLeft: number;
  readonly daysPastDue: number;
  /** Dia en que la cuenta cae a solo lectura si no paga. */
  readonly readOnlyOn: PlainDate;
  /** Puede dar de alta alumnos, registrar pagos y cambiar planes. */
  readonly canWrite: boolean;
  /** Sale en el directorio publico y acepta reservas de clase gratis. */
  readonly listed: boolean;
}

/**
 * Estado derivado de la cuenta del gimnasio.
 *
 * Se calcula, no se lee: `saas_subscriptions.status` es un cache que el job
 * diario refresca para poder listar en SQL, y esta funcion es la definicion. Si
 * los dos discrepan, manda esta — mismo trato que `evaluateDelinquency` recibe
 * en el cobro del alumno.
 */
export function evaluateSaas(input: SaasInput): SaasState {
  const graceDays = input.graceDays ?? SAAS_GRACE_DAYS;
  const readOnlyOn = addDays(input.nextBillingDate, graceDays);

  /**
   * El plan gratis se resuelve ANTES que nada.
   *
   * Un local de diez alumnos no debe nada, asi que no hay fecha que se le pueda
   * pasar ni corte que aplicarle. Si esto fuera al final, un gimnasio pequeno
   * cuyo mes gratis vencio hace medio ano saldria en solo lectura por una deuda
   * de cero soles — que es la forma mas rapida de perder al cliente que mas
   * tarda en crecer.
   */
  if (isFreeTier(input.tier) && input.canceled !== true) {
    return {
      status: 'free',
      freeDaysLeft: 0,
      daysPastDue: 0,
      readOnlyOn,
      canWrite: true,
      listed: true,
    };
  }

  if (input.canceled === true) {
    return {
      status: 'canceled',
      freeDaysLeft: 0,
      daysPastDue: Math.max(0, daysBetween(input.nextBillingDate, input.today)),
      readOnlyOn,
      canWrite: false,
      listed: false,
    };
  }

  const delinquency = evaluateDelinquency({
    nextBillingDate: input.nextBillingDate,
    today: input.today,
    graceDays,
    periodPaid: input.periodPaid,
  });

  /**
   * Dentro del mes gratis y sin haber pagado todavia: `trialing`.
   *
   * No es lo mismo que `active` aunque los dos dejen escribir. El dueno tiene
   * que ver la cuenta atras desde el primer dia — un mes gratis del que se
   * entera el dia que se corta es un cliente que se va enojado, no uno que paga.
   *
   * El ultimo dia entra (`isBeforeOrEqual`) y dice "termina hoy". Dejarlo fuera
   * lo mandaba al motor del alumno, que ese dia todavia responde `active`
   * —vence hoy, no esta atrasado— y el dueno leia "suscripcion al dia" justo el
   * dia que tenia que pagar.
   */
  const freeDaysLeft = Math.max(0, daysBetween(input.today, input.freeUntil));
  if (!input.periodPaid && isBeforeOrEqual(input.today, input.freeUntil)) {
    return {
      status: 'trialing',
      freeDaysLeft,
      daysPastDue: 0,
      readOnlyOn,
      canWrite: true,
      listed: true,
    };
  }

  if (delinquency.status === 'suspended') {
    return {
      status: 'read_only',
      freeDaysLeft: 0,
      daysPastDue: delinquency.daysPastDue,
      readOnlyOn,
      canWrite: false,
      // Un local que no paga deja de recibir interesados POR Sinchi.
      listed: false,
    };
  }

  // En gracia todavia escribe: es justo lo que la gracia significa.
  return {
    status: delinquency.status === 'in_grace' ? 'in_grace' : 'active',
    freeDaysLeft: 0,
    daysPastDue: delinquency.daysPastDue,
    readOnlyOn,
    canWrite: true,
    listed: true,
  };
}

/**
 * Lo que ve el dueno.
 *
 * Vive en `shared` por la misma razon que los textos del semaforo: el aviso de
 * la app, el del panel web y el motivo con el que la api rechaza un alta tienen
 * que decir lo mismo del mismo hecho.
 */
export type SaasNoticeTone = 'info' | 'warn' | 'blocked';

export interface SaasNotice {
  readonly tone: SaasNoticeTone;
  readonly title: string;
  readonly detail: string;
}

export function saasNotice(state: SaasState, price: Cents): SaasNotice {
  const soles = Math.round(price / 100);

  switch (state.status) {
    case 'free':
      return {
        tone: 'info',
        title: 'Plan gratis',
        detail: `Hasta ${SAAS_FREE_TIER_LIMIT} alumnos, sin costo. Al pasar de ahí, S/ 149 al mes.`,
      };
    case 'trialing':
      return {
        tone: state.freeDaysLeft <= 7 ? 'warn' : 'info',
        title:
          state.freeDaysLeft === 0
            ? 'Tu mes gratis termina hoy'
            : state.freeDaysLeft === 1
              ? 'Te queda 1 día de tu mes gratis'
              : `Te quedan ${state.freeDaysLeft} días de tu mes gratis`,
        detail: `Después, Sinchi cuesta S/ ${soles} al mes.`,
      };
    case 'active':
      return { tone: 'info', title: 'Suscripción al día', detail: `S/ ${soles} al mes.` };
    case 'in_grace':
      return {
        tone: 'warn',
        title: `Tu suscripción venció hace ${state.daysPastDue} ${
          state.daysPastDue === 1 ? 'día' : 'días'
        }`,
        detail: 'Regulariza el pago para no quedarte en solo lectura.',
      };
    case 'read_only':
      return {
        tone: 'blocked',
        title: 'Cuenta en solo lectura',
        detail:
          'La puerta sigue funcionando. Para dar de alta alumnos o registrar ' +
          'pagos, regulariza tu suscripción.',
      };
    case 'canceled':
      return {
        tone: 'blocked',
        title: 'Suscripción cancelada',
        detail: 'La puerta sigue funcionando y tus datos siguen aquí.',
      };
  }
}
