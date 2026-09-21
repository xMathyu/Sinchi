/**
 * Las reglas del panel de Sinchi.
 *
 * Lo que se prueba aquí no es aritmética: son las dos cerraduras que impiden
 * perder algo que no se puede recuperar —quedarse sin ningún administrador, y
 * borrar un gimnasio de un clic—. Si alguna de estas pruebas se «arregla»
 * relajando la regla, lo que cambió es el producto.
 */
import { describe, expect, it } from 'vitest';
import {
  ADMIN_EMAIL_MAX,
  SUSPENSION_REASON_MIN,
  adminInviteDenialMessage,
  adminRevocationDenialMessage,
  checkAdminInvite,
  checkAdminRevocation,
  checkGymDeletion,
  checkGymSuspension,
  gymDeletionDenialMessage,
  gymSuspensionDenialMessage,
  isPromoExpired,
  isWellFormedAdminEmail,
  normalizeAdminEmail,
  platformActionLabel,
  type PlatformActionKind,
} from './admin.js';
import { plainDate } from '../time/plain-date.js';

describe('normalizeAdminEmail', () => {
  it('lleva a la misma forma lo que se escribe distinto', () => {
    for (const input of ['XMathyu@Gmail.com', ' xmathyu@gmail.com ', 'XMATHYU@GMAIL.COM']) {
      expect(normalizeAdminEmail(input), input).toBe('xmathyu@gmail.com');
    }
  });

  /**
   * Los puntos NO se quitan.
   *
   * `a.b@gmail.com` y `ab@gmail.com` son la misma bandeja en Gmail y buzones
   * distintos en casi todo lo demás. Normalizar por las reglas de un proveedor
   * es cómo se acaba dando acceso a una dirección que su dueño no controla.
   */
  it('no toca la parte local', () => {
    expect(normalizeAdminEmail('x.mathyu+sinchi@gmail.com')).toBe('x.mathyu+sinchi@gmail.com');
  });
});

describe('isWellFormedAdminEmail', () => {
  it('acepta lo que parece un correo', () => {
    expect(isWellFormedAdminEmail('xmathyu@gmail.com')).toBe(true);
    expect(isWellFormedAdminEmail('soporte@sinchi.fit')).toBe(true);
  });

  it('rechaza lo que no lo es', () => {
    for (const input of ['', 'xmathyu', 'xmathyu@', '@gmail.com', 'a@b', 'dos @ correos@x.com']) {
      expect(isWellFormedAdminEmail(input), input).toBe(false);
    }
  });

  it('rechaza un correo más largo que el del RFC', () => {
    expect(isWellFormedAdminEmail(`${'a'.repeat(ADMIN_EMAIL_MAX)}@gmail.com`)).toBe(false);
  });
});

describe('checkAdminInvite', () => {
  const current = ['xmathyu@gmail.com'];

  it('deja invitar a alguien nuevo', () => {
    expect(checkAdminInvite({ email: 'dev@sinchi.fit', current })).toBeNull();
  });

  it('no deja invitar dos veces al mismo, escrito distinto', () => {
    expect(checkAdminInvite({ email: ' XMathyu@Gmail.com ', current })).toBe('already_admin');
  });

  /**
   * A quien se le retiró el acceso se le puede volver a invitar: `current` solo
   * trae los vivos. Rechazarlo por «ya existe» quemaría un correo para siempre
   * por un despido que se deshizo.
   */
  it('deja volver a invitar a quien ya no está', () => {
    expect(checkAdminInvite({ email: 'exdev@sinchi.fit', current })).toBeNull();
  });

  it('cada motivo tiene su frase', () => {
    expect(adminInviteDenialMessage('malformed_email')).toContain('Google');
    expect(adminInviteDenialMessage('already_admin')).toContain('ya tiene acceso');
  });
});

describe('checkAdminRevocation', () => {
  it('deja quitar el acceso a otro cuando quedan más', () => {
    expect(
      checkAdminRevocation({ adminId: 'b', actingAdminId: 'a', liveCount: 2 }),
    ).toBeNull();
  });

  it('nunca a ti mismo', () => {
    expect(checkAdminRevocation({ adminId: 'a', actingAdminId: 'a', liveCount: 3 })).toBe('self');
  });

  /**
   * El caso que deja el panel cerrado para siempre: el último administrador
   * fuera y nadie dentro que pueda volver a invitar. Recuperarse de eso es
   * escribir SQL a mano contra Neon.
   */
  it('nunca al último, aunque sea otro', () => {
    expect(checkAdminRevocation({ adminId: 'b', actingAdminId: 'a', liveCount: 1 })).toBe(
      'last_one',
    );
  });

  it('cada motivo tiene su frase', () => {
    expect(adminRevocationDenialMessage('self')).toContain('otro administrador');
    expect(adminRevocationDenialMessage('last_one')).toContain('último');
  });
});

