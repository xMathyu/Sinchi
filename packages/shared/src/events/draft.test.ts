import { describe, expect, it } from 'vitest';
import {
  checkEventDraft,
  eventDenialMessage,
  EVENT_CAPACITY_MAX,
  EVENT_PRICE_MAX_CENTS,
  type EventDraft,
} from './draft.js';
import { fromSoles } from '../money/cents.js';
import { plainDate } from '../time/plain-date.js';

const HOY = plainDate(2026, 9, 3);

function borrador(overrides: Partial<EventDraft> = {}): EventDraft {
  return {
    name: 'Seminario con Jorge Linares',
    description: 'Tres horas de técnica de boxeo.',
    instructor: 'Jorge Linares',
    date: plainDate(2026, 9, 20),
    startTime: '10:00',
    endTime: '13:00',
    capacity: 30,
    memberPriceCents: fromSoles(80),
    guestPriceCents: fromSoles(120),
    ...overrides,
  };
}

describe('nombre y descripción', () => {
  it('acepta uno normal', () => {
    expect(checkEventDraft(borrador(), HOY)).toBeNull();
  });

  it('exige un nombre que diga algo', () => {
    expect(checkEventDraft(borrador({ name: 'x' }), HOY)).toBe('name_too_short');
    expect(checkEventDraft(borrador({ name: '   ' }), HOY)).toBe('name_too_short');
  });

  it('acota lo que cabe en la columna', () => {
    expect(checkEventDraft(borrador({ name: 'x'.repeat(81) }), HOY)).toBe('name_too_long');
    expect(checkEventDraft(borrador({ description: 'x'.repeat(601) }), HOY)).toBe(
      'description_too_long',
    );
  });

  it('la descripción y el invitado pueden faltar', () => {
    expect(checkEventDraft(borrador({ description: null, instructor: null }), HOY)).toBeNull();
  });
});

describe('precios', () => {
  it('acepta gratis: hay seminarios de cortesía', () => {
    expect(
      checkEventDraft(borrador({ memberPriceCents: 0, guestPriceCents: 0 }), HOY),
    ).toBeNull();
  });

  it('no deja que el del alumno sea negativo', () => {
    expect(checkEventDraft(borrador({ memberPriceCents: -1 }), HOY)).toBe('price_negative');
  });

  it('caza el tipeo en cualquiera de los dos', () => {
    expect(
      checkEventDraft(borrador({ guestPriceCents: EVENT_PRICE_MAX_CENTS + 1 }), HOY),
    ).toBe('price_too_high');
    expect(checkEventDraft(borrador({ memberPriceCents: 80.5 }), HOY)).toBe('price_not_integer');
  });

  it('deja cobrarle MENOS a quien viene de fuera: es decisión del gimnasio', () => {
    expect(
      checkEventDraft(
        borrador({ memberPriceCents: fromSoles(120), guestPriceCents: fromSoles(80) }),
        HOY,
      ),
    ).toBeNull();
  });
});

describe('cupo', () => {
  it('vacío significa sin límite', () => {
    expect(checkEventDraft(borrador({ capacity: null }), HOY)).toBeNull();
  });

  it('cero plazas no es un cupo, es un evento que nadie puede reservar', () => {
    expect(checkEventDraft(borrador({ capacity: 0 }), HOY)).toBe('capacity_not_positive');
  });

  it('un cupo absurdo es un tipeo', () => {
    expect(checkEventDraft(borrador({ capacity: EVENT_CAPACITY_MAX + 1 }), HOY)).toBe(
      'capacity_too_high',
    );
  });
});

describe('fecha y hora', () => {
  it('la hora de fin va después de la de inicio', () => {
    expect(checkEventDraft(borrador({ startTime: '19:00', endTime: '18:00' }), HOY)).toBe(
      'ends_before_it_starts',
    );
    expect(checkEventDraft(borrador({ startTime: '19:00', endTime: '19:00' }), HOY)).toBe(
      'ends_before_it_starts',
    );
  });

  it('no se publica algo que ya pasó', () => {
    expect(checkEventDraft(borrador({ date: plainDate(2026, 9, 2) }), HOY)).toBe(
      'date_in_the_past',
    );
  });

  it('hoy mismo vale: el taller de esta tarde se publica esta mañana', () => {
    expect(checkEventDraft(borrador({ date: HOY }), HOY)).toBeNull();
  });

  /**
   * Sin `today` no se mira la fecha, y eso es lo que permite corregir el nombre
   * del invitado DESPUES del seminario sin que la lista de asistentes se vuelva
   * ineditable.
   */
  it('sin fecha de hoy, editar algo pasado es legítimo', () => {
    expect(checkEventDraft(borrador({ date: plainDate(2020, 1, 1) }))).toBeNull();
  });
});

describe('mensajes', () => {
  it('todo motivo tiene texto', () => {
    const motivos = [
      'name_too_short',
      'name_too_long',
      'description_too_long',
      'price_negative',
      'price_not_integer',
      'price_too_high',
      'capacity_not_positive',
      'capacity_too_high',
      'ends_before_it_starts',
      'date_in_the_past',
    ] as const;
    for (const motivo of motivos) {
      expect(eventDenialMessage(motivo).length).toBeGreaterThan(10);
    }
  });
});
