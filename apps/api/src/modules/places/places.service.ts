/**
 * Sugerir direcciones mientras el dueno las escribe.
 *
 * El alta pedia la direccion como texto libre y nada mas. Quien la escribe no
 * tiene forma de saber si lo que puso lleva a su puerta, y el directorio la
 * ensena tal cual: una coma de menos y el mapa del alumno apunta a otra cuadra.
 *
 * POR QUE PASA POR AQUI Y NO LA LLAMA LA APP. Las restricciones por aplicacion
 * —bundle id en iOS, huella SHA-1 en Android— solo valen para los SDK nativos.
 * El servicio REST de Places solo admite restriccion por IP, y una clave metida
 * en el binario se extrae de cualquier APK descargado: quedaria de hecho
 * abierta, sobre una api QUE SE FACTURA POR USO. Con el proxy, la clave no sale
 * nunca de Cloud Run.
 *
 * Se usa Places API (New) —`places.googleapis.com`— y no la heredada: es la
 * superficie vigente, devuelve la prediccion y su `placeId` en una sola llamada,
 * y la de detalle obliga a declarar una mascara de campos, que es lo que evita
 * pagar por datos que nadie va a mirar.
 *
 * `regionCode: 'PE'` y `languageCode: 'es'` no son cosmetica: sin ellos una
 * busqueda de "primavera" devuelve calles de media America antes que la avenida
 * de Surco que el dueno esta escribiendo.
 */
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { loadEnv } from '../../config/env';

/** Una sugerencia, ya reducida a lo que la pantalla necesita pintar. */
export interface PlaceSuggestion {
  /** Lo que identifica el sitio para pedir su detalle despues. */
  readonly placeId: string;
  /** La linea gruesa: "Av. Primavera 120". */
  readonly mainText: string;
  /** La fina, debajo: "Surco, Lima, Peru". `null` si Google no la da. */
  readonly secondaryText: string | null;
}

/** El sitio elegido, con lo unico que el alta guarda. */
export interface PlaceDetail {
  readonly address: string;
  readonly latitude: number;
  readonly longitude: number;
}

/**
 * Lima, para sesgar la busqueda sin encerrarla.
 *
 * Es un sesgo (`locationBias`) y NO un filtro (`locationRestriction`) a
 * proposito: un dojo en Arequipa o en Trujillo tiene que poder registrarse. Lo
 * que hace es que, escribiendo tres letras, salga primero lo de Lima — que es
 * donde esta casi todo el padron.
 */
const SESGO_LIMA = {
  circle: {
    center: { latitude: -12.0464, longitude: -77.0428 },
    radius: 50_000.0,
  },
};

/** Diez segundos, igual que el correo: mas alla de eso el dueno ya reescribio. */
const TIMEOUT_MS = 10_000;

@Injectable()
export class PlacesService {
  private readonly logger = new Logger(PlacesService.name);

  /** `false` cuando no hay clave: el buscador se apaga y el alta sigue entera. */
  get disponible(): boolean {
    return loadEnv().GOOGLE_PLACES_API_KEY !== undefined;
  }

  private get clave(): string {
    const clave = loadEnv().GOOGLE_PLACES_API_KEY;
    if (clave === undefined) {
      // No deberia llegar aqui: el controlador comprueba `disponible` antes.
      throw new ServiceUnavailableException('El buscador de direcciones no está configurado.');
    }
    return clave;
  }

  /**
   * Las sugerencias para lo que se ha escrito hasta ahora.
   *
   * Devuelve vacio en vez de fallar cuando Google no contesta. El buscador es
   * una AYUDA: si se cae, el dueno escribe la direccion a mano y mueve el pin,
   * que es el camino que siempre tiene que funcionar. Tumbar el alta porque un
   * servicio de terceros tuvo un mal minuto seria cambiar una comodidad por un
   * registro perdido.
   */
  async suggest(input: string): Promise<readonly PlaceSuggestion[]> {
    const texto = input.trim();
    // Con menos de tres letras Google devuelve ruido y se paga igual.
    if (texto.length < 3) return [];

    try {
      const response = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': this.clave,
        },
        body: JSON.stringify({
          input: texto,
          languageCode: 'es',
          regionCode: 'PE',
          locationBias: SESGO_LIMA,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (!response.ok) {
        this.logger.warn(`Places contestó ${response.status} a una búsqueda.`);
        return [];
      }

      const payload = (await response.json()) as {
        readonly suggestions?: readonly {
          readonly placePrediction?: {
            readonly placeId?: string;
            readonly structuredFormat?: {
              readonly mainText?: { readonly text?: string };
              readonly secondaryText?: { readonly text?: string };
            };
            readonly text?: { readonly text?: string };
          };
        }[];
      };

      const salida: PlaceSuggestion[] = [];
      for (const sugerencia of payload.suggestions ?? []) {
        const prediccion = sugerencia.placePrediction;
        const placeId = prediccion?.placeId;
        // Sin `placeId` no se puede pedir el detalle, asi que la fila no sirve
        // de nada: ofrecerla llevaria a un toque que no hace nada.
        if (prediccion === undefined || placeId === undefined) continue;

        const principal =
          prediccion.structuredFormat?.mainText?.text ?? prediccion.text?.text ?? null;
        if (principal === null) continue;

        salida.push({
          placeId,
          mainText: principal,
          secondaryText: prediccion.structuredFormat?.secondaryText?.text ?? null,
        });
      }
      return salida;
    } catch (error) {
      this.logger.warn(
        `No se pudo buscar direcciones: ${error instanceof Error ? error.message : error}`,
      );
      return [];
    }
  }

  /**
   * El sitio elegido: su direccion formateada y su punto.
   *
   * Aqui SI se falla con un error, al contrario que en `suggest`: el dueno acaba
   * de tocar una sugerencia concreta y espera que se rellene. Devolver vacio en
   * silencio se leeria como que el toque no hizo nada.
   *
   * La mascara de campos es obligatoria en Places (New) y ademas es lo que
   * decide el precio: se piden los tres datos que se guardan y ni uno mas.
   */
  async detail(placeId: string): Promise<PlaceDetail> {
    const response = await fetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
      {
        headers: {
          'X-Goog-Api-Key': this.clave,
          'X-Goog-FieldMask': 'formattedAddress,location',
          'Accept-Language': 'es',
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );

    if (!response.ok) {
      this.logger.warn(`Places contestó ${response.status} al pedir un detalle.`);
      throw new ServiceUnavailableException(
        'No se pudo leer esa dirección. Escríbela a mano y mueve el pin en el mapa.',
      );
    }

    const payload = (await response.json()) as {
      readonly formattedAddress?: string;
      readonly location?: { readonly latitude?: number; readonly longitude?: number };
    };

    const lat = payload.location?.latitude;
    const lng = payload.location?.longitude;
    if (
      payload.formattedAddress === undefined ||
      typeof lat !== 'number' ||
      typeof lng !== 'number'
    ) {
      throw new ServiceUnavailableException(
        'Esa dirección llegó incompleta. Escríbela a mano y mueve el pin en el mapa.',
      );
    }

    return { address: payload.formattedAddress, latitude: lat, longitude: lng };
  }
}
