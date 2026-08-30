import { describe, expect, it } from 'vitest';
import { trialMessage, validateTrialBooking, type TrialBookingContext } from './validate.js';
import { upcomingClassSlots } from './slots.js';
import { makeSchedule } from '../testing/fixtures.js';
import { plainDate } from '../time/plain-date.js';

const JUEVES = plainDate(2026, 8, 20);
const LUNES_19 = makeSchedule(1, '19:00', '20:30', { name: 'Fundamentos' });
const LUNES_QUE_VIENE = plainDate(2026, 8, 24);

const slots = upcomingClassSlots({ schedules: [LUNES_19], today: JUEVES, now: '06:00' });

function contexto(overrides: Partial<TrialBookingContext> = {}): TrialBookingContext {
  return {
    gymActive: true,
    trialOffered: true,
    alreadyMember: false,
    existing: null,
    slots,
    scheduleId: LUNES_19.id,
    date: LUNES_QUE_VIENE,
    ...overrides,
  };
}

describe('reservar la clase gratis', () => {
  it('acepta una clase de las que el gimnasio publica', () => {
    const r = validateTrialBooking(contexto());
    expect(r.allowed).toBe(true);
    if (!r.allowed) return;
    expect(r.slot.name).toBe('Fundamentos');
    expect(r.slot.startTime).toBe('19:00');
  });

  it('rechaza si el gimnasio no ofrece clase gratis', () => {
    const r = validateTrialBooking(contexto({ trialOffered: false }));
    expect(r.allowed).toBe(false);
    if (r.allowed) return;
    expect(r.reason.code).toBe('not_offered');
  });

  it('rechaza si el gimnasio esta suspendido', () => {
    const r = validateTrialBooking(contexto({ gymActive: false }));
    expect(r.allowed).toBe(false);
    if (r.allowed) return;
    expect(r.reason.code).toBe('gym_unavailable');
  });

  it('rechaza a quien ya entrena ahi', () => {
    const r = validateTrialBooking(contexto({ alreadyMember: true }));
    expect(r.allowed).toBe(false);
    if (r.allowed) return;
    expect(r.reason.code).toBe('already_member');
  });

  it('es una por gimnasio, y recuerda cual', () => {
    const r = validateTrialBooking(
      contexto({
        existing: { date: LUNES_QUE_VIENE, startTime: '19:00', className: 'Fundamentos' },
      }),
    );
    expect(r.allowed).toBe(false);
    if (r.allowed) return;
    expect(r.reason.code).toBe('already_booked');
    expect(trialMessage(r.reason).detail).toContain('lunes 24 a las 19:00');
  });

  it('el gimnasio manda antes que la reserva vigente', () => {
    // Quien ya reservo y ve el gimnasio suspendido tiene que leer eso, no
    // "ya tienes una reservada": la salida es distinta.
    const r = validateTrialBooking(
      contexto({
        gymActive: false,
        existing: { date: LUNES_QUE_VIENE, startTime: '19:00', className: 'Fundamentos' },
      }),
    );
    expect(r.allowed).toBe(false);
    if (r.allowed) return;
    expect(r.reason.code).toBe('gym_unavailable');
  });

  it('rechaza una clase que el gimnasio no dicta ese dia', () => {
    const r = validateTrialBooking(contexto({ date: plainDate(2026, 8, 25) }));
    expect(r.allowed).toBe(false);
    if (r.allowed) return;
    expect(r.reason.code).toBe('slot_not_available');
  });

  it('rechaza una fecha ya pasada', () => {
    const r = validateTrialBooking(contexto({ date: plainDate(2026, 8, 17) }));
    expect(r.allowed).toBe(false);
    if (r.allowed) return;
    expect(r.reason.code).toBe('slot_not_available');
  });

  it('cada rechazo dice algo distinto', () => {
    const codigos = ['gym_unavailable', 'not_offered', 'already_member', 'slot_not_available'] as const;
    const titulos = codigos.map((code) => trialMessage({ code }).title);
    expect(new Set(titulos).size).toBe(codigos.length);
  });
});
