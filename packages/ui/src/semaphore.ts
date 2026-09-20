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
  mix,
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
  /**
   * Texto secundario DENTRO de una tarjeta tenida: el gris del tema tirado
   * hacia el color del estado. La explicacion larga que acompana al titular
   * —«al confirmar se crea el cargo...»— no puede ir en el color pleno, que
   * grita, ni en el gris pelado, que se despega de la tarjeta.
   */
  readonly mutedInk: string;
  /** Fondo translucido para chips y tarjetas de aviso. */
  readonly tint: string;
  /** Borde translucido, un poco mas presente que el fondo. */
  readonly border: string;
  /** Degradado para pantallas que se tinen completas. */
  readonly gradient: readonly [string, string];
  /**
   * Tinta sobre el degradado. NO es `ink`: el degradado es brillante en los dos
   * temas —ver `TINTED_PAPER`— asi que su tinta es oscura tambien en el claro.
   */
  readonly gradientInk: string;
}

/**
 * El gris del tema tirado hacia un color.
 *
 * Es lo que pinta `SemaphoreStyle.mutedInk`, expuesto aparte para las pantallas
 * que tienen una tarjeta tenida de un color fijo —«al dia», «te quedan tres
 * dias»— y no un nivel del dominio del que sacar un `semaphoreStyle`.
 */
export const mutedOn = (theme: Theme, color: string): string =>
  mix(theme.colors.textSecondary, color, 0.4);

export function semaphoreStyle(theme: Theme, level: AccessLevel): SemaphoreStyle {
  const key = semaphoreKey(level);
  const color = theme.semaphore[key];
  return {
    color,
    ink: theme.semaphoreInk[key],
    mutedInk: mutedOn(theme, color),
    tint: withAlpha(color, 0.12),
    border: withAlpha(color, 0.28),
    gradient: SEMAPHORE_GRADIENT[key],
    gradientInk: theme.semaphoreGradientInk[key],
  };
}
