import { describe, expect, it } from 'vitest';
import { checkRuc, isValidRuc, normalizeRuc, rucDenialMessage } from './ruc.js';

/** RUC reales y publicos: si el algoritmo se rompe, estos lo dicen. */
const REALES = [
  '20100070970', // Backus
  '20131312955', // SUNAT
  '20100047218', // Banco de Crédito
];

describe('checkRuc', () => {
  it('acepta RUC reales', () => {
    for (const ruc of REALES) {
      expect(checkRuc(ruc), ruc).toBeNull();
    }
  });

  it('rechaza un digito cambiado aunque la longitud siga bien', () => {
    // Es el caso que una comprobacion de longitud deja pasar y el verificador no.
    expect(checkRuc('20100070971')).toBe('check_digit');
    expect(checkRuc('20131312956')).toBe('check_digit');
  });

  it('rechaza los rellenos obvios', () => {
    expect(checkRuc('11111111111')).toBe('prefix');
    expect(checkRuc('20000000000')).toBe('check_digit');
  });

  it('distingue faltar digitos de equivocarlos', () => {
    expect(checkRuc('2010007097')).toBe('length');
    expect(checkRuc('')).toBe('length');
    expect(checkRuc('30100070970')).toBe('prefix');
  });

  it('ignora espacios y guiones, que es como la gente lo escribe', () => {
    expect(normalizeRuc(' 20-100 070 970 ')).toBe('20100070970');
    expect(isValidRuc('20-100-070-970')).toBe(true);
  });

  it('acepta el RUC de persona natural con negocio', () => {
    // Un dojo de una sola persona no es una S.A.C.: empieza por 10.
    expect(checkRuc('10412345675')).toBe('check_digit');
    expect(checkRuc('20100070970')).toBeNull();
  });

  it('cada motivo tiene su texto', () => {
    expect(rucDenialMessage('length')).toContain('11 dígitos');
    expect(rucDenialMessage('prefix')).toContain('10, 15, 16, 17 o 20');
    expect(rucDenialMessage('check_digit')).toContain('no existe');
  });
});
