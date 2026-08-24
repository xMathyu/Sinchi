import { describe, expect, it } from 'vitest';
import { endOfIsoWeek, isSameIsoWeek, isoWeekOf, isoWeekRange, startOfIsoWeek } from './iso-week.js';
import { plainDate } from './plain-date.js';

describe('startOfIsoWeek', () => {
  it('el lunes es el inicio', () => {
    // 2026-08-24 es lunes.
    expect(startOfIsoWeek(plainDate(2026, 8, 24))).toEqual(plainDate(2026, 8, 24));
    expect(startOfIsoWeek(plainDate(2026, 8, 30))).toEqual(plainDate(2026, 8, 24));
    expect(endOfIsoWeek(plainDate(2026, 8, 24))).toEqual(plainDate(2026, 8, 30));
  });

  it('el domingo cierra la semana anterior, no abre la siguiente', () => {
    // Esto es lo que hace que el cupo NO se reinicie el domingo por la noche.
    expect(startOfIsoWeek(plainDate(2026, 8, 23))).toEqual(plainDate(2026, 8, 17));
  });
});

describe('isoWeekOf', () => {
  it('numera la semana del anio', () => {
    expect(isoWeekOf(plainDate(2026, 8, 23))).toEqual({
      year: 2026,
      week: 34,
      key: '2026-W34',
    });
    expect(isoWeekOf(plainDate(2026, 8, 24)).key).toBe('2026-W35');
  });

  it('el anio ISO lo define el jueves de la semana', () => {
    // 2025-12-29 es lunes y su jueves cae en 2026: es la semana 1 de 2026.
    expect(isoWeekOf(plainDate(2025, 12, 29)).key).toBe('2026-W01');
    // 2027-01-01 es viernes; su semana empieza el lunes 28-dic-2026 y su
    // jueves sigue en 2026: semana 53 de 2026.
    expect(isoWeekOf(plainDate(2027, 1, 1)).key).toBe('2026-W53');
  });

  it('el 4 de enero siempre esta en la semana 1', () => {
    for (const year of [2024, 2025, 2026, 2027, 2028, 2029, 2030]) {
      expect(isoWeekOf(plainDate(year, 1, 4)).week).toBe(1);
      expect(isoWeekOf(plainDate(year, 1, 4)).year).toBe(year);
    }
  });
});

describe('isSameIsoWeek', () => {
  it('agrupa lunes a domingo', () => {
    expect(isSameIsoWeek(plainDate(2026, 8, 17), plainDate(2026, 8, 23))).toBe(true);
    expect(isSameIsoWeek(plainDate(2026, 8, 23), plainDate(2026, 8, 24))).toBe(false);
  });
});

describe('isoWeekRange', () => {
  it('devuelve los limites listos para SQL', () => {
    expect(isoWeekRange(plainDate(2026, 8, 20))).toMatchObject({
      from: '2026-08-17',
      to: '2026-08-23',
    });
  });
});
