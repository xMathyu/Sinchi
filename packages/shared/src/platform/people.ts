/**
 * Lo que el panel de Sinchi le puede hacer a una PERSONA.
 *
 * Una persona en Sinchi tiene dos formas, y las reglas tienen que valer para las
 * dos (glosario, «Conceptos del panel de Sinchi»):
 *
 *  - **con ficha**: una fila en `users`. Tiene documento, está en el padrón de
 *    uno o varios gimnasios, y puede que ni haya instalado la app —la
 *    recepcionista la inscribió antes—;
 *  - **sin ficha**: una cuenta de Google que entró a la app y no está en ningún
 *    padrón (`account_claims`). Es el curioso del directorio: reserva clases,
 *    escribe a los gimnasios, y no tiene documento.
 *
 * Las tres acciones —corregir, banear y eliminar— devuelven el MOTIVO y no un
 * booleano, y las corren los dos lados: el panel apaga el botón por el mismo
 * motivo exacto por el que la api respondería 400.
 */
import {
  checkAccountDetails,
  accountDetailsDenialMessage,
  type AccountDetailsDenial,
} from '../identity/account-details.js';
import { isWellFormedEmail, SUSPENSION_REASON_MAX, SUSPENSION_REASON_MIN } from './admin.js';

/** Los mismos topes que el alta de un alumno en el mostrador. */
export const DOCUMENT_ID_MIN = 6;
export const DOCUMENT_ID_MAX = 20;

/**
 * El motivo de un baneo: la misma vara que el de una suspensión.
 *
 * Por la misma razón. Es lo único que queda para explicárselo a quien pregunte
 * «¿por qué no puedo entrar?», y a nosotros mismos meses después. Una letra pasa
 * un `notNull` y no explica nada.
 */
export const BAN_REASON_MIN = SUSPENSION_REASON_MIN;
export const BAN_REASON_MAX = SUSPENSION_REASON_MAX;

// ---------------------------------------------------------------------------
// Corregir
// ---------------------------------------------------------------------------

export type PersonDetailsDenial = AccountDetailsDenial | 'document_invalid' | 'email_invalid';

export interface PersonDetailsDraft {
  readonly name: string;
  readonly phone: string;
  readonly documentId: string;
  /** Vacío = sin correo. Es opcional en la ficha. */
  readonly email: string;
}

/**
 * Corregir los datos de alguien desde el panel. `null` si se puede.
 *
 * Nombre y celular pasan por `checkAccountDetails`, LA MISMA que corre la app
 * cuando la persona se corrige a sí misma (decisiones §15): dos reglas para el
 * mismo celular es cómo el panel acabaría aceptando un número que la app
 * rechaza, o al revés.
 *
 * El panel puede además tocar dos cosas que la persona no puede, y por eso son
 * reglas aparte:
 *
 *  - **el documento.** La persona no lo edita porque es lo que ancla quién es
 *    quién ante el padrón. Nosotros sí, y no es contradicción: el caso real es
 *    el DNI mal tecleado en un mostrador, que después choca con el de la persona
 *    de verdad cuando la inscriben en otro gimnasio. Quien lo corrige ha visto el
 *    carné; queda en el registro quién fue.
 *  - **el correo.** La persona no lo edita porque cambiarlo exige verificar el
 *    nuevo. Aquí tampoco se verifica, y el registro es la red: corregirlo es lo
 *    que deja entrar a un dueño cuyo correo se escribió mal en el alta.
 */
export function checkPersonDetails(draft: PersonDetailsDraft): PersonDetailsDenial | null {
  const account = checkAccountDetails({ name: draft.name, phone: draft.phone });
  if (account !== null) return account;

  const document = draft.documentId.trim();
  if (document.length < DOCUMENT_ID_MIN || document.length > DOCUMENT_ID_MAX) {
    return 'document_invalid';
  }
  // Letras y números, nada más: carné de extranjería lleva letras, un DNI no, y
  // un espacio o un guion copiados de otro lado hacen que el índice único no
  // reconozca a la misma persona escrita de dos formas.
  if (!/^[A-Za-z0-9]+$/.test(document)) return 'document_invalid';

  const email = draft.email.trim();
  if (email.length > 0 && !isWellFormedEmail(email)) return 'email_invalid';

  return null;
}

export function personDetailsDenialMessage(reason: PersonDetailsDenial): string {
  switch (reason) {
    case 'document_invalid':
      return `El documento va de ${DOCUMENT_ID_MIN} a ${DOCUMENT_ID_MAX} letras o números, sin espacios.`;
    case 'email_invalid':
      return 'Ese correo no parece válido. Déjalo vacío si la persona no tiene.';
    default:
      return accountDetailsDenialMessage(reason);
  }
}

// ---------------------------------------------------------------------------
// Banear
// ---------------------------------------------------------------------------

export type PersonBanDenial = 'reason_too_short' | 'reason_too_long' | 'already_banned';

export interface PersonBanDraft {
  readonly reason: string;
  /** Si ya tiene un baneo vivo. */
  readonly banned: boolean;
}

