/**
 * Quien puede reservar una clase desde el directorio, y por que no.
 *
 * Misma forma que `validateCheckIn`: devuelve un MOTIVO ESTRUCTURADO en vez de
 * un booleano. "No se pudo reservar" deja al interesado sin saber si el problema
 * es que ya la uso, que el gimnasio no la ofrece o que eligio una clase que ya
 * paso — y cada uno tiene una salida distinta.
 *
 * Una sola funcion para los tres tipos —prueba, clase suelta, inscripcion— y no
 * tres, porque el orden de las preguntas es el mismo y lo que cambia es cada
 * respuesta: si lo ofrece lo dice `bookingOffer`, y con que choca lo decide
 * quien consulta la base. Tres funciones casi iguales es como una acaba
 * comprobando el gimnasio despues de la clase y la otra antes.
 *
 * Es una funcion pura y la corren los dos lados: la app para no ofrecer lo que
 * va a fallar, la api para no confiar en que la app lo hizo.
 */
import { weekdayName } from '../checkin/messages.js';
import type { BookingKind } from '../domain/types.js';
import { isoWeekday, type PlainDate } from '../time/plain-date.js';
import type { ClassSlot } from './slots.js';
import { findSlot } from './slots.js';

export type BookingDenialCode =
  | 'gym_unavailable'
  | 'not_offered'
  | 'plan_unavailable'
  | 'already_member'
  | 'already_booked'
  | 'slot_not_available';

export type BookingDenialReason =
  | { readonly code: 'gym_unavailable' }
  | { readonly code: 'not_offered' }
  /** Solo en una inscripcion: el plan elegido ya no se vende. */
  | { readonly code: 'plan_unavailable' }
  | { readonly code: 'already_member' }
  | {
      readonly code: 'already_booked';
      /** La que ya tiene: se la recuerda en vez de decirle que no y ya. */
      readonly date: PlainDate;
      readonly startTime: string;
      readonly className: string;
    }
  | { readonly code: 'slot_not_available' };

export type BookingResult =
  | { readonly allowed: true; readonly slot: ClassSlot }
  | { readonly allowed: false; readonly reason: BookingDenialReason };

/** La reserva que choca con esta, mirada desde aqui. */
export interface ExistingBooking {
  readonly date: PlainDate;
  readonly startTime: string;
  readonly className: string;
}

export interface BookingContext {
  readonly kind: BookingKind;
  /** `false` cuando el gimnasio esta suspendido: no recibe alumnos nuevos. */
  readonly gymActive: boolean;
  /**
   * El gimnasio vende ESTO: la prueba encendida, un precio por clase suelta o,
   * en una inscripcion, el plan elegido entre sus mensualidades. Sale de
   * `bookingOffer`; calcularlo a mano en cada llamador es como la app y la api
   * acaban ofreciendo cosas distintas.
   */
  readonly offered: boolean;
  /**
   * Ya entrena aqui. La prueba es para conocer un local nuevo, la clase suelta
   * de un alumno se cobra en la puerta y quien ya esta inscrito no se inscribe.
   */
  readonly alreadyMember: boolean;
  /**
   * La reserva viva que choca con esta, si la hay. Que cuenta como choque
   * depende del tipo y lo decide la consulta: la prueba es UNA por gimnasio; la
   * inscripcion, una pendiente a la vez; la clase suelta, una por clase.
   */
  readonly existing: ExistingBooking | null;
  /** Las opciones reales, de `upcomingClassSlots`. */
  readonly slots: readonly ClassSlot[];
  /** Lo que la persona eligio. */
  readonly scheduleId: string;
  readonly date: PlainDate;
}

/**
 * El orden importa y es el mismo criterio que en la puerta: primero lo que no
 * depende de la eleccion —el gimnasio, el derecho a pedirlo— y solo al final la
 * clase elegida. Al reves, a alguien que ya uso su clase gratis se le diria "esa
 * clase ya no esta disponible", que no es el problema.
 */
export function validateBooking(context: BookingContext): BookingResult {
  if (!context.gymActive) return { allowed: false, reason: { code: 'gym_unavailable' } };
  if (!context.offered) {
    // En la inscripcion el gimnasio SI inscribe: lo que falta es ese plan, y la
    // salida —elegir otro— es distinta de la de un local que no vende nada.
    return {
      allowed: false,
      reason: { code: context.kind === 'enrollment' ? 'plan_unavailable' : 'not_offered' },
    };
  }
  if (context.alreadyMember) return { allowed: false, reason: { code: 'already_member' } };

  if (context.existing !== null) {
    return {
      allowed: false,
      reason: {
        code: 'already_booked',
        date: context.existing.date,
        startTime: context.existing.startTime,
        className: context.existing.className,
      },
    };
  }

  const slot = findSlot(context.slots, context.scheduleId, context.date);
  if (slot === null) return { allowed: false, reason: { code: 'slot_not_available' } };

  return { allowed: true, slot };
}

export interface BookingMessage {
  readonly title: string;
  readonly detail: string;
}

