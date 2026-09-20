import { describe, expect, it } from 'vitest';
import {
  COLORS_DARK,
  COLORS_LIGHT,
  SEMAPHORE_INK_ON_DARK,
  SEMAPHORE_ON_DARK,
  SEMAPHORE_ON_LIGHT,
  makeTheme,
  mix,
  withAlpha,
} from './tokens.js';
import { semaphoreKey, semaphoreStyle } from './semaphore.js';

describe('withAlpha', () => {
  it('convierte hex a rgba', () => {
    expect(withAlpha('#2FD16D', 0.12)).toBe('rgba(47,209,109,0.12)');
  });

  it('acepta hex de tres digitos', () => {
    expect(withAlpha('#FFF', 1)).toBe('rgba(255,255,255,1)');
  });

  it('deja pasar un color que ya no es hex', () => {
    expect(withAlpha('rgba(0,0,0,0.5)', 0.2)).toBe('rgba(0,0,0,0.5)');
  });
});

describe('mix', () => {
  it('a cero devuelve el primero y a uno el segundo', () => {
    expect(mix('#000000', '#FFFFFF', 0)).toBe('#000000');
    expect(mix('#000000', '#FFFFFF', 1)).toBe('#ffffff');
  });

  it('a la mitad cae en medio de cada canal', () => {
    expect(mix('#000000', '#FFFFFF', 0.5)).toBe('#808080');
  });

  it('deja pasar un color que no es hex', () => {
    expect(mix('rgba(0,0,0,0.5)', '#FFFFFF', 0.5)).toBe('rgba(0,0,0,0.5)');
  });
});

describe('semaphoreKey', () => {
  it('mapea el nivel del dominio a la llave de la paleta', () => {
    expect(semaphoreKey('ok')).toBe('ok');
    expect(semaphoreKey('warn')).toBe('warn');
    expect(semaphoreKey('alert')).toBe('alert');
    // El dominio lo llama `blocked`; la paleta, `bad`.
    expect(semaphoreKey('blocked')).toBe('bad');
  });
});

describe('semaphoreStyle', () => {
  it('usa la paleta del tema oscuro por defecto', () => {
    const style = semaphoreStyle(makeTheme(), 'ok');
    expect(style.color).toBe(SEMAPHORE_ON_DARK.ok);
    expect(style.tint).toBe(withAlpha(SEMAPHORE_ON_DARK.ok, 0.12));
  });

  it('cambia toda la paleta con el tema claro', () => {
    const theme = makeTheme({ scheme: 'light' });
    expect(semaphoreStyle(theme, 'ok').color).toBe(SEMAPHORE_ON_LIGHT.ok);
    expect(semaphoreStyle(theme, 'blocked').color).toBe(SEMAPHORE_ON_LIGHT.bad);
  });

  it('los cuatro niveles tienen color, tinta y degradado', () => {
    for (const scheme of ['dark', 'light'] as const) {
      const theme = makeTheme({ scheme });
      for (const level of ['ok', 'warn', 'alert', 'blocked'] as const) {
        const style = semaphoreStyle(theme, level);
        expect(style.color).toMatch(/^#[0-9A-F]{6}$/i);
        expect(style.ink).toMatch(/^#[0-9A-F]{6}$/i);
        expect(style.mutedInk).toMatch(/^#[0-9A-F]{6}$/i);
        expect(style.gradient).toHaveLength(2);
      }
    }
  });

  it('el degradado y su tinta no siguen al tema', () => {
    // La pantalla de la puerta se pinta del color del estado en los dos temas:
    // se lee a un metro y es lo mismo de dia que de noche. Si el degradado
    // empezara a seguir al tema, el mismo veredicto tendria dos caras.
    const oscuro = semaphoreStyle(makeTheme(), 'blocked');
    const claro = semaphoreStyle(makeTheme({ scheme: 'light' }), 'blocked');
    expect(claro.gradient).toEqual(oscuro.gradient);
    expect(claro.gradientInk).toBe(SEMAPHORE_INK_ON_DARK.bad);
    expect(oscuro.gradientInk).toBe(SEMAPHORE_INK_ON_DARK.bad);
  });
});

describe('las dos paletas', () => {
  it('tienen exactamente los mismos tokens', () => {
    // La interfaz `Palette` ya lo obliga al compilar; esto lo sostiene tambien
    // para quien lea los valores en tiempo de ejecucion.
    expect(Object.keys(COLORS_LIGHT).sort()).toEqual(Object.keys(COLORS_DARK).sort());
  });

  it('el semaforo claro es legible sobre la superficie mas clara', () => {
    // Es la razon de existir de la segunda paleta: el verde brillante sobre una
    // tarjeta blanca da 1.9:1 y deja de ser texto.
    for (const key of ['ok', 'warn', 'alert', 'bad'] as const) {
      expect(contrast(SEMAPHORE_ON_LIGHT[key], COLORS_LIGHT.surfaceRaised)).toBeGreaterThan(4.5);
    }
  });

  it('el suelo de texto pasa AA sobre todas las superficies de su tema', () => {
    const superficies = [
      'canvas',
      'screen',
      'screenScanner',
      'surface',
      'surfaceSunken',
      'surfaceMuted',
      'surfaceRaised',
      'surfaceHigh',
      'surfaceHigher',
    ] as const;
    for (const paleta of [COLORS_DARK, COLORS_LIGHT]) {
      for (const superficie of superficies) {
        expect(contrast(paleta.textTertiary, paleta[superficie])).toBeGreaterThan(4.5);
      }
    }
  });
});

/** Contraste WCAG entre dos hex. */
function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

function luminance(hex: string): number {
  const channel = (i: number): number => {
    const value = Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}