/**
 * Banear a una persona. `null` si se puede.
 *
 * Banear no toca sus datos: su ficha sigue en el padrón de su gimnasio, sus
 * pagos siguen en la caja. Lo que pierde es la app —entrar, escribir a los
 * gimnasios, reservar desde el directorio—. La diferencia con eliminar la cuenta
 * es justo esa, y por eso son dos acciones y no una con dos grados.
 */
export function checkPersonBan(draft: PersonBanDraft): PersonBanDenial | null {
  if (draft.banned) return 'already_banned';
  const reason = draft.reason.trim();
  if (reason.length < BAN_REASON_MIN) return 'reason_too_short';
  if (reason.length > BAN_REASON_MAX) return 'reason_too_long';
  return null;
}

export function personBanDenialMessage(reason: PersonBanDenial): string {
  switch (reason) {
    case 'reason_too_short':
      return `Escribe el motivo, de al menos ${BAN_REASON_MIN} caracteres: es lo que vas a poder contestar cuando pregunten.`;
    case 'reason_too_long':
      return `El motivo no puede pasar de ${BAN_REASON_MAX} caracteres.`;
    case 'already_banned':
      return 'Esa persona ya está baneada.';
  }
}

// ---------------------------------------------------------------------------
// Eliminar
// ---------------------------------------------------------------------------

export type PersonDeletionDenial = 'is_staff' | 'confirmation_mismatch';

export interface PersonDeletionDraft {
  /** Los gimnasios donde trabaja. Vacío si no trabaja en ninguno. */
  readonly staffOf: readonly string[];
  /** Lo que hay que escribir para confirmar (`personConfirmationKey`). */
  readonly key: string;
  /** Lo que se escribió. */
  readonly typed: string;
}

/**
 * Eliminar la cuenta de una persona. `null` si se puede.
 *
 *  - **Quien trabaja en un gimnasio no se elimina desde aquí.** Su fila de
 *    `staff` es la que abre ese local: borrarla deja un gimnasio sin nadie que
 *    pueda entrar a él, y un dueño que pide la baja casi nunca quiere eso.
 *    Primero sale del equipo —o se elimina el gimnasio—, y después se va él. La
 *    base lo impide igualmente (`staff.user_id` es RESTRICT); esto es para
 *    decirlo con palabras antes de chocar.
 *  - **Se escribe lo que la identifica.** La misma cerradura que el borrado de
 *    un gimnasio: teclearlo obliga a mirar A QUIÉN se está borrando.
 *
 * No exige un baneo previo, al revés que el gimnasio con la suspensión: la baja
 * casi siempre la pide la propia persona (Google Play obliga a ofrecerla), y
 * banear a alguien para poder cumplirle un derecho sería absurdo.
 */
export function checkPersonDeletion(draft: PersonDeletionDraft): PersonDeletionDenial | null {
  if (draft.staffOf.length > 0) return 'is_staff';
  if (draft.typed.trim().toLowerCase() !== draft.key.trim().toLowerCase()) {
    return 'confirmation_mismatch';
  }
  return null;
}

export function personDeletionDenialMessage(
  reason: PersonDeletionDenial,
  staffOf: readonly string[] = [],
): string {
  switch (reason) {
    case 'is_staff':
      return staffOf.length === 0
        ? 'Trabaja en un gimnasio: primero tiene que salir de ese equipo.'
        : `Trabaja en ${staffOf.join(', ')}: primero tiene que salir de ese equipo, o eliminarse el gimnasio.`;
    case 'confirmation_mismatch':
      return 'Lo escrito no coincide. Escríbelo tal cual para confirmar.';
  }
}

/**
 * Qué se escribe para confirmar que se borra a ESTA persona.
 *
 * El documento, si tiene ficha: es único en la red y no se confunde con el de
 * nadie. Sin ficha no hay documento, así que el correo de su cuenta de Google —
 * el que tiene casi siempre— o, a falta de él, su celular.
 *
 * Se compara sin distinguir mayúsculas: un correo se escribe como sea, y lo que
 * importa es haberlo mirado, no la tecla de mayúsculas.
 */
export function personConfirmationKey(person: {
  readonly documentId: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly firebaseUid: string | null;
}): string {
  return person.documentId ?? person.email ?? person.phone ?? person.firebaseUid ?? '';
}

/**
 * Cuántos días le quedan a una baja pedida para cumplir lo prometido.
 *
 * La política publicada (`/eliminar-cuenta`) promete completar el borrado
 * dentro de los 30 días. La cuenta la hace el dominio y no la pantalla porque
 * es un plazo con consecuencias: una baja vencida es una promesa legal rota.
 */
export const DELETION_DEADLINE_DAYS = 30;

export function deletionDaysLeft(requestedAt: Date, now: Date): number {
  const elapsed = Math.floor((now.getTime() - requestedAt.getTime()) / 86_400_000);
  return DELETION_DEADLINE_DAYS - elapsed;
}
