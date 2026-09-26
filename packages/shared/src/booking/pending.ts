/**
 * La inscripción que todavía espera su ficha.
 *
 * Es la reserva que más vale y la que menos se notaba: alguien que eligió plan
 * desde el directorio y viene a pagar un mes. En la lista del mostrador se veía
 * igual que una prueba, salvo por una etiqueta gris, y un gimnasio lo dijo con
 * todas las letras: «que sea más intuitivo de verlo en la app».
 *
 * Una sola definición para los tres sitios que la cuentan —la insignia de
 * Reservas, el aviso de la puerta y la sección de arriba de la lista—: si cada
 * uno filtrara a su manera, la insignia diría 2 y la lista enseñaría 1.
 *
 * Solo las que siguen `booked`. La que el mostrador marcó «no vino» ya la miró
 * alguien, y contarla la dejaría encendida para siempre en una insignia que
 * nadie puede apagar.
 */
import type { ClassBooking } from '../domain/types.js';

export function awaitsEnrollment(
  booking: Pick<ClassBooking, 'kind' | 'status' | 'membershipId'>,
): boolean {
  return (
    booking.kind === 'enrollment' &&
    booking.status === 'booked' &&
    // `??` porque la app se actualiza sola y la api no: una anterior a la 0022
    // no manda el campo. Tampoco manda `kind`, así que ahí ya no llega.
    (booking.membershipId ?? null) === null
  );
}
