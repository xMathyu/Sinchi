/**
 * El buscador de direcciones es una AYUDA, y eso decide cómo falla.
 *
 * Las dos ramas que se prueban aquí son las que deciden si un alta se pierde:
 * sin clave configurada y con Google caído, tiene que devolver vacío y dejar que
 * el dueño escriba la dirección a mano y mueva el pin. Cambiar eso por una
 * excepción convertiría un servicio de terceros con un mal minuto en un registro
 * que no se completa.
 *
 * No necesita clave ni red: se sustituye `fetch`. Por eso corre en cada commit,
 * al contrario que los e2e, que piden una base.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetEnvCache } from '../../config/env';
import { PlacesService } from './places.service';

/**
 * `loadEnv()` valida el entorno ENTERO y cachea el resultado.
 *
 * Instanciar el servicio fuera del arranque de Nest lo hacia reventar con
 * «DATABASE_URL: Required» antes de llegar a mirar Places, y el fallo se leia
 * como un problema del buscador. Asi que cada caso parte de un entorno minimo
 * valido y tira la cache: es lo que `resetEnvCache` existe para hacer.
 */
const ENTORNO_MINIMO = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/d',
  JWT_SECRET: 'x'.repeat(48),
  ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
};

const fetchOriginal = globalThis.fetch;

/** Cuántas veces se llamó de verdad a Places. Lo que no se llama, no se paga. */
let llamadas = 0;

function responderCon(status: number, body: unknown): void {
  llamadas = 0;
  globalThis.fetch = (async () => {
    llamadas += 1;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as unknown as Response;
  }) as typeof globalThis.fetch;
}

beforeEach(() => {
  Object.assign(process.env, ENTORNO_MINIMO);
  process.env.GOOGLE_PLACES_API_KEY = 'una-clave-de-prueba-suficientemente-larga';
  resetEnvCache();
  llamadas = 0;
});

afterEach(() => {
  globalThis.fetch = fetchOriginal;
  // La cache es de modulo: dejarla puesta contaminaria los e2e, que cargan su
  // propia configuracion.
  resetEnvCache();
});

describe('sugerir direcciones', () => {
  it('traduce las predicciones a lo que la pantalla pinta', async () => {
    responderCon(200, {
      suggestions: [
        {
          placePrediction: {
            placeId: 'abc123',
            structuredFormat: {
              mainText: { text: 'Av. Primavera 120' },
              secondaryText: { text: 'Surco, Lima' },
            },
          },
        },
      ],
    });

    const found = await new PlacesService().suggest('Av. Primavera 120');

    expect(found).toEqual([
      { placeId: 'abc123', mainText: 'Av. Primavera 120', secondaryText: 'Surco, Lima' },
    ]);
  });

  it('descarta la predicción sin placeId: ofrecerla sería un toque que no hace nada', async () => {
    responderCon(200, {
      suggestions: [
        { placePrediction: { structuredFormat: { mainText: { text: 'Sin id' } } } },
        {
          placePrediction: {
            placeId: 'ok',
            structuredFormat: { mainText: { text: 'Con id' } },
          },
        },
      ],
    });

    const found = await new PlacesService().suggest('algo');

    expect(found.map((s) => s.placeId)).toEqual(['ok']);
  });

  it('con menos de tres letras no llama a Places: eso se paga igual', async () => {
    responderCon(200, { suggestions: [] });

    expect(await new PlacesService().suggest('av')).toEqual([]);
    expect(llamadas).toBe(0);
  });

  it('si Google falla devuelve vacío, no tumba el alta', async () => {
    responderCon(500, {});

    // El dueño sigue pudiendo escribir la dirección y mover el pin. Perder el
    // registro porque el buscador tuvo un mal minuto sería cambiar una comodidad
    // por un gimnasio que no se da de alta.
    await expect(new PlacesService().suggest('Av. Arequipa')).resolves.toEqual([]);
  });

  it('sin clave configurada queda apagado', async () => {
    delete process.env.GOOGLE_PLACES_API_KEY;
    resetEnvCache();
    // El controlador lo consulta antes de responder: sin clave devuelve la lista
    // vacia, y el alta sigue entera con la direccion a mano y el pin del mapa.
    expect(new PlacesService().disponible).toBe(false);
  });
});

describe('el detalle del sitio elegido', () => {
  it('devuelve la dirección y el punto', async () => {
    responderCon(200, {
      formattedAddress: 'Av. Arequipa 3150, Lince, Perú',
      location: { latitude: -12.0889, longitude: -77.0356 },
    });

    const detail = await new PlacesService().detail('xyz');

    expect(detail.address).toBe('Av. Arequipa 3150, Lince, Perú');
    expect(detail.latitude).toBeCloseTo(-12.0889, 4);
    expect(detail.longitude).toBeCloseTo(-77.0356, 4);
  });

  /**
   * Aquí SÍ se falla, al contrario que en `suggest`: el dueño acaba de tocar una
   * sugerencia concreta y espera que el campo se rellene. Quedarse callado se
   * leería como que el toque no hizo nada.
   */
  it('falla con un mensaje que dice qué hacer cuando llega incompleto', async () => {
    responderCon(200, { formattedAddress: 'Solo el texto, sin punto' });

    await expect(new PlacesService().detail('xyz')).rejects.toThrow(/pin/i);
  });
});
