import { describe, expect, it } from 'vitest';
import {
  assertValidPin,
  generateClaimCode,
  hashDeviceToken,
  hashPin,
  issueDeviceToken,
  verifyPin,
} from './secrets';

describe('PIN', () => {
  it('cifra y verifica ida y vuelta', () => {
    const stored = hashPin('4821');
    expect(verifyPin('4821', stored)).toBe(true);
    expect(verifyPin('4822', stored)).toBe(false);
  });

  it('el hash nunca contiene el PIN', () => {
    expect(hashPin('4821')).not.toContain('4821');
  });

  it('dos hash del mismo PIN son distintos', () => {
    // Sal aleatoria: si se repitieran, dos personas con el mismo PIN tendrian la
    // misma fila y eso filtra informacion.
    expect(hashPin('4821')).not.toBe(hashPin('4821'));
  });

  it('rechaza PIN de digitos repetidos', () => {
    // Es lo primero que prueba quien quiere marcar asistencia a nombre de otro.
    expect(() => assertValidPin('1111')).toThrow(/mismo dígito/);
    expect(() => assertValidPin('000000')).toThrow(/mismo dígito/);
  });

  it('rechaza secuencias', () => {
    expect(() => assertValidPin('1234')).toThrow(/consecutivos/);
    expect(() => assertValidPin('4321')).toThrow(/consecutivos/);
    expect(() => assertValidPin('789')).toThrow();
  });

  it('rechaza longitudes fuera de rango y no numericos', () => {
    expect(() => assertValidPin('123')).toThrow();
    expect(() => assertValidPin('1948273')).toThrow();
    expect(() => assertValidPin('48a1')).toThrow();
    expect(() => assertValidPin('')).toThrow();
  });

  it('acepta un PIN razonable de 4 a 6 digitos', () => {
    for (const pin of ['4821', '90514', '712583']) {
      expect(() => assertValidPin(pin)).not.toThrow();
    }
  });

  it('un hash con formato desconocido no valida nada', () => {
    expect(verifyPin('4821', 'texto plano')).toBe(false);
    expect(verifyPin('4821', 'bcrypt$a$b')).toBe(false);
    expect(verifyPin('4821', 'scrypt$a')).toBe(false);
  });
});

describe('token del equipo', () => {
  it('el hash es determinista, para poder buscar por el', () => {
    // Es la diferencia de diseno con el PIN: aqui hace falta BUSCAR el equipo
    // por su hash, y con sal aleatoria eso seria imposible.
    const { token, hash } = issueDeviceToken();
    expect(hashDeviceToken(token)).toBe(hash);
    expect(hashDeviceToken(token)).toBe(hashDeviceToken(token));
  });

  it('dos tokens distintos dan hash distinto', () => {
    expect(issueDeviceToken().hash).not.toBe(issueDeviceToken().hash);
  });

  it('el token tiene entropia suficiente para no necesitar KDF lento', () => {
    // 32 bytes en base64url: 43 caracteres.
    expect(issueDeviceToken().token.length).toBeGreaterThanOrEqual(43);
  });

  it('el hash no revela el token', () => {
    const { token, hash } = issueDeviceToken();
    expect(hash).not.toContain(token.slice(0, 12));
  });
});

describe('codigo de vinculacion', () => {
  it('son seis digitos, siempre', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(generateClaimCode()).toMatch(/^\d{6}$/);
    }
  });

  it('incluye los que empiezan por cero', () => {
    // Con `String(n)` sin relleno, el 5 saldria como "5" y el CHECK de la base
    // lo rechazaria; el fallo apareceria una vez cada mil.
    const codes = Array.from({ length: 4000 }, () => generateClaimCode());
    expect(codes.every((c) => c.length === 6)).toBe(true);
  });

  it('no repite de forma evidente', () => {
    const codes = new Set(Array.from({ length: 500 }, () => generateClaimCode()));
    expect(codes.size).toBeGreaterThan(480);
  });
});
