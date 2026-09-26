/**
 * El asunto del aviso de reserva.
 *
 * Es lo único del correo que el dueño lee de verdad —sale entero en la
 * notificación del móvil—, y durante meses dijo «Clase de prueba» también a las
 * inscripciones.
 */
import { describe, expect, it } from 'vitest';
import { bookingSubject } from './mail.service';

const base = { personName: 'Ana Quispe', when: 'martes 2 de setiembre' } as const;

describe('bookingSubject', () => {
  it('dice qué viene a hacer, empezando por eso', () => {
    expect(bookingSubject({ ...base, kind: 'enrollment' })).toBe(
      'Inscripción: Ana Quispe viene el martes 2 de setiembre',
    );
    expect(bookingSubject({ ...base, kind: 'drop_in' })).toBe(
      'Clase suelta: Ana Quispe viene el martes 2 de setiembre',
    );
    expect(bookingSubject({ ...base, kind: 'trial' })).toBe(
      'Clase de prueba: Ana Quispe viene el martes 2 de setiembre',
    );
  });

  it('un cambio de hora se anuncia como cambio, sea lo que sea', () => {
    expect(bookingSubject({ ...base, kind: 'enrollment', rescheduled: true })).toBe(
      'Cambio de hora: Ana Quispe ahora viene el martes 2 de setiembre',
    );
  });
});
