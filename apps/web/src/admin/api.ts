/**
 * La puerta de salida del panel de Sinchi hacia la api. Solo en el servidor.
 *
 * Hermana de `src/panel/api.ts` y con la misma forma, pero con su propia cookie:
 * el token que lee esta función administra la plataforma entera, y una sola
 * función que aceptara «el token que le pases» es una que un día se llama con el
 * de un gimnasio — o peor, al revés.
 *
 * `server-only` no es decoración: si alguien importa esto desde un componente de
 * cliente, el build falla en vez de mandarle al navegador un módulo que lee la
 * cookie de sesión y la URL interna de la api.
 */
import 'server-only';
import { ApiError } from '../panel/api';
import { readAdminSession } from './session';

const BASE = process.env.SINCHI_API_URL ?? 'http://localhost:3000/v1';

export { ApiError };

interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'DELETE';
  readonly body?: unknown;
}

/**
 * Una petición al panel de Sinchi con su sesión puesta.
 *
 * Nunca se cachea. En el panel del dueño la portada acepta unos segundos de
 * copia; aquí no hay ninguna pantalla donde valga la pena: quien acaba de
 * suspender un gimnasio tiene que verlo suspendido, y quien acaba de retirarle
 * el acceso a alguien tiene que verlo fuera.
 */
export async function adminApi<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const session = await readAdminSession();
  if (session === null) throw new ApiError(401, 'No hay sesión.');

  const response = await fetch(`${BASE}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    cache: 'no-store',
  });

  if (!response.ok) throw await toError(response);

  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text.length === 0 ? undefined : JSON.parse(text)) as T;
}

/**
 * El error, con la frase que ya venía escrita.
 *
 * La api contesta en español y pensado para leerse —«Solo se puede eliminar un
 * gimnasio suspendido»—, así que se respeta tal cual. Taparlo con un «algo salió
 * mal» es tirar la única frase que decía qué corregir.
 */
async function toError(response: Response): Promise<ApiError> {
  let body: unknown = null;
  let message = `La api respondió ${response.status}.`;

  try {
    body = await response.json();
    const parsed = body as { readonly message?: unknown };
    if (typeof parsed.message === 'string' && parsed.message.length > 0) message = parsed.message;
  } catch {
    // Un 502 del balanceador llega como HTML. El mensaje por defecto sirve.
  }

  return new ApiError(response.status, message, body);
}
