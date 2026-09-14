import { describe, expect, it } from 'vitest';
import {
  accountDetailsDenialMessage,
  checkAccountDetails,
  normalizePhoneNumber,
} from './account-details.js';

describe('los datos que la persona corrige', () => {
  it('acepta un nombre y un celular con código de país', () => {
    expect(checkAccountDetails({ name: 'Camila Rojas', phone: '+51922333444' })).toBeNull();
  });

  it('el celular se compara sin espacios ni guiones', () => {
    // Es lo que evita que «+51 987 000 111» pase por un número distinto del de
    // la persona que ya lo tiene.
    expect(normalizePhoneNumber('+51 987-000 111')).toBe('+51987000111');
    expect(checkAccountDetails({ name: 'Ana', phone: '+51 987 000 111' })).toBeNull();
  });

  it('dice qué falta, y no solo que no se puede', () => {
    expect(checkAccountDetails({ name: ' A ', phone: '+51922333444' })).toBe('name_too_short');
    expect(checkAccountDetails({ name: 'x'.repeat(121), phone: '+51922333444' })).toBe(
      'name_too_long',
    );
    expect(checkAccountDetails({ name: 'Camila', phone: '922333444' })).toBe('phone_invalid');
    expect(checkAccountDetails({ name: 'Camila', phone: '+51' })).toBe('phone_invalid');
    expect(checkAccountDetails({ name: 'Camila', phone: '+5192233344455566' })).toBe(
      'phone_invalid',
    );
  });

  it('cada motivo tiene su frase', () => {
    expect(accountDetailsDenialMessage('phone_invalid')).toMatch(/código del país/);
    expect(accountDetailsDenialMessage('name_too_short')).toMatch(/dos letras/);
  });
});
