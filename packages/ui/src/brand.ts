/**
 * Marca Sinchi.
 *
 * El simbolo es una punta de lanza atravesada por una barra: la lectura es
 * "guerrero" (sinchi, en quechua) y a la vez el nudo del cinturon. Funciona a
 * 17px en una tarjeta y a 200px en una pantalla completa, que es el rango real
 * de uso en la app.
 *
 * Se expone como datos de SVG para que la app (react-native-svg) y el panel web
 * dibujen exactamente la misma forma.
 */

export const LOGO_VIEWBOX = '0 0 100 100';

/** Contorno de la punta de lanza. */
export const LOGO_OUTLINE_PATH = 'M50 8 L88 92 L50 71 L12 92 Z';

/** Barra que la cruza. Se pinta del color del fondo, no del de la marca. */
export const LOGO_BAR_PATH = 'M31 51 H69';
export const LOGO_BAR_WIDTH = 11;

/** Palabra marca, siempre en versalitas con tracking negativo. */
export const WORDMARK = 'SINCHI';
export const WORDMARK_TRACKING_RATIO = -0.045;

/** Marca de agua que deriva de fondo en las pantallas tenidas del diseno. */
export const WATERMARK_TILES = 24;
