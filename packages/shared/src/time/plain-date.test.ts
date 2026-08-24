import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonthsClamped,
  compareDates,
  daysBetween,
  daysInMonth,
  formatPlainDate,
  fromEpochDay,
  isLeapYear,
  isoWeekday,
  localTimeInZone,
  minutesSinceMidnight,
  parsePlainDate,
  plainDate,
  plainDateInZone,
  startOfDayInZone,
  toEpochDay,
} from './plain-date.js';
import { TZ_LIMA } from './zone.js';

describe('plainDate', () => {
  it('rechaza el 30 de febrero', () => {
    expect(() => plainDate(2026, 2, 30)).toThrow(RangeError);
  });

  it('acepta el 29 de febrero solo en bisiesto', () => {
    expect(() => plainDate(2028, 2, 29)).not.toThrow();
    expect(() => plainDate(2026, 2, 29)).toThrow(RangeError);
  });
});

describe('isLeapYear', () => {
  it('aplica la regla de los siglos', () => {
    expect(isLeapYear(2000)).toBe(true);
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2026)).toBe(false);
  });
});

describe('epoch day', () => {
  it('ancla 1970-01-01 en cero', () => {
    expect(toEpochDay(plainDate(1970, 1, 1))).toBe(0);
  });

  it('es reversible en un rango amplio', () => {
    for (let day = -30_000; day < 30_000; day += 137) {
      expect(toEpochDay(fromEpochDay(day))).toBe(day);
    }
  });
});

describe('isoWeekday', () => {
  it('devuelve lunes = 1 y domingo = 7', () => {
    // 2026-08-24 es lunes.
    expect(isoWeekday(plainDate(2026, 8, 24))).toBe(1);
    expect(isoWeekday(plainDate(2026, 8, 30))).toBe(7);
    // 1970-01-01 fue jueves.
    expect(isoWeekday(plainDate(1970, 1, 1))).toBe(4);
  });
});

describe('addMonthsClamped', () => {
  it('recorta al ultimo dia del mes destino', () => {
    expect(addMonthsClamped(plainDate(2026, 1, 31), 1)).toEqual(plainDate(2026, 2, 28));
    expect(addMonthsClamped(plainDate(2028, 1, 31), 1)).toEqual(plainDate(2028, 2, 29));
    expect(addMonthsClamped(plainDate(2026, 3, 31), 1)).toEqual(plainDate(2026, 4, 30));
  });

  it('no acumula el recorte al avanzar mes a mes desde la misma base', () => {
    // El recorte se aplica siempre contra la fecha original, no en cadena:
    // asi el alumno inscrito un 31 vuelve al 31 en los meses que lo tienen.
    const base = plainDate(2026, 1, 31);
    expect(addMonthsClamped(base, 2)).toEqual(plainDate(2026, 3, 31));
  });

  it('cruza el fin de anio', () => {
    expect(addMonthsClamped(plainDate(2026, 12, 15), 1)).toEqual(plainDate(2027, 1, 15));
  });
});

describe('addDays y daysBetween', () => {
  it('cruza el cambio de mes y de anio', () => {
    expect(addDays(plainDate(2026, 8, 30), 3)).toEqual(plainDate(2026, 9, 2));
    expect(addDays(plainDate(2026, 12, 31), 1)).toEqual(plainDate(2027, 1, 1));
    expect(daysBetween(plainDate(2026, 8, 12), plainDate(2026, 9, 12))).toBe(31);
    expect(daysBetween(plainDate(2026, 2, 1), plainDate(2026, 3, 1))).toBe(28);
  });

  it('es negativo hacia atras', () => {
    expect(daysBetween(plainDate(2026, 9, 12), plainDate(2026, 8, 12))).toBe(-31);
  });
});

describe('formato', () => {
  it('serializa y parsea ida y vuelta', () => {
    expect(formatPlainDate(plainDate(2026, 8, 3))).toBe('2026-08-03');
    expect(parsePlainDate('2026-08-03')).toEqual(plainDate(2026, 8, 3));
  });

  it('rechaza formatos que no son YYYY-MM-DD', () => {
    expect(() => parsePlainDate('3/8/2026')).toThrow(RangeError);
    expect(() => parsePlainDate('2026-8-3')).toThrow(RangeError);
  });
});

describe('compareDates', () => {
  it('ordena', () => {
    expect(compareDates(plainDate(2026, 1, 1), plainDate(2026, 1, 2))).toBe(-1);
    expect(compareDates(plainDate(2026, 1, 2), plainDate(2026, 1, 2))).toBe(0);
    expect(compareDates(plainDate(2026, 2, 1), plainDate(2026, 1, 2))).toBe(1);
  });
});

describe('zona horaria de Lima', () => {
  it('un instante UTC de madrugada cae el dia anterior en Lima', () => {
    // 2026-08-24 03:00 UTC son las 22:00 del 23 de agosto en Lima.
    const instant = new Date('2026-08-24T03:00:00Z');
    expect(plainDateInZone(instant, TZ_LIMA)).toEqual(plainDate(2026, 8, 23));
    expect(plainDateInZone(instant, 'UTC')).toEqual(plainDate(2026, 8, 24));
  });

  it('la medianoche de Lima es 05:00 UTC', () => {
    expect(startOfDayInZone(plainDate(2026, 8, 23), TZ_LIMA).toISOString()).toBe(
      '2026-08-23T05:00:00.000Z',
    );
  });

  it('ida y vuelta entre fecha civil e instante', () => {
    const date = plainDate(2026, 8, 23);
    expect(plainDateInZone(startOfDayInZone(date, TZ_LIMA), TZ_LIMA)).toEqual(date);
  });

  it('lee la hora local', () => {
    expect(localTimeInZone(new Date('2026-08-24T00:04:00Z'), TZ_LIMA)).toBe('19:04');
  });
});

describe('minutesSinceMidnight', () => {
  it('convierte HH:MM', () => {
    expect(minutesSinceMidnight('00:00')).toBe(0);
    expect(minutesSinceMidnight('19:30')).toBe(1170);
    expect(minutesSinceMidnight('23:59')).toBe(1439);
  });

  it('rechaza horas invalidas', () => {
    expect(() => minutesSinceMidnight('24:00')).toThrow(RangeError);
    expect(() => minutesSinceMidnight('19:60')).toThrow(RangeError);
    expect(() => minutesSinceMidnight('7pm')).toThrow(RangeError);
  });
});

describe('daysInMonth', () => {
  it('conoce los meses cortos', () => {
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(() => daysInMonth(2026, 13)).toThrow(RangeError);
  });
});
