/**
 * Quién administra Sinchi, y qué se le deja hacer con un gimnasio ajeno.
 *
 * Es el otro lado del producto. `Staff` es quien trabaja EN un gimnasio; esto es
 * quien trabaja EN Sinchi: da de baja a un local que abusa, reparte códigos de
 * promoción y mira la red entera. Son poderes que ningún dueño tiene, así que no
 * se apoyan en `staff` ni en `AppRole` — un `owner` con una fila de más no puede
 * convertirse en esto (glosario, «Conceptos del panel de Sinchi»).
 *
 * Las reglas viven aquí por lo mismo que las del gimnasio: las corren los dos
 * lados. El panel apaga el botón de «eliminar» por el mismo motivo exacto por el
 * que la api responde 400, y devuelven el MOTIVO y no un booleano — «no se pudo»
 * deja a quien lo lee sin saber qué corregir.
 */
import type { PlainDate } from '../time/plain-date.js';
import { isAfter } from '../time/plain-date.js';

/**
 * Tope de un correo, el del RFC 5321.
 *
 * No es cosmético: el correo es la LLAVE del administrador —se invita por correo
 * y se reconoce por correo al entrar— y una columna sin tope es una columna
 * donde alguien pega un documento entero.
 */
export const ADMIN_EMAIL_MAX = 254;

/** Cómo se llama quien administra Sinchi, en la pantalla. */
export const ADMIN_NAME_MAX = 120;

/**
 * Forma canónica del correo: minúsculas y sin espacios alrededor.
 *
 * Se guarda normalizado, así que el índice único compara lo mismo que compara la
 * búsqueda del login. Sin esto, invitar a `Xmathyu@Gmail.com` crea una segunda
 * fila que nunca coincide con la del que entra — y peor: retirarle el acceso a
 * una de las dos deja la otra viva.
 *
 * Lo que NO se hace es tocar la parte local (quitar puntos, cortar en el `+`):
 * `a.b@gmail.com` y `ab@gmail.com` son la misma bandeja en Gmail y buzones
 * distintos en casi todo lo demás. Normalizar por las reglas de un proveedor es
 * cómo se acaba dando acceso a una dirección que su dueño no controla.
 */
export function normalizeAdminEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Si eso parece un correo.
 *
 * Deliberadamente laxa —algo, una arroba, algo con un punto— y no el monstruo
 * del RFC: la comprobación que de verdad importa no es sintáctica sino que quien
 * entra presente ese correo VERIFICADO por Google. Una expresión regular
 * estricta solo agrega falsos rechazos a direcciones legítimas raras.
 */
export function isWellFormedAdminEmail(raw: string): boolean {
  const email = normalizeAdminEmail(raw);
  if (email.length === 0 || email.length > ADMIN_EMAIL_MAX) return false;
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email);
}

export type AdminInviteDenial = 'malformed_email' | 'already_admin';

export interface AdminInviteDraft {
  readonly email: string;
  /** Los correos que ya tienen acceso VIVO, normalizados. */
  readonly current: readonly string[];
}

/**
 * Invitar a alguien al panel de Sinchi. `null` si se puede.
 *
 * `already_admin` mira solo a los que tienen el acceso vivo: a quien se le
 * retiró se le puede volver a invitar, y eso reabre su misma fila en vez de
 * crear una segunda. La alternativa —rechazarlo por «ya existe»— dejaría un
 * correo quemado para siempre por un despido que se deshizo.
 */
export function checkAdminInvite(draft: AdminInviteDraft): AdminInviteDenial | null {
  if (!isWellFormedAdminEmail(draft.email)) return 'malformed_email';
  const email = normalizeAdminEmail(draft.email);
  if (draft.current.some((current) => normalizeAdminEmail(current) === email)) {
    return 'already_admin';
  }
  return null;
}

export function adminInviteDenialMessage(reason: AdminInviteDenial): string {
  switch (reason) {
    case 'malformed_email':
      return 'Ese correo no parece válido. Entra con Google, así que tiene que ser el de su cuenta.';
    case 'already_admin':
      return 'Ese correo ya tiene acceso al panel.';
  }
}

export type AdminRevocationDenial = 'self' | 'last_one';

