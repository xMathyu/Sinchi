/**
 * Si esta persona ya vio la bienvenida.
 *
 * Un solo booleano, pero vive fuera de React por lo mismo que la sesión: quien
 * lo consulta es `SessionRouter`, que decide a dónde va la app antes de que
 * haya una pantalla montada.
 *
 * Va al llavero y no a un almacén plano porque es el único que tiene la app
 * (`expo-secure-store`). No es un secreto —da igual quién lo lea— y trae una
 * consecuencia que conviene saber: en iOS el llavero **sobrevive a desinstalar
 * la app**, así que reinstalarla no vuelve a enseñar la bienvenida. Es el
 * comportamiento que se quiere (nadie quiere volver a verla), pero hay que
 * recordarlo al probar: se limpia con `xcrun simctl keychain booted reset`.
 */
import * as SecureStore from 'expo-secure-store';

const KEY = 'sinchi.bienvenida.v1';

/**
 * `cargando` no es un detalle: hasta saberlo no se puede enrutar. Mandar al
 * login y corregir un instante después es justo el parpadeo que la portada
 * existe para evitar.
 */
export type EstadoBienvenida = 'cargando' | 'pendiente' | 'vista';

let estado: EstadoBienvenida = 'cargando';
const listeners = new Set<() => void>();

function emit(next: EstadoBienvenida): void {
  estado = next;
  for (const listener of listeners) listener();
}

export function subscribeBienvenida(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const getBienvenida = (): EstadoBienvenida => estado;

/** Lee el llavero al arrancar. Se llama junto a `restoreSession`. */
export async function restaurarBienvenida(): Promise<void> {
  try {
    emit((await SecureStore.getItemAsync(KEY)) === null ? 'pendiente' : 'vista');
  } catch {
    // Un llavero ilegible no puede dejar la app tapada por la portada para
    // siempre. Ante la duda se da por vista: de los dos errores posibles, no
    // enseñar la bienvenida es el que no le estorba a nadie.
    emit('vista');
  }
}

/**
 * La marca como vista y sigue.
 *
 * El estado se emite ANTES de escribir a propósito: la navegación no tiene por
 * qué esperar al disco, y si la escritura falla lo peor que pasa es que la
 * bienvenida vuelva a salir en el próximo arranque.
 */
export async function marcarBienvenidaVista(): Promise<void> {
  if (estado === 'vista') return;
  emit('vista');
  try {
    await SecureStore.setItemAsync(KEY, new Date().toISOString());
  } catch {
    // Ver arriba.
  }
}
