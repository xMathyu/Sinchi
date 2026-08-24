/**
 * Prorrateo.
 *
 * Se usa en dos sitios (MD 4.2 y 8.1):
 *  - upgrade de plan a mitad de periodo: se cobra hoy solo el diferencial por
 *    los dias que quedan;
 *  - primer periodo corto cuando el tenant cobra un dia fijo del mes.
 *
 * Todo en centimos enteros. La fraccion se aplica con aritmetica entera para
 * que dos maquinas distintas nunca den dos montos distintos: el estado de
 * cuenta que no cuadra se descubre tres meses despues.
 */
import { ZERO, multiplyByFraction, subtract, type Cents } from '../money/cents.js';
import { daysBetween, type PlainDate } from '../time/plain-date.js';

export interface ProrationInput {
  readonly periodStart: PlainDate;
  /** Fin exclusivo del periodo vigente: el `nextBillingDate`. */
  readonly periodEnd: PlainDate;
  readonly today: PlainDate;
  readonly currentPriceCents: Cents;
  readonly newPriceCents: Cents;
}

export interface ProrationResult {
  /** Lo que se cobra hoy. Nunca negativo: un downgrade no devuelve plata. */
  readonly amountCents: Cents;
  readonly daysRemaining: number;
  readonly daysInPeriod: number;
  readonly monthlyDifferenceCents: Cents;
}

/**
 * Diferencial prorrateado de un upgrade.
 *
 * Se cobra hoy mismo como cargo unico y `nextBillingDate` NO se toca: el
 * alumno sigue su calendario y solo paga la diferencia por lo que queda de mes.
 *
 * Si el diferencial es cero o negativo devuelve 0: ese caso es un downgrade y
 * se resuelve difiriendo el cambio, no devolviendo dinero (MD 4.2).
 */
export function prorateUpgrade(input: ProrationInput): ProrationResult {
  const daysInPeriod = daysBetween(input.periodStart, input.periodEnd);
  if (daysInPeriod <= 0) {
    throw new RangeError(
      'Periodo invalido: el fin debe ser posterior al inicio para poder prorratear.',
    );
  }

  const difference = subtract(input.newPriceCents, input.currentPriceCents);
  const daysRemaining = Math.min(
    daysInPeriod,
    Math.max(0, daysBetween(input.today, input.periodEnd)),
  );

  if (difference <= 0 || daysRemaining === 0) {
    return {
      amountCents: ZERO,
      daysRemaining,
      daysInPeriod,
      monthlyDifferenceCents: difference,
    };
  }

  return {
    amountCents: multiplyByFraction(difference, daysRemaining, daysInPeriod, 'half_up'),
    daysRemaining,
    daysInPeriod,
    monthlyDifferenceCents: difference,
  };
}

export interface FirstPeriodProrationInput {
  readonly start: PlainDate;
  readonly end: PlainDate;
  /** Largo del periodo mensual de referencia, en dias. */
  readonly monthlyPeriodLengthInDays: number;
  readonly monthlyPriceCents: Cents;
}

/**
 * Monto del primer periodo cuando es corto (politica de dia fijo del mes).
 *
 * Se cobra la fraccion del mes que el alumno va a usar, medida contra el largo
 * del periodo mensual siguiente. Usar el mes siguiente como referencia evita
 * que un alumno que entra el 27 pague casi el mes completo por cuatro dias.
 */
export function prorateFirstPeriod(input: FirstPeriodProrationInput): Cents {
  const days = daysBetween(input.start, input.end);
  if (days <= 0) throw new RangeError('El primer periodo no puede tener duracion cero o negativa.');
  if (input.monthlyPeriodLengthInDays <= 0) {
    throw new RangeError('El largo del periodo mensual de referencia debe ser positivo.');
  }
  if (days >= input.monthlyPeriodLengthInDays) return input.monthlyPriceCents;

  return multiplyByFraction(
    input.monthlyPriceCents,
    days,
    input.monthlyPeriodLengthInDays,
    'half_up',
  );
}
