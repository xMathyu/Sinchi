/**
 * Guard de sesión y de rol.
 *
 * Un solo guard hace las dos cosas a propósito: separarlos deja la puerta
 * abierta a registrar el de autenticación y olvidar el de autorización, que es
 * un error silencioso.
 */
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import type { AppRole } from '@sinchi/shared';
import { toSession, type Session, type SessionClaims } from './session';

const ROLES_KEY = 'sinchi:roles';
const PUBLIC_KEY = 'sinchi:public';

/** Marca una ruta como abierta. Solo salud y login. */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/** Restringe una ruta a ciertos roles. Sin esto, cualquier sesión válida pasa. */
export const Roles = (...roles: readonly AppRole[]) => SetMetadata(ROLES_KEY, roles);

/** Rutas de staff: recepción y dueño. */
export const StaffOnly = () => Roles('front_desk', 'owner');

/** Rutas de reportes: solo el dueño (MD 4.6). */
export const OwnerOnly = () => Roles('owner');

export const CurrentSession = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Session => {
    const request = context.switchToHttp().getRequest<Request>();
    if (request.session === undefined) {
      throw new UnauthorizedException('Sin sesión.');
    }
    return request.session;
  },
);

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handlers = [context.getHandler(), context.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, handlers) === true) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const token = extractBearer(request.headers.authorization);
    if (token === null) throw new UnauthorizedException('Falta el token de sesión.');

    let claims: SessionClaims;
    try {
      claims = await this.jwt.verifyAsync<SessionClaims>(token);
    } catch {
      // Sin detalle: distinguir "expirado" de "firma inválida" le dice a un
      // atacante si acertó el secreto.
      throw new UnauthorizedException('Sesión inválida o expirada.');
    }

    const session = toSession(claims);
    if (session.isStaff && (session.tenantId === undefined || session.staffId === undefined)) {
      throw new UnauthorizedException('Sesión de staff sin gimnasio asignado.');
    }
    request.session = session;

    const allowed = this.reflector.getAllAndOverride<readonly AppRole[]>(ROLES_KEY, handlers);
    if (allowed !== undefined && !allowed.includes(session.role)) {
      throw new ForbiddenException('Tu rol no tiene acceso a esta operación.');
    }

    return true;
  }
}

function extractBearer(header: string | undefined): string | null {
  if (header === undefined) return null;
  const [scheme, value] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || value === undefined || value.length === 0) return null;
  return value;
}
