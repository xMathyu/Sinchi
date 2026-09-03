import { describe, expect, it } from 'vitest';
import {
  describePromo,
  extendedFreeUntil,
  isWellFormedPromoCode,
  normalizePromoCode,
  promoDenialMessage,
} from './promo.js';
import { plainDate } from '../time/plain-date.js';

describe('normalizePromoCode', () => {
  it('lleva a la misma forma lo que la gente escribe distinto', () => {
    for (const escrito of ['sinchi-2026', 'SINCHI 2026', 'Sinchi2026', ' sinchi_2026 ']) {
      expect(normalizePromoCode(escrito), escrito).toBe('SINCHI2026');
    }
  });

  it('exige una longitud razonable', () => {
    expect(isWellFormedPromoCode('AB')).toBe(false);
    expect(isWellFormedPromoCode('SINCHI2026')).toBe(true);
    expect(isWellFormedPromoCode('X'.repeat(25))).toBe(false);
  });
});

describe('extendedFreeUntil', () => {
  const HOY = plainDate(2026, 9, 2);

  it('suma al mes gratis que todavia corre', () => {
    // Le quedaban 30 días: no se le quitan por canjear temprano.
    expect(extendedFreeUntil(plainDate(2026, 10, 2), HOY, 1)).toEqual(plainDate(2026, 11, 2));
  });

  /**
   * El caso que importa: el gimnasio ya esta en solo lectura y canjea para
   * volver. Sumar sobre una fecha que ya paso lo dejaria cortado igual, que es
   * exactamente lo que el codigo venia a arreglar.
   */
  it('cuenta desde hoy si el mes gratis ya vencio', () => {
    expect(extendedFreeUntil(plainDate(2026, 8, 1), HOY, 1)).toEqual(plainDate(2026, 10, 2));
  });

  it('vencido hoy mismo cuenta desde hoy', () => {
    expect(extendedFreeUntil(HOY, HOY, 1)).toEqual(plainDate(2026, 10, 2));
  });

  it('cuenta desde lo ya pagado, no desde el mes gratis vencido', () => {
    // Un gimnasio que pagó hasta el 2 de noviembre y canjea: el código le da
    // diciembre, no le regala el noviembre que ya compró.
    const cubierto = plainDate(2026, 11, 2); // max(free_until, next_billing_date)
    expect(extendedFreeUntil(cubierto, HOY, 1)).toEqual(plainDate(2026, 12, 2));
  });

  it('suma varios meses', () => {
    expect(extendedFreeUntil(plainDate(2026, 10, 2), HOY, 3)).toEqual(plainDate(2027, 1, 2));
  });

  it('recorta el dia en meses cortos, como todo lo demas', () => {
    expect(extendedFreeUntil(plainDate(2026, 1, 31), plainDate(2026, 1, 15), 1)).toEqual(
      plainDate(2026, 2, 28),
    );
  });
});

describe('textos', () => {
  it('singulariza el mes', () => {
    expect(describePromo({ freeMonths: 1, freeUntil: plainDate(2026, 11, 2) })).toBe(
      'Un mes más de Sinchi gratis.',
    );
    expect(describePromo({ freeMonths: 2, freeUntil: plainDate(2026, 12, 2) })).toBe(
      '2 meses más de Sinchi gratis.',
    );
  });

  it('cada rechazo dice si insistir sirve de algo', () => {
    expect(promoDenialMessage('not_found')).toContain('bien escrito');
    expect(promoDenialMessage('exhausted')).toContain('todas las veces');
    expect(promoDenialMessage('already_used')).toContain('Ya usaste');
  });
});
