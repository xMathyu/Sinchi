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
// Cuenta sin ficha
// ---------------------------------------------------------------------------

/**
 * Seis dígitos, con `randomInt` (que usa el generador criptográfico) y no
 * `Math.random`.
 *
 * Era el código que se dictaba en el mostrador. Ya no se confirma —la persona
 * acepta la solicitud del gimnasio—, pero se sigue emitiendo: la columna es NOT
 * NULL y las apps anteriores a la migración 0023 lo leen al entrar.
 */
export function generateClaimCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/**
 * El token del QR de la cuenta: 18 bytes, 24 caracteres base64url.
 *
 * Largo porque no se dicta, se escanea, y porque canjearlo entrega el nombre, el
 * celular y el correo de la persona: seis dígitos se podrían recorrer desde
 * cualquier sesión de staff. Se guarda en claro, al revés que el de la
 * invitación, porque vive diez minutos y no abre nada por sí solo.
 */
export function generateAccountQrToken(): string {
  return randomBytes(18).toString('base64url');
}
