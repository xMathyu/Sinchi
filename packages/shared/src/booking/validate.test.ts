import { describe, expect, it } from 'vitest';
import {
  bookingMessage,
  validateBooking,
  validateReschedule,
  type BookingContext,
  type BookingDenialCode,
} from './validate.js';
import { upcomingClassSlots } from './slots.js';
import { makeSchedule } from '../testing/fixtures.js';
import { plainDate } from '../time/plain-date.js';

const JUEVES = plainDate(2026, 8, 20);
const LUNES_19 = makeSchedule(1, '19:00', '20:30', { name: 'Fundamentos' });
const NEXT_MONDAY = plainDate(2026, 8, 24);
const LA_DEL_LUNES = { date: NEXT_MONDAY, startTime: '19:00', className: 'Fundamentos' };

const slots = upcomingClassSlots({ schedules: [LUNES_19], today: JUEVES, now: '06:00' });

function contexto(overrides: Partial<BookingContext> = {}): BookingContext {
  return {
    kind: 'trial',
    gymActive: true,
    offered: true,
    alreadyMember: false,
    existing: null,
    slots,
    scheduleId: LUNES_19.id,
    date: NEXT_MONDAY,
    ...overrides,
  };
}

describe('reservar la clase de prueba', () => {
  it('acepta una clase de las que el gimnasio publica', () => {
    const r = validateBooking(contexto());
    expect(r.allowed).toBe(true);
    if (!r.allowed) return;
    expect(r.slot.name).toBe('Fundamentos');
    expect(r.slot.startTime).toBe('19:00');
  });

  it('rechaza si el gimnasio no ofrece clase de prueba', () => {
    const r = validateBooking(contexto({ offered: false }));
    expect(r.allowed).toBe(false);
    if (r.allowed) return;
    expect(r.reason.code).toBe('not_offered');
  });

  it('rechaza si el gimnasio esta suspendido', () => {
    const r = validateBooking(contexto({ gymActive: false }));
    expect(r.allowed).toBe(false);
    if (r.allowed) return;
    expect(r.reason.code).toBe('gym_unavailable');
  });

  it('rechaza a quien ya entrena ahi', () => {
    const r = validateBooking(contexto({ alreadyMember: true }));
    expect(r.allowed).toBe(false);
    if (r.allowed) return;
    expect(r.reason.code).toBe('already_member');
  });

  it('es una por gimnasio, y recuerda cual', () => {
    const r = validateBooking(contexto({ existing: LA_DEL_LUNES }));
    expect(r.allowed).toBe(false);
    if (r.allowed) return;
    expect(r.reason.code).toBe('already_booked');
    expect(bookingMessage('trial', r.reason).detail).toContain('lunes 24 a las 19:00');
  });

  it('el gimnasio manda antes que la reserva vigente', () => {
    // Quien ya reservo y ve el gimnasio suspendido tiene que leer eso, no
    // "ya tienes una reservada": la salida es distinta.
    const r = validateBooking(contexto({ gymActive: false, existing: LA_DEL_LUNES }));
    expect(r.allowed).toBe(false);
    if (r.allowed) return;
    expect(r.reason.code).toBe('gym_unavailable');
  });

  it('rechaza una clase que el gimnasio no dicta ese dia', () => {
    const r = validateBooking(contexto({ date: plainDate(2026, 8, 25) }));
    expect(r.allowed).toBe(false);
    if (r.allowed) return;
    expect(r.reason.code).toBe('slot_not_available');
  });

  it('rechaza una fecha ya pasada', () => {
    const r = validateBooking(contexto({ date: plainDate(2026, 8, 17) }));
    expect(r.allowed).toBe(false);
    if (r.allowed) return;
    expect(r.reason.code).toBe('slot_not_available');
  });

  it('cada rechazo dice algo distinto', () => {
    const codes = ['gym_unavailable', 'not_offered', 'already_member', 'slot_not_available'] as const;
    const titulos = codes.map((code) => bookingMessage('trial', { code }).title);
    expect(new Set(titulos).size).toBe(codes.length);
  });
});

/**
 * La clase suelta desde el directorio.
 *
 * Existe porque en un gimnasio sin clase de prueba la ficha no ofrecia nada que
 * hacer, y quien solo queria venir a una clase —pagandola— tenia que presentarse
 * sin avisar.
 */
describe('reservar una clase suelta', () => {
  const suelta = (overrides: Partial<BookingContext> = {}) =>
    contexto({ kind: 'drop_in', ...overrides });

  it('acepta una clase publicada de un gimnasio que vende clases sueltas', () => {
    expect(validateBooking(suelta()).allowed).toBe(true);
  });

  it('sin precio por clase no se vende, y lo dice asi', () => {
    const r = validateBooking(suelta({ offered: false }));
    expect(r.allowed).toBe(false);
    if (r.allowed) return;
    expect(r.reason.code).toBe('not_offered');
    // No «no ofrece clase de prueba»: quien pidio una clase suelta no pregunto
    // por la prueba, y ese texto le haria creer que eligio mal el boton.
    expect(bookingMessage('drop_in', r.reason).title).toContain('clases sueltas');
  });

  it('la misma clase dos veces no, y le invita a elegir otro dia', () => {
    const r = validateBooking(suelta({ existing: LA_DEL_LUNES }));
    expect(r.allowed).toBe(false);
    if (r.allowed) return;
    expect(r.reason.code).toBe('already_booked');
    expect(bookingMessage('drop_in', r.reason).detail).toContain('otra hora');
  });

  it('al alumno de casa se le cobra en la puerta, no por aqui', () => {
    const r = validateBooking(suelta({ alreadyMember: true }));
    expect(r.allowed).toBe(false);
    if (r.allowed) return;
    expect(bookingMessage('drop_in', r.reason).detail).toContain('puerta');
  });
});

