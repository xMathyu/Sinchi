/**
 * Enlace entre la sesión y React.
 *
 * Igual que el store: `useSyncExternalStore` en vez de un contexto con estado. La
 * sesión la leen el layout raíz —para enrutar por rol— y el cliente HTTP, que no
 * es un componente. Meterla en un contexto obligaría a que todo lo que la
 * necesita esté dentro del árbol de React, y el cliente HTTP no lo está.
 */
import { useSyncExternalStore } from 'react';
import type { AppRole } from '@sinchi/shared';
import { getSessionState, subscribeSession, type SessionState } from './session';

export function useSession(): SessionState {
  return useSyncExternalStore(subscribeSession, getSessionState, getSessionState);
}

/** Atajo para las pantallas que solo quieren saber con qué rol se entró. */
export function useRole(): AppRole | null {
  const state = useSession();
  return state.status === 'signed_in' ? state.session.role : null;
}
