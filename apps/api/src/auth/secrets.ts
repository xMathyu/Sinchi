/**
 * Los secretos que la api emite y guarda hasheados.
 *
 * Aqui vivio tambien el PIN de turno del mostrador —4-6 digitos con scrypt, con
 * su bloqueo por intentos— hasta que el turno se retiro: los gimnasios de la red
 * no usan una tablet compartida, la recepcion entra con su propia cuenta. El
 * razonamiento de por que un PIN pedia scrypt y un token no, esta en el
 * historial (busca `hashPin`); no hay que volver a deducirlo si algun dia vuelve.
 */
import { createHash, randomBytes, randomInt } from 'node:crypto';

// ---------------------------------------------------------------------------
// Tokens de portador
// ---------------------------------------------------------------------------

const BEARER_TOKEN_BYTES = 32;

export interface IssuedBearerToken {
  /** Se muestra UNA vez. La base solo guarda el hash. */
  readonly token: string;
  readonly hash: string;
}

/**
 * Un secreto de portador: hoy lo usa el enlace de invitacion.
 *
 * 32 bytes aleatorios, asi que adivinarlo por fuerza bruta es imposible y un KDF
 * lento no aportaria nada.
 */
export function issueBearerToken(): IssuedBearerToken {
  const token = randomBytes(BEARER_TOKEN_BYTES).toString('base64url');
  return { token, hash: hashBearerToken(token) };
}

/**
 * SHA-256 sin sal, y eso es deliberado: el hash tiene que ser determinista para
 * poder BUSCAR la fila por el. Con 32 bytes de entropia no hay nada que proteger
 * contra fuerza bruta ni tabla precomputada, y un KDF con sal aleatoria obligaria
 * a recorrer todas las filas probando una por una.
 */
export function hashBearerToken(token: string): string {
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
