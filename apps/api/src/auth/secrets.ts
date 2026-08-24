/**
 * Hash de los dos secretos que el staff maneja: el PIN de turno y el token del
 * equipo del mostrador.
 *
 * Se tratan distinto porque tienen entropía distinta, y confundirlo es el error
 * clásico:
 *
 *  - **PIN**: 4 a 6 dígitos. Como máximo un millón de combinaciones, que un
 *    equipo moderno prueba en segundos si el hash es rápido. Va con **scrypt**,
 *    que es deliberadamente lento y con costo de memoria.
 *
 *  - **Token del equipo**: 32 bytes aleatorios. Adivinarlo es imposible por
 *    fuerza bruta, así que un KDF lento no aporta nada y sí estorba: hay que
 *    poder BUSCAR por el hash para saber qué equipo es, y scrypt lleva sal
 *    aleatoria, lo que hace imposible la búsqueda. Va con **SHA-256**, que es lo
 *    correcto para una llave de API y lo que hace todo el mundo.
 *
 * Usar scrypt para el token obligaría a recorrer todos los equipos probando uno
 * por uno; usar SHA-256 para el PIN lo dejaría reventado en un descuido.
 */
import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';

// ---------------------------------------------------------------------------
// PIN de turno
// ---------------------------------------------------------------------------

const SCRYPT_SALT_BYTES = 16;
const SCRYPT_KEY_BYTES = 32;
/**
 * Parámetros de scrypt. `N=2^15` tarda unos 100 ms en un vCPU de Cloud Run:
 * imperceptible al abrir turno, y suficiente para que probar un millón de PINs
 * cueste días en vez de segundos.
 */
const SCRYPT_PARAMS = { N: 32_768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;

export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 6;

export function assertValidPin(pin: string): void {
  if (!new RegExp(`^\\d{${PIN_MIN_LENGTH},${PIN_MAX_LENGTH}}$`).test(pin)) {
    throw new Error(`El PIN debe tener entre ${PIN_MIN_LENGTH} y ${PIN_MAX_LENGTH} dígitos.`);
  }
  // Un PIN de dígitos repetidos o una secuencia es lo primero que prueba
  // cualquiera que quiera marcar asistencia a nombre de otro.
  if (/^(\d)\1+$/.test(pin)) {
    throw new Error('Ese PIN es demasiado obvio: no uses el mismo dígito repetido.');
  }
  if ('0123456789'.includes(pin) || '9876543210'.includes(pin)) {
    throw new Error('Ese PIN es demasiado obvio: no uses dígitos consecutivos.');
  }
}

/** Formato guardado: `scrypt$<sal>$<clave>`, ambos en base64url. */
export function hashPin(pin: string): string {
  assertValidPin(pin);
  const salt = randomBytes(SCRYPT_SALT_BYTES);
  const key = scryptSync(pin, salt, SCRYPT_KEY_BYTES, SCRYPT_PARAMS);
  return `scrypt$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export function verifyPin(pin: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;

  const salt = Buffer.from(parts[1] as string, 'base64url');
  const expected = Buffer.from(parts[2] as string, 'base64url');
  if (expected.length !== SCRYPT_KEY_BYTES) return false;

  const actual = scryptSync(pin, salt, SCRYPT_KEY_BYTES, SCRYPT_PARAMS);
  return timingSafeEqual(actual, expected);
}

// ---------------------------------------------------------------------------
// Token del equipo del mostrador
// ---------------------------------------------------------------------------

const DEVICE_TOKEN_BYTES = 32;

export interface IssuedDeviceToken {
  /** Se muestra UNA vez. La base solo guarda el hash. */
  readonly token: string;
  readonly hash: string;
}

export function issueDeviceToken(): IssuedDeviceToken {
  const token = randomBytes(DEVICE_TOKEN_BYTES).toString('base64url');
  return { token, hash: hashDeviceToken(token) };
}

/**
 * SHA-256 sin sal, y eso es deliberado: el hash tiene que ser determinista para
 * poder buscar el equipo por él. Con 32 bytes de entropía no hay nada que
 * proteger contra fuerza bruta ni tabla precomputada.
 */
export function hashDeviceToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

// ---------------------------------------------------------------------------
// Código de vinculación
// ---------------------------------------------------------------------------

/**
 * Seis dígitos, con `randomInt` (que usa el generador criptográfico) y no
 * `Math.random`.
 *
 * Es corto porque se dicta en voz alta en el mostrador, y es aceptable que sea
 * corto porque no vale por sí solo: hay que estar frente a la recepcionista para
 * usarlo, dura minutos, y quien lo confirma está mirando a la persona.
 */
export function generateClaimCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}
