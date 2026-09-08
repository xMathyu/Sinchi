import { describe, expect, it } from 'vitest';
import {
  checkScheduleDraft,
  isValidScheduleDraft,
  scheduleDenialMessage,
  scheduleRange,
  schedulesOverlap,
  SCHEDULE_CAPACITY_MAX,
  SCHEDULE_MIN_MINUTES,
  SCHEDULE_NAME_MAX,
  type ScheduleDenial,
  type ScheduleDraft,
} from './schedule-draft.js';

function borrador(overrides: Partial<ScheduleDraft> = {}): ScheduleDraft {
  return {
    name: 'Muay Thai principiantes',
    weekday: 1,
    startTime: '19:00',
    endTime: '20:30',
    capacity: 20,
    instructor: 'Sergio',
    ...overrides,
  };
}

describe('nombre', () => {
  it('acepta uno normal', () => {
    expect(checkScheduleDraft(borrador())).toBeNull();
  });

  it('rechaza el vacio y el de una letra', () => {
    expect(checkScheduleDraft(borrador({ name: '   ' }))).toBe('name_too_short');
    expect(checkScheduleDraft(borrador({ name: 'A' }))).toBe('name_too_short');
  });

  it('rechaza el que pasa del tope', () => {
    expect(checkScheduleDraft(borrador({ name: 'x'.repeat(SCHEDULE_NAME_MAX + 1) }))).toBe(
      'name_too_long',
    );
  });
});

describe('dia', () => {
  it('acepta los siete dias ISO', () => {
    for (const weekday of [1, 2, 3, 4, 5, 6, 7]) {
      expect(checkScheduleDraft(borrador({ weekday }))).toBeNull();
    }
  });

  it('rechaza el 0 y el 8', () => {
    expect(checkScheduleDraft(borrador({ weekday: 0 }))).toBe('weekday_invalid');
    expect(checkScheduleDraft(borrador({ weekday: 8 }))).toBe('weekday_invalid');
  });
});

describe('horas', () => {
  it('rechaza lo que no tiene forma HH:MM', () => {
    expect(checkScheduleDraft(borrador({ startTime: '7pm' }))).toBe('time_malformed');
    expect(checkScheduleDraft(borrador({ endTime: '' }))).toBe('time_malformed');
    expect(checkScheduleDraft(borrador({ startTime: '25:00' }))).toBe('time_malformed');
    expect(checkScheduleDraft(borrador({ endTime: '19:60' }))).toBe('time_malformed');
  });

  it('rechaza la clase que termina antes de empezar', () => {
    expect(checkScheduleDraft(borrador({ startTime: '20:00', endTime: '19:00' }))).toBe(
      'ends_before_start',
    );
  });

  /**
   * El caso que sale de tocar guardar sin mover la hora de fin: un bloque de
   * duracion cero no genera ni un cupo reservable y nadie puede marcar dentro.
   */
  it('rechaza el bloque de duracion cero', () => {
    expect(checkScheduleDraft(borrador({ startTime: '19:00', endTime: '19:00' }))).toBe(
      'too_short',
    );
  });

  it(`rechaza el que dura menos de ${SCHEDULE_MIN_MINUTES} minutos y acepta el que dura justo eso`, () => {
    expect(checkScheduleDraft(borrador({ startTime: '19:00', endTime: '19:14' }))).toBe(
      'too_short',
    );
    expect(checkScheduleDraft(borrador({ startTime: '19:00', endTime: '19:15' }))).toBeNull();
  });

  it('acepta el bloque que llega al final del dia', () => {
    expect(checkScheduleDraft(borrador({ startTime: '22:00', endTime: '23:59' }))).toBeNull();
  });
});

describe('aforo', () => {
  it('acepta el vacio: no todo local limita el cupo', () => {
    expect(checkScheduleDraft(borrador({ capacity: null }))).toBeNull();
  });

  it('rechaza el cero y el negativo', () => {
    expect(checkScheduleDraft(borrador({ capacity: 0 }))).toBe('capacity_out_of_range');
    expect(checkScheduleDraft(borrador({ capacity: -3 }))).toBe('capacity_out_of_range');
  });

  it('rechaza el cero de mas', () => {
    expect(checkScheduleDraft(borrador({ capacity: SCHEDULE_CAPACITY_MAX + 1 }))).toBe(
      'capacity_out_of_range',
    );
  });

  it('rechaza el decimal', () => {
    expect(checkScheduleDraft(borrador({ capacity: 12.5 }))).toBe('capacity_not_integer');
  });
});

describe('profesor', () => {
  it('acepta el vacio', () => {
    expect(checkScheduleDraft(borrador({ instructor: null }))).toBeNull();
  });

  it('rechaza el que pasa del tope', () => {
    expect(checkScheduleDraft(borrador({ instructor: 'x'.repeat(61) }))).toBe(
      'instructor_too_long',
    );
  });
});

describe('mensajes', () => {
  const motivos: readonly ScheduleDenial[] = [
    'name_too_short',
    'name_too_long',
    'weekday_invalid',
    'time_malformed',
    'ends_before_start',
    'too_short',
    'capacity_not_integer',
    'capacity_out_of_range',
    'instructor_too_long',
  ];

  it('cada motivo tiene su texto y ninguno se repite', () => {
    const textos = motivos.map(scheduleDenialMessage);
    expect(textos.every((texto) => texto.length > 0)).toBe(true);
    expect(new Set(textos).size).toBe(motivos.length);
  });
});

describe('isValidScheduleDraft', () => {
  it('es el mismo veredicto que checkScheduleDraft', () => {
    expect(isValidScheduleDraft(borrador())).toBe(true);
    expect(isValidScheduleDraft(borrador({ endTime: '18:00' }))).toBe(false);
  });
});

describe('scheduleRange', () => {
  it('se lee de un vistazo', () => {
    expect(scheduleRange({ startTime: '19:00', endTime: '20:30' })).toBe('19:00 – 20:30');
  });
});

describe('schedulesOverlap', () => {
  const bloque = (weekday: number, startTime: string, endTime: string) => ({
    weekday,
    startTime,
    endTime,
  });

  it('no se pisan los de dias distintos', () => {
    expect(schedulesOverlap(bloque(1, '19:00', '20:30'), bloque(2, '19:00', '20:30'))).toBe(false);
  });

  it('se pisan los que comparten franja', () => {
    expect(schedulesOverlap(bloque(1, '19:00', '20:30'), bloque(1, '20:00', '21:00'))).toBe(true);
  });

  /** Una acaba cuando la otra empieza: es un horario seguido, no un choque. */
  it('no se pisan los que solo se tocan en el borde', () => {
    expect(schedulesOverlap(bloque(1, '19:00', '20:00'), bloque(1, '20:00', '21:00'))).toBe(false);
  });

  it('se pisa el que contiene entero al otro', () => {
    expect(schedulesOverlap(bloque(3, '08:00', '12:00'), bloque(3, '09:00', '10:00'))).toBe(true);
  });
});
