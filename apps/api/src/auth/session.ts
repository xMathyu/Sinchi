/**
 * Sesión.
 *
 * La forma del token refleja la del producto: la identidad (`sub`) es global y
 * el gimnasio (`tenantId`) es contexto. Un alumno pertenece a varios gimnasios,
 * así que su token NO fija tenant: el gimnasio sale de la membresía que pide, y
 * se verifica que sea suya. Un miembro del staff sí trabaja en un local
 * concreto, y ahí el tenant viaja en el token.
 */
import type { AppRole } from '@sinchi/shared';

export interface SessionClaims {
  /** Id del usuario global. */
  readonly sub: string;
  readonly role: AppRole;
  /** Solo para staff: el gimnasio donde trabaja. */
  readonly tenantId?: string;
  /** Solo para staff: su fila en `staff`, que es lo que se audita. */
  readonly staffId?: string;
  /**
   * Cuándo caduca, en segundos epoch. Lo pone `jsonwebtoken` al firmar con
   * `expiresIn` y lo devuelve al verificar: aquí NUNCA se escribe a mano —
   * firmar un payload que ya trae `exp` junto a `expiresIn` es un error.
   *
   * Se declara porque el cambio de modo lo necesita: reemitir el token no puede
   * regalar vida nueva. Ver `switchToStudent`.
   */
  readonly exp?: number;
}

export interface Session extends SessionClaims {
  readonly isStaff: boolean;
}

export function toSession(claims: SessionClaims): Session {
  return { ...claims, isStaff: claims.role === 'front_desk' || claims.role === 'owner' };
}

/**
 * Sesión de staff, con tenant y staffId garantizados por tipo.
 *
 * Que exista este tipo evita el `session.tenantId!` repartido por los
 * controladores: si el guard dejó pasar a un staff, estos campos están.
 */
export interface StaffSession extends Session {
  readonly tenantId: string;
  readonly staffId: string;
}

export function assertStaffSession(session: Session): StaffSession {
  if (!session.isStaff || session.tenantId === undefined || session.staffId === undefined) {
    throw new Error('La sesión no es de staff.');
  }
  return session as StaffSession;
}

/**
 * La sesion del panel de SINCHI, que no es un rol de la app.
 *
 * Va aparte de `Session` y no como un `AppRole` mas, y es la decision de
 * seguridad de todo esto: `AppRole` nombra con que se abre la APP —alumno,
 * recepcion, dueno— y `Roles(...)` reparte las rutas de gimnasio entre esos
 * tres. Metiendo aqui un cuarto valor, cada ruta que hoy dice `StaffOnly()`
 * pasaria a tener que acordarse de excluirlo, y la que se olvide no falla: deja
 * entrar.
 *
 * Con dos formas separadas el guard decide UNA vez, por el discriminante
 * `scope`, y el resultado es simetrico: un token de Sinchi no abre ninguna ruta
 * de gimnasio, y un token de gimnasio no abre ninguna del panel de Sinchi.
 */
export interface AdminClaims {
  /** Su fila en `platform_admins`. */
  readonly sub: string;
  readonly email: string;
  /** El discriminante. Lo unico que distingue los dos mundos en el token. */
  readonly scope: 'platform';
  /** Igual que en `SessionClaims`: lo pone `jsonwebtoken` al firmar. */
  readonly exp?: number;
}

export const isAdminClaims = (claims: unknown): claims is AdminClaims =>
  typeof claims === 'object' &&
  claims !== null &&
  (claims as { scope?: unknown }).scope === 'platform';

declare module 'express' {
  interface Request {
    session?: Session;
    /** Puesta por `AuthGuard` cuando el token es del panel de Sinchi. */
    admin?: AdminClaims;
  }
}
