import { describe, expect, it } from 'vitest';
import {
  FADING_AFTER_DAYS,
  NEW_MEMBER_GRACE_DAYS,
  computeAttendanceRanking,
  lastDays,
  type AttendanceRecord,
} from './ranking.js';
import { addDays, plainDate } from '../time/plain-date.js';

const HOY = plainDate(2026, 9, 20);
const RANGO = lastDays(HOY, 28);

/** Un alumno de siempre: inscrito hace tiempo, plan de 2x. */
const alumno = (
  name: string,
  overrides: Partial<AttendanceRecord> = {},
): AttendanceRecord => ({
  membershipId: `m-${name.toLowerCase()}`,
  name,
  checkIns: 0,
  lastVisit: null,
  since: addDays(HOY, -120),
  weeklyLimit: 2,
  ...overrides,
});

const rank = (records: readonly AttendanceRecord[], limit = 5) =>
  computeAttendanceRanking({ records, ...RANGO, today: HOY, limit });

describe('el top', () => {
  it('ordena por asistencias, de más a menos', () => {
    const { regulars } = rank([
      alumno('Rosa', { checkIns: 8, lastVisit: addDays(HOY, -1) }),
      alumno('Diego', { checkIns: 14, lastVisit: addDays(HOY, -2) }),
      alumno('Ana', { checkIns: 11, lastVisit: addDays(HOY, -1) }),
    ]);

    expect(regulars.map((r) => r.name)).toEqual(['Diego', 'Ana', 'Rosa']);
  });

  it('deja fuera a quien no vino: su sitio es la otra lista', () => {
    const { regulars } = rank([
      alumno('Rosa', { checkIns: 6, lastVisit: addDays(HOY, -3) }),
      alumno('Fantasma', { checkIns: 0 }),
    ]);

    expect(regulars.map((r) => r.name)).toEqual(['Rosa']);
  });

  it('un empate lo rompe quien vino hace menos', () => {
    const { regulars } = rank([
      alumno('Lejano', { checkIns: 9, lastVisit: addDays(HOY, -20) }),
      alumno('Reciente', { checkIns: 9, lastVisit: addDays(HOY, -1) }),
    ]);

    expect(regulars[0]?.name).toBe('Reciente');
  });

  it('el uso del cupo hace comparables dos planes distintos', () => {
    // Cuatro semanas. Marta con plan de 2x vino 8 veces: usó su plan entero.
    // Julio con ilimitado vino 12: más veces, pero no hay cupo que medir.
    const { regulars } = rank([
      alumno('Marta', { checkIns: 8, lastVisit: addDays(HOY, -1), weeklyLimit: 2 }),
      alumno('Julio', { checkIns: 12, lastVisit: addDays(HOY, -1), weeklyLimit: null }),
    ]);

    const marta = regulars.find((r) => r.name === 'Marta');
    const julio = regulars.find((r) => r.name === 'Julio');

    expect(marta?.perWeek).toBe(2);
    expect(marta?.quotaUse).toBe(1);
    // `null` y no 1: en ilimitado no hay cupo, y fingir uno pondría a todo el
    // mundo al 100%.
    expect(julio?.quotaUse).toBeNull();
    expect(julio?.perWeek).toBe(3);
  });

  it('respeta el límite de filas', () => {
    const muchos = Array.from({ length: 12 }, (_, i) =>
      alumno(`Alumno${i}`, { checkIns: 20 - i, lastVisit: addDays(HOY, -1) }),
    );

    expect(rank(muchos, 3).regulars).toHaveLength(3);
  });
});

describe('los que se están yendo', () => {
  it('ordena por días sin aparecer, no por asistencias', () => {
    // Es la razón de ser del archivo: contar de menos a más mezcla tres casos
    // distintos. Aquí Ausente tiene MÁS asistencias que Flojo y va primero,
    // porque lleva más tiempo sin pisar el local.
    const { fading } = rank([
      alumno('Ausente', { checkIns: 4, lastVisit: addDays(HOY, -25) }),
      alumno('Flojo', { checkIns: 2, lastVisit: addDays(HOY, -12) }),
    ]);

    expect(fading.map((f) => f.name)).toEqual(['Ausente', 'Flojo']);
    expect(fading[0]?.daysAway).toBe(25);
  });

  it('no mete al recién inscrito que todavía no vino', () => {
    const { fading } = rank([
      alumno('Nuevo', { checkIns: 0, since: addDays(HOY, -(NEW_MEMBER_GRACE_DAYS - 1)) }),
    ]);

    expect(fading).toHaveLength(0);
  });

  it('pero sí al que se inscribió hace rato y nunca vino, con su motivo', () => {
    const { fading } = rank([
      alumno('NuncaVino', { checkIns: 0, lastVisit: null, since: addDays(HOY, -40) }),
    ]);

    expect(fading).toHaveLength(1);
    expect(fading[0]?.reason).toBe('never_came');
    // Sin última visita, los días se cuentan desde el alta.
    expect(fading[0]?.daysAway).toBe(40);
  });

  it('distingue «nunca vino» de «dejó de venir»', () => {
    // Piden llamadas distintas: al primero le falló el alta, al segundo le pasó
    // algo después.
    const { fading } = rank([
      alumno('NuncaVino', { checkIns: 0, lastVisit: null, since: addDays(HOY, -40) }),
      alumno('SeFue', { checkIns: 1, lastVisit: addDays(HOY, -30), since: addDays(HOY, -200) }),
    ]);

    expect(fading.map((f) => f.reason)).toEqual(['NuncaVino', 'SeFue'].map((n) =>
      n === 'NuncaVino' ? 'never_came' : 'absent',
    ));
  });

  it('deja tranquilo al que vino hace poco', () => {
    const { fading } = rank([
      alumno('AlDia', { checkIns: 8, lastVisit: addDays(HOY, -(FADING_AFTER_DAYS - 1)) }),
    ]);

    expect(fading).toHaveLength(0);
  });

  it('el que vino el día antes del rango no sale como «nunca vino»', () => {
    // `lastVisit` mira todo el historial, no solo el rango: acusar de no haber
    // venido nunca a quien vino hace 29 días es la peor forma de equivocarse.
    const { fading } = rank([
      alumno('Justo', { checkIns: 0, lastVisit: addDays(HOY, -29), since: addDays(HOY, -300) }),
    ]);

    expect(fading[0]?.reason).toBe('absent');
  });
});

describe('los totales', () => {
  it('cuentan quién pisó el local y quién no', () => {
    const resumen = rank([
      alumno('Rosa', { checkIns: 8, lastVisit: addDays(HOY, -1) }),
      alumno('Diego', { checkIns: 3, lastVisit: addDays(HOY, -4) }),
      alumno('Fantasma', { checkIns: 0, since: addDays(HOY, -90) }),
    ]);

    expect(resumen.totalCheckIns).toBe(11);
    expect(resumen.activeMembers).toBe(2);
    expect(resumen.absentMembers).toBe(1);
  });

  it('un padrón vacío devuelve listas vacías, no error', () => {
    const resumen = rank([]);

    expect(resumen.regulars).toEqual([]);
    expect(resumen.fading).toEqual([]);
    expect(resumen.totalCheckIns).toBe(0);
  });
});

describe('el rango de la pantalla', () => {
  it('«últimos 28 días» incluye hoy', () => {
    expect(lastDays(HOY, 28)).toEqual({
      from: plainDate(2026, 8, 24),
      through: HOY,
    });
  });
});
