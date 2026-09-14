import { describe, expect, it } from 'vitest';
import {
  generateAccountQrToken,
  generateClaimCode,
  hashBearerToken,
  issueBearerToken,
} from './secrets';

describe('token de portador', () => {
  it('el hash es determinista, para poder buscar por el', () => {
    // Es la propiedad que decide el algoritmo: hace falta BUSCAR la fila por su
    // hash —la invitacion que alguien acaba de abrir— y con sal aleatoria eso
    // seria imposible. Por eso SHA-256 y no un KDF lento.
    const { token, hash } = issueBearerToken();
    expect(hashBearerToken(token)).toBe(hash);
    expect(hashBearerToken(token)).toBe(hashBearerToken(token));
  });

  it('dos tokens distintos dan hash distinto', () => {
    expect(issueBearerToken().hash).not.toBe(issueBearerToken().hash);
  });

  it('el token tiene entropia suficiente para no necesitar KDF lento', () => {
    // 32 bytes en base64url: 43 caracteres.
    expect(issueBearerToken().token.length).toBeGreaterThanOrEqual(43);
  });

  it('el hash no revela el token', () => {
    const { token, hash } = issueBearerToken();
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

describe('token del QR de la cuenta', () => {
  it('cabe en el formato que lee el mostrador', () => {
    // `parseAccountQrPayload` exige 20 a 64 caracteres base64url: un token que se
    // saliera de ahi seria un QR que el escaner descarta sin decir por que.
    for (let i = 0; i < 200; i += 1) {
      expect(generateAccountQrToken()).toMatch(/^[A-Za-z0-9_-]{24}$/);
    }
  });

  it('no se repite', () => {
    const tokens = new Set(Array.from({ length: 2000 }, () => generateAccountQrToken()));
    expect(tokens.size).toBe(2000);
  });
});
