/**
 * Un 401 del servidor suelta la sesión. Uno de una ruta pública, no.
 *
 * Va en su propio archivo y NO detrás de `TEST_API_URL`, al revés que
 * `api.test.ts`: ese comprueba el contrato contra una api de verdad y por eso
 * se omite cuando no hay ninguna corriendo —en CI, siempre—. Lo que se prueba
 * aquí es una decisión del cliente, se resuelve sustituyendo `fetch`, y tiene
 * que correr en cada commit. Si viviera en el archivo de al lado no se
 * ejecutaría nunca, que es exactamente como se perdió lo que esto cubre:
 * `ApiError.isUnauthorized` existía documentado como «hay que volver al login»
 * y no lo llamaba nadie.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fetchGyms, fetchModes, setApiBase, setCredentialProvider } from './api';

const fetchOriginal = globalThis.fetch;

/** Cuántas veces la capa de red pidió soltar la sesión. */
let soltadas = 0;

/** Sustituye `fetch` por uno que siempre responde con este estado. */
function responderCon(status: number, body = '{"message":"Sesión inválida o expirada."}'): void {
  globalThis.fetch = (async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      statusText: String(status),
      text: async () => body,
    }) as unknown as Response) as typeof globalThis.fetch;
}

beforeEach(() => {
  soltadas = 0;
  setApiBase('http://api.de.prueba/v1');
  setCredentialProvider({
    getToken: () => 'un-token-que-el-servidor-va-a-rechazar',
    getDeviceToken: async () => null,
    onUnauthorized: () => {
      soltadas += 1;
    },
  });
});

afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

describe('cuando el servidor rechaza la sesión', () => {
  it('la suelta, para que la app lleve al login en vez de quedarse sin salida', async () => {
    responderCon(401);

    await expect(fetchModes()).rejects.toThrow();
    // Es el caso que reportó el primer dueño: sesión aparentemente iniciada y
    // ninguna pantalla con datos. Sin esto, la única salida era adivinar que el
    // remedio estaba en Ajustes → cerrar sesión.
    expect(soltadas).toBe(1);
  });

  it('no la suelta por un 401 de una ruta pública', async () => {
    responderCon(401);

    // `/gyms` viaja sin sesión de Sinchi. Su 401 habla de otra credencial —el ID
    // token de Firebase de quien reserva como invitado— y soltar la sesión aquí
    // echaría del turno a una recepcionista porque falló la reserva de alguien
    // que pasaba por la calle.
    await expect(fetchGyms()).rejects.toThrow();
    expect(soltadas).toBe(0);
  });

  it('no la suelta por un error del servidor', async () => {
    responderCon(500, '{"message":"Internal server error"}');

    // Un 500 no dice nada de la sesión. Echar a alguien porque la api tuvo un
    // mal minuto le hace volver a entrar para nada.
    await expect(fetchModes()).rejects.toThrow();
    expect(soltadas).toBe(0);
  });

  it('no la suelta cuando ni siquiera había sesión', async () => {
    responderCon(401);
    setCredentialProvider({
      getToken: () => null,
      getDeviceToken: async () => null,
      onUnauthorized: () => {
        soltadas += 1;
      },
    });

    // Este 401 lo lanza el cliente ANTES de pedir nada, y no hay nada que
    // soltar. Contarlo dispararía un `signed_out` en bucle sobre una app que ya
    // está fuera.
    await expect(fetchModes()).rejects.toThrow();
    expect(soltadas).toBe(0);
  });
});
