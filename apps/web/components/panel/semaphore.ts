/**
 * El color del semáforo, resuelto a una variable CSS.
 *
 * Pasa por `semaphoreKey` de `@sinchi/ui` y no por un `switch` local, que es
 * media línea más corta y la trampa conocida: `blocked` se pinta con el rojo,
 * que la paleta llama `bad`. Escribir esa correspondencia otra vez aquí es como
 * se llega a que un alumno suspendido salga ámbar en el panel y rojo en la app.
 *
 * Devuelve la variable y no el hex porque `app/tokens.ts` ya las inyectó desde
 * el mismo paquete: leer el hex aquí sería una segunda copia de lo mismo.
 */
import { semaphoreKey } from '@sinchi/ui';
import type { AccessLevel } from '@sinchi/shared';

export const semaphoreColor = (level: AccessLevel): string => `var(--${semaphoreKey(level)})`;
