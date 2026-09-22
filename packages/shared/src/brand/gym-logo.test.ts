import { describe, expect, it } from 'vitest';
import {
  checkGymLogo,
  gymLogoDenialMessage,
  gymLogoPath,
  gymLogoTargetSize,
  GYM_LOGO_MAX_BYTES,
  GYM_LOGO_MAX_SIDE,
} from './gym-logo.js';

const ok = { contentType: 'image/png', sizeBytes: 40_000, width: 512, height: 512 };

describe('qué se acepta', () => {
  it('un PNG o un JPG del tamaño justo', () => {
    expect(checkGymLogo(ok)).toBeNull();
    expect(checkGymLogo({ ...ok, contentType: 'image/jpeg' })).toBeNull();
  });

  /**
   * WebP pesaría menos, pero el logo es candidato a salir en un correo y Outlook
   * no lo pinta. Un SVG, además, puede llevar código dentro.
   */
  it('rechaza lo que no es PNG ni JPG', () => {
    for (const kind of ['image/webp', 'image/svg+xml', 'image/heic', 'application/octet-stream']) {
      expect(checkGymLogo({ ...ok, contentType: kind })?.code, kind).toBe('unsupported_type');
    }
  });

  it('rechaza lo vacío', () => {
    expect(checkGymLogo({ ...ok, sizeBytes: 0 })?.code).toBe('empty');
    expect(checkGymLogo({ ...ok, width: 0 })?.code).toBe('empty');
  });

  it('corta por peso', () => {
    expect(checkGymLogo({ ...ok, sizeBytes: GYM_LOGO_MAX_BYTES })).toBeNull();
    expect(checkGymLogo({ ...ok, sizeBytes: GYM_LOGO_MAX_BYTES + 1 })?.code).toBe('too_large');
  });

  /**
   * El caso que el tope de bytes deja pasar: un PNG de un color comprime a casi
   * nada y al abrirlo ocupa gigas. Es el que cerraría la app de quien mira el
   * directorio.
   */
  it('corta por píxeles aunque pese poco', () => {
    expect(checkGymLogo({ ...ok, sizeBytes: 900, width: 20_000, height: 20_000 })?.code).toBe(
      'too_many_pixels',
    );
    expect(checkGymLogo({ ...ok, width: GYM_LOGO_MAX_SIDE + 1 })?.code).toBe('too_many_pixels');
    expect(checkGymLogo({ ...ok, height: GYM_LOGO_MAX_SIDE + 1 })?.code).toBe('too_many_pixels');
  });

  it('cada motivo tiene su frase', () => {
    for (const code of ['unsupported_type', 'empty', 'too_large', 'too_many_pixels'] as const) {
      expect(gymLogoDenialMessage({ code }).length, code).toBeGreaterThan(10);
    }
  });
});

describe('a qué tamaño se deja', () => {
  it('lo que ya cabe no se toca', () => {
    expect(gymLogoTargetSize(512, 512)).toBeNull();
    expect(gymLogoTargetSize(200, 90)).toBeNull();
  });

  /**
   * Recortar a un cuadrado le cortaría las letras a cualquier logo que sea un
   * nombre escrito.
   */
  it('un logo apaisado sigue apaisado', () => {
    expect(gymLogoTargetSize(4032, 3024)).toEqual({ width: 512, height: 384 });
    expect(gymLogoTargetSize(1200, 300)).toEqual({ width: 512, height: 128 });
  });

  it('uno vertical baja por el alto', () => {
    expect(gymLogoTargetSize(3024, 4032)).toEqual({ width: 384, height: 512 });
  });

  it('lo que devuelve siempre pasa la regla', () => {
    for (const [w, h] of [
      [4033, 3025],
      [513, 1],
      [1, 9999],
      [7777, 7777],
    ] as const) {
      const size = gymLogoTargetSize(w, h)!;
      expect(checkGymLogo({ ...ok, ...size }), `${w}×${h}`).toBeNull();
    }
  });
});

describe('dónde se sirve', () => {
  it('relativa a la base de la api, que ya lleva /v1', () => {
    expect(gymLogoPath('abc')).toBe('/gyms/logos/abc');
  });
});
