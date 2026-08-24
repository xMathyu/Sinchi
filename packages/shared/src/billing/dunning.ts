/**
 * Morosidad y corte de acceso.
 *
 * Esto es feature del producto, no manejo de errores (MD 4.4). Es lo que
 * define cuanto recupera cada escuela, y por eso la politica es explicita y
 * testeable en vez de un `catch` con reintento a ciegas.
 *
 *  - reintentos en dia 0, +3, +7 desde el primer fallo;
 *  - periodo de gracia configurable por gimnasio (default 5 dias) durante el
 *    cual el alumno SI puede entrenar;
 *  - vencida la gracia, la suscripcion pasa a `suspended` y el check-in deja
 *    de validar;
 *  - la politica de reintentos depende del codigo de error de Culqi: no es lo
 *    mismo fondos insuficientes que tarjeta bloqueada.
 */
import { addDays, daysBetween, type PlainDate } from '../time/plain-date.js';
import type { SubscriptionStatus } from '../domain/types.js';

/** Offsets de reintento en dias desde el primer fallo. */
export const RETRY_OFFSETS: readonly number[] = [0, 3, 7];
export const MAX_ATTEMPTS = RETRY_OFFSETS.length;
export const DEFAULT_GRACE_DAYS = 5;

/**
 * Como tratar un rechazo segun su causa.
 *
 *  - `transient`: puede funcionar mas tarde (saldo, timeout del emisor).
 *  - `needs_new_card`: reintentar la misma tarjeta es tiempo perdido; hay que
 *    pedirle al alumno que actualice el metodo de pago.
 *  - `terminal`: tarjeta robada, bloqueada o marcada como fraude. No se
 *    reintenta y se desactiva el metodo de pago.
 */
export type PaymentErrorClass = 'transient' | 'needs_new_card' | 'terminal';

export interface PaymentErrorDescriptor {
  readonly class: PaymentErrorClass;
  /** Texto que ve el alumno. El del gateway es para el log, no para la gente. */
  readonly message: string;
}

/**
 * Tabla de codigos de Culqi.
 *
 * PENDIENTE DE VERIFICACION (MD 6, Fase 0): estos codigos salen de la
 * documentacion publica. Hay que confirmarlos en sandbox probando el flujo
 * completo de tarjeta rechazada y ajustar la tabla con los codigos reales
 * antes de construir encima. La clasificacion importa mas que el texto: de
 * ella depende si se reintenta o si se le pide otra tarjeta al alumno.
 */
const CULQI_ERROR_CODES: Readonly<Record<string, PaymentErrorDescriptor>> = {
  insufficient_funds: { class: 'transient', message: 'Fondos insuficientes' },
  processing_error: { class: 'transient', message: 'Error de procesamiento' },
  issuer_not_available: { class: 'transient', message: 'Banco emisor no disponible' },
  issuer_decline: { class: 'transient', message: 'Rechazada por el banco emisor' },
  contact_issuer: { class: 'transient', message: 'El banco pide contactarlo' },
  card_declined: { class: 'transient', message: 'Tarjeta rechazada' },
  max_attempts_exceeded: { class: 'transient', message: 'Demasiados intentos' },

  expired_card: { class: 'needs_new_card', message: 'Tarjeta vencida' },
  invalid_cvv: { class: 'needs_new_card', message: 'CVV incorrecto' },
  invalid_card: { class: 'needs_new_card', message: 'Datos de tarjeta inválidos' },
  card_not_supported: { class: 'needs_new_card', message: 'Tarjeta no soportada' },
  restricted_card: { class: 'needs_new_card', message: 'Tarjeta con restricciones' },
  invalid_token: { class: 'needs_new_card', message: 'Token de tarjeta inválido' },

  stolen_card: { class: 'terminal', message: 'Tarjeta reportada como robada' },
  lost_card: { class: 'terminal', message: 'Tarjeta reportada como perdida' },
  fraudulent: { class: 'terminal', message: 'Operación marcada como fraude' },
  blocked_card: { class: 'terminal', message: 'Tarjeta bloqueada' },
};

/**
 * Un codigo desconocido se trata como transitorio a proposito: es preferible
 * gastar dos reintentos que suspender por error a un alumno que si iba a pagar.
 */
const UNKNOWN_ERROR: PaymentErrorDescriptor = {
  class: 'transient',
  message: 'Cobro rechazado',
};

