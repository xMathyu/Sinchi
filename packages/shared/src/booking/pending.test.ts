import { describe, expect, it } from 'vitest';
import { awaitsEnrollment } from './pending.js';
import type { MembershipId } from '../domain/types.js';

const inscripcion = {
  kind: 'enrollment',
  status: 'booked',
  membershipId: null,
} as const;

describe('awaitsEnrollment', () => {
  it('la inscripción reservada y sin ficha espera al mostrador', () => {
    expect(awaitsEnrollment(inscripcion)).toBe(true);
  });

  it('con su ficha hecha ya no espera nada', () => {
    expect(awaitsEnrollment({ ...inscripcion, membershipId: 'm-1' as MembershipId })).toBe(false);
  });

  it('marcada «no vino» o cancelada, tampoco: alguien ya la atendió', () => {
    expect(awaitsEnrollment({ ...inscripcion, status: 'no_show' })).toBe(false);
    expect(awaitsEnrollment({ ...inscripcion, status: 'canceled' })).toBe(false);
  });

  it('una prueba o una clase suelta no son inscripciones', () => {
    expect(awaitsEnrollment({ ...inscripcion, kind: 'trial' })).toBe(false);
    expect(awaitsEnrollment({ ...inscripcion, kind: 'drop_in' })).toBe(false);
  });

  it('contra una api anterior a la 0022, que no manda el tipo, no inventa una inscripción', () => {
    const vieja = { status: 'booked' } as unknown as typeof inscripcion;
    expect(awaitsEnrollment(vieja)).toBe(false);
  });
});
