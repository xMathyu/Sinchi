/**
 * El aviso al teléfono de que alguien reservó.
 *
 * El título es el MISMO asunto del correo (`bookingSubject`): el dueño que ve
 * los dos tiene que leer una sola cosa, no dos formas de decirla. El cuerpo es
 * lo que el correo cuenta en su tabla, en una línea: la hora, la clase y lo que
 * hay que hacer, porque una notificación se lee en la pantalla bloqueada y no se
 * abre si no dice para qué.
 */
import { bookingSubject } from '../mail/mail.service';
import type { PushNotice } from './push.service';

export interface BookingNoticeInput {
  readonly bookingId: string;
  readonly kind: 'trial' | 'drop_in' | 'enrollment';
  readonly personName: string;
  readonly klass: string;
  /** "martes 2 de setiembre", ya formateado por quien conoce la zona. */
  readonly when: string;
  readonly time: string;
  /** Lo que esa clase le cuesta —en una inscripción, el primer mes—. 0 = gratis. */
  readonly priceCents: number;
  readonly planName?: string | null;
  readonly rescheduled?: boolean;
}

export function bookingNotice(input: BookingNoticeInput): PushNotice {
  const soles = `S/ ${(input.priceCents / 100).toFixed(2)}`;
  const body =
    input.rescheduled === true
      ? `Ahora a las ${input.time} · ${input.klass}. Es la misma reserva, movida.`
      : input.kind === 'enrollment'
        ? `${input.time} · ${input.klass}${
            input.planName == null ? '' : ` · plan ${input.planName}`
          }. Escríbele desde Reservas para confirmar.`
        : input.kind === 'drop_in'
          ? `${input.time} · ${input.klass} · paga ${soles} al llegar.`
          : `${input.time} · ${input.klass} · ${input.priceCents === 0 ? 'gratis' : `${soles} al llegar`}.`;

  return {
    title: bookingSubject(input),
    body,
    // La pestaña donde se atiende: ahí está su tarjeta, con «Escribirle» y el
    // cobro o la ficha según lo que venga a hacer.
    data: { url: '/staff/trials', bookingId: input.bookingId },
    channelId: 'reservas',
  };
}
