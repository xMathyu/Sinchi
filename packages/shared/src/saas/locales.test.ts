import { describe, expect, it } from 'vitest';
import { MAX_GYMS_PER_PERSON, checkNewGym } from './locales.js';

describe('cuantos locales puede abrir una persona', () => {
  it('quien no tiene ninguno puede, y no se le trata de dueño todavía', () => {
    const decision = checkNewGym(0);

    expect(decision.allowed).toBe(true);
    expect(decision.remaining).toBe(MAX_GYMS_PER_PERSON);
    // Cambia el texto: «Registra tu gimnasio» y no «Abre otro local».
    expect(decision.hasGyms).toBe(false);
    expect(decision.reason).toBeNull();
  });

  it('quien ya tiene uno puede abrir otro', () => {
    const decision = checkNewGym(1);

    expect(decision.allowed).toBe(true);
    expect(decision.hasGyms).toBe(true);
    expect(decision.remaining).toBe(MAX_GYMS_PER_PERSON - 1);
  });

  it('en el tope no se puede, y dice qué hacer', () => {
    const decision = checkNewGym(MAX_GYMS_PER_PERSON);

    expect(decision.allowed).toBe(false);
    expect(decision.remaining).toBe(0);
    // El motivo, no un booleano: lo que hay que hacer es escribirnos.
    expect(decision.reason?.code).toBe('at_cap');
    expect(decision.reason?.message).toMatch(/máximo por cuenta/i);
    expect(decision.reason?.message).toMatch(/escríbenos/i);
  });

  it('por encima del tope tampoco, y `remaining` no se va en negativo', () => {
    // Pasa de verdad: el tope podría bajar algún día con gente por encima.
    const decision = checkNewGym(MAX_GYMS_PER_PERSON + 3);

    expect(decision.allowed).toBe(false);
    expect(decision.remaining).toBe(0);
  });

  it('un conteo absurdo no rompe la pantalla', () => {
    // La app le pasa `modes.staff.length`; si un día llega algo raro, la
    // decisión tiene que seguir siendo legible y no un NaN en el botón.
    expect(checkNewGym(-2).allowed).toBe(true);
    expect(checkNewGym(-2).remaining).toBe(MAX_GYMS_PER_PERSON);
    expect(checkNewGym(1.7).remaining).toBe(MAX_GYMS_PER_PERSON - 1);
  });
});
