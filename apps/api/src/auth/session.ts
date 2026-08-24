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

declare module 'express' {
  interface Request {
    session?: Session;
  }
}
