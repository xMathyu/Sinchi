/**
 * Quien puede ver una rutina, y por que no.
 *
 * Es la regla que el dueno compra: **cada rutina decide su publico**. Unas son
 * el escaparate —el video que hace que alguien que no entrena en ningun sitio
 * elija este dojo— y otras son la razon de seguir pagando la mensualidad. Un
 * gimnasio que solo pudiera publicar hacia fuera regala su contenido; uno que
 * solo pudiera guardarlo no lo usa nunca para traer gente. Por eso la
 * visibilidad va en la RUTINA y no en el gimnasio.
 *
 * Quien es `member` es la otra mitad de la decision, y esta escrita a proposito
 * asi: **suscripcion viva, sin mirar la deuda**. Al moroso ya se le cierra la
 * puerta, que es la palanca que cobra; quitarle ademas el video no recupera un
 * sol —servirlo no le cuesta nada al gimnasio— y le quita justo lo unico que lo
 * mantiene atado a la escuela mientras junta la plata. Lo que si cierra la
 * biblioteca es la BAJA: quien se dio de baja dejo de ser alumno. Quien traduce
 * eso a una consulta es `RoutinesService.viewerForMembership`.
 *
 * Devuelve un motivo estructurado y no un booleano, como `validateCheckIn` y
 * `validateEventBooking`: "no puedes verlo" deja a la persona sin saber si le
 * falta entrar con su cuenta, si tiene que apuntarse al gimnasio, o si el video
 * todavia no existe — y cada una tiene una salida distinta. La de
 * `members_only` es, ademas, la unica pantalla del producto donde alguien de
 * fuera esta mirando algo que quiere: ahi el motivo ES el argumento de venta.
 */
import type { Routine } from '../domain/types.js';

/**
 * Con que ojos se mira la biblioteca.
 *
 * `staff` es quien trabaja en el local: ve tambien los borradores, porque son
 * suyos. `member` entrena en ESTE gimnasio, aunque deba. `visitor` es cualquiera,
 * incluida la persona sin cuenta que abrio la ficha del directorio.
 */
export type RoutineViewer = 'staff' | 'member' | 'visitor';

export type RoutineAccessDenialCode = 'not_published' | 'members_only';

export interface RoutineAccessDenial {
  readonly code: RoutineAccessDenialCode;
}

/** El motivo, o `null` si puede verla. */
export function checkRoutineAccess(
  routine: Pick<Routine, 'status' | 'visibility'>,
  viewer: RoutineViewer,
): RoutineAccessDenial | null {
  // El borrador es del local: se escribe en tres tardes y no tiene por que
  // ensenarselo a nadie a medio hacer.
  if (viewer === 'staff') return null;
  if (routine.status !== 'published') return { code: 'not_published' };
  if (routine.visibility === 'members' && viewer !== 'member') {
    return { code: 'members_only' };
  }
  return null;
}

export const canSeeRoutine = (
  routine: Pick<Routine, 'status' | 'visibility'>,
  viewer: RoutineViewer,
): boolean => checkRoutineAccess(routine, viewer) === null;

/**
 * Lo que este publico puede ver de una biblioteca entera.
 *
 * Existe para que ninguna pantalla ni ninguna ruta filtre a mano: la lista y la
 * ficha tienen que estar de acuerdo, o alguien acaba viendo un titulo que al
 * tocarlo le dice que no.
 */
export const visibleRoutines = <T extends Pick<Routine, 'status' | 'visibility'>>(
  routines: readonly T[],
  viewer: RoutineViewer,
): readonly T[] => routines.filter((routine) => canSeeRoutine(routine, viewer));

/**
 * Cuantas se esta perdiendo quien mira desde fuera.
 *
 * Es el numero que convierte: "12 rutinas mas para alumnos" dicho en la ficha
 * del gimnasio vende la mensualidad mejor que cualquier texto, y ensenar el
 * TITULO de lo que no puede ver seria regalar la mitad del valor.
 */
export const membersOnlyCount = (
  routines: readonly Pick<Routine, 'status' | 'visibility'>[],
): number =>
  routines.filter((r) => r.status === 'published' && r.visibility === 'members').length;

export function routineAccessMessage(denial: RoutineAccessDenial): {
  readonly title: string;
  readonly detail: string;
} {
  switch (denial.code) {
    case 'not_published':
      return {
        title: 'Todavía no está publicada',
        detail: 'El gimnasio la está preparando.',
      };
    case 'members_only':
      return {
        title: 'Es contenido de alumnos',
        detail:
          'Los alumnos de este gimnasio lo ven completo desde su app. Prueba una clase y entra al padrón.',
      };
  }
}