/**
 * La inscripcion desde el directorio.
 *
 * Reserva la PRIMERA clase con un plan; la ficha la hace recepcion el dia que la
 * persona llega, y su mensualidad cuenta desde ese dia (migracion 0022).
 */
describe('reservar la inscripcion', () => {
  const inscripcion = (overrides: Partial<BookingContext> = {}) =>
    contexto({ kind: 'enrollment', ...overrides });

  it('acepta un plan que el gimnasio vende, con la clase elegida', () => {
    const r = validateBooking(inscripcion());
    expect(r.allowed).toBe(true);
    if (!r.allowed) return;
    expect(r.slot.startTime).toBe('19:00');
  });

  it('un plan que ya no se vende dice eso, no que el gimnasio no inscribe', () => {
    const r = validateBooking(inscripcion({ offered: false }));
    expect(r.allowed).toBe(false);
    if (r.allowed) return;
    // La salida es elegir otro plan de la misma lista, no irse a otro gimnasio.
    expect(r.reason.code).toBe('plan_unavailable');
  });

  it('una inscripcion pendiente recuerda cual es su primera clase', () => {
    const r = validateBooking(inscripcion({ existing: LA_DEL_LUNES }));
    expect(r.allowed).toBe(false);
    if (r.allowed) return;
    const message = bookingMessage('enrollment', r.reason);
    expect(message.detail).toContain('Tu primera clase');
    expect(message.detail).toContain('lunes 24');
  });

  it('quien ya esta inscrito no se inscribe otra vez', () => {
    const r = validateBooking(inscripcion({ alreadyMember: true }));
    expect(r.allowed).toBe(false);
    if (r.allowed) return;
    expect(bookingMessage('enrollment', r.reason).title).toBe('Ya estás inscrito aquí');
  });

  it('sus rechazos tambien dicen cosas distintas', () => {
    const codes: readonly BookingDenialCode[] = [
      'gym_unavailable',
      'plan_unavailable',
      'already_member',
      'slot_not_available',
    ];
    const titulos = codes.map(
      (code) => bookingMessage('enrollment', { code } as Parameters<typeof bookingMessage>[1]).title,
    );
    expect(new Set(titulos).size).toBe(codes.length);
  });
});

describe('mover una reserva a otra hora', () => {
  const JUEVES_19 = makeSchedule(4, '19:00', '20:30', { name: 'Sparring' });
  const twoClasses = upcomingClassSlots({
    schedules: [LUNES_19, JUEVES_19],
    today: JUEVES,
    now: '06:00',
  });
  const NEXT_THURSDAY = plainDate(2026, 8, 27);

  it('acepta otra hora publicada del mismo gimnasio', () => {
    const r = validateReschedule({
      gymActive: true,
      slots: twoClasses,
      scheduleId: JUEVES_19.id,
      date: NEXT_THURSDAY,
    });
    expect(r.allowed).toBe(true);
    if (!r.allowed) return;
    expect(r.slot.name).toBe('Sparring');
    expect(r.slot.startTime).toBe('19:00');
  });

  /**
   * Es LA diferencia con reservar, y la razon de que esta funcion exista.
   *
   * `validateBooking` contesta `already_booked` en cuanto hay una reserva
   * vigente —la prueba es una por gimnasio— y eso, aplicado a mover la hora,
   * prohibe justo lo que se esta pidiendo. Quien quiere venir el jueves en vez
   * del martes acababa cancelando y reservando de nuevo, con el cupo en el aire
   * entre una cosa y otra.
   */
  it('no la rechaza por tener ya una reserva: es esa la que se mueve', () => {
    const asBooking = validateBooking(
      contexto({
        slots: twoClasses,
        scheduleId: JUEVES_19.id,
        date: NEXT_THURSDAY,
        existing: LA_DEL_LUNES,
      }),
    );
    expect(asBooking.allowed).toBe(false);

    const asReschedule = validateReschedule({
      gymActive: true,
      slots: twoClasses,
      scheduleId: JUEVES_19.id,
      date: NEXT_THURSDAY,
    });
    expect(asReschedule.allowed).toBe(true);
  });

  it('deja quedarse en la misma hora sin quejarse', () => {
    // Tocar dos veces el mismo boton no es un error: es la respuesta correcta.
    const r = validateReschedule({
      gymActive: true,
      slots: twoClasses,
      scheduleId: LUNES_19.id,
      date: NEXT_MONDAY,
    });
    expect(r.allowed).toBe(true);
  });

  it('rechaza una hora que el gimnasio no dicta', () => {
    const r = validateReschedule({
      gymActive: true,
      slots: twoClasses,
      scheduleId: LUNES_19.id,
      date: plainDate(2026, 8, 25),
    });
    expect(r.allowed).toBe(false);
    if (r.allowed) return;
    expect(r.reason.code).toBe('slot_not_available');
  });

  it('no deja mover nada en un gimnasio suspendido', () => {
    const r = validateReschedule({
      gymActive: false,
      slots: twoClasses,
      scheduleId: JUEVES_19.id,
      date: NEXT_THURSDAY,
    });
    expect(r.allowed).toBe(false);
    if (r.allowed) return;
    expect(r.reason.code).toBe('gym_unavailable');
  });
});
