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

const publica: Visible = { status: 'published', visibility: 'public' };
const deAlumnos: Visible = { status: 'published', visibility: 'members' };
const borrador: Visible = { status: 'draft', visibility: 'public' };

describe('quien ve que', () => {
  it('la publica la ve cualquiera, incluida la persona sin cuenta', () => {
    for (const viewer of ['visitor', 'member', 'staff'] as RoutineViewer[]) {
      expect(checkRoutineAccess(publica, viewer)).toBeNull();
    }
  });

  it('la de alumnos la ve el alumno y el local, no la calle', () => {
    expect(checkRoutineAccess(deAlumnos, 'visitor')).toEqual({ code: 'members_only' });
    expect(checkRoutineAccess(deAlumnos, 'member')).toBeNull();
    expect(checkRoutineAccess(deAlumnos, 'staff')).toBeNull();
  });

  /**
   * El borrador se escribe en tres tardes. Ni el alumno lo ve: publicar es
   * exactamente la decision de que ya se puede leer.
   */
  it('el borrador es solo del local', () => {
    expect(checkRoutineAccess(borrador, 'visitor')).toEqual({ code: 'not_published' });
    expect(checkRoutineAccess(borrador, 'member')).toEqual({ code: 'not_published' });
    expect(checkRoutineAccess(borrador, 'staff')).toBeNull();
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
  const todas = [publica, deAlumnos, borrador];

  it('filtra igual que la ficha, que es lo que evita el titulo que al tocarlo dice que no', () => {
    expect(visibleRoutines(todas, 'visitor')).toEqual([publica]);
    expect(visibleRoutines(todas, 'member')).toEqual([publica, deAlumnos]);
    expect(visibleRoutines(todas, 'staff')).toEqual(todas);
  });

  it('cuenta lo que se pierde quien no es alumno, sin ensenar los titulos', () => {
    expect(membersOnlyCount(todas)).toBe(1);
    // El borrador no cuenta: prometeria contenido que el gimnasio no tiene.
    expect(membersOnlyCount([{ status: 'draft', visibility: 'members' }])).toBe(0);
  });
});

describe('el motivo dicho en voz alta', () => {
  it('el de alumnos es el argumento de venta, no un error', () => {
    const mensaje = routineAccessMessage({ code: 'members_only' });
    expect(mensaje.title).toContain('alumnos');
    expect(mensaje.detail).toContain('Prueba una clase');
  });

  it('canSeeRoutine y checkRoutineAccess no pueden discrepar', () => {
    for (const rutina of [publica, deAlumnos, borrador]) {
      for (const viewer of ['visitor', 'member', 'staff'] as RoutineViewer[]) {
        expect(canSeeRoutine(rutina, viewer)).toBe(checkRoutineAccess(rutina, viewer) === null);
      }
    }
  });
});