export interface AdminRevocationDraft {
  /** A quién se le quita. */
  readonly adminId: string;
  /** Quién lo está quitando. */
  readonly actingAdminId: string;
  /** Cuántos tienen el acceso vivo ahora mismo, contando al que se va. */
  readonly liveCount: number;
}

/**
 * Retirarle el acceso a alguien. `null` si se puede.
 *
 * Dos negativas, y las dos existen para el mismo fallo: quedarse fuera del panel
 * que administra la plataforma entera, sin nadie dentro que pueda volver a
 * invitarte. Recuperarse de eso es escribir SQL a mano contra Neon.
 *
 *  - **a ti mismo, no.** Nadie quiere quitarse su propio acceso; quien pulsa ahí
 *    se equivocó de fila. Y no hay caso legítimo: irse del proyecto se hace
 *    pidiéndole a otro que te retire, que además deja el hecho firmado por quien
 *    lo decidió.
 *  - **al último, tampoco.** Aunque sea otro: un panel con cero administradores
 *    no lo puede reabrir nadie desde dentro.
 */
export function checkAdminRevocation(draft: AdminRevocationDraft): AdminRevocationDenial | null {
  if (draft.adminId === draft.actingAdminId) return 'self';
  if (draft.liveCount <= 1) return 'last_one';
  return null;
}

export function adminRevocationDenialMessage(reason: AdminRevocationDenial): string {
  switch (reason) {
    case 'self':
      return 'No puedes quitarte tu propio acceso. Que te lo quite otro administrador.';
    case 'last_one':
      return 'Es el último administrador. Invita a alguien más antes de quitarle el acceso.';
  }
}

// ---------------------------------------------------------------------------
// Lo que se le puede hacer a un gimnasio desde fuera
// ---------------------------------------------------------------------------

/**
 * Lo corto que puede ser el motivo de una suspensión.
 *
 * Hay un mínimo a propósito. Suspender un gimnasio le corta la entrada al dueño
 * y lo saca del directorio, y el motivo es lo único que queda para explicárselo
 * —a él por teléfono, y a nosotros mismos seis meses después—. «x» pasa un
 * `notNull` y no explica nada.
 */
export const SUSPENSION_REASON_MIN = 12;
export const SUSPENSION_REASON_MAX = 400;

export type GymSuspensionDenial = 'reason_too_short' | 'reason_too_long' | 'already_suspended';

export interface GymSuspensionDraft {
  readonly reason: string;
  /** Cómo está el gimnasio ahora. */
  readonly status: 'active' | 'suspended';
}

export function checkGymSuspension(draft: GymSuspensionDraft): GymSuspensionDenial | null {
  if (draft.status === 'suspended') return 'already_suspended';
  const reason = draft.reason.trim();
  if (reason.length < SUSPENSION_REASON_MIN) return 'reason_too_short';
  if (reason.length > SUSPENSION_REASON_MAX) return 'reason_too_long';
  return null;
}

export function gymSuspensionDenialMessage(reason: GymSuspensionDenial): string {
  switch (reason) {
    case 'reason_too_short':
      return `Escribe el motivo, de al menos ${SUSPENSION_REASON_MIN} caracteres: es lo que le vas a explicar al dueño.`;
    case 'reason_too_long':
      return `El motivo no puede pasar de ${SUSPENSION_REASON_MAX} caracteres.`;
    case 'already_suspended':
      return 'Ese gimnasio ya está suspendido.';
  }
}

export type GymDeletionDenial = 'not_suspended' | 'slug_mismatch';

export interface GymDeletionDraft {
  /** El identificador real del gimnasio. */
  readonly slug: string;
  /** Lo que se escribió en la casilla de confirmación. */
  readonly typed: string;
  readonly status: 'active' | 'suspended';
}

/**
 * Borrar un gimnasio. `null` si se puede.
 *
 * Borrar es en cascada y no tiene vuelta: se lleva el padrón, la caja, las
 * asistencias y la biblioteca de un negocio de verdad. Las dos reglas son las
 * mismas que `db:purge` ya defendía desde la línea de comandos, subidas al
 * dominio para que la pantalla pueda apagar el botón por el mismo motivo:
 *
 *  - **antes hay que suspenderlo.** Así el borrado nunca es el primer contacto:
 *    hay un motivo escrito, un dueño avisado y un tiempo en medio para que
 *    alguien diga que no. Un botón de borrar que se puede pulsar de primeras es
 *    un negocio que desaparece por un clic en la fila equivocada.
 *  - **el identificador se escribe.** Sin comodines y sin «confirmar»: teclear
 *    `iron-muay-thai` es lo que obliga a mirar QUÉ se está borrando.
 */
