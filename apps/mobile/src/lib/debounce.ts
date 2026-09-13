/**
 * Un valor que espera a que dejes de teclear.
 *
 * Lo pide el buscador de direcciones del alta, y ahi no es una cuestion de
 * rendimiento: cada busqueda que sale de la app es una llamada a Places, **y
 * Places se factura por uso**. Sin esto, escribir "Av. Primavera 120" son
 * diecinueve busquedas para una sola direccion — dieciocho de ellas de un texto
 * que nadie queria buscar todavia.
 *
 * 350 ms es el hueco entre dos teclas de alguien escribiendo de corrido y la
 * pausa de quien ya termino. Mas corto vuelve a pagar por prefijos; mas largo se
 * siente lento justo cuando la persona espera la lista.
 */
import { useEffect, useState } from 'react';

export const DEBOUNCE_MS = 350;

export function useDebounced<T>(value: T, delay: number = DEBOUNCE_MS): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    // Cada tecla cancela el reloj anterior: por eso solo sobrevive la ultima
    // pausa, y no una busqueda por letra.
    return () => clearTimeout(timer);
  }, [value, delay]);

  return settled;
}
