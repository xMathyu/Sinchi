import { describe, expect, it } from 'vitest';
import {
  eventBookingDenialMessage,
  seatsLeft,
  validateEventBooking,
  type EventBookingContext,
} from './validate.js';
import { asId, eventPriceFor, type GymEvent } from '../domain/types.js';
import { fromSoles } from '../money/cents.js';
import { plainDate } from '../time/plain-date.js';

const HOY = plainDate(2026, 9, 3);

function evento(overrides: Partial<GymEvent> = {}): GymEvent {
  return {
    id: asId('event-1'),
    tenantId: asId('tenant-1'),
    name: 'Seminario con Jorge Linares',
    description: 'Tres horas de técnica de boxeo.',
    instructor: 'Jorge Linares',
    date: plainDate(2026, 9, 20),
    startTime: '10:00',
    endTime: '13:00',
    capacity: 30,
    memberPriceCents: fromSoles(80),
    guestPriceCents: fromSoles(120),
    status: 'published',
    ...overrides,
  };
}

function contexto(overrides: Partial<EventBookingContext> = {}): EventBookingContext {
  return {
    gymActive: true,
    event: evento(),
    seatsTaken: 0,
    existing: null,
    isMember: false,
    today: HOY,
    ...overrides,
  };
}

describe('coger plaza', () => {
  it('deja reservar y dice cuánto le toca pagar', () => {
    const r = validateEventBooking(contexto());
    expect(r.allowed).toBe(true);
    if (!r.allowed) return;
    expect(r.priceCents).toBe(fromSoles(120));
  });

  it('al alumno del local le cobra su precio, que es el punto de tener dos', () => {
    const r = validateEventBooking(contexto({ isMember: true }));
    if (!r.allowed) throw new Error('debía dejar');
    expect(r.priceCents).toBe(fromSoles(80));
  });
});

describe('lo que no depende de la persona va primero', () => {
  it('el gimnasio suspendido no recibe reservas', () => {
    const r = validateEventBooking(contexto({ gymActive: false }));
    if (r.allowed) throw new Error('debía rechazar');
    expect(r.reason.code).toBe('gym_unavailable');
  });

  it('un borrador no se puede reservar', () => {
    const r = validateEventBooking(contexto({ event: evento({ status: 'draft' }) }));
    if (r.allowed) throw new Error('debía rechazar');
    expect(r.reason.code).toBe('not_published');
  });

  it('cancelado no es lo mismo que sin publicar, y se dice distinto', () => {
    const r = validateEventBooking(contexto({ event: evento({ status: 'canceled' }) }));
    if (r.allowed) throw new Error('debía rechazar');
    expect(r.reason.code).toBe('event_canceled');
  });

  it('lo que ya pasó no se reserva', () => {
    const r = validateEventBooking(
      contexto({ event: evento({ date: plainDate(2026, 9, 2) }) }),
    );
    if (r.allowed) throw new Error('debía rechazar');
    expect(r.reason.code).toBe('already_over');
  });

  it('el mismo día sigue abierto: a las 19:05 de un evento de las 19:00 se llega', () => {
    const r = validateEventBooking(contexto({ event: evento({ date: HOY }) }));
    expect(r.allowed).toBe(true);
  });
});

describe('cupo', () => {
  it('rechaza cuando se agotaron las plazas', () => {
    const r = validateEventBooking(contexto({ seatsTaken: 30 }));
    if (r.allowed) throw new Error('debía rechazar');
    expect(r.reason.code).toBe('sold_out');
    if (r.reason.code !== 'sold_out') return;
    expect(r.reason.capacity).toBe(30);
  });

  it('la última plaza todavía se coge', () => {
    expect(validateEventBooking(contexto({ seatsTaken: 29 })).allowed).toBe(true);
  });

  it('sin cupo declarado no se llena nunca', () => {
    const abierto = evento({ capacity: null });
    expect(validateEventBooking(contexto({ event: abierto, seatsTaken: 500 })).allowed).toBe(true);
    expect(seatsLeft(abierto, 500)).toBeNull();
  });

  it('cuenta las plazas que quedan', () => {
    expect(seatsLeft(evento(), 28)).toBe(2);
    // Nunca negativo: si el mostrador metió a dos de más, quedan cero, no -2.
    expect(seatsLeft(evento(), 32)).toBe(0);
  });
});

describe('quien ya tiene plaza', () => {
  it('no se le dice que está lleno: ese no es su problema', () => {
    const r = validateEventBooking(
      contexto({ existing: { paid: false }, seatsTaken: 30 }),
    );
    if (r.allowed) throw new Error('debía rechazar');
    expect(r.reason.code).toBe('already_registered');
  });

  it('el mensaje cambia según la haya pagado o no', () => {
    const pagada = validateEventBooking(contexto({ existing: { paid: true } }));
    const sinPagar = validateEventBooking(contexto({ existing: { paid: false } }));
    if (pagada.allowed || sinPagar.allowed) throw new Error('debían rechazar');
    expect(eventBookingDenialMessage(pagada.reason)).toContain('pagada');
    expect(eventBookingDenialMessage(sinPagar.reason)).toContain('mostrador');
  });
});

describe('precio', () => {
  it('sale del evento y no de la pantalla', () => {
    expect(eventPriceFor(evento(), true)).toBe(fromSoles(80));
    expect(eventPriceFor(evento(), false)).toBe(fromSoles(120));
  });
});

describe('mensajes', () => {
  it('todo motivo tiene texto', () => {
    const motivos = [
      { code: 'gym_unavailable' },
      { code: 'not_published' },
      { code: 'event_canceled' },
      { code: 'already_over' },
      { code: 'already_registered', paid: true },
      { code: 'sold_out', capacity: 30 },
    ] as const;
    for (const motivo of motivos) {
      expect(eventBookingDenialMessage(motivo).length).toBeGreaterThan(10);
    }
  });
});
