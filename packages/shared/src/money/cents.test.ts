import { describe, expect, it } from 'vitest';
import {
  cents,
  formatPEN,
  formatPENShort,
  fromSoles,
  multiplyByFraction,
  subtract,
  sum,
} from './cents.js';

describe('cents', () => {
  it('rechaza montos con fraccion', () => {
    expect(() => cents(12.5)).toThrow(RangeError);
  });

  it('convierte soles a centimos', () => {
    expect(fromSoles(149)).toBe(14_900);
    expect(fromSoles(1.5)).toBe(150);
    expect(fromSoles(0.01)).toBe(1);
  });

  it('rechaza soles con mas de dos decimales', () => {
    expect(() => fromSoles(1.005)).toThrow(RangeError);
  });
});

describe('aritmetica', () => {
  it('suma y resta sin perder centimos', () => {
    expect(sum(fromSoles(149), fromSoles(150), fromSoles(0.01))).toBe(29_901);
    expect(subtract(fromSoles(180), fromSoles(150))).toBe(3_000);
  });

  it('admite resultados negativos', () => {
    expect(subtract(fromSoles(120), fromSoles(180))).toBe(-6_000);
  });
});

describe('multiplyByFraction', () => {
  it('redondea half-up', () => {
    // 3000 * 1/2 = 1500 exacto.
    expect(multiplyByFraction(cents(3_000), 1, 2)).toBe(1_500);
    // 1 centimo * 1/2 = 0.5 -> 1.
    expect(multiplyByFraction(cents(1), 1, 2)).toBe(1);
    // 3 * 1/3 = 1 exacto.
    expect(multiplyByFraction(cents(3), 1, 3)).toBe(1);
    // 1 * 1/3 = 0.33 -> 0.
    expect(multiplyByFraction(cents(1), 1, 3)).toBe(0);
  });

  it('respeta floor y ceil', () => {
    expect(multiplyByFraction(cents(1), 1, 2, 'floor')).toBe(0);
    expect(multiplyByFraction(cents(1), 1, 3, 'ceil')).toBe(1);
  });

  it('no depende del punto flotante en el caso clasico', () => {
    // 0.1 + 0.2 en floats es 0.30000000000000004; en centimos es exacto.
    expect(multiplyByFraction(cents(10), 3, 10)).toBe(3);
  });

  it('mantiene el signo', () => {
    expect(multiplyByFraction(cents(-3_000), 1, 2)).toBe(-1_500);
  });

  it('rechaza denominador cero', () => {
    expect(() => multiplyByFraction(cents(100), 1, 0)).toThrow(RangeError);
  });

  it('la suma de las partes no excede el total', () => {
    // Un mes de 31 dias repartido dia por dia no puede inventar centimos.
    const total = fromSoles(150);
    let acumulado = 0;
    for (let dia = 0; dia < 31; dia += 1) {
      acumulado += multiplyByFraction(total, 1, 31, 'floor');
    }
    expect(acumulado).toBeLessThanOrEqual(total);
  });
});

describe('formatPEN', () => {
  it('usa el formato peruano', () => {
    expect(formatPEN(fromSoles(149))).toBe('S/ 149.00');
    expect(formatPEN(fromSoles(1234.5))).toBe('S/ 1,234.50');
    expect(formatPEN(cents(5))).toBe('S/ 0.05');
    expect(formatPEN(fromSoles(-120))).toBe('-S/ 120.00');
  });

  it('la version corta omite los decimales redondos', () => {
    expect(formatPENShort(fromSoles(120))).toBe('S/ 120');
    expect(formatPENShort(fromSoles(120.5))).toBe('S/ 120.50');
  });

  it('puede omitir el simbolo', () => {
    expect(formatPEN(fromSoles(180), { withSymbol: false })).toBe('180.00');
  });
});
