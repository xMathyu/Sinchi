/**
 * Dinero en enteros de centimos, moneda PEN (MD 4.1). Nunca floats.
 *
 * El tipo va marcado (`branded`) para que un `number` cualquiera no pueda
 * colarse como monto sin pasar por el constructor. En un dominio de pagos, la
 * diferencia entre soles y centimos son dos ordenes de magnitud.
 */

declare const centsBrand: unique symbol;

export type Cents = number & { readonly [centsBrand]: 'Cents' };

export const CURRENCY = 'PEN' as const;
export type Currency = typeof CURRENCY;

export const ZERO = 0 as Cents;

export function cents(value: number): Cents {
  if (!Number.isInteger(value)) {
    throw new RangeError(`Monto no entero: ${value}. Los montos van en centimos enteros.`);
  }
  if (!Number.isSafeInteger(value)) throw new RangeError(`Monto fuera de rango seguro: ${value}`);
  return value as Cents;
}

/** Azucar para fixtures y seeds: `fromSoles(149)` -> 14900 centimos. */
export function fromSoles(soles: number): Cents {
  const value = Math.round(soles * 100);
  if (Math.abs(value - soles * 100) > 1e-6) {
    throw new RangeError(`${soles} soles no es representable en centimos exactos.`);
  }
  return cents(value);
}

export function sum(...amounts: readonly Cents[]): Cents {
  return cents(amounts.reduce<number>((acc, amount) => acc + amount, 0));
}

export function subtract(a: Cents, b: Cents): Cents {
  return cents(a - b);
}

export function negate(a: Cents): Cents {
  return cents(-a);
}

export const isPositive = (a: Cents): boolean => a > 0;
export const isZero = (a: Cents): boolean => a === 0;
export const max = (a: Cents, b: Cents): Cents => (a >= b ? a : b);
export const min = (a: Cents, b: Cents): Cents => (a <= b ? a : b);

export type Rounding = 'half_up' | 'floor' | 'ceil';

/**
 * `amount * numerator / denominator` con aritmetica entera.
 *
 * Es la primitiva del prorrateo. `half_up` se calcula como
 * `floor((2n + d) / 2d)` para no pasar por punto flotante al redondear: dos
 * maquinas distintas tienen que dar exactamente el mismo centimo.
 */
export function multiplyByFraction(
  amount: Cents,
  numerator: number,
  denominator: number,
  rounding: Rounding = 'half_up',
): Cents {
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator)) {
    throw new RangeError(`Fraccion no entera: ${numerator}/${denominator}`);
  }
  if (denominator === 0) throw new RangeError('Denominador cero en el prorrateo.');

  const sign = Math.sign(amount) * Math.sign(numerator) * Math.sign(denominator);
  const n = Math.abs(amount) * Math.abs(numerator);
  const d = Math.abs(denominator);

  let magnitude: number;
  switch (rounding) {
    case 'half_up':
      magnitude = Math.floor((2 * n + d) / (2 * d));
      break;
    case 'floor':
      magnitude = sign >= 0 ? Math.floor(n / d) : Math.ceil(n / d);
      break;
    case 'ceil':
      magnitude = sign >= 0 ? Math.ceil(n / d) : Math.floor(n / d);
      break;
  }
  return cents(sign < 0 ? -magnitude : magnitude);
}

export interface FormatOptions {
  readonly withDecimals?: boolean;
  readonly withSymbol?: boolean;
}

/**
 * `S/ 1,234.50`. Sin `Intl`: este formateo corre tambien en Hermes, y la
 * moneda es siempre PEN, asi que la tabla de locales no aporta nada.
 */
export function formatPEN(amount: Cents, options: FormatOptions = {}): string {
  const withDecimals = options.withDecimals ?? true;
  const withSymbol = options.withSymbol ?? true;

  const negative = amount < 0;
  const abs = Math.abs(amount);
  const whole = Math.floor(abs / 100);
  const fraction = abs % 100;

  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = withDecimals
    ? `${grouped}.${fraction < 10 ? `0${fraction}` : fraction}`
    : grouped;

  return `${negative ? '-' : ''}${withSymbol ? 'S/ ' : ''}${body}`;
}

/** Version corta para chips y titulares: `S/ 120` cuando el monto es redondo. */
export function formatPENShort(amount: Cents): string {
  return formatPEN(amount, { withDecimals: amount % 100 !== 0 });
}
