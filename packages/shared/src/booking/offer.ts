/**
 * Qué se puede reservar en un gimnasio desde el directorio, y a cuánto.
 *
 * Tres cosas que se piden igual —eligiendo una clase con fecha— y que el
 * gimnasio NO configura por separado: salen de lo que ya escribió. La prueba, de
 * su interruptor y su precio; la clase suelta, de lo que cobra por una clase; la
 * inscripción, de sus mensualidades. Un interruptor más por cada una sería
 * pedirle al dueño que diga dos veces lo que ya dijo al poner los precios, y el
 * día que no coincidieran el directorio ofrecería algo que el mostrador no sabe
 * cobrar.
 *
 * Vive aquí y no en la pantalla porque la corren los dos lados: la app para
 * enseñar solo lo que se puede pedir, la api para rechazar con el mismo criterio
 * lo que llegue de una app vieja.
 */
import { isDropInPlan, type Plan } from '../domain/types.js';
import { cents, type Cents } from '../money/cents.js';

export interface BookingOfferInput {
  readonly trialClassEnabled: boolean;
  /** 0 = gratis. */
  readonly trialClassPriceCents: number;
  /** `tenants.drop_in_price_cents`: lo que cobra el local por una clase suelta. */
  readonly dropInPriceCents: number | null;
  readonly enrollmentFeeCents: number;
  readonly plans: readonly Plan[];
}

export interface BookingOffer {
  /** `null` si el gimnasio no la ofrece. Precio 0 = gratis. */
  readonly trial: { readonly priceCents: Cents } | null;
  /** `null` si no vende clases sueltas a quien no es alumno. */
  readonly dropIn: { readonly priceCents: Cents } | null;
  /** `null` si no tiene ninguna mensualidad con la que inscribirse. */
  readonly enrollment: {
    readonly plans: readonly Plan[];
    readonly enrollmentFeeCents: Cents;
  } | null;
}

export function bookingOffer(input: BookingOfferInput): BookingOffer {
  const active = input.plans.filter((plan) => plan.active);
  // La inscripción es con MENSUALIDAD. Un plan `drop_in` es pagar por clase, y
  // eso desde el directorio ya es la clase suelta: ofrecer las dos cosas para el
  // mismo precio obliga a elegir entre dos botones que hacen lo mismo.
  const monthly = active.filter((plan) => !isDropInPlan(plan));
  const dropIn = dropInClassPrice(active, input.dropInPriceCents);

  return {
    trial: input.trialClassEnabled ? { priceCents: cents(input.trialClassPriceCents) } : null,
    dropIn: dropIn === null ? null : { priceCents: dropIn },
    enrollment:
      monthly.length === 0
        ? null
        : { plans: monthly, enrollmentFeeCents: cents(input.enrollmentFeeCents) },
  };
}

/**
 * Cuánto cuesta UNA clase para quien no es alumno.
 *
 * El plan `drop_in` manda sobre `tenants.drop_in_price_cents`, y no por gusto:
 * son dos precios con el mismo nombre (`docs/glosario.md`). El del plan es justo
 * el de quien no tiene mensualidad —la persona que llega por el directorio—; el
 * del local es el que paga el alumno CON plan que agota su cupo. Solo si el
 * gimnasio no tiene plan por clase se usa el del local, que es además el que su
 * ficha ya anuncia como «Clase suelta».
 *
 * Con precio cero no se ofrece: una clase suelta gratis es una clase de prueba,
 * y esa tiene su propio interruptor y su regla de una por gimnasio.
 */
export function dropInClassPrice(
  plans: readonly Plan[],
  dropInPriceCents: number | null,
): Cents | null {
  const [cheapest] = plans
    .filter((plan) => plan.active && isDropInPlan(plan) && plan.priceCents > 0)
    .map((plan) => plan.priceCents)
    .sort((a, b) => a - b);
  if (cheapest !== undefined) return cheapest;

  return dropInPriceCents !== null && dropInPriceCents > 0 ? cents(dropInPriceCents) : null;
}

/** Si hay algo que reservar. Decide si la ficha trae horas con fecha. */
export const offersAnything = (offer: BookingOffer): boolean =>
  offer.trial !== null || offer.dropIn !== null || offer.enrollment !== null;