export function checkGymDeletion(draft: GymDeletionDraft): GymDeletionDenial | null {
  if (draft.status !== 'suspended') return 'not_suspended';
  if (draft.typed.trim() !== draft.slug) return 'slug_mismatch';
  return null;
}

export function gymDeletionDenialMessage(reason: GymDeletionDenial): string {
  switch (reason) {
    case 'not_suspended':
      return 'Solo se puede eliminar un gimnasio suspendido. Suspéndelo primero, con su motivo.';
    case 'slug_mismatch':
      return 'El identificador no coincide. Escríbelo tal cual para confirmar.';
  }
}

// ---------------------------------------------------------------------------
// El registro
// ---------------------------------------------------------------------------

/**
 * Lo que un administrador de Sinchi hizo, para el registro.
 *
 * Es una unión cerrada y no texto libre: lo que se escribe aquí se lee meses
 * después buscando «quién suspendió a este gimnasio», y una cadena suelta se
 * escribe distinta cada vez (`gym.suspend`, `suspend_gym`, `suspendió`) hasta
 * que el filtro deja de encontrar la mitad.
 */
export type PlatformActionKind =
  | 'gym.update'
  | 'gym.suspend'
  | 'gym.restore'
  | 'gym.delete'
  | 'gym.payment'
  | 'promo.create'
  | 'promo.disable'
  | 'admin.invite'
  | 'admin.revoke';

/** Cómo se lee cada acción en el registro. En pasado: ya ocurrió. */
export function platformActionLabel(kind: PlatformActionKind): string {
  switch (kind) {
    case 'gym.update':
      return 'editó el gimnasio';
    case 'gym.suspend':
      return 'suspendió el gimnasio';
    case 'gym.restore':
      return 'reactivó el gimnasio';
    case 'gym.delete':
      return 'eliminó el gimnasio';
    case 'gym.payment':
      return 'registró un pago';
    case 'promo.create':
      return 'creó el código';
    case 'promo.disable':
      return 'apagó el código';
    case 'admin.invite':
      return 'dio acceso al panel';
    case 'admin.revoke':
      return 'quitó el acceso al panel';
  }
}

/**
 * Si la acción es de las que no se pueden deshacer.
 *
 * La usa el registro para pintarlas distinto. Suspender se deshace reactivando;
 * borrar no se deshace, y una lista donde las dos se leen igual es una lista que
 * no ayuda a encontrar el día que algo se perdió.
 */
export const isIrreversibleAction = (kind: PlatformActionKind): boolean =>
  kind === 'gym.delete' || kind === 'promo.create' || kind === 'gym.payment';

// ---------------------------------------------------------------------------
// Fin del acceso
// ---------------------------------------------------------------------------

/**
 * Si una sesión del panel de Sinchi sigue viva.
 *
 * El token es corto de vida a propósito (`ADMIN_SESSION_HOURS`), pero eso no
 * basta: retirarle el acceso a alguien tiene que cortar el que YA tiene abierto,
 * no esperar a que caduque. Por eso cada petición del panel vuelve a leer la
 * fila, y esta función es la pregunta que se le hace.
 */
export function isAdminAccessLive(admin: { readonly revokedAt: Date | string | null }): boolean {
  return admin.revokedAt === null;
}

/**
 * Doce horas.
 *
 * La sesión del alumno dura una semana porque abre la app en la puerta del
 * gimnasio, muchas veces sin datos, y dejarlo fuera ahí es el peor momento. Esta
 * no: este token suspende y elimina gimnasios, y su dueño está sentado frente a
 * un navegador con Google a un clic. Una jornada es todo lo que necesita vivir.
 */
export const ADMIN_SESSION_HOURS = 12;

/** Si un código de promoción ya venció, para pintarlo apagado. */
export function isPromoExpired(expiresOn: PlainDate | null, today: PlainDate): boolean {
  return expiresOn !== null && isAfter(today, expiresOn);
}
