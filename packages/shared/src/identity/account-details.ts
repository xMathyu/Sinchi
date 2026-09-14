/**
 * Lo que una persona puede corregir de sí misma: su nombre y su celular.
 *
 * Lo corren las dos puntas —la app para apagar el botón, la api para no confiar
 * en que la app lo hizo— y por eso devuelve el motivo y no un booleano: el mismo
 * texto sale debajo del campo y en el 400 (decisiones §15).
 *
 * El documento no está, a propósito: lo lee el gimnasio del carné y es lo que
 * ancla quién es quién. Dejarlo editar es dejar que alguien se convierta en otra
 * persona ante el padrón.
 */
import { checkPhoneNumber, phoneDenialMessage, type PhoneDenial } from './phone.js';

export type AccountDetailsDenial = 'name_too_short' | 'name_too_long' | PhoneDenial;

export interface AccountDetailsDraft {
  readonly name: string;
  readonly phone: string;
}

const NAME_MAX = 120;

export function checkAccountDetails(draft: AccountDetailsDraft): AccountDetailsDenial | null {
  const name = draft.name.trim();
  if (name.length < 2) return 'name_too_short';
  if (name.length > NAME_MAX) return 'name_too_long';

  // La misma regla que el resto de formularios con celular: tenerla aparte es
  // cómo Mi cuenta acabaría aceptando un número que el registro rechaza.
  return checkPhoneNumber(draft.phone);
}

export function accountDetailsDenialMessage(denial: AccountDetailsDenial): string {
  switch (denial) {
    case 'name_too_short':
      return 'Escribe tu nombre: al menos dos letras.';
    case 'name_too_long':
      return `Tu nombre no puede pasar de ${NAME_MAX} caracteres.`;
    default:
      return phoneDenialMessage(denial);
  }
}
