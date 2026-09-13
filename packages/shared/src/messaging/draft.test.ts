import { describe, expect, it } from 'vitest';
import {
  MAX_UNANSWERED,
  MESSAGE_MAX_LENGTH,
  checkMessageDraft,
  messageDenialText,
  unansweredStreak,
  type MessageDraft,
} from './draft.js';

function borrador(overrides: Partial<MessageDraft> = {}): MessageDraft {
  return {
    sender: 'person',
    body: '¿Tienen clases de noche?',
    gymOpen: true,
    alreadyMember: false,
    unanswered: 0,
    ...overrides,
  };
}

describe('escribirle al gimnasio', () => {
  it('deja preguntar a quien no se ha inscrito en ningun sitio', () => {
    expect(checkMessageDraft(borrador())).toBeNull();
  });

  it('rechaza el mensaje vacio y el de solo espacios', () => {
    expect(checkMessageDraft(borrador({ body: '' }))).toBe('empty');
    expect(checkMessageDraft(borrador({ body: '   \n  ' }))).toBe('empty');
  });

  it('mide el tope sobre el texto recortado', () => {
    const justo = 'a'.repeat(MESSAGE_MAX_LENGTH);
    expect(checkMessageDraft(borrador({ body: `  ${justo}  ` }))).toBeNull();
    expect(checkMessageDraft(borrador({ body: `${justo}a` }))).toBe('too_long');
  });

  it('no deja escribirle a un gimnasio fuera del directorio', () => {
    expect(checkMessageDraft(borrador({ gymOpen: false }))).toBe('gym_unavailable');
  });

  /**
   * La otra mitad de la misma regla, y la que de verdad importa: al alumno de
   * casa no se le corta el canal porque su gimnasio haya salido de la lista
   * publica. Es la misma promesa que «la puerta nunca se cierra».
   */
  it('pero si al alumno que ya entrena ahi', () => {
    expect(checkMessageDraft(borrador({ gymOpen: false, alreadyMember: true }))).toBeNull();
  });

  it('corta la racha de mensajes sin respuesta', () => {
    expect(checkMessageDraft(borrador({ unanswered: MAX_UNANSWERED - 1 }))).toBeNull();
    expect(checkMessageDraft(borrador({ unanswered: MAX_UNANSWERED }))).toBe('awaiting_reply');
  });

  /** El gimnasio contesta a quien le escribe: ni la racha ni el directorio le aplican. */
  it('el gimnasio contesta siempre', () => {
    const respuesta = borrador({ sender: 'gym', gymOpen: false, unanswered: 99 });
    expect(checkMessageDraft(respuesta)).toBeNull();
    expect(checkMessageDraft({ ...respuesta, body: ' ' })).toBe('empty');
  });

  it('avisa de la racha antes que del texto: no es problema suyo lo que escribio', () => {
    expect(checkMessageDraft(borrador({ body: '', unanswered: MAX_UNANSWERED }))).toBe(
      'awaiting_reply',
    );
  });

  it('cada motivo tiene su frase', () => {
    for (const reason of ['gym_unavailable', 'empty', 'too_long', 'awaiting_reply'] as const) {
      expect(messageDenialText(reason).length).toBeGreaterThan(10);
    }
  });
});

describe('la racha sin respuesta', () => {
  const person = { sender: 'person' } as const;
  const gym = { sender: 'gym' } as const;

  it('un hilo vacio no tiene racha', () => {
    expect(unansweredStreak([])).toBe(0);
  });

  it('cuenta solo lo de despues de la ultima respuesta', () => {
    expect(unansweredStreak([person, person, gym, person])).toBe(1);
  });

  it('contestar la pone a cero', () => {
    expect(unansweredStreak([person, person, person, gym])).toBe(0);
  });

  it('sin respuesta nunca, cuenta el hilo entero', () => {
    expect(unansweredStreak([person, person, person])).toBe(3);
  });
});
