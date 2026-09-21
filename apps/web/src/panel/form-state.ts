/**
 * El estado que devuelve una Server Action a su formulario.
 *
 * Vive APARTE de `actions.ts`, y no es orden: un módulo `'use server'` solo
 * puede exportar funciones asíncronas. `IDLE` salía de ahí como una constante y
 * no llegaba entera al cliente, así que `useActionState` arrancaba con un estado
 * cuyo `error` era `undefined` en vez de `null` — y como la pantalla preguntaba
 * `=== null`, pintaba el recuadro de error VACÍO en la primera carga, sin que
 * nadie hubiera enviado nada. Se vio en producción antes que en ninguna prueba:
 * compila, tipa y arranca; solo está mal.
 *
 * Cada acción devuelve el MOTIVO y nunca un booleano, que es la misma regla que
 * el CLAUDE.md pide para el dominio: «no se pudo» deja a quien lo lee sin saber
 * qué corregir.
 */

export interface FormState {
  /** El motivo del rechazo, ya escrito en español. `null` si no hubo. */
  readonly error: string | null;
  /** Mensaje de éxito, cuando la pantalla se queda donde está. */
  readonly ok?: string;
}

export const IDLE: FormState = { error: null };
