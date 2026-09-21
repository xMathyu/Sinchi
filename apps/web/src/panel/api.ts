/**
 * La unica puerta de salida a la api, y corre SOLO en el servidor.
 *
 * `server-only` no es decoracion: si alguien importa esto desde un componente de
 * cliente, el build falla en vez de mandar al navegador un modulo que lee la
 * cookie de sesion y la URL interna de la api. Es el tipo de error que no se ve
 * revisando el diff —el import parece inofensivo— y que publica el token.
 *
 * Todo lo que devuelve la api viaja como JSON, asi que las fechas civiles llegan
 * como `{ year, month, day }` y los montos como enteros de centimos. Aqui no se
 * reconstruyen a objetos de dominio como hace la app: el panel los pinta y ya, y
 * una capa de mapeo que solo sirve para volver a serializar en el HTML es trabajo
 * que se paga en cada peticion sin que nadie lo cobre.
 */
import 'server-only';
import { readSession } from './session';

const BASE = process.env.SINCHI_API_URL ?? 'http://localhost:3000/v1';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: unknown = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** La sesion ya no vale. Quien lo reciba tiene que mandar al login. */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  /** Entro, pero esto no es suyo. Recepcion pidiendo las ganancias del local. */
  get isForbidden(): boolean {
    return this.status === 403;
  }
}

interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'DELETE';
  readonly body?: unknown;
  /**
   * Segundos que Next puede reusar la respuesta.
   *
   * Por defecto `0` —nada se cachea— y es lo correcto para casi todo el panel:
   * quien acaba de cobrar tiene que ver el cobro, no una copia de hace un minuto.
   * El caso que lo pide es el de la portada, que se pinta entera en cada
   * navegacion entre pestanas.
   */
  readonly revalidate?: number;
}

/**
 * Una peticion a la api con la sesion del panel puesta.
 *
 * El token sale de la cookie y nunca de un parametro: una funcion que acepta el
 * token por argumento es una que alguien acaba llamando con el de otro, y aqui
 * «el de otro» es la caja de otro gimnasio.
 */
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const session = await readSession();
  if (session === null) throw new ApiError(401, 'No hay sesion.');

  const response = await fetch(`${BASE}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    next: { revalidate: options.revalidate ?? 0 },
  });

  if (!response.ok) throw await toError(response);

  // 204 y un cuerpo vacio: `DELETE` de una rutina no devuelve nada, y
  // `response.json()` sobre vacio lanza un SyntaxError que se leeria como un
  // fallo de la api.
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text.length === 0 ? undefined : JSON.parse(text)) as T;
}

/**
 * El error de la api, con su frase.
 *
 * La api contesta `{ message }` en español y pensado para leerse —«Un celular de
 * Perú tiene 9 dígitos»—, asi que se respeta tal cual. Inventar aqui un «Algo
 * salio mal» encima de un mensaje que ya explicaba que corregir es como se
 * pierden las unicas frases utiles del sistema.
 */
async function toError(response: Response): Promise<ApiError> {
  let body: unknown = null;
  let message = `La api respondio ${response.status}.`;

  try {
    body = await response.json();
    const parsed = body as { readonly message?: unknown };
    if (typeof parsed.message === 'string' && parsed.message.length > 0) message = parsed.message;
  } catch {
    // Un 502 del balanceador llega como HTML. El mensaje por defecto sirve.
  }

  return new ApiError(response.status, message, body);
}