export function describePaymentError(code: string | null): PaymentErrorDescriptor {
  if (code === null) return UNKNOWN_ERROR;
  return CULQI_ERROR_CODES[code] ?? UNKNOWN_ERROR;
}

export const classifyPaymentError = (code: string | null): PaymentErrorClass =>
  describePaymentError(code).class;

export const paymentErrorMessage = (code: string | null): string =>
  describePaymentError(code).message;

// ---------------------------------------------------------------------------
// Plan de reintentos
// ---------------------------------------------------------------------------

export type DunningAction =
  | { readonly action: 'retry'; readonly date: PlainDate; readonly attempt: number }
  | { readonly action: 'request_new_card'; readonly deactivatePaymentMethod: boolean }
  | { readonly action: 'exhausted' };

export interface DunningInput {
  /** Fecha del primer cobro fallido de este periodo. */
  readonly firstFailureOn: PlainDate;
  /** Cuantos intentos ya se hicieron (1 tras el primer fallo). */
  readonly attemptsMade: number;
  /** Codigo devuelto por el gateway en el ultimo intento. */
  readonly lastErrorCode: string | null;
}

/**
 * Que hacer despues de un cobro fallido.
 *
 * El calendario de reintentos se ancla al PRIMER fallo, no al ultimo: asi la
 * ventana total de recuperacion es siempre la misma (7 dias) por mas veces que
 * pase el cron.
 */
export function planRetry(input: DunningInput): DunningAction {
  const errorClass = classifyPaymentError(input.lastErrorCode);

  if (errorClass === 'terminal') {
    return { action: 'request_new_card', deactivatePaymentMethod: true };
  }
  if (errorClass === 'needs_new_card') {
    return { action: 'request_new_card', deactivatePaymentMethod: false };
  }

  const nextIndex = input.attemptsMade;
  const offset = RETRY_OFFSETS[nextIndex];
  if (offset === undefined) return { action: 'exhausted' };

  return {
    action: 'retry',
    date: addDays(input.firstFailureOn, offset),
    attempt: nextIndex + 1,
  };
}

/** Calendario completo de reintentos, para pintarlo en la app del alumno. */
export function retrySchedule(firstFailureOn: PlainDate): readonly PlainDate[] {
  return RETRY_OFFSETS.map((offset) => addDays(firstFailureOn, offset));
}

// ---------------------------------------------------------------------------
// Estado de la suscripcion
// ---------------------------------------------------------------------------

export interface DelinquencyInput {
  readonly nextBillingDate: PlainDate;
  readonly today: PlainDate;
  readonly graceDays: number;
  /** `true` si el cargo del periodo vigente ya se cobro. */
  readonly periodPaid: boolean;
  readonly canceled?: boolean;
}

export interface DelinquencyState {
  readonly status: SubscriptionStatus;
  readonly daysPastDue: number;
  /** Dias que le quedan al alumno para seguir entrenando. */
  readonly graceDaysLeft: number;
  readonly suspensionDate: PlainDate;
  readonly canTrain: boolean;
}

/**
 * Estado derivado de la suscripcion.
 *
 * Se calcula, no se guarda como verdad: el estado persistido es un cache que
 * el cron refresca, y esta funcion es la definicion. Si los dos discrepan,
 * manda esta.
 */
export function evaluateDelinquency(input: DelinquencyInput): DelinquencyState {
  const suspensionDate = addDays(input.nextBillingDate, input.graceDays);
  const pastDue = Math.max(0, daysBetween(input.nextBillingDate, input.today));

  if (input.canceled === true) {
    return {
      status: 'canceled',
      daysPastDue: pastDue,
      graceDaysLeft: 0,
      suspensionDate,
      canTrain: false,
    };
  }

  if (input.periodPaid || pastDue === 0) {
    return {
      status: 'active',
      daysPastDue: 0,
      graceDaysLeft: input.graceDays,
      suspensionDate,
      canTrain: true,
    };
  }

  if (pastDue <= input.graceDays) {
    return {
      status: 'in_grace',
      daysPastDue: pastDue,
      graceDaysLeft: input.graceDays - pastDue,
      suspensionDate,
      canTrain: true,
    };
  }

  return {
    status: 'suspended',
    daysPastDue: pastDue,
    graceDaysLeft: 0,
    suspensionDate,
    canTrain: false,
  };
}

export function canTrain(status: SubscriptionStatus): boolean {
  return status === 'active' || status === 'in_grace';
}
