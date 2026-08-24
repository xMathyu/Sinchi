import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  encodeQrPayload,
  generateTotp,
  parseQrPayload,
  secondsUntilRotation,
  totpCounter,
  verifyTotp,
  type HmacFn,
} from './totp.js';

const hmacSha1: HmacFn = (key, message) =>
  new Uint8Array(createHmac('sha1', Buffer.from(key)).update(Buffer.from(message)).digest());

/** Secreto de los vectores de prueba del RFC 6238. */
const RFC_SECRET = new TextEncoder().encode('12345678901234567890');

describe('vectores del RFC 6238 (SHA-1, 8 digitos, ventana de 30 s)', () => {
  const vectores: readonly [number, string][] = [
    [59, '94287082'],
    [1_111_111_109, '07081804'],
    [1_111_111_111, '14050471'],
    [1_234_567_890, '89005924'],
    [2_000_000_000, '69279037'],
    [20_000_000_000, '65353130'],
  ];

  for (const [seconds, expected] of vectores) {
    it(`T = ${seconds} produce ${expected}`, () => {
      const code = generateTotp(RFC_SECRET, new Date(seconds * 1000), hmacSha1);
      expect(code).toBe(expected);
    });
  }
});

describe('ventana de 30 segundos', () => {
  it('el codigo cambia al cruzar la ventana', () => {
    const dentro = generateTotp(RFC_SECRET, new Date(1_111_111_109 * 1000), hmacSha1);
    const siguiente = generateTotp(RFC_SECRET, new Date(1_111_111_140 * 1000), hmacSha1);
    expect(dentro).not.toBe(siguiente);
  });

  it('el codigo no cambia dentro de la misma ventana', () => {
    const a = generateTotp(RFC_SECRET, new Date(1_111_111_111 * 1000), hmacSha1);
    const b = generateTotp(RFC_SECRET, new Date(1_111_111_119 * 1000), hmacSha1);
    expect(a).toBe(b);
  });

  it('cuenta los segundos que le quedan a la ventana', () => {
    expect(secondsUntilRotation(new Date(1_111_111_110 * 1000))).toBe(30);
    expect(secondsUntilRotation(new Date(1_111_111_111 * 1000))).toBe(29);
    expect(secondsUntilRotation(new Date(1_111_111_139 * 1000))).toBe(1);
  });

  it('el contador avanza una unidad por ventana', () => {
    expect(totpCounter(new Date(59 * 1000))).toBe(1);
    expect(totpCounter(new Date(60 * 1000))).toBe(2);
  });
});

describe('verifyTotp', () => {
  const instante = new Date(1_111_111_111 * 1000);

  it('acepta el codigo de la ventana actual', () => {
    const code = generateTotp(RFC_SECRET, instante, hmacSha1);
    expect(verifyTotp({ secret: RFC_SECRET, code, instant: instante, hmac: hmacSha1 })).toBe(true);
  });

  it('tolera un desfase de una ventana: los relojes de la puerta se atrasan', () => {
    const code = generateTotp(RFC_SECRET, new Date(instante.getTime() - 30_000), hmacSha1);
    expect(verifyTotp({ secret: RFC_SECRET, code, instant: instante, hmac: hmacSha1 })).toBe(true);
  });

  it('rechaza un codigo de hace dos ventanas', () => {
    const code = generateTotp(RFC_SECRET, new Date(instante.getTime() - 90_000), hmacSha1);
    expect(verifyTotp({ secret: RFC_SECRET, code, instant: instante, hmac: hmacSha1 })).toBe(false);
  });

  it('rechaza un codigo de otro secreto: un QR reenviado por WhatsApp no sirve', () => {
    const otro = new TextEncoder().encode('98765432109876543210');
    const code = generateTotp(otro, instante, hmacSha1);
    expect(verifyTotp({ secret: RFC_SECRET, code, instant: instante, hmac: hmacSha1 })).toBe(false);
  });

  it('rechaza basura', () => {
    expect(
      verifyTotp({ secret: RFC_SECRET, code: '00000000', instant: instante, hmac: hmacSha1 }),
    ).toBe(false);
    expect(verifyTotp({ secret: RFC_SECRET, code: '', instant: instante, hmac: hmacSha1 })).toBe(
      false,
    );
  });
});

describe('payload del QR', () => {
  it('ida y vuelta', () => {
    const payload = { subject: 'user', id: 'a1b2c3', code: '94287082' } as const;
    expect(parseQrPayload(encodeQrPayload(payload))).toEqual(payload);
  });

  it('distingue el QR del alumno del de la puerta', () => {
    expect(encodeQrPayload({ subject: 'user', id: 'u1', code: '12345678' })).toBe(
      'SINCHI1:u:u1:12345678',
    );
    expect(encodeQrPayload({ subject: 'device', id: 'd1', code: '12345678' })).toBe(
      'SINCHI1:d:d1:12345678',
    );
  });

  it('rechaza payloads que no son de Sinchi', () => {
    expect(parseQrPayload('https://ejemplo.com/qr')).toBeNull();
    expect(parseQrPayload('SINCHI0:u:u1:12345678')).toBeNull();
    expect(parseQrPayload('SINCHI1:x:u1:12345678')).toBeNull();
    expect(parseQrPayload('SINCHI1:u::12345678')).toBeNull();
    expect(parseQrPayload('SINCHI1:u:u1:abc')).toBeNull();
    expect(parseQrPayload('SINCHI1:u:u1')).toBeNull();
  });

  it('ignora espacios del lector de camara', () => {
    expect(parseQrPayload('  SINCHI1:u:u1:12345678\n')).not.toBeNull();
  });
});
