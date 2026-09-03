/**
 * Codigos de promocion: meses de Sinchi de regalo para el gimnasio.
 *
 * No es un descuento sobre el precio, es TIEMPO. Un codigo mueve `free_until`
 * hacia adelante y nada mas; el resto —cuando vence, cuando corta, cuanto
 * cuesta— lo sigue decidiendo `evaluateSaas`, que no sabe que existen los
 * codigos. Un descuento sobre el importe habria obligado a tocar el motor de
 * cobro, que es lo unico que no conviene tocar por una promocion.
 *
 * El tope de usos NO se comprueba aqui: se cierra en la base con un
 * `UPDATE ... WHERE redeemed_count < max_redemptions`. Dos gimnasios canjeando
 * el ultimo uso en el mismo segundo es justo el caso donde un `if` en el codigo
 * regala meses de mas.
 */
import { advanceBillingDate } from '../billing/cycle.js';
import { isAfter, type PlainDate } from '../time/plain-date.js';

/** Tope por codigo. Doce meses regalados ya no es promocion, es otra cosa. */
export const PROMO_MAX_FREE_MONTHS = 12;
export const PROMO_CODE_MIN_LENGTH = 4;
export const PROMO_CODE_MAX_LENGTH = 24;

/**
 * Forma canonica del codigo.
 *
 * Mayusculas y sin nada que no sea letra o numero: el mismo codigo llega escrito
 * "sinchi-2026", "SINCHI 2026" y "Sinchi2026" segun quien lo copie de donde, y
 * las tres tienen que abrir la misma puerta. Se guarda normalizado, asi que el
 * indice unico compara lo mismo que compara la busqueda.
 */
export function normalizePromoCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isWellFormedPromoCode(raw: string): boolean {
  const code = normalizePromoCode(raw);
  return code.length >= PROMO_CODE_MIN_LENGTH && code.length <= PROMO_CODE_MAX_LENGTH;
}

/** Por que no se pudo canjear. Estructurado: quien lo lee tiene que saber si insistir. */
export type PromoDenial =
  | 'malformed'
  | 'not_found'
  | 'inactive'
  | 'expired'
  | 'exhausted'
  | 'already_used';

export function promoDenialMessage(reason: PromoDenial): string {
  switch (reason) {
    case 'malformed':
      return 'Ese código no tiene la forma de un código de Sinchi.';
    case 'not_found':
      return 'Ese código no existe. Revisa que esté bien escrito.';
    case 'inactive':
      return 'Ese código ya no está activo.';
    case 'expired':
      return 'Ese código venció.';
    case 'exhausted':
      return 'Ese código ya se usó todas las veces que podía usarse.';
    case 'already_used':
      return 'Ya usaste ese código en este gimnasio.';
  }
}

/**
 * Hasta cuando queda gratis despues de canjear.
 *
 * `coveredUntil` es lo ULTIMO que el gimnasio ya tiene cubierto: la ultima de
 * `free_until` y `next_billing_date`. Con solo `free_until`, un gimnasio que ya
 * pago un mes canjeaba un codigo y no ganaba nada — se le regalaba un periodo
 * que ya habia comprado.
 *
 * Y cuenta desde HOY si eso ya vencio. Sin eso, un gimnasio cortado canjea y
 * sigue cortado: se le habria sumado un mes a una fecha que ya paso. Al reves
 * —contar siempre desde hoy— le robaria al que canjea temprano los dias que le
 * quedaban.
 */
export function extendedFreeUntil(
  coveredUntil: PlainDate,
  today: PlainDate,
  freeMonths: number,
): PlainDate {
  let end = isAfter(coveredUntil, today) ? coveredUntil : today;
  for (let month = 0; month < freeMonths; month += 1) {
    end = advanceBillingDate(end, { mode: 'anniversary' });
  }
  return end;
}

export interface PromoOutcome {
  readonly freeMonths: number;
  readonly freeUntil: PlainDate;
}

export function describePromo(outcome: PromoOutcome): string {
  return outcome.freeMonths === 1
    ? 'Un mes más de Sinchi gratis.'
    : `${outcome.freeMonths} meses más de Sinchi gratis.`;
}
