import { describe, expect, it } from 'vitest';
import {
  checkScheduleDraft,
  formatAgeRange,
  isValidScheduleDraft,
  scheduleDenialMessage,
  scheduleRange,
  schedulesOverlap,
  SCHEDULE_AGE_MAX,
  SCHEDULE_CAPACITY_MAX,
  SCHEDULE_MIN_MINUTES,
  SCHEDULE_NAME_MAX,
  type ScheduleDenial,
  type ScheduleDraft,
} from './schedule-draft.js';

function draft(overrides: Partial<ScheduleDraft> = {}): ScheduleDraft {
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
    expect(checkScheduleDraft(draft())).toBeNull();
  });

  it('rechaza el vacio y el de una letra', () => {
    expect(checkScheduleDraft(draft({ name: '   ' }))).toBe('name_too_short');
    expect(checkScheduleDraft(draft({ name: 'A' }))).toBe('name_too_short');
  });

  it('rechaza el que pasa del tope', () => {
    expect(checkScheduleDraft(draft({ name: 'x'.repeat(SCHEDULE_NAME_MAX + 1) }))).toBe(
      'name_too_long',
    );
  });
});

describe('dia', () => {
  it('acepta los siete dias ISO', () => {
    for (const weekday of [1, 2, 3, 4, 5, 6, 7]) {
      expect(checkScheduleDraft(draft({ weekday }))).toBeNull();
    }
  });

  it('rechaza el 0 y el 8', () => {
    expect(checkScheduleDraft(draft({ weekday: 0 }))).toBe('weekday_invalid');
    expect(checkScheduleDraft(draft({ weekday: 8 }))).toBe('weekday_invalid');
  });
});

describe('horas', () => {
  it('rechaza lo que no tiene forma HH:MM', () => {
    expect(checkScheduleDraft(draft({ startTime: '7pm' }))).toBe('time_malformed');
    expect(checkScheduleDraft(draft({ endTime: '' }))).toBe('time_malformed');
    expect(checkScheduleDraft(draft({ startTime: '25:00' }))).toBe('time_malformed');
    expect(checkScheduleDraft(draft({ endTime: '19:60' }))).toBe('time_malformed');
  });

  it('rechaza la clase que termina antes de empezar', () => {
    expect(checkScheduleDraft(draft({ startTime: '20:00', endTime: '19:00' }))).toBe(
      'ends_before_start',
    );
  });

  /**
   * El caso que sale de tocar guardar sin mover la hora de fin: un bloque de
   * duracion cero no genera ni un cupo reservable y nadie puede marcar dentro.
   */
  it('rechaza el bloque de duracion cero', () => {
    expect(checkScheduleDraft(draft({ startTime: '19:00', endTime: '19:00' }))).toBe(
      'too_short',
    );
  });

  it(`rechaza el que dura menos de ${SCHEDULE_MIN_MINUTES} minutos y acepta el que dura justo eso`, () => {
    expect(checkScheduleDraft(draft({ startTime: '19:00', endTime: '19:14' }))).toBe(
      'too_short',
    );
    expect(checkScheduleDraft(draft({ startTime: '19:00', endTime: '19:15' }))).toBeNull();
  });

  it('acepta el bloque que llega al final del dia', () => {
    expect(checkScheduleDraft(draft({ startTime: '22:00', endTime: '23:59' }))).toBeNull();
  });
});

describe('aforo', () => {
  it('acepta el vacio: no todo local limita el cupo', () => {
    expect(checkScheduleDraft(draft({ capacity: null }))).toBeNull();
  });

  it('rechaza el cero y el negativo', () => {
    expect(checkScheduleDraft(draft({ capacity: 0 }))).toBe('capacity_out_of_range');
    expect(checkScheduleDraft(draft({ capacity: -3 }))).toBe('capacity_out_of_range');
  });

  it('rechaza el cero de mas', () => {
    expect(checkScheduleDraft(draft({ capacity: SCHEDULE_CAPACITY_MAX + 1 }))).toBe(
      'capacity_out_of_range',
    );
  });

  it('rechaza el decimal', () => {
    expect(checkScheduleDraft(draft({ capacity: 12.5 }))).toBe('capacity_not_integer');
  });
});

describe('profesor', () => {
  it('acepta el vacio', () => {
    expect(checkScheduleDraft(draft({ instructor: null }))).toBeNull();
  });

  it('rechaza el que pasa del tope', () => {
    expect(checkScheduleDraft(draft({ instructor: 'x'.repeat(61) }))).toBe(
      'instructor_too_long',
    );
  });
});

