import { describe, expect, it } from 'vitest';
import {
  SEMAPHORE_COLORBLIND_SAFE,
  SEMAPHORE_DEFAULT,
  makeTheme,
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
  it('usa la paleta estandar por defecto', () => {
    const style = semaphoreStyle(makeTheme(), 'ok');
    expect(style.color).toBe(SEMAPHORE_DEFAULT.ok);
    expect(style.tint).toBe(withAlpha(SEMAPHORE_DEFAULT.ok, 0.12));
  });

  it('cambia toda la paleta con el interruptor de daltonismo', () => {
    const theme = makeTheme({ colorBlindSafe: true });
    expect(semaphoreStyle(theme, 'ok').color).toBe(SEMAPHORE_COLORBLIND_SAFE.ok);
    expect(semaphoreStyle(theme, 'blocked').color).toBe(SEMAPHORE_COLORBLIND_SAFE.bad);
  });

  it('los cuatro niveles tienen color, tinta y degradado', () => {
    const theme = makeTheme();
    for (const level of ['ok', 'warn', 'alert', 'blocked'] as const) {
      const style = semaphoreStyle(theme, level);
      expect(style.color).toMatch(/^#[0-9A-F]{6}$/i);
      expect(style.ink).toMatch(/^#[0-9A-F]{6}$/i);
      expect(style.gradient).toHaveLength(2);
    }
  });

  it('el verde y el rojo de la paleta para daltonismo no se confunden entre si', () => {
    // Sin este contraste el interruptor seria decorativo: lo que separa las dos
    // paletas es que la segura mueve el "ok" al azul, fuera del eje rojo-verde.
    const { ok, bad } = SEMAPHORE_COLORBLIND_SAFE;
    expect(ok).not.toBe(bad);
    expect(blueness(ok)).toBeGreaterThan(blueness(bad));
  });
});

/** Peso del canal azul respecto del rojo: separa un azul de un magenta. */
function blueness(hex: string): number {
  const red = Number.parseInt(hex.slice(1, 3), 16);
  const blue = Number.parseInt(hex.slice(5, 7), 16);
  return blue - red;
}
