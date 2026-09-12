/**
 * Como llegar al gimnasio, en el mapa que la persona ya usa.
 *
 * El directorio decia el precio, el horario y las disciplinas de cada dojo y
 * callaba lo primero que pregunta quien busca donde entrenar: donde queda. Y
 * decirlo no basta — una direccion escrita obliga a copiarla, abrir otra app y
 * pegarla, que son tres pasos y dos oportunidades de abandonar.
 *
 * TRES MAPAS Y NO UNO porque no hay uno que sirva a todos: en Peru la mitad
 * navega con Waze por el trafico, quien tiene iPhone tiene Apple Maps sin
 * instalar nada, y Google Maps es el que casi todos usan para BUSCAR. Elegir
 * por ellos manda a alguien a instalar una app para ir a una clase de prueba.
 *
 * Se generan enlaces `https://` y no esquemas propios (`waze://`, `comgooglemaps://`):
 *
 *  · el enlace universal abre la app si esta instalada y el navegador si no, que
 *    es exactamente el comportamiento que se quiere. Con el esquema propio, el
 *    boton no hace NADA cuando la app falta, y eso se lee como que la app esta
 *    rota;
 *  · en iOS, `canOpenURL` contra un esquema propio exige declararlo en
 *    `LSApplicationQueriesSchemes` del Info.plist. Un mapa mas seria otro
 *    `prebuild`.
 *
 * Vive en el dominio y no en la pantalla por lo de siempre: lo van a pedir la
 * ficha del gimnasio, la tarjeta del directorio y algun dia el correo de la
 * reserva, y las tres tienen que llevar al mismo sitio.
 */

/** Donde queda un local: el texto, el pin, o los dos. */
export interface GymPlace {
  readonly name: string;
  readonly address: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
}

export type MapApp = 'google' | 'waze' | 'apple';

export const MAP_APP_LABELS: Readonly<Record<MapApp, string>> = {
  google: 'Google Maps',
  waze: 'Waze',
  apple: 'Apple Maps',
};

/**
 * El pin, si el local tiene los DOS numeros.
 *
 * Media coordenada no es medio dato: es un punto en el ecuador o en Greenwich, y
 * el mapa lo dibujaria sin dudar.
 */
export function pinOf(place: GymPlace): { readonly lat: number; readonly lng: number } | null {
  const { latitude: lat, longitude: lng } = place;
  if (lat === null || lng === null) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/**
 * Lo que se le da al mapa para buscar cuando no hay pin.
 *
 * El NOMBRE va delante de la direccion a proposito: los mapas encuentran «Nova
 * BJJ, Av. Primavera 120, Surco» mejor que la direccion sola —el negocio esta
 * fichado— y cuando no lo encuentran, caen en la direccion igual.
 */
function queryOf(place: GymPlace): string | null {
  const address = (place.address ?? '').trim();
  if (address.length === 0) return null;
  const name = place.name.trim();
  return name.length === 0 ? address : `${name}, ${address}`;
}

/** `null` cuando el local no dice ni donde esta: no hay a donde llevar a nadie. */
export function directionsUrl(place: GymPlace, app: MapApp): string | null {
  const pin = pinOf(place);
  const query = queryOf(place);
  if (pin === null && query === null) return null;

  const destino = pin === null ? encodeURIComponent(query!) : `${pin.lat},${pin.lng}`;

  switch (app) {
    case 'google':
      // `api=1` es la forma documentada y estable; sin el, Google resuelve una
      // URL heredada que a veces abre la web en vez de la app.
      return `https://www.google.com/maps/dir/?api=1&destination=${destino}`;
    case 'waze':
      // `ll` toma coordenadas y `q` un texto: no son intercambiables, y pasarle
      // «-12.1,-77.0» a `q` abre una busqueda de ese texto en vez de ir ahi.
      return pin === null
        ? `https://waze.com/ul?q=${destino}&navigate=yes`
        : `https://waze.com/ul?ll=${destino}&navigate=yes`;
    case 'apple':
      // `dirflg=d` es en coche. Sin el, Apple Maps abre el ultimo modo que la
      // persona uso, que puede ser «transporte publico» y no tener ruta.
      return `https://maps.apple.com/?daddr=${destino}&dirflg=d`;
  }
}

/**
 * El mismo sitio, para MIRARLO en vez de para ir.
 *
 * Es lo que hace falta cuando alguien todavia esta decidiendo: «¿esto por donde
 * queda?» es otra pregunta que «llevame», y abrir una navegacion paso a paso
 * para responderla es contestar de mas.
 */
export function placeUrl(place: GymPlace): string | null {
  const pin = pinOf(place);
  if (pin !== null) {
    return `https://www.google.com/maps/search/?api=1&query=${pin.lat},${pin.lng}`;
  }
  const query = queryOf(place);
  return query === null
    ? null
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** Si hay algo que ensenar: sin direccion ni pin, el bloque del mapa sobra. */
export const hasLocation = (place: GymPlace): boolean =>
  pinOf(place) !== null || queryOf(place) !== null;
