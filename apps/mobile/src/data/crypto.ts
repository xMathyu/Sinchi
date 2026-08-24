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
import { getRandomValues } from 'expo-crypto';
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
 * Secreto TOTP del dispositivo.
 *
 * En produccion lo entrega el servidor al vincular la cuenta, para que el
 * mismo secreto valga en cualquier gimnasio de la red. Mientras la api no
 * existe se genera local, que es suficiente para ejercitar el flujo completo.
 */
export async function loadOrCreateSecret(): Promise<Uint8Array> {
  const stored = await SecureStore.getItemAsync(SECRET_KEY);
  if (stored !== null) return fromBase64(stored);

  const fresh = getRandomValues(new Uint8Array(SECRET_BYTES));
  await SecureStore.setItemAsync(SECRET_KEY, toBase64(fresh), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return fresh;
}

/** Se llama al cerrar sesion: el secreto no debe sobrevivir al usuario. */
export async function clearSecret(): Promise<void> {
  await SecureStore.deleteItemAsync(SECRET_KEY);
}
