/**
 * Cifrado en reposo para los secretos de la base.
 *
 * Dos cosas van cifradas y ninguna es opcional: el secreto TOTP del alumno (con
 * él se generan códigos de acceso válidos) y la clave secreta de Culqi de cada
 * gimnasio (con ella se mueve su dinero). El MD lo pide explícito: "cifradas en
 * reposo, nunca en texto plano ni en logs".
 *
 * AES-256-GCM: cifra y autentica a la vez, así que una fila manipulada falla al
 * descifrar en vez de producir un secreto distinto y silencioso.
 *
 * El formato guardado es `v1.<iv>.<tag>.<ciphertext>` en base64url. La versión
 * al frente permite rotar el algoritmo sin adivinar qué es cada fila.
 */
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // GCM estándar
const KEY_BYTES = 32;

export class SecretBox {
  private readonly key: Buffer;

  constructor(keyBase64: string) {
    const key = Buffer.from(keyBase64, 'base64');
    if (key.length !== KEY_BYTES) {
      throw new Error(
        `ENCRYPTION_KEY debe ser de ${KEY_BYTES} bytes en base64 (${key.length} recibidos). ` +
          'Genera una con: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
      );
    }
    this.key = key;
  }

  encrypt(plaintext: Uint8Array): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, b64(iv), b64(tag), b64(ciphertext)].join('.');
  }

  decrypt(envelope: string): Uint8Array {
    const parts = envelope.split('.');
    if (parts.length !== 4 || parts[0] !== VERSION) {
      throw new Error('Sobre cifrado con formato desconocido.');
    }
    const [, ivPart, tagPart, dataPart] = parts as [string, string, string, string];

    const decipher = createDecipheriv(ALGORITHM, this.key, unb64(ivPart));
    decipher.setAuthTag(unb64(tagPart));
    // `final()` lanza si el tag no cuadra: una fila alterada no descifra.
    return new Uint8Array(Buffer.concat([decipher.update(unb64(dataPart)), decipher.final()]));
  }

  encryptText(value: string): string {
    return this.encrypt(new TextEncoder().encode(value));
  }

  decryptText(envelope: string): string {
    return new TextDecoder().decode(this.decrypt(envelope));
  }
}

const b64 = (buffer: Buffer): string => buffer.toString('base64url');
const unb64 = (value: string): Buffer => Buffer.from(value, 'base64url');

/** Secreto TOTP nuevo. 32 bytes es lo que recomienda el RFC 6238 para SHA-256. */
export const generateTotpSecret = (): Uint8Array => new Uint8Array(randomBytes(32));

/** Comparación en tiempo constante para tokens de longitud fija. */
export function safeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
