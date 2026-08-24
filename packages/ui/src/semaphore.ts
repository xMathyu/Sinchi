/**
 * Traduccion del semaforo del dominio a tratamiento visual.
 *
 * El nivel lo decide `@sinchi/shared` (`AccessLevel`), no la pantalla. Aqui
 * solo se resuelve como se pinta, de modo que la app del alumno y la del staff
 * no puedan discrepar de color para el mismo hecho.
 */
import type { AccessLevel } from '@sinchi/shared';
import {
  SEMAPHORE_GRADIENT,
  SEMAPHORE_INK,
  type SemaphorePalette,
  type Theme,
  withAlpha,
} from './tokens.js';

/** Llave de la paleta. `blocked` usa el rojo, que la paleta llama `bad`. */
export type SemaphoreKey = keyof SemaphorePalette;

const LEVEL_TO_KEY: Readonly<Record<AccessLevel, SemaphoreKey>> = {
  ok: 'ok',
  warn: 'warn',
  alert: 'alert',
  blocked: 'bad',
};

export const semaphoreKey = (level: AccessLevel): SemaphoreKey => LEVEL_TO_KEY[level];

export interface SemaphoreStyle {
  /** Color pleno: punto, borde, barra lateral. */
  readonly color: string;
  /** Tinta legible sobre el color pleno. */
  readonly ink: string;
  /** Fondo translucido para chips y tarjetas de aviso. */
  readonly tint: string;
  /** Borde translucido, un poco mas presente que el fondo. */
  readonly border: string;
  /** Degradado para pantallas que se tinen completas. */
  readonly gradient: readonly [string, string];
}

export function semaphoreStyle(theme: Theme, level: AccessLevel): SemaphoreStyle {
  const key = semaphoreKey(level);
  const color = theme.semaphore[key];
  return {
    color,
    ink: SEMAPHORE_INK[key],
    tint: withAlpha(color, 0.12),
    border: withAlpha(color, 0.28),
    gradient: SEMAPHORE_GRADIENT[key],
  };
}
