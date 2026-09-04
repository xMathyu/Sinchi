import { describe, expect, it } from 'vitest';
import {
  checkVideoUpload,
  formatMegabytes,
  isVideoContentType,
  videoObjectPath,
  videoUploadDenialMessage,
  VIDEO_MAX_BYTES,
} from './upload.js';

describe('qué se acepta', () => {
  it('lo que graba un celular', () => {
    for (const tipo of ['video/mp4', 'video/quicktime', 'video/x-m4v', 'video/webm']) {
      expect(checkVideoUpload({ contentType: tipo }), tipo).toBeNull();
    }
  });

  /**
   * Es lo que manda medio mundo cuando no sabe qué es, y aceptarlo convierte el
   * bucket del gimnasio en un sitio donde subir cualquier cosa.
   */
  it('rechaza octet-stream y cualquier cosa que no sea video', () => {
    expect(checkVideoUpload({ contentType: 'application/octet-stream' })?.code).toBe(
      'unsupported_type',
    );
    expect(checkVideoUpload({ contentType: 'image/png' })?.code).toBe('unsupported_type');
    expect(isVideoContentType('application/pdf')).toBe(false);
  });

  it('corta por tamaño cuando se sabe, y no cuando no', () => {
    expect(checkVideoUpload({ contentType: 'video/mp4', sizeBytes: 5_000_000 })).toBeNull();
    expect(checkVideoUpload({ contentType: 'video/mp4', sizeBytes: VIDEO_MAX_BYTES + 1 })?.code).toBe(
      'too_large',
    );
    expect(checkVideoUpload({ contentType: 'video/mp4', sizeBytes: 0 })?.code).toBe('empty');
    // Sin tamaño se deja pasar: lo comprueba el almacenamiento al recibirlo.
    expect(checkVideoUpload({ contentType: 'video/mp4' })).toBeNull();
  });

  it('el mensaje del tamaño ofrece la salida, no solo el no', () => {
    expect(videoUploadDenialMessage({ code: 'too_large' })).toContain('YouTube');
  });
});

describe('dónde se guarda', () => {
  /**
   * «../../otro-gimnasio/kata.mp4» es un nombre de archivo perfectamente válido.
   * Aquí no hay nada que sanear porque no entra nada del cliente.
   */
  it('la ruta se deriva del gimnasio y del id, nunca del nombre del archivo', () => {
    const ruta = videoObjectPath('t-1', 'v-9', 'video/mp4');
    expect(ruta).toBe('gyms/t-1/routines/v-9.mp4');
    expect(videoObjectPath('t-1', 'v-9', 'video/quicktime')).toBe('gyms/t-1/routines/v-9.mov');
  });

  /**
   * El gimnasio va delante para que borrar un local sea borrar un prefijo: es
   * la única forma barata de cumplir un «borren mis datos».
   */
  it('agrupa por gimnasio', () => {
    expect(videoObjectPath('t-1', 'v-9', 'video/mp4').startsWith('gyms/t-1/')).toBe(true);
  });

  it('la extensión la decide el tipo, y termina como un archivo de video', () => {
    // Es lo que hace que `parseVideoLink` lo clasifique como reproducible.
    expect(videoObjectPath('t', 'v', 'video/webm').endsWith('.webm')).toBe(true);
  });
});

describe('el peso dicho al dueño', () => {
  it('en MB con un decimal', () => {
    expect(formatMegabytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatMegabytes(157_286_400)).toBe('150.0 MB');
  });
});