describe('edades', () => {
  it('sin edades es para todos, como cada bloque antes de la 0028', () => {
    expect(checkScheduleDraft(draft())).toBeNull();
    expect(checkScheduleDraft(draft({ minAge: null, maxAge: null }))).toBeNull();
  });

  it('el caso que lo pidió: judo kids de 3 a 7 y de 8 a 13', () => {
    expect(checkScheduleDraft(draft({ minAge: 3, maxAge: 7 }))).toBeNull();
    expect(checkScheduleDraft(draft({ minAge: 8, maxAge: 13 }))).toBeNull();
  });

  it('cada extremo vale solo', () => {
    expect(checkScheduleDraft(draft({ minAge: 16 }))).toBeNull();
    expect(checkScheduleDraft(draft({ maxAge: 5 }))).toBeNull();
  });

  it('una sola edad es un rango de un año', () => {
    expect(checkScheduleDraft(draft({ minAge: 5, maxAge: 5 }))).toBeNull();
  });

  it('rechaza el rango al revés', () => {
    expect(checkScheduleDraft(draft({ minAge: 13, maxAge: 8 }))).toBe('age_range_inverted');
  });

  it('rechaza edades imposibles y medias', () => {
    expect(checkScheduleDraft(draft({ minAge: -1 }))).toBe('age_out_of_range');
    expect(checkScheduleDraft(draft({ maxAge: SCHEDULE_AGE_MAX + 1 }))).toBe('age_out_of_range');
    expect(checkScheduleDraft(draft({ minAge: 3.5 }))).toBe('age_not_integer');
  });
});

describe('formatAgeRange', () => {
  it('se lee igual en todos los gimnasios', () => {
    expect(formatAgeRange({ minAge: 3, maxAge: 7 })).toBe('3 a 7 años');
    expect(formatAgeRange({ minAge: 16, maxAge: null })).toBe('desde 16 años');
    expect(formatAgeRange({ minAge: null, maxAge: 5 })).toBe('hasta 5 años');
    expect(formatAgeRange({ minAge: 5, maxAge: 5 })).toBe('5 años');
    expect(formatAgeRange({ minAge: null, maxAge: 1 })).toBe('hasta 1 año');
  });

  it('para todos no dice nada, ni contra una api que no manda los campos', () => {
    expect(formatAgeRange({ minAge: null, maxAge: null })).toBeNull();
    expect(formatAgeRange({})).toBeNull();
  });
});

describe('mensajes', () => {
  const denials: readonly ScheduleDenial[] = [
    'name_too_short',
    'name_too_long',
    'weekday_invalid',
    'time_malformed',
    'ends_before_start',
    'too_short',
    'capacity_not_integer',
    'capacity_out_of_range',
    'instructor_too_long',
    'age_not_integer',
    'age_out_of_range',
    'age_range_inverted',
  ];

  it('cada motivo tiene su texto y ninguno se repite', () => {
    const textos = denials.map(scheduleDenialMessage);
    expect(textos.every((text) => text.length > 0)).toBe(true);
    expect(new Set(textos).size).toBe(denials.length);
  });
});

describe('isValidScheduleDraft', () => {
  it('es el mismo veredicto que checkScheduleDraft', () => {
    expect(isValidScheduleDraft(draft())).toBe(true);
    expect(isValidScheduleDraft(draft({ endTime: '18:00' }))).toBe(false);
  });
});

describe('scheduleRange', () => {
  it('se lee de un vistazo', () => {
    expect(scheduleRange({ startTime: '19:00', endTime: '20:30' })).toBe('19:00 – 20:30');
  });
});

describe('schedulesOverlap', () => {
  const block = (weekday: number, startTime: string, endTime: string) => ({
    weekday,
    startTime,
    endTime,
  });

  it('no se pisan los de dias distintos', () => {
    expect(schedulesOverlap(block(1, '19:00', '20:30'), block(2, '19:00', '20:30'))).toBe(false);
  });

  it('se pisan los que comparten franja', () => {
    expect(schedulesOverlap(block(1, '19:00', '20:30'), block(1, '20:00', '21:00'))).toBe(true);
  });

  /** Una acaba cuando la otra empieza: es un horario seguido, no un choque. */
  it('no se pisan los que solo se tocan en el borde', () => {
    expect(schedulesOverlap(block(1, '19:00', '20:00'), block(1, '20:00', '21:00'))).toBe(false);
  });

  it('se pisa el que contiene entero al otro', () => {
    expect(schedulesOverlap(block(3, '08:00', '12:00'), block(3, '09:00', '10:00'))).toBe(true);
  });
});
