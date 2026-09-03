/**
 * Cuanto debe un alumno ahora mismo.
 *
 * En la version 1 no hay cobro automatico con tarjeta: el staff registra pagos
 * manuales (efectivo, Yape, transferencia) desde su rol admin. Eso cambia una
 * cosa importante del ciclo y conviene decirla explicita:
 *
 *   `nextBillingDate` NO avanza con el calendario. Avanza solo cuando entra un
 *   pago.
 *
 * Es decir, `nextBillingDate` es siempre el inicio del primer periodo NO
 * pagado. La deuda se deriva de ahi contra el ledger, nunca se guarda en una
 * columna: un saldo guardado se desincroniza del ledger y despues nadie sabe
 * cual de los dos miente (MD 4.5).
 *
 * Cuando entre el cobro con tarjeta, el cron de renovacion pasa a intentar el
 * cargo en esa fecha y esta funcion sigue valiendo igual: lo que cambia es
 * quien paga, no como se mide la deuda.
 */
import { ZERO, multiplyByFraction, type Cents } from '../money/cents.js';
import {
  isDropInPlan,
  type BillingDatePolicy,
  type Charge,
  type Plan,
  type Subscription,
} from '../domain/types.js';
import { daysBetween, type PlainDate } from '../time/plain-date.js';
import { advanceBillingDate, isDue } from './cycle.js';

/**
 * Tope de periodos que se acumulan como deuda.
 *
 * Un alumno que desaparecio ocho meses no debe ocho mensualidades: dejo de ser
 * alumno. Sin este tope, el primer moroso antiguo genera una deuda absurda en
 * pantalla y el dueno pierde la confianza en el numero.
 */
export const MAX_PERIODS_OWED = 3;

export interface ReceivableInput {
  readonly subscription: Subscription;
  readonly plan: Plan;
  readonly policy: BillingDatePolicy;
  readonly today: PlainDate;
}

export interface Receivable {
  readonly due: boolean;
  /** Periodos completos sin pagar, con tope en `MAX_PERIODS_OWED`. */
  readonly periodsOwed: number;
  /** Total a cobrar para ponerse al dia. */
  readonly amountCents: Cents;
  /** Lo que cuesta cubrir un solo periodo. */
  readonly perPeriodCents: Cents;
  /** Inicio del primer periodo sin pagar. */
  readonly fromDate: PlainDate;
  /** Fin del ultimo periodo que se cubre al pagar el total. */
  readonly throughDate: PlainDate;
  readonly daysPastDue: number;
  /** `true` cuando la deuda se topo: hay mas periodos vencidos que los cobrados. */
  readonly capped: boolean;
}

/**
 * Deuda vigente de una suscripcion.
 *
 * Se cobra por adelantado (MD 4.1): el dia que llega `nextBillingDate` el
 * periodo que empieza ya se debe, no al final.
 */
export function computeReceivable(input: ReceivableInput): Receivable {
  const { subscription, plan, policy, today } = input;
  const from = subscription.nextBillingDate;
  const price = plan.priceCents;

  /**
   * La clase suelta no debe nunca, y esto es lo unico que hay que escribir para
   * que asi sea en todas partes.
   *
   * `evaluateDelinquency` no recibe el plan: recibe `periodPaid: !receivable.due`
   * de sus tres llamadores —la vista de la api, el store de la app y el cron de
   * morosidad—. Cortando aqui, los tres concluyen `active` sin tocarlos, y no
   * queda ninguno donde se pueda olvidar la excepcion.
   *
   * La suscripcion de un plan `drop_in` igual lleva `next_billing_date`: la
   * columna es NOT NULL y la fecha existe por si el alumno pasa manana a un plan
   * mensual. Lo que no hace es significar nada mientras el plan sea este.
   */
  if (isDropInPlan(plan) || subscription.status === 'canceled' || !isDue(from, today)) {
    return {
      due: false,
      periodsOwed: 0,
      amountCents: ZERO,
      perPeriodCents: price,
      fromDate: from,
      throughDate: advanceBillingDate(from, policy),
      daysPastDue: 0,
      capped: false,
    };
  }

  let cursor = from;
  let owed = 0;
  while (isDue(cursor, today) && owed < MAX_PERIODS_OWED) {
    owed += 1;
    cursor = advanceBillingDate(cursor, policy);
  }
  const capped = isDue(cursor, today);

  return {
    due: true,
    periodsOwed: owed,
    amountCents: multiplyByFraction(price, owed, 1),
    perPeriodCents: price,
    fromDate: from,
    throughDate: cursor,
    daysPastDue: Math.max(0, daysBetween(from, today)),
    capped,
  };
}

// ---------------------------------------------------------------------------
// Aplicar un pago
// ---------------------------------------------------------------------------

export interface ApplyPaymentInput {
  readonly subscription: Subscription;
  readonly policy: BillingDatePolicy;
  /** Cuantos periodos cubre el pago. Normalmente 1. */
  readonly periodsPaid: number;
  /** Plan pendiente que entra en vigor al renovar, si hay downgrade guardado. */
  readonly pendingPlanApplies?: boolean;
}

export interface AppliedPayment {
  readonly periodStart: PlainDate;
  readonly nextBillingDate: PlainDate;
  readonly status: 'active';
  readonly planId: Subscription['planId'];
  readonly pendingPlanId: null;
}

/**
 * Efecto de un pago sobre la suscripcion.
 *
 * Un pago manual activa el MISMO ciclo que uno con tarjeta (MD 4.5): extiende
 * `nextBillingDate`, reactiva la suscripcion y libera el check-in. Que el
 * dinero haya entrado en efectivo no lo hace un caso especial.
 */
export function applyPayment(input: ApplyPaymentInput): AppliedPayment {
  const { subscription, policy, periodsPaid } = input;
  if (!Number.isInteger(periodsPaid) || periodsPaid < 1) {
    throw new RangeError(`Periodos pagados invalido: ${periodsPaid}. Debe ser 1 o mas.`);
  }

  let cursor = subscription.nextBillingDate;
  let periodStart = cursor;
  for (let i = 0; i < periodsPaid; i += 1) {
    periodStart = cursor;
    cursor = advanceBillingDate(cursor, policy);
  }

  const appliesPending =
    (input.pendingPlanApplies ?? true) && subscription.pendingPlanId !== null;

  return {
    // El periodo vigente pasa a ser el ultimo que el pago cubre.
    periodStart,
    nextBillingDate: cursor,
    status: 'active',
    planId: appliesPending ? (subscription.pendingPlanId as Subscription['planId']) : subscription.planId,
    pendingPlanId: null,
  };
}

/** Cargos exitosos de tipo renovacion que cubren el periodo dado. */
export function findRenewalCharge(
  charges: readonly Charge[],
  subscriptionId: Subscription['id'],
  periodStart: PlainDate,
): Charge | undefined {
  return charges.find(
    (charge) =>
      charge.subscriptionId === subscriptionId &&
      charge.type === 'renewal' &&
      charge.status === 'succeeded' &&
      charge.periodStart !== null &&
      charge.periodStart.year === periodStart.year &&
      charge.periodStart.month === periodStart.month &&
      charge.periodStart.day === periodStart.day,
  );
}
