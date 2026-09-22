/**
 * Qué imagen es de verdad, leído de sus primeros bytes.
 *
 * El tipo que declara quien sube y la extensión del archivo son texto que
 * escribe el cliente. Lo que se guarda como logo y después se sirve a todo el
 * directorio tiene que ser lo que dicen los BYTES: un PNG empieza por su firma,
 * un JPEG por la suya, y el tamaño está escrito en la cabecera.
 *
 * Solo se lee la cabecera, sin decodificar la imagen. Es a propósito: el tope de
 * píxeles (`GYM_LOGO_MAX_SIDE`) existe para no abrir nunca una imagen gigante, y
 * decodificarla para medirla sería caer justo en eso. Por lo mismo no hay aquí
 * una librería de imágenes: todas las que decodifican son nativas, y la imagen
 * de la api es alpine con `--ignore-scripts`.
 */

export interface ImageHeader {
  readonly contentType: 'image/png' | 'image/jpeg';
  readonly width: number;
  readonly height: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** `null` si no es un PNG ni un JPEG que se pueda medir. */
export function readImageHeader(bytes: Uint8Array): ImageHeader | null {
  return readPng(bytes) ?? readJpeg(bytes);
}

/**
 * PNG: la firma de 8 bytes y, obligatoriamente primero, el bloque IHDR con el
 * ancho y el alto en big-endian.
 */
function readPng(bytes: Uint8Array): ImageHeader | null {
  if (bytes.length < 24) return null;
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return null;
  }
  // "IHDR"
  if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { contentType: 'image/png', width: view.getUint32(16), height: view.getUint32(20) };
}

/**
 * JPEG: se recorren los segmentos hasta el primer SOF, que es el que lleva el
 * tamaño.
 *
 * No está al principio: delante suelen ir los metadatos (EXIF, el perfil de
 * color), y cada segmento dice cuánto mide, así que se salta de uno en uno. Si
 * aparece el comienzo de los datos (SOS) sin haber visto un SOF, el archivo no
 * dice su tamaño y no se acepta.
 */
function readJpeg(bytes: Uint8Array): ImageHeader | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;

  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1]!;

    // Relleno: una racha de 0xFF antes del marcador es válida.
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    // Marcadores sueltos, sin longitud: RST0-7 y TEM.
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      offset += 2;
      continue;
    }
    // Empiezan los datos, o se acaba la imagen, sin haber dicho su tamaño.
    if (marker === 0xda || marker === 0xd9) return null;

    const length = view.getUint16(offset + 2);
    if (length < 2) return null;

    // SOF0-SOF15, menos los tres que comparten rango y no son SOF: DHT (C4),
    // JPG (C8) y DAC (CC).
    const isStartOfFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isStartOfFrame) {
      if (offset + 9 > bytes.length) return null;
      return {
        contentType: 'image/jpeg',
        height: view.getUint16(offset + 5),
        width: view.getUint16(offset + 7),
      };
    }

    offset += 2 + length;
  }
  return null;
}