/**
 * El rechazo, dicho en la voz del interesado.
 *
 * Vive con la regla y no en la pantalla por lo mismo que `accessMessage`: la
 * app y el correo del gimnasio tienen que contar el mismo hecho igual. Recibe el
 * tipo porque «ya tienes una reservada» no significa lo mismo para una prueba
 * —no hay otra— que para una clase suelta —elige otro dia—.
 */
export function bookingMessage(kind: BookingKind, reason: BookingDenialReason): BookingMessage {
  switch (reason.code) {
    case 'gym_unavailable':
      return {
        title: 'Este gimnasio no está recibiendo alumnos',
        detail: 'Vuelve a intentarlo más adelante o escoge otro de la lista.',
      };
    case 'not_offered':
      return kind === 'drop_in'
        ? {
            title: 'Este gimnasio no vende clases sueltas',
            detail: 'Puedes ver sus planes y precios, o escribirles para preguntar.',
          }
        : {
            title: 'Este gimnasio no ofrece clase de prueba',
            detail: 'Puedes ver sus planes y precios, y escribirles para ir de todas formas.',
          };
    case 'plan_unavailable':
      return {
        title: 'Ese plan ya no está disponible',
        detail: 'El gimnasio cambió sus planes hace poco. Elige otro de la lista.',
      };
    case 'already_member':
      return kind === 'trial'
        ? {
            title: 'Ya entrenas aquí',
            detail:
              'La clase de prueba es para conocer un gimnasio nuevo. El tuyo ya está en tu billetera.',
          }
        : kind === 'drop_in'
          ? {
              title: 'Ya entrenas aquí',
              detail: 'Tu plan está en tu billetera: la clase se registra en la puerta.',
            }
          : {
              title: 'Ya estás inscrito aquí',
              detail: 'Tu membresía está en tu billetera. Si quieres otro plan, pídelo desde ella.',
            };
    case 'already_booked': {
      const when = `${reason.className}, ${weekdayName(isoWeekday(reason.date))} ${reason.date.day} a las ${reason.startTime}`;
      return kind === 'trial'
        ? { title: 'Ya tienes tu clase de prueba reservada', detail: `${when}. Es una por gimnasio.` }
        : kind === 'drop_in'
          ? {
              title: 'Ya reservaste esa clase',
              detail: `${when}. Si quieres venir otro día, elige otra hora.`,
            }
          : {
              title: 'Ya reservaste tu inscripción',
              detail: `Tu primera clase: ${when}. Si no puedes ese día, cambia la hora desde tu reserva.`,
            };
    }
    case 'slot_not_available':
      return {
        title: 'Esa clase ya no está disponible',
        detail: 'Puede que acabe de empezar o que el gimnasio haya cambiado su horario. Elige otra.',
      };
  }
}

/**
 * Cambiar la hora de una reserva que ya existe.
 *
 * Lo pidieron los primeros que usaron el directorio, y hasta entonces la unica
 * salida era CANCELAR y volver a reservar: dos pantallas, un aviso que amenaza
 * con perder el cupo y, si entre una cosa y otra alguien mira mal, la reserva
 * perdida de verdad. Nadie que solo queria venir el jueves en vez del martes
 * merece esa escalera — y el gimnasio prefiere mil veces mover la hora a que le
 * cancelen.
 *
 * No es reservar otra vez, y por eso no reutiliza `validateBooking`:
 *
 *  · `existing` no aplica. Esa reserva es justamente la que se esta moviendo, y
 *    la regla de "una por gimnasio" la seguiria cumpliendo porque sigue siendo
 *    UNA;
 *  · `alreadyMember` tampoco. Quien se inscribio entre la reserva y hoy ya no
 *    necesita la clase gratis, pero prohibirle mover la que tiene no le quita
 *    nada a nadie: la alternativa que le queda es no venir;
 *  · `offered` tampoco, por lo mismo que apagar la prueba no cancela lo ya
 *    reservado. El gimnasio ya le prometio una clase; dejar de ofrecerla a los
 *    nuevos no deshace esa promesa, solo decide quien mas la recibe.
 *
 * Lo que SI se comprueba es que el gimnasio siga en pie y que la hora nueva sea
 * una de verdad. Elegir la que ya tiene se permite y no hace nada: es la
 * respuesta correcta a tocar dos veces el mismo boton.
 */
export interface RescheduleContext {
  /** `false` cuando el gimnasio esta suspendido o fuera del directorio. */
  readonly gymActive: boolean;
  /** Las opciones reales, de `upcomingClassSlots`. */
  readonly slots: readonly ClassSlot[];
  /** La hora nueva. */
  readonly scheduleId: string;
  readonly date: PlainDate;
}

export function validateReschedule(context: RescheduleContext): BookingResult {
  if (!context.gymActive) return { allowed: false, reason: { code: 'gym_unavailable' } };

  const slot = findSlot(context.slots, context.scheduleId, context.date);
  if (slot === null) return { allowed: false, reason: { code: 'slot_not_available' } };

  return { allowed: true, slot };
}
