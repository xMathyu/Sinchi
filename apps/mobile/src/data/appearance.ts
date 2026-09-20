/**
 * Qué tema quiere ver esta persona.
 *
 * Tres valores y no un booleano, por la misma razón por la que las reglas del
 * dominio devuelven el motivo: «claro» y «el teléfono está en claro» son dos
 * hechos distintos. Quien elige `system` quiere que la app cambie sola cuando
 * cae la noche; quien elige `light` lo quiere claro aunque el teléfono no lo
 * esté. Guardar solo el resultado perdería esa diferencia, y al día siguiente
 * la app dejaría de seguir al teléfono sin que nadie se lo pidiera.
 *
 * Vive fuera de React igual que la sesión y la bienvenida, y por lo mismo: lo
 * lee el layout raíz para decidir el color de la barra de estado y el fondo que
 * tapa el arranque, antes de que haya una pantalla montada.
 *
 * Va al llavero (`expo-secure-store`) porque es el único almacén que la app
 * tiene, no porque sea un secreto. Trae la consecuencia que ya documenta
 * `welcome.ts`: en iOS sobrevive a desinstalar la app.
 */
import * as SecureStore from 'expo-secure-store';

const KEY = 'sinchi.apariencia.v1';

/** `system` sigue al teléfono; los otros dos lo contradicen a propósito. */
export type AppearancePreference = 'system' | 'light' | 'dark';

/**
 * `null` es «todavía no se leyó el llavero», y no es un detalle: mientras no se
 * sepa, la app se pinta con el tema del teléfono. Si la preferencia guardada
 * era la contraria, eso es un parpadeo del tema entero en el arranque — y por
 * eso la portada del layout raíz espera también a esto.
 */
let preference: AppearancePreference | null = null;
const listeners = new Set<() => void>();

function emit(next: AppearancePreference): void {
  preference = next;
  for (const listener of listeners) listener();
}

export function subscribeAppearance(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const getAppearance = (): AppearancePreference | null => preference;

const isPreference = (value: string | null): value is AppearancePreference =>
  value === 'system' || value === 'light' || value === 'dark';

/** Lee el llavero al arrancar. Se llama junto a `restoreSession`. */
export async function restoreAppearance(): Promise<void> {
  try {
    const guardada = await SecureStore.getItemAsync(KEY);
    emit(isPreference(guardada) ? guardada : 'system');
  } catch {
    // Un llavero ilegible no puede dejar la app tapada por la portada para
    // siempre. Seguir al teléfono es el fallo que no le estorba a nadie.
    emit('system');
  }
}

/**
 * La cambia y sigue.
 *
 * Se emite ANTES de escribir, igual que la bienvenida: el tema tiene que
 * cambiar en el toque, no cuando el disco conteste. Si la escritura falla, lo
 * peor que pasa es que en el próximo arranque vuelva a la anterior.
 */
export async function setAppearance(next: AppearancePreference): Promise<void> {
  if (preference === next) return;
  emit(next);
  try {
    await SecureStore.setItemAsync(KEY, next);
  } catch {
    // Ver arriba.
  }
}