describe('checkGymSuspension', () => {
  it('deja suspender con un motivo escrito', () => {
    expect(
      checkGymSuspension({ reason: 'Cobra por fuera y no responde', status: 'active' }),
    ).toBeNull();
  });

  /**
   * El motivo es lo único que queda para explicarle la suspensión al dueño por
   * teléfono, y a nosotros mismos seis meses después. Una letra pasa un
   * `notNull` y no explica nada.
   */
  it('exige un motivo de verdad', () => {
    expect(checkGymSuspension({ reason: 'x', status: 'active' })).toBe('reason_too_short');
    expect(checkGymSuspension({ reason: '   spam   ', status: 'active' })).toBe(
      'reason_too_short',
    );
    expect('x'.repeat(SUSPENSION_REASON_MIN).length).toBe(SUSPENSION_REASON_MIN);
  });

  it('no suspende dos veces', () => {
    expect(
      checkGymSuspension({ reason: 'Cobra por fuera y no responde', status: 'suspended' }),
    ).toBe('already_suspended');
  });

  it('cada motivo tiene su frase', () => {
    expect(gymSuspensionDenialMessage('reason_too_short')).toContain('dueño');
    expect(gymSuspensionDenialMessage('already_suspended')).toContain('ya está suspendido');
    expect(gymSuspensionDenialMessage('reason_too_long')).toContain('no puede pasar');
  });
});

describe('checkGymDeletion', () => {
  const suspendido = { slug: 'iron-muay-thai', status: 'suspended' } as const;

  it('deja borrar un gimnasio suspendido con su identificador escrito', () => {
    expect(checkGymDeletion({ ...suspendido, typed: 'iron-muay-thai' })).toBeNull();
    // Los espacios de un copiar y pegar no son un error de la persona.
    expect(checkGymDeletion({ ...suspendido, typed: ' iron-muay-thai ' })).toBeNull();
  });

  /**
   * Un gimnasio activo no se borra nunca de primeras: primero se suspende, con
   * su motivo y su aviso al dueño. Así el borrado no puede ser el primer
   * contacto — y un clic en la fila equivocada no se lleva un negocio.
   */
  it('no borra un gimnasio activo', () => {
    expect(
      checkGymDeletion({ slug: 'iron-muay-thai', status: 'active', typed: 'iron-muay-thai' }),
    ).toBe('not_suspended');
  });

  it('no borra si lo escrito no coincide', () => {
    expect(checkGymDeletion({ ...suspendido, typed: 'iron muay thai' })).toBe('slug_mismatch');
    expect(checkGymDeletion({ ...suspendido, typed: '' })).toBe('slug_mismatch');
    // Sin comodines: es justo lo que se llevaría el dojo de al lado.
    expect(checkGymDeletion({ ...suspendido, typed: 'iron-*' })).toBe('slug_mismatch');
  });

  it('cada motivo tiene su frase', () => {
    expect(gymDeletionDenialMessage('not_suspended')).toContain('Suspéndelo primero');
    expect(gymDeletionDenialMessage('slug_mismatch')).toContain('no coincide');
  });
});

describe('platformActionLabel', () => {
  it('nombra en pasado todo lo que se registra', () => {
    const kinds: readonly PlatformActionKind[] = [
      'gym.update',
      'gym.suspend',
      'gym.restore',
      'gym.delete',
      'gym.payment',
      'promo.create',
      'promo.disable',
      'admin.invite',
      'admin.revoke',
    ];
    for (const kind of kinds) expect(platformActionLabel(kind), kind).not.toBe('');
  });
});

describe('isPromoExpired', () => {
  const hoy = plainDate(2026, 9, 21);

  it('un código sin fecha no vence', () => {
    expect(isPromoExpired(null, hoy)).toBe(false);
  });

  it('el último día todavía canjea', () => {
    expect(isPromoExpired(plainDate(2026, 9, 21), hoy)).toBe(false);
    expect(isPromoExpired(plainDate(2026, 9, 20), hoy)).toBe(true);
  });
});
