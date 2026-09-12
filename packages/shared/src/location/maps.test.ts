import { describe, expect, it } from 'vitest';
import {
  directionsUrl,
  hasLocation,
  pinOf,
  placeUrl,
  type GymPlace,
} from './maps.js';

const NOVA: GymPlace = {
  name: 'Nova BJJ',
  address: 'Av. Primavera 120, Surco',
  latitude: -12.1104,
  longitude: -76.9878,
};

const sinPin: GymPlace = { ...NOVA, latitude: null, longitude: null };
const sinNada: GymPlace = { ...sinPin, address: null };

describe('el pin del gimnasio', () => {
  it('sale solo con los dos números', () => {
    expect(pinOf(NOVA)).toEqual({ lat: -12.1104, lng: -76.9878 });
    expect(pinOf({ ...NOVA, longitude: null })).toBeNull();
    expect(pinOf({ ...NOVA, latitude: null })).toBeNull();
  });

  /**
   * Teclear «-77.0» sin el punto da 770, y el mapa dibujaria ese punto sin
   * dudar. La base lo rechaza con un CHECK; aquí se rechaza otra vez porque
   * estos datos llegan de una api que puede ser más vieja que la app.
   */
  it('descarta un punto que no está en el mapa', () => {
    expect(pinOf({ ...NOVA, longitude: 770 })).toBeNull();
    expect(pinOf({ ...NOVA, latitude: 91 })).toBeNull();
    expect(pinOf({ ...NOVA, latitude: Number.NaN })).toBeNull();
  });
});

describe('cómo llegar', () => {
  it('con pin, los tres mapas llevan a las mismas coordenadas', () => {
    expect(directionsUrl(NOVA, 'google')).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=-12.1104,-76.9878',
    );
    expect(directionsUrl(NOVA, 'waze')).toBe(
      'https://waze.com/ul?ll=-12.1104,-76.9878&navigate=yes',
    );
    expect(directionsUrl(NOVA, 'apple')).toBe(
      'https://maps.apple.com/?daddr=-12.1104,-76.9878&dirflg=d',
    );
  });

  /**
   * `ll` toma coordenadas y `q` un texto, y no son intercambiables: pasarle
   * «-12.1,-77.0» a `q` abre una BÚSQUEDA de ese texto en vez de ir ahí.
   */
  it('sin pin, Waze cambia de parámetro y no solo de valor', () => {
    const url = directionsUrl(sinPin, 'waze')!;
    expect(url).toContain('?q=');
    expect(url).not.toContain('ll=');
    expect(url).toContain('navigate=yes');
  });

  it('sin pin busca por nombre y dirección, con el nombre delante', () => {
    // Los mapas encuentran el negocio fichado mejor que la dirección sola, y
    // cuando no lo encuentran caen en la dirección igual.
    const url = directionsUrl(sinPin, 'google')!;
    expect(decodeURIComponent(url)).toContain('Nova BJJ, Av. Primavera 120, Surco');
  });

  it('escapa lo que escribió el dueño', () => {
    const raro: GymPlace = { ...sinPin, address: 'Jr. Unión 120 & 122, Lima' };
    const url = directionsUrl(raro, 'google')!;
    // Sin escapar, el `&` partiría la URL y el mapa recibiría media dirección.
    expect(url).not.toContain('& 122');
    expect(decodeURIComponent(url)).toContain('Jr. Unión 120 & 122, Lima');
  });

  it('sin dirección ni pin no hay a dónde llevar a nadie', () => {
    expect(directionsUrl(sinNada, 'google')).toBeNull();
    expect(directionsUrl(sinNada, 'waze')).toBeNull();
    expect(directionsUrl(sinNada, 'apple')).toBeNull();
    expect(placeUrl(sinNada)).toBeNull();
    expect(hasLocation(sinNada)).toBe(false);
  });

  it('una dirección en blanco cuenta como ninguna', () => {
    expect(hasLocation({ ...sinPin, address: '   ' })).toBe(false);
  });

  it('con pin pero sin dirección sigue habiendo a dónde ir', () => {
    expect(hasLocation({ ...NOVA, address: null })).toBe(true);
    expect(directionsUrl({ ...NOVA, address: null }, 'google')).toContain('-12.1104');
  });
});

describe('mirar dónde queda, que es otra pregunta que «llévame»', () => {
  it('abre la ficha del sitio y no una navegación paso a paso', () => {
    expect(placeUrl(NOVA)).toBe(
      'https://www.google.com/maps/search/?api=1&query=-12.1104,-76.9878',
    );
    expect(placeUrl(sinPin)).toContain('/maps/search/');
  });
});
