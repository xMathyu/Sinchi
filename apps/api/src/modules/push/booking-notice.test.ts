/**
 * El aviso de reserva: lo que se lee en la pantalla bloqueada del dueño.
 */
import { describe, expect, it } from 'vitest';
import { bookingNotice, type BookingNoticeInput } from './booking-notice';
import { bookingSubject } from '../mail/mail.service';

const base: BookingNoticeInput = {
  bookingId: 'b-1',
  kind: 'enrollment',
  personName: 'Ana Quispe',
  klass: 'Karate adultos',
  when: 'martes 29 de setiembre',
  time: '19:00',
  priceCents: 18_000,
  planName: 'Ilimitado',
};

describe('bookingNotice', () => {
  it('el título es el mismo asunto del correo', () => {
    for (const kind of ['trial', 'drop_in', 'enrollment'] as const) {
      expect(bookingNotice({ ...base, kind }).title).toBe(bookingSubject({ ...base, kind }));
    }
  });

  it('la inscripción dice el plan y qué hacer', () => {
    expect(bookingNotice(base).body).toBe(
      '19:00 · Karate adultos · plan Ilimitado. Escríbele desde Reservas para confirmar.',
    );
  });

  it('la prueba dice si es gratis o cuánto se cobra al llegar', () => {
    expect(bookingNotice({ ...base, kind: 'trial', priceCents: 0 }).body).toBe(
      '19:00 · Karate adultos · gratis.',
    );
    expect(bookingNotice({ ...base, kind: 'trial', priceCents: 4_000 }).body).toBe(
      '19:00 · Karate adultos · S/ 40.00 al llegar.',
    );
  });

  it('un cambio de hora dice que es la misma reserva', () => {
    const notice = bookingNotice({ ...base, rescheduled: true });
    expect(notice.title).toContain('Cambio de hora');
    expect(notice.body).toContain('la misma reserva');
  });

  it('abre Reservas, en el canal de reservas', () => {
    const notice = bookingNotice(base);
    expect(notice.data).toEqual({ url: '/staff/trials', bookingId: 'b-1' });
    expect(notice.channelId).toBe('reservas');
  });
});
