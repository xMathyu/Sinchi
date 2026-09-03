/**
 * RUC peruano.
 *
 * Existe porque `tenants.tax_id` es NOT NULL y el alta del gimnasio es una ruta
 * PUBLICA: sin verificar, cualquiera deja un "11111111111" que nadie corrige
 * despues, y la boleta que ese gimnasio emita sale mal para siempre.
 *
 * Once digitos con digito verificador. Se comprueba de verdad —modulo 11 con
 * los pesos de SUNAT— y no solo la longitud: un tipeo cambia un digito y la
 * longitud sigue siendo once.
 */

/** Pesos de SUNAT para los diez primeros digitos. */
const WEIGHTS: readonly number[] = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

/**
 * Los dos primeros digitos dicen que ES el contribuyente.
 *
 *  10 — persona natural con negocio (el dojo de una sola persona)
 *  15 — persona natural no domiciliada
 *  16 — sucesion indivisa
 *  17 — persona natural sin RUC previo
 *  20 — persona juridica (la asociacion o la S.A.C.)
 *
 * Un gimnasio real cae casi siempre en 10 o en 20; los otros se aceptan porque
 * existen y rechazarlos seria inventar una regla que SUNAT no tiene.
 */
const VALID_PREFIXES: readonly string[] = ['10', '15', '16', '17', '20'];

export const RUC_LENGTH = 11;

/** Quita todo lo que no sea digito: la gente lo escribe con espacios y guiones. */
export function normalizeRuc(raw: string): string {
  return raw.replace(/\D/g, '');
}

export type RucDenial = 'length' | 'prefix' | 'check_digit';

/**
 * `null` si el RUC es valido; el motivo si no.
 *
 * Motivo estructurado y no un booleano, por lo mismo que el rechazo del
 * check-in: quien lo lee esta escribiendo un formulario y "RUC invalido" a secas
 * no le dice si se equivoco de numero o si le falta un digito.
 */
export function checkRuc(raw: string): RucDenial | null {
  const digits = normalizeRuc(raw);
  if (digits.length !== RUC_LENGTH) return 'length';
  if (!VALID_PREFIXES.includes(digits.slice(0, 2))) return 'prefix';

  let sum = 0;
  for (let i = 0; i < WEIGHTS.length; i += 1) {
    sum += Number(digits[i]) * WEIGHTS[i]!;
  }

  // 10 y 11 se pliegan a 0 y 1: es la regla de SUNAT, no un atajo.
  const remainder = 11 - (sum % 11);
  const expected = remainder === 10 ? 0 : remainder === 11 ? 1 : remainder;

  return Number(digits[10]) === expected ? null : 'check_digit';
}

export const isValidRuc = (raw: string): boolean => checkRuc(raw) === null;

export function rucDenialMessage(reason: RucDenial): string {
  switch (reason) {
    case 'length':
      return 'El RUC tiene 11 dígitos.';
    case 'prefix':
      return 'Un RUC empieza por 10, 15, 16, 17 o 20.';
    case 'check_digit':
      return 'Ese RUC no existe: revisa los dígitos.';
  }
}
