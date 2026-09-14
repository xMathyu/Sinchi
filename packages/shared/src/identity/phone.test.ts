import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PHONE_COUNTRY,
  PHONE_COUNTRIES,
  checkPhoneNumber,
  flagEmoji,
  isValidPhoneNumber,
  joinPhoneNumber,
  normalizePhoneNumber,
  phoneCountryByIso,
  phoneDenialMessage,
  searchPhoneCountries,
  splitPhoneNumber,
  type PhoneDenial,
} from './phone.js';

const country = (iso: string) => {
  const found = phoneCountryByIso(iso);
  if (found === null) throw new Error(`No hay ${iso} en la lista`);
  return found;
};

describe('la lista de países', () => {
  it('arranca en Perú y sigue por nombre', () => {
    expect(DEFAULT_PHONE_COUNTRY.iso).toBe('PE');
    const rest = PHONE_COUNTRIES.slice(1).map((c) => c.name);
    expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b, 'es')));
  });

  it('no repite países y cada código es de dígitos', () => {
    const isos = PHONE_COUNTRIES.map((c) => c.iso);
    expect(new Set(isos).size).toBe(isos.length);
    for (const c of PHONE_COUNTRIES) {
      expect(c.iso).toMatch(/^[A-Z]{2}$/);
      expect(c.dialCode).toMatch(/^[1-9]\d{0,2}$/);
    }
  });

  it('dos países con el mismo código no reclaman el mismo código de área', () => {
    const seen = new Map<string, string>();
    for (const c of PHONE_COUNTRIES) {
      for (const prefix of c.leadingDigits ?? []) {
        const key = `${c.dialCode}:${prefix}`;
        expect(seen.get(key), key).toBeUndefined();
        seen.set(key, c.iso);
      }
    }
  });

  it('la bandera sale del código ISO', () => {
    expect(flagEmoji('PE')).toBe('🇵🇪');
    expect(flagEmoji('ve')).toBe('🇻🇪');
  });
});

describe('separar y unir', () => {
  it('un celular peruano va y vuelve igual', () => {
    const split = splitPhoneNumber('+51 987 654 321');
    expect(split.country?.iso).toBe('PE');
    expect(split.national).toBe('987654321');
    expect(joinPhoneNumber(split.country!, split.national)).toBe('+51987654321');
  });

  it('sin número no hay celular, ni siquiera el prefijo', () => {
    // «+51» a solas se guardaba encima del número bueno.
    expect(joinPhoneNumber(DEFAULT_PHONE_COUNTRY, '')).toBe('');
    expect(joinPhoneNumber(DEFAULT_PHONE_COUNTRY, ' - ')).toBe('');
  });

  it('lo pegado sin «+» es número nacional del país elegido', () => {
    expect(splitPhoneNumber('987 654 321')).toEqual({
      country: DEFAULT_PHONE_COUNTRY,
      national: '987654321',
    });
    expect(splitPhoneNumber('412 555 1234', country('VE')).country?.iso).toBe('VE');
  });

  it('el código de área decide entre los países del +1', () => {
    expect(splitPhoneNumber('+1 809 555 1234').country?.iso).toBe('DO');
    expect(splitPhoneNumber('+1 787 555 1234').country?.iso).toBe('PR');
    expect(splitPhoneNumber('+1 212 555 1234').country?.iso).toBe('US');
  });

  it('con un código compartido se respeta el país que ya eligió', () => {
    expect(splitPhoneNumber('+1 416 555 1234', country('CA')).country?.iso).toBe('CA');
    // Salvo que el código de área sea de otro: ese número no es de Canadá.
    expect(splitPhoneNumber('+1 809 555 1234', country('CA')).country?.iso).toBe('DO');
  });

  it('Rusia y Kazajistán se separan por el primer dígito', () => {
    expect(splitPhoneNumber('+7 912 345 6789').country?.iso).toBe('RU');
    expect(splitPhoneNumber('+7 701 234 5678').country?.iso).toBe('KZ');
  });

  it('un código que no es de nadie no se inventa un país', () => {
    expect(splitPhoneNumber('+999 1234 5678').country).toBeNull();
  });
});

describe('cuándo un celular sirve', () => {
  it('acepta el de Perú con y sin espacios, y el de otros países', () => {
    expect(checkPhoneNumber('+51987654321')).toBeNull();
    expect(checkPhoneNumber('+51 987 654 321')).toBeNull();
    expect(checkPhoneNumber('+58 412 555 1234')).toBeNull();
    expect(checkPhoneNumber('+34 612 345 678')).toBeNull();
    expect(isValidPhoneNumber('+1 809 555 1234')).toBe(true);
  });

  it('dice qué le pasa, y no solo que no sirve', () => {
    const cases: readonly (readonly [string, PhoneDenial])[] = [
      ['', 'missing'],
      ['+', 'missing'],
      // El hueco que motivó todo esto: el mismo número sin país.
      ['987654321', 'no_country_code'],
      ['+999 1234 5678', 'unknown_country'],
      // Un dígito de menos: parece bueno y no llama a nadie.
      ['+51 98765432', 'peru_mobile'],
      ['+51 887 654 321', 'peru_mobile'],
      ['+51', 'peru_mobile'],
      ['+51 9876543210', 'peru_mobile'],
      ['+34 6123456789012345', 'length'],
      ['+34 61', 'length'],
    ];
    for (const [raw, denial] of cases) expect(checkPhoneNumber(raw), raw).toBe(denial);
  });

  it('se compara sin espacios ni guiones', () => {
    expect(normalizePhoneNumber('+51 987-000 111')).toBe('+51987000111');
  });

  it('cada motivo tiene su frase', () => {
    expect(phoneDenialMessage('no_country_code')).toMatch(/código del país/);
    expect(phoneDenialMessage('peru_mobile')).toMatch(/9 dígitos/);
  });
});

describe('el buscador de países', () => {
  it('encuentra por nombre sin fijarse en tildes', () => {
    expect(searchPhoneCountries('peru').map((c) => c.iso)).toContain('PE');
    expect(searchPhoneCountries('espana').map((c) => c.iso)).toContain('ES');
    expect(searchPhoneCountries('MÉXICO').map((c) => c.iso)).toEqual(['MX']);
  });

  it('encuentra por código, con o sin «+»', () => {
    expect(searchPhoneCountries('+58').map((c) => c.iso)).toEqual(['VE']);
    expect(searchPhoneCountries('51').map((c) => c.iso)).toContain('PE');
  });

  it('vacío, la lista entera', () => {
    expect(searchPhoneCountries('  ')).toBe(PHONE_COUNTRIES);
  });
});
