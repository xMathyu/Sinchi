import { describe, expect, it } from 'vitest';
import { findSlot, upcomingClassSlots, TRIAL_WINDOW_DAYS } from './slots.js';
import { makeSchedule } from '../testing/fixtures.js';
import { formatPlainDate, plainDate } from '../time/plain-date.js';

// 2026-08-20 es jueves.
const JUEVES = plainDate(2026, 8, 20);

const LUNES_19 = makeSchedule(1, '19:00', '20:30', { name: 'Fundamentos' });
const JUEVES_08 = makeSchedule(4, '08:00', '09:00', { name: 'Preparación física' });
const JUEVES_20 = makeSchedule(4, '20:00', '21:00', { name: 'Judo Adultos' });

describe('proximas clases', () => {
  it('devuelve las de hoy que todavia no empiezan', () => {
    const slots = upcomingClassSlots({
      schedules: [JUEVES_08, JUEVES_20],
      today: JUEVES,
      now: '10:00',
    });

    const hoy = slots.filter((slot) => formatPlainDate(slot.date) === '2026-08-20');
    expect(hoy.map((slot) => slot.startTime)).toEqual(['20:00']);
  });

  it('descarta la clase que empieza en menos de una hora', () => {
    // Empieza a las 20:00 y son las 19:30: el gimnasio no llega a enterarse.
    const slots = upcomingClassSlots({
      schedules: [JUEVES_20],
      today: JUEVES,
      now: '19:30',
    });

    expect(formatPlainDate(slots[0]!.date)).toBe('2026-08-27');
  });

  it('ordena por fecha y luego por hora', () => {
    const slots = upcomingClassSlots({
      schedules: [JUEVES_20, JUEVES_08, LUNES_19],
      today: JUEVES,
      now: '06:00',
    });

    expect(slots.slice(0, 4).map((slot) => `${formatPlainDate(slot.date)} ${slot.startTime}`)).toEqual([
      '2026-08-20 08:00',
      '2026-08-20 20:00',
      '2026-08-24 19:00',
      '2026-08-27 08:00',
    ]);
  });

  it('cubre dos semanas: la clase de los sabados aparece dos veces', () => {
    const sabado = makeSchedule(6, '11:00', '13:00', { name: 'Judo Adultos' });
    const slots = upcomingClassSlots({ schedules: [sabado], today: JUEVES, now: '06:00' });

    expect(slots).toHaveLength(2);
    expect(slots.map((slot) => formatPlainDate(slot.date))).toEqual([
      '2026-08-22',
      '2026-08-29',
    ]);
  });

  it('la ventana es de dos semanas exactas', () => {
    // Un horario todos los dias: hay tantas opciones como dias de la ventana.
    const todos = [1, 2, 3, 4, 5, 6, 7].map((weekday) =>
      makeSchedule(weekday as 1, '19:00', '20:00'),
    );
    const slots = upcomingClassSlots({ schedules: todos, today: JUEVES, now: '06:00' });

    expect(slots).toHaveLength(TRIAL_WINDOW_DAYS);
  });

  it('un gimnasio sin horarios no ofrece nada', () => {
    expect(upcomingClassSlots({ schedules: [], today: JUEVES, now: '06:00' })).toEqual([]);
  });
});

describe('buscar la clase elegida', () => {
  const slots = upcomingClassSlots({
    schedules: [JUEVES_20, LUNES_19],
    today: JUEVES,
    now: '06:00',
  });

  it('encuentra por horario y fecha', () => {
    const encontrada = findSlot(slots, LUNES_19.id, plainDate(2026, 8, 24));
    expect(encontrada?.name).toBe('Fundamentos');
  });

  it('no vale el horario correcto en una fecha que no toca', () => {
    // El lunes 19:00 existe, pero no el jueves 20.
    expect(findSlot(slots, LUNES_19.id, JUEVES)).toBeNull();
  });

  it('no vale una fecha correcta con otro horario', () => {
    expect(findSlot(slots, 'schedule-inventado', plainDate(2026, 8, 24))).toBeNull();
  });
});
