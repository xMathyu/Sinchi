/**
 * Codigo de acceso de vida corta (TOTP, RFC 6238).
 *
 * Requisito no negociable del MD 4.6: todo QR es firmado y de vida corta, lo
 * genere el alumno o el dispositivo de la puerta. Un QR estatico circula por
 * WhatsApp en una semana y se pierde el control de aforo.
 *
 * El codigo del alumno se deriva de un secreto sembrado al vincular la cuenta,
 * asi que funciona sin internet en su celular. El secreto es GLOBAL, no por
 * gimnasio: un solo codigo lo identifica en cualquier local de la red y el
 * servidor resuelve contra que membresia validarlo (MD 5).
 *
 * La primitiva HMAC se inyecta porque este paquete corre en Node (api), en el
 * navegador (web) y en Hermes (mobile), y cada uno la trae por su lado.
 */

/** HMAC-SHA1 o HMAC-SHA256 provista por la plataforma. */
export type HmacFn = (key: Uint8Array, message: Uint8Array) => Uint8Array;

export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 8;

export interface TotpOptions {
  /** Ventana en segundos. Default 30. */
  readonly periodSeconds?: number;
  /** Digitos del codigo. Default 8: 6 es adivinable a fuerza bruta en la puerta. */
  readonly digits?: number;
}

/** Contador TOTP: cuantas ventanas completas pasaron desde epoch. */
export function totpCounter(instant: Date, periodSeconds: number = TOTP_PERIOD_SECONDS): number {
  return Math.floor(instant.getTime() / 1000 / periodSeconds);
}

/** Segundos que le quedan de vida a la ventana actual. Alimenta el contador de la UI. */
export function secondsUntilRotation(
  instant: Date,
  periodSeconds: number = TOTP_PERIOD_SECONDS,
): number {
  const elapsed = Math.floor(instant.getTime() / 1000) % periodSeconds;
  return periodSeconds - elapsed;
}

function counterToBytes(counter: number): Uint8Array {
  const bytes = new Uint8Array(8);
  let value = counter;
  for (let i = 7; i >= 0; i -= 1) {
    bytes[i] = value & 0xff;
    value = Math.floor(value / 256);
  }
  return bytes;
}

/** Truncamiento dinamico del RFC 4226. */
function truncate(mac: Uint8Array, digits: number): string {
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f;
  const binary =
    (((mac[offset] ?? 0) & 0x7f) << 24) |
    (((mac[offset + 1] ?? 0) & 0xff) << 16) |
    (((mac[offset + 2] ?? 0) & 0xff) << 8) |
    ((mac[offset + 3] ?? 0) & 0xff);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export function generateHotp(
  secret: Uint8Array,
  counter: number,
  hmac: HmacFn,
  digits: number = TOTP_DIGITS,
): string {
  return truncate(hmac(secret, counterToBytes(counter)), digits);
}

export function generateTotp(
  secret: Uint8Array,
  instant: Date,
  hmac: HmacFn,
  options: TotpOptions = {},
): string {
  const period = options.periodSeconds ?? TOTP_PERIOD_SECONDS;
  const digits = options.digits ?? TOTP_DIGITS;
  return generateHotp(secret, totpCounter(instant, period), hmac, digits);
}

/** Comparacion en tiempo constante: un compare con corto circuito filtra el codigo. */
export function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export interface TotpVerifyInput {
  readonly secret: Uint8Array;
  readonly code: string;
  readonly instant: Date;
  readonly hmac: HmacFn;
  /**
   * Ventanas de tolerancia hacia atras y adelante. Default 1: el reloj del
   * celular del alumno no esta sincronizado, y el del dispositivo de la puerta
   * menos todavia despues de horas sin internet.
   */
  readonly skewWindows?: number;
  readonly options?: TotpOptions;
}

export function verifyTotp(input: TotpVerifyInput): boolean {
  const period = input.options?.periodSeconds ?? TOTP_PERIOD_SECONDS;
  const digits = input.options?.digits ?? TOTP_DIGITS;
  const skew = input.skewWindows ?? 1;
  const center = totpCounter(input.instant, period);

  for (let offset = -skew; offset <= skew; offset += 1) {
    const expected = generateHotp(input.secret, center + offset, input.hmac, digits);
    if (constantTimeEquals(expected, input.code)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Payload del QR
// ---------------------------------------------------------------------------

/** Version del formato, al frente, para poder rotarlo sin romper lectores viejos. */
export const QR_PREFIX = 'SINCHI1';

export type QrSubject = 'user' | 'device';

export interface QrPayload {
  /** `user` = QR del alumno (modo A). `device` = QR de la puerta (modo B). */
  readonly subject: QrSubject;
  /** UUID del usuario global o del dispositivo de check-in. */
  readonly id: string;
  readonly code: string;
}

/**
 * `SINCHI1:u:<id>:<code>`.
 *
 * El id viaja en claro a proposito: sin el, el lector tendria que probar el
 * codigo contra todo el padron. Lo que autentica es el codigo, no el id.
 */
export function encodeQrPayload(payload: QrPayload): string {
  const tag = payload.subject === 'user' ? 'u' : 'd';
  return `${QR_PREFIX}:${tag}:${payload.id}:${payload.code}`;
}

export function parseQrPayload(raw: string): QrPayload | null {
  const parts = raw.trim().split(':');
  if (parts.length !== 4) return null;
  const [prefix, tag, id, code] = parts;
  if (prefix !== QR_PREFIX) return null;
  if (tag !== 'u' && tag !== 'd') return null;
  if (id === undefined || id.length === 0) return null;
  if (code === undefined || !/^\d{6,10}$/.test(code)) return null;
  return { subject: tag === 'u' ? 'user' : 'device', id, code };
}
