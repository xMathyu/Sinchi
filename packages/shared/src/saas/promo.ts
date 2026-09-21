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

// ---------------------------------------------------------------------------
// El codigo antes de existir
// ---------------------------------------------------------------------------

/**
 * Un codigo tal como lo escribe quien administra Sinchi.
 *
 * Nacio para la linea de comandos (`saas:promo new`), donde la validacion era
 * un `throw` con su frase. Desde que hay pantalla hace falta lo mismo en los dos
 * lados: el formulario apaga el boton por el mismo motivo por el que la api
 * responde 400, o se llenan cuatro campos para que te digan que no al final.
 */
export interface PromoDraft {
  readonly code: string;
  readonly freeMonths: number;
  /** `null` = sin tope de usos, y tiene que ser una decision (ver abajo). */
  readonly maxRedemptions: number | null;
  /** Hasta cuando se puede canjear. `null` = no vence. */
  readonly expiresOn: PlainDate | null;
}

export type PromoDraftDenial =
  | 'malformed_code'
  | 'months_out_of_range'
  | 'max_redemptions_invalid'
  | 'already_expired';

/** `null` si el codigo se puede crear; el motivo si no. */
export function checkPromoDraft(draft: PromoDraft, today: PlainDate): PromoDraftDenial | null {
  if (!isWellFormedPromoCode(draft.code)) return 'malformed_code';

  if (!Number.isInteger(draft.freeMonths)) return 'months_out_of_range';
  if (draft.freeMonths < 1 || draft.freeMonths > PROMO_MAX_FREE_MONTHS) {
    return 'months_out_of_range';
  }

  /**
   * El tope: un entero positivo, o `null` a proposito.
   *
   * `null` es «sin tope», y es una promocion que regala meses a todo el que pase
   * el codigo a un grupo de WhatsApp. Se acepta —a veces es lo que se quiere—
   * pero tiene que escribirse, no salir de un campo vacio.
   */
  if (draft.maxRedemptions !== null) {
    if (!Number.isInteger(draft.maxRedemptions) || draft.maxRedemptions < 1) {
      return 'max_redemptions_invalid';
    }
  }

  // Un codigo que ya vencio se puede crear sin que nada falle y no canjea nunca:
  // se reparte, nadie lo puede usar, y el dia que alguien se queja hay que
  // mirar la columna para entender por que.
  if (draft.expiresOn !== null && isAfter(today, draft.expiresOn)) return 'already_expired';

  return null;
}

export function promoDraftDenialMessage(reason: PromoDraftDenial): string {
  switch (reason) {
    case 'malformed_code':
      return `El código va entre ${PROMO_CODE_MIN_LENGTH} y ${PROMO_CODE_MAX_LENGTH} letras o números.`;
    case 'months_out_of_range':
      return `Los meses de regalo van de 1 a ${PROMO_MAX_FREE_MONTHS}.`;
    case 'max_redemptions_invalid':
      return 'El tope de usos es un número entero de 1 en adelante, o sin tope.';
    case 'already_expired':
      return 'Esa fecha de vencimiento ya pasó: el código no se podría canjear nunca.';
  }
}

/** Cuántos usos le quedan, o `null` si no tiene tope. */
export function promoUsesLeft(promo: {
  readonly maxRedemptions: number | null;
  readonly redeemedCount: number;
}): number | null {
  if (promo.maxRedemptions === null) return null;
  return Math.max(0, promo.maxRedemptions - promo.redeemedCount);
}
