/**
 * El estado del formulario de eliminar una cuenta.
 *
 * Aparte de `actions.ts` por la misma razón que `IDLE` vive en `form-state.ts`:
 * un módulo `'use server'` solo puede exportar funciones asíncronas, y una
 * constante exportada desde ahí no llega entera al cliente.
 *
 * No es un `FormState` porque el éxito aquí no es una frase: es el resultado
 * que hay que leer — y, si Firebase no se pudo borrar, un paso que falta dar.
 */
import type { WireDeletionOutcome } from './types';

export interface DeletionState {
  readonly error: string | null;
  readonly outcome: WireDeletionOutcome | null;
}

export const NOTHING_DELETED: DeletionState = { error: null, outcome: null };
