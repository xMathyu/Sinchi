/**
 * Primitiva HMAC y custodia del secreto del alumno.
 *
 * `@sinchi/shared` no trae criptografia: la inyecta cada superficie. En la app
 * se usa `@noble/hashes`, que es JS puro y por tanto funciona en Hermes sin
 * modulo nativo.
 *
 * El secreto se siembra al vincular la cuenta y vive en el llavero del
 * dispositivo (Keychain en iOS, Keystore en Android). Por eso el QR se genera
 * sin internet, que es el requisito del MD 4.6.
 */
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import * as SecureStore from 'expo-secure-store';
import type { HmacFn } from '@sinchi/shared';

/**
 * HMAC-SHA256, no SHA-1.
 *
 * El RFC 6238 permite las tres familias. SHA-1 sigue siendo seguro para HMAC,
 * pero no hay razon para arrastrarlo en codigo nuevo: aqui el generador y el
 * verificador son nuestros, asi que no hay compatibilidad que respetar.
 */
export const hmacSha256: HmacFn = (key, message) => hmac(sha256, key, message);

const SECRET_KEY = 'sinchi.totp.secret.v1';
/** Lo que emite la api. Ver `generateTotpSecret` en apps/api. */
const SECRET_BYTES = 32;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = globalThis.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Secreto TOTP del alumno.
 *
 * LO ENTREGA EL SERVIDOR al vincular la cuenta (`POST /me/device`), y esto es lo
 * unico que puede pasar: el servidor guarda su propia copia cifrada y verifica el
 * codigo contra ella. Un secreto inventado en el telefono produce un QR
 * perfectamente valido... que la puerta rechaza, porque no coincide con ninguno.
 *
 * Es global, no por gimnasio: un solo codigo identifica al alumno en cualquier
 * local de la red (MD 4.6).
 *
 * Vive en el llavero con `WHEN_UNLOCKED_THIS_DEVICE_ONLY`: no viaja en las copias
 * de seguridad ni se sincroniza a otro dispositivo. Cambiar de telefono exige
 * volver a vincular, que es lo correcto — el QR es una credencial de acceso.
 */
export async function loadSecret(): Promise<Uint8Array | null> {
  const stored = await SecureStore.getItemAsync(SECRET_KEY);
  return stored === null ? null : fromBase64(stored);
}

/** Adopta el secreto que sembro la api. Llega en base64. */
export async function storeSecret(secretBase64: string): Promise<void> {
  // Se valida el tamano antes de guardarlo: un secreto corto generaria codigos
  // que la api rechaza, y el sintoma seria "mi QR no funciona" sin mas pistas.
  const bytes = fromBase64(secretBase64);
  if (bytes.length !== SECRET_BYTES) {
    throw new Error(
      `El secreto de acceso debe ser de ${SECRET_BYTES} bytes; llegaron ${bytes.length}.`,
    );
  }
  await SecureStore.setItemAsync(SECRET_KEY, secretBase64, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

/**
 * Se llama al cerrar sesion del alumno.
 *
 * El secreto no debe sobrevivir a su dueno: si presta el telefono, el siguiente
 * no puede quedarse generando su QR.
 */
export async function forgetSecret(): Promise<void> {
  await SecureStore.deleteItemAsync(SECRET_KEY);
}
