/**
 * Las reglas que el panel de Sinchi aplica a una persona.
 *
 * Lo que importa aquí no es la validación de formularios —eso se ve usando la
 * pantalla— sino las dos negativas que protegen algo que no se recupera: no se
 * elimina a quien sostiene la entrada de un gimnasio, y no se elimina a nadie
 * sin haber escrito quién es.
 */
import { describe, expect, it } from 'vitest';
import {
  BAN_REASON_MIN,
  DELETION_DEADLINE_DAYS,
  checkPersonBan,
  checkPersonDeletion,
  checkPersonDetails,
  deletionDaysLeft,
  personBanDenialMessage,
  personConfirmationKey,
  personDeletionDenialMessage,
  personDetailsDenialMessage,
} from './people.js';
import { checkAccountDetails } from '../identity/account-details.js';

const valido = {
  name: 'Rosa Quispe',
  phone: '+51987654321',
  documentId: '45678912',
  email: 'rosa@gmail.com',
};

describe('checkPersonDetails', () => {
  it('acepta una ficha bien escrita, con o sin correo', () => {
    expect(checkPersonDetails(valido)).toBeNull();
    expect(checkPersonDetails({ ...valido, email: '' })).toBeNull();
    // El carné de extranjería lleva letras.
    expect(checkPersonDetails({ ...valido, documentId: 'CE001234567' })).toBeNull();
  });

  /**
   * Nombre y celular son LA MISMA regla que la app usa cuando la persona se
   * corrige sola. Si esto se separa, el panel acaba guardando un celular que la
   * app no dejaría escribir.
   */
  it('nombre y celular se juzgan igual que en la app', () => {
    for (const draft of [
      { ...valido, name: 'R' },
      { ...valido, phone: '123' },
    ]) {
      expect(checkPersonDetails(draft)).toBe(
        checkAccountDetails({ name: draft.name, phone: draft.phone }),
      );
    }
  });

  it('rechaza un documento que no identificaría a nadie', () => {
    expect(checkPersonDetails({ ...valido, documentId: '123' })).toBe('document_invalid');
    // Un espacio o un guion copiados hacen que el índice único no reconozca a
    // la misma persona escrita de dos formas.
    expect(checkPersonDetails({ ...valido, documentId: '4567 8912' })).toBe('document_invalid');
    expect(checkPersonDetails({ ...valido, documentId: '4567-8912' })).toBe('document_invalid');
  });

  it('rechaza un correo mal escrito', () => {
    expect(checkPersonDetails({ ...valido, email: 'rosa@' })).toBe('email_invalid');
  });

  it('cada motivo tiene su frase', () => {
    expect(personDetailsDenialMessage('document_invalid')).toContain('letras o números');
    expect(personDetailsDenialMessage('email_invalid')).toContain('vacío');
    expect(personDetailsDenialMessage('name_too_short')).toContain('dos letras');
  });
});

describe('checkPersonBan', () => {
  it('deja banear con un motivo escrito', () => {
    expect(
      checkPersonBan({ reason: 'Insulta a los gimnasios por el chat', banned: false }),
    ).toBeNull();
  });

  it('exige un motivo de verdad', () => {
    expect(checkPersonBan({ reason: 'spam', banned: false })).toBe('reason_too_short');
    expect('x'.repeat(BAN_REASON_MIN)).toHaveLength(BAN_REASON_MIN);
  });

  it('no banea dos veces', () => {
    expect(
      checkPersonBan({ reason: 'Insulta a los gimnasios por el chat', banned: true }),
    ).toBe('already_banned');
  });

  it('cada motivo tiene su frase', () => {
    expect(personBanDenialMessage('already_banned')).toContain('ya está baneada');
    expect(personBanDenialMessage('reason_too_short')).toContain(String(BAN_REASON_MIN));
  });
});

describe('checkPersonDeletion', () => {
  const persona = { staffOf: [] as string[], key: '45678912' };

  it('deja eliminar con el documento escrito', () => {
    expect(checkPersonDeletion({ ...persona, typed: '45678912' })).toBeNull();
    expect(checkPersonDeletion({ ...persona, typed: ' 45678912 ' })).toBeNull();
  });

  /**
   * Su fila de `staff` es la que abre el gimnasio: borrarla deja un local sin
   * nadie que pueda entrar a él. La base también lo impide (RESTRICT); esto es
   * para decirlo con palabras.
   */
  it('no elimina a quien trabaja en un gimnasio', () => {
    expect(
      checkPersonDeletion({ staffOf: ['Iron Muay Thai'], key: '45678912', typed: '45678912' }),
    ).toBe('is_staff');
    expect(personDeletionDenialMessage('is_staff', ['Iron Muay Thai'])).toContain(
      'Iron Muay Thai',
    );
  });

  it('no elimina si lo escrito no coincide', () => {
    expect(checkPersonDeletion({ ...persona, typed: '4567891' })).toBe('confirmation_mismatch');
    expect(checkPersonDeletion({ ...persona, typed: '' })).toBe('confirmation_mismatch');
  });

  it('un correo se compara sin mayúsculas', () => {
    expect(
      checkPersonDeletion({ staffOf: [], key: 'rosa@gmail.com', typed: 'Rosa@Gmail.com' }),
    ).toBeNull();
  });
});

describe('personConfirmationKey', () => {
  it('con ficha, el documento', () => {
    expect(
      personConfirmationKey({
        documentId: '45678912',
        email: 'rosa@gmail.com',
        phone: '+51987654321',
        firebaseUid: 'abc',
      }),
    ).toBe('45678912');
  });

  it('sin ficha, el correo; y sin correo, el celular', () => {
    expect(
      personConfirmationKey({ documentId: null, email: 'x@y.pe', phone: '+51', firebaseUid: 'u' }),
    ).toBe('x@y.pe');
    expect(
      personConfirmationKey({ documentId: null, email: null, phone: '+51999', firebaseUid: 'u' }),
    ).toBe('+51999');
  });
});

describe('deletionDaysLeft', () => {
  const pedida = new Date('2026-09-01T15:00:00Z');

  it('cuenta hacia atrás desde los 30 prometidos', () => {
    expect(deletionDaysLeft(pedida, pedida)).toBe(DELETION_DEADLINE_DAYS);
    expect(deletionDaysLeft(pedida, new Date('2026-09-11T15:00:00Z'))).toBe(20);
  });

  it('se va a negativo cuando la promesa ya se rompió', () => {
    expect(deletionDaysLeft(pedida, new Date('2026-10-05T15:00:00Z'))).toBeLessThan(0);
  });
});
