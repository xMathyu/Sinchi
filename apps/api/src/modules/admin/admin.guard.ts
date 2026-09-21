/**
 * El acceso al panel de Sinchi sigue vigente.
 *
 * `AuthGuard` ya comprobó que el token es del panel y que la firma es nuestra.
 * Lo que este guard agrega es una pregunta que el token no puede responder:
 * **¿esa persona sigue teniendo acceso?**
 *
 * Cuesta una consulta por petición y se paga a propósito. El token vive doce
 * horas; sin esta relectura, retirarle el acceso a alguien no surtiría efecto
 * hasta que caducara — medio día de poder sobre la red entera para quien ya no
 * debería tenerlo. Es el mismo razonamiento por el que `switch-to-staff` vuelve
 * a leer `staff` en vez de creerle al rol firmado.
 *
 * Va como guard del controlador y no como una línea al principio de cada
 * método: una ruta nueva nace comprobada, y añadirla sin la comprobación exige
 * sacarla del controlador a propósito.
 */
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { PlatformAdminService } from './platform-admin.service';

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(private readonly admins: PlatformAdminService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const claims = request.admin;

    // Sin `@AdminOnly()` en la ruta, `AuthGuard` no deja esto puesto. Que sea un
    // 401 y no un 500 es deliberado: pasa cuando alguien registra este guard en
    // una ruta que olvidó marcar, y el mensaje tiene que servir para arreglarlo.
    if (claims === undefined) {
      throw new UnauthorizedException('Sin sesión del panel de Sinchi.');
    }

    await this.admins.requireLive(claims.sub);
    return true;
  }
}
