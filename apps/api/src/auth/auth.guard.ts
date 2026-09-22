/**
 * Guard de sesión y de rol.
 *
 * Un solo guard hace las dos cosas a propósito: separarlos deja la puerta
 * abierta a registrar el de autenticación y olvidar el de autorización, que es
 * un error silencioso.
 *
 * Y desde el panel de Sinchi hace una tercera, por el mismo motivo: reparte los
 * dos tipos de token que firma este servidor —el de un gimnasio y el de quien
 * administra la plataforma— y los mantiene excluyentes. Ese reparto tiene que
 * ocurrir en el mismo sitio donde se verifica la firma; en cualquier otro, la
 * ruta que se olvide de comprobarlo deja entrar.
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
import { AccountBans } from './account-bans';
import {
  isAdminClaims,
  toSession,
  type AdminClaims,
  type Session,
  type SessionClaims,
} from './session';

const ROLES_KEY = 'sinchi:roles';
const PUBLIC_KEY = 'sinchi:public';
const ADMIN_KEY = 'sinchi:platform-admin';

/** Marca una ruta como abierta. Solo salud y login. */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/** Restringe una ruta a ciertos roles. Sin esto, cualquier sesión válida pasa. */
export const Roles = (...roles: readonly AppRole[]) => SetMetadata(ROLES_KEY, roles);

/** Rutas de staff: recepción y dueño. */
export const StaffOnly = () => Roles('front_desk', 'owner');

/** Rutas de reportes: solo el dueño (MD 4.6). */
export const OwnerOnly = () => Roles('owner');

/**
 * Rutas del panel de SINCHI: las que cruzan gimnasios.
 *
 * Es excluyente en los dos sentidos, y eso es lo que la hace segura: una ruta
 * marcada así rechaza cualquier sesión de gimnasio —aunque sea de un dueño— y
 * un token del panel de Sinchi no abre ninguna ruta que NO esté marcada así.
 * Con un rol más dentro de `AppRole`, la segunda mitad habría que recordarla
 * ruta por ruta, y la que se olvidara no fallaría: dejaría entrar.
 *
 * Solo comprueba el TOKEN. Que el acceso siga vivo lo comprueba
 * `PlatformAdminGuard` releyendo la fila en cada petición: retirarle el acceso a
 * alguien tiene que cortar el que ya tiene abierto, no esperar a que caduque.
 */
export const AdminOnly = () => SetMetadata(ADMIN_KEY, true);

/** Quién administra Sinchi en esta petición. Solo en rutas `@AdminOnly()`. */
export const CurrentAdmin = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AdminClaims => {
    const request = context.switchToHttp().getRequest<Request>();
    if (request.admin === undefined) {
      throw new UnauthorizedException('Sin sesión del panel de Sinchi.');
    }
    return request.admin;
  },
);

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
    private readonly bans: AccountBans,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handlers = [context.getHandler(), context.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, handlers) === true) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const token = extractBearer(request.headers.authorization);
    if (token === null) throw new UnauthorizedException('Falta el token de sesión.');

    let claims: SessionClaims | AdminClaims;
    try {
      claims = await this.jwt.verifyAsync<SessionClaims | AdminClaims>(token);
    } catch {
      // Sin detalle: distinguir "expirado" de "firma inválida" le dice a un
      // atacante si acertó el secreto.
      throw new UnauthorizedException('Sesión inválida o expirada.');
    }

    /**
     * Los dos mundos se separan aquí, y en un solo sitio.
     *
     * El mismo secreto firma los dos tokens —es el mismo servidor— así que lo
     * que los distingue es el discriminante `scope`. Las dos ramas son
     * excluyentes a propósito: sin el `throw` de la segunda, un dueño con su
     * sesión normal entraría a las rutas que suspenden gimnasios ajenos.
     */
    const wantsAdmin = this.reflector.getAllAndOverride<boolean>(ADMIN_KEY, handlers) === true;

    if (isAdminClaims(claims)) {
      if (!wantsAdmin) {
        throw new ForbiddenException(
          'La sesión del panel de Sinchi no abre las rutas de un gimnasio.',
        );
      }
      request.admin = claims;
      return true;
    }

    if (wantsAdmin) {
      throw new ForbiddenException('Esto es del panel de Sinchi.');
    }

    const session = toSession(claims);
    if (session.isStaff && (session.tenantId === undefined || session.staffId === undefined)) {
      throw new UnauthorizedException('Sesión de staff sin gimnasio asignado.');
    }
    request.session = session;

    /**
     * Un token de siete días no puede sobrevivir a un baneo.
     *
     * La sesión del alumno dura una semana a propósito (abre la app en la puerta,
     * a veces sin datos), así que esperar a que caduque sería una semana más de
     * app para alguien a quien acabamos de sacar. Se mira contra la lista en
     * memoria de `AccountBans`: no cuesta un viaje a la base por petición.
     *
     * Responde 401 y no 403: es lo que hace que la app suelte la sesión y lleve
     * a la persona al login, donde sí lee el motivo (ver `assertSessionNotBanned`).
     */
    await this.bans.assertSessionNotBanned(session.sub);

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
