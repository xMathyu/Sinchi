import { describe, expect, it } from 'vitest';
import { canonicalVideoUrl, isValidVideoLink, parseVideoLink } from './video.js';

describe('YouTube', () => {
  it('entiende las cuatro formas en que la gente pega un enlace', () => {
    const formas = [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ',
      'https://www.youtube.com/shorts/dQw4w9WgXcQ',
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
    ];
    for (const forma of formas) {
      expect(parseVideoLink(forma)?.url).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    }
  });

  /**
   * El caso real: el dueno copia de la barra del navegador y se lleva la lista
   * de reproduccion y el segundo por el que iba. Guardado tal cual, el uchimata
   * empieza por la mitad.
   */
  it('deja fuera la lista y el minuto de la barra del navegador', () => {
    expect(canonicalVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL9&t=42')).toBe(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    );
    expect(canonicalVideoUrl('https://youtu.be/dQw4w9WgXcQ?t=42')).toBe(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    );
  });

  it('acepta la v del movil y la que llega con el parametro detras', () => {
    expect(parseVideoLink('https://m.youtube.com/watch?v=dQw4w9WgXcQ')?.provider).toBe('youtube');
    expect(parseVideoLink('https://www.youtube.com/watch?app=desktop&v=dQw4w9WgXcQ')?.provider).toBe(
      'youtube',
    );
  });

  it('saca miniatura sin subir ninguna imagen', () => {
    const video = parseVideoLink('https://youtu.be/dQw4w9WgXcQ');
    expect(video?.thumbnailUrl).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
    expect(video?.embedUrl).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ');
  });

  it('un id que no mide once no es un id', () => {
    expect(parseVideoLink('https://youtu.be/corto')).toBeNull();
  });
});

describe('Vimeo', () => {
  it('entiende la pagina y el reproductor', () => {
    expect(parseVideoLink('https://vimeo.com/123456789')?.url).toBe('https://vimeo.com/123456789');
    expect(parseVideoLink('https://player.vimeo.com/video/123456789')?.url).toBe(
      'https://vimeo.com/123456789',
    );
  });

  it('no promete una miniatura que hay que ir a buscar a su api', () => {
    expect(parseVideoLink('https://vimeo.com/123456789')?.thumbnailUrl).toBeNull();
  });
});

/**
 * Es lo que hace que el video se vea DENTRO de la app: YouTube y Vimeo no
 * sirven el archivo y hay que embeber su reproductor; un `.mp4` se reproduce
 * con el nativo, que trae pantalla completa y velocidad.
 */
describe('cómo se reproduce', () => {
  it('YouTube y Vimeo se embeben', () => {
    expect(parseVideoLink('https://youtu.be/dQw4w9WgXcQ')?.playback).toBe('embed');
    expect(parseVideoLink('https://vimeo.com/123456789')?.playback).toBe('embed');
  });

  it('un archivo de video se reproduce nativo', () => {
    for (const ext of ['mp4', 'm4v', 'mov', 'webm', 'm3u8']) {
      const video = parseVideoLink(`https://videos.sinchi.pe/kaizen/uchimata.${ext}`);
      expect(video?.provider, ext).toBe('file');
      expect(video?.playback, ext).toBe('file');
    }
  });

  /**
   * El caso que importa cuando el gimnasio SUBE el video: una URL firmada trae
   * media docena de parámetros detrás, y mirando la cadena entera el `.mp4`
   * queda tapado y el video se abriría en el navegador en vez de reproducirse.
   */
  it('reconoce el archivo aunque venga firmado, con la query detrás', () => {
    const firmada =
      'https://storage.googleapis.com/sinchi-videos/kaizen/uchimata.mp4' +
      '?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Expires=3600&X-Goog-Signature=abc';
    expect(parseVideoLink(firmada)?.playback).toBe('file');
  });

  it('lo que no se puede reproducir se abre fuera', () => {
    expect(parseVideoLink('https://drive.google.com/file/d/abc/view')?.playback).toBe('external');
  });
});

describe('cualquier otro enlace', () => {
  it('se acepta y se abre en el navegador', () => {
    const video = parseVideoLink('https://drive.google.com/file/d/abc/view');
    expect(video?.provider).toBe('link');
    expect(video?.embedUrl).toBeNull();
    expect(video?.thumbnailUrl).toBeNull();
  });

  /**
   * iOS bloquea el trafico en claro. Un `http://` guardado hoy es un video que
   * no se ve manana en medio padron, y el sitio donde eso se arregla barato es
   * el formulario, con el dueno delante.
   */
  it('rechaza http a secas', () => {
    expect(parseVideoLink('http://midojo.pe/uchimata.mp4')).toBeNull();
  });

  it('rechaza lo que no es una direccion', () => {
    expect(parseVideoLink('uchimata')).toBeNull();
    expect(parseVideoLink('')).toBeNull();
    expect(parseVideoLink('   ')).toBeNull();
    expect(parseVideoLink('javascript:alert(1)')).toBeNull();
    expect(parseVideoLink('https://sinpunto')).toBeNull();
  });

  it('rechaza una cadena absurdamente larga', () => {
    expect(isValidVideoLink(`https://midojo.pe/${'x'.repeat(600)}`)).toBe(false);
  });
});

/**
 * Lo encontró el test, no la lectura: `youtu.be/corto` no cae por el patrón de
 * YouTube y se colaba por el cajón de «cualquier enlace https». Se habría
 * guardado un enlace roto que solo falla el día que un alumno lo toca.
 */
describe('la dirección de un sitio conocido que no lleva a un video', () => {
  it('no se guarda como enlace genérico', () => {
    expect(parseVideoLink('https://youtu.be/corto')).toBeNull();
    expect(parseVideoLink('https://www.youtube.com/watch?v=nomide11')).toBeNull();
    expect(parseVideoLink('https://vimeo.com/12')).toBeNull();
  });

  it('un canal o una lista tampoco: el alumno esperaba una técnica', () => {
    expect(parseVideoLink('https://www.youtube.com/@midojoperu')).toBeNull();
    expect(parseVideoLink('https://www.youtube.com/playlist?list=PL9abc')).toBeNull();
  });
});
