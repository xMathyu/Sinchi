import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SecretBox, generateTotpSecret, safeEquals } from './secret-box';

const key = randomBytes(32).toString('base64');
const box = new SecretBox(key);

describe('SecretBox', () => {
  it('cifra y descifra ida y vuelta', () => {
    const secret = generateTotpSecret();
    expect(box.decrypt(box.encrypt(secret))).toEqual(secret);
  });

  it('cifra y descifra texto', () => {
    const clave = 'sk_test_culqi_1234567890';
    expect(box.decryptText(box.encryptText(clave))).toBe(clave);
  });

  it('dos cifrados del mismo secreto dan sobres distintos', () => {
    // Si el IV se repitiera, dos alumnos con el mismo secreto tendrian la misma
    // fila cifrada y eso filtraria informacion.
    const secret = generateTotpSecret();
    expect(box.encrypt(secret)).not.toBe(box.encrypt(secret));
  });

  it('el sobre lleva version al frente', () => {
    expect(box.encrypt(generateTotpSecret()).startsWith('v1.')).toBe(true);
  });

  it('rechaza una fila manipulada', () => {
    // GCM autentica: alterar el texto cifrado falla al descifrar en vez de
    // devolver un secreto distinto en silencio.
    const envelope = box.encrypt(generateTotpSecret());
    const parts = envelope.split('.');
    const tampered = [parts[0], parts[1], parts[2], `${parts[3]!.slice(0, -2)}AA`].join('.');
    expect(() => box.decrypt(tampered)).toThrow();
  });

  it('rechaza un sobre cifrado con otra clave', () => {
    const other = new SecretBox(randomBytes(32).toString('base64'));
    const envelope = other.encrypt(generateTotpSecret());
    expect(() => box.decrypt(envelope)).toThrow();
  });

  it('rechaza formatos desconocidos', () => {
    expect(() => box.decrypt('texto plano')).toThrow(/formato desconocido/);
    expect(() => box.decrypt('v2.a.b.c')).toThrow(/formato desconocido/);
  });

  it('rechaza una clave de tamano incorrecto', () => {
    expect(() => new SecretBox(randomBytes(16).toString('base64'))).toThrow(/32 bytes/);
  });
});

describe('generateTotpSecret', () => {
  it('produce 32 bytes distintos cada vez', () => {
    const a = generateTotpSecret();
    const b = generateTotpSecret();
    expect(a.length).toBe(32);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });
});

describe('safeEquals', () => {
  it('compara sin corto circuito', () => {
    expect(safeEquals('abc123', 'abc123')).toBe(true);
    expect(safeEquals('abc123', 'abc124')).toBe(false);
    expect(safeEquals('abc', 'abcd')).toBe(false);
  });
});
