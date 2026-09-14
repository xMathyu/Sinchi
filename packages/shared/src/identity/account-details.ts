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

export type AccountDetailsDenial = 'name_too_short' | 'name_too_long' | 'phone_invalid';

export interface AccountDetailsDraft {
  readonly name: string;
  readonly phone: string;
}

const NAME_MAX = 120;

/**
 * El celular con solo dígitos y el `+`.
 *
 * Es como se compara y como se guarda: «+51 987 654 321» y «+51987654321» son el
 * mismo número, y tratarlos como dos deja pasar el celular de otra persona.
 */
export function normalizePhoneNumber(raw: string): string {
  return raw.replace(/[^\d+]/g, '');
}

export function checkAccountDetails(draft: AccountDetailsDraft): AccountDetailsDenial | null {
  const name = draft.name.trim();
  if (name.length < 2) return 'name_too_short';
  if (name.length > NAME_MAX) return 'name_too_long';

  // Con el código del país, y hasta 15 dígitos, que es el tope de E.164. Sin
  // prefijo un número no dice de dónde es, y el mismo celular escrito con y sin
  // él pasaría por dos personas distintas.
  if (!/^\+\d{8,15}$/.test(normalizePhoneNumber(draft.phone))) return 'phone_invalid';

  return null;
}

export function accountDetailsDenialMessage(denial: AccountDetailsDenial): string {
  switch (denial) {
    case 'name_too_short':
      return 'Escribe tu nombre: al menos dos letras.';
    case 'name_too_long':
      return `Tu nombre no puede pasar de ${NAME_MAX} caracteres.`;
    case 'phone_invalid':
      return 'Revisa tu celular: va con el código del país, como +51987654321.';
  }
}
