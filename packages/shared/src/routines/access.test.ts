import { describe, expect, it } from 'vitest';
import {
  canSeeRoutine,
  checkRoutineAccess,
  membersOnlyCount,
  routineAccessMessage,
  visibleRoutines,
  type RoutineViewer,
} from './access.js';
import type { Routine } from '../domain/types.js';

type Visible = Pick<Routine, 'status' | 'visibility'>;

const isPublic: Visible = { status: 'published', visibility: 'public' };
const forStudents: Visible = { status: 'published', visibility: 'members' };
const draft: Visible = { status: 'draft', visibility: 'public' };

describe('quien ve que', () => {
  it('la publica la ve cualquiera, incluida la persona sin cuenta', () => {
    for (const viewer of ['visitor', 'member', 'staff'] as RoutineViewer[]) {
      expect(checkRoutineAccess(isPublic, viewer)).toBeNull();
    }
  });

  it('la de alumnos la ve el alumno y el local, no la calle', () => {
    expect(checkRoutineAccess(forStudents, 'visitor')).toEqual({ code: 'members_only' });
    expect(checkRoutineAccess(forStudents, 'member')).toBeNull();
    expect(checkRoutineAccess(forStudents, 'staff')).toBeNull();
  });

  /**
   * El borrador se escribe en tres tardes. Ni el alumno lo ve: publicar es
   * exactamente la decision de que ya se puede leer.
   */
  it('el borrador es solo del local', () => {
    expect(checkRoutineAccess(draft, 'visitor')).toEqual({ code: 'not_published' });
    expect(checkRoutineAccess(draft, 'member')).toEqual({ code: 'not_published' });
    expect(checkRoutineAccess(draft, 'staff')).toBeNull();
  });

  /**
   * El orden importa: a quien mira desde la calle una rutina de alumnos SIN
   * publicar hay que decirle que no existe todavia, no venderle la mensualidad
   * por algo que el gimnasio aun no escribio.
   */
  it('sin publicar manda sobre "es de alumnos"', () => {
    expect(checkRoutineAccess({ status: 'draft', visibility: 'members' }, 'visitor')).toEqual({
      code: 'not_published',
    });
  });
});

describe('la biblioteca entera', () => {
  const all = [isPublic, forStudents, draft];

  it('filtra igual que la ficha, que es lo que evita el titulo que al tocarlo dice que no', () => {
    expect(visibleRoutines(all, 'visitor')).toEqual([isPublic]);
    expect(visibleRoutines(all, 'member')).toEqual([isPublic, forStudents]);
    expect(visibleRoutines(all, 'staff')).toEqual(all);
  });

  it('cuenta lo que se pierde quien no es alumno, sin ensenar los titulos', () => {
    expect(membersOnlyCount(all)).toBe(1);
    // El borrador no cuenta: prometeria contenido que el gimnasio no tiene.
    expect(membersOnlyCount([{ status: 'draft', visibility: 'members' }])).toBe(0);
  });
});

describe('el motivo dicho en voz alta', () => {
  it('el de alumnos es el argumento de venta, no un error', () => {
    const message = routineAccessMessage({ code: 'members_only' });
    expect(message.title).toContain('alumnos');
    expect(message.detail).toContain('Prueba una clase');
  });

  it('canSeeRoutine y checkRoutineAccess no pueden discrepar', () => {
    for (const routine of [isPublic, forStudents, draft]) {
      for (const viewer of ['visitor', 'member', 'staff'] as RoutineViewer[]) {
        expect(canSeeRoutine(routine, viewer)).toBe(checkRoutineAccess(routine, viewer) === null);
      }
    }
  });
});
