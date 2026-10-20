import type { SaasTier } from '@sinchi/shared';

/** En el orden en que se ofrecen: del gratis al más grande. */
export const TIERS: readonly SaasTier[] = ['free', 'up_to_60', 'up_to_150', 'unlimited'];

/**
 * El escalón, si lo que llegó es uno.
 *
 * Lo que llega por la URL o por un formulario no se cree: un `plan=` cualquiera
 * no se pega en una redirección ni viaja a la api.
 */
export const asTier = (raw: unknown): SaasTier | null =>
  typeof raw === 'string' && (TIERS as readonly string[]).includes(raw) ? (raw as SaasTier) : null;
