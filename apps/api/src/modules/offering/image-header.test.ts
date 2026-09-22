import { describe, expect, it } from 'vitest';
import { readImageHeader } from './image-header';

/** 3 × 2, RGBA. Hecho con zlib, sin ningún editor de por medio. */
const PNG_3X2 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAYAAACddGYaAAAAEUlEQVR4nGO4oqX1H4YZkDkApnkM6wkw3uoAAAAASUVORK5CYII=',
  'base64',
);

/**
 * El mismo 3 × 2 pasado a JPEG por `sips`, el conversor de macOS. Lleva EXIF y
 * un bloque de Photoshop DELANTE del tamaño, que es como llega una foto de
 * verdad: por eso hay que saltar segmentos para encontrarlo.
 */
const JPEG_3X2 = Buffer.from(
  '/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAA6ADAAQAAAABAAAAAgAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAAgADAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQAAf/aAAwDAQACEQMRAD8A+c6KKK/Cz/VQ/9k=',
  'base64',
);

/** Una cabecera PNG que dice medir lo que se le pida, sin la imagen detrás. */
function pngHeader(width: number, height: number): Buffer {
  const header = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0);
  header.writeUInt32BE(13, 8);
  header.write('IHDR', 12, 'ascii');
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return header;
}

describe('lo que se reconoce', () => {
  it('un PNG, con su tamaño', () => {
    expect(readImageHeader(PNG_3X2)).toEqual({ contentType: 'image/png', width: 3, height: 2 });
  });

  it('un JPEG con metadatos delante del tamaño', () => {
    expect(readImageHeader(JPEG_3X2)).toEqual({ contentType: 'image/jpeg', width: 3, height: 2 });
  });

  /**
   * Es la bomba de descompresión: la cabecera dice 20.000 × 20.000 y el archivo
   * pesa nada. Se mide sin abrirla, que es todo el punto.
   */
  it('mide sin decodificar, aunque la imagen diga ser enorme', () => {
    expect(readImageHeader(pngHeader(20_000, 20_000))).toEqual({
      contentType: 'image/png',
      width: 20_000,
      height: 20_000,
    });
  });

  it('lee el Buffer aunque sea una vista dentro de otro más grande', () => {
    const grande = Buffer.concat([Buffer.alloc(100, 7), PNG_3X2]);
    expect(readImageHeader(grande.subarray(100))).toMatchObject({ width: 3, height: 2 });
  });
});

describe('lo que no', () => {
  it('lo que no empieza como imagen', () => {
    expect(readImageHeader(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(readImageHeader(Buffer.from('GIF89a......'))).toBeNull();
    expect(readImageHeader(Buffer.alloc(0))).toBeNull();
  });

  it('un PNG cortado antes de su tamaño', () => {
    expect(readImageHeader(PNG_3X2.subarray(0, 20))).toBeNull();
  });

  it('un PNG cuyo primer bloque no es IHDR', () => {
    const roto = Buffer.from(PNG_3X2);
    roto.write('IDAT', 12, 'ascii');
    expect(readImageHeader(roto)).toBeNull();
  });

  it('un JPEG cortado antes de decir su tamaño', () => {
    // El SOF de este archivo empieza en el byte 156, detrás del EXIF.
    expect(readImageHeader(JPEG_3X2.subarray(0, 150))).toBeNull();
    expect(readImageHeader(JPEG_3X2.subarray(0, 160))).toBeNull();
  });

  it('un JPEG que empieza los datos sin haber dicho su tamaño', () => {
    // SOI y directamente SOS.
    expect(readImageHeader(Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x08, 0, 0, 0, 0]))).toBeNull();
  });

  it('un segmento con una longitud imposible no deja el bucle girando', () => {
    expect(readImageHeader(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00, 0, 0]))).toBeNull();
  });
});
