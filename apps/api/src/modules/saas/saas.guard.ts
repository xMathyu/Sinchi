/**
 * El corte por impago del GIMNASIO.
 *
 * Cuando la suscripcion a Sinchi vence y no se paga, la cuenta cae a solo
 * lectura. Este guard es ese corte, y su forma responde a una decision de
 * producto: **la puerta nunca se cierra**. El check-in del alumno que si le pago
 * a su gimnasio no es la palanca de cobro de Sinchi — cortarlo castiga a quien
 * no debe nada, delante de todos, y la reaccion del dueno es volver al cuaderno
 * ese mismo dia.
 *
 * Bloquea por defecto y se abre a mano con `@AllowedWhenReadOnly()`, igual que
 * `AuthGuard` protege por defecto y se abre con `@Public()`. Al reves —abierto
 * por defecto y bloqueado a mano— cada ruta nueva nacería regalando el producto,
 * y ese olvido no se nota nunca porque nada falla.
 *
 * Solo mira sesiones de STAFF. Un alumno cambiando de plan desde su app no crea
 * ingreso para el gimnasio y su tenant no viaja en la sesion sino en la
 * membresia que pide, asi que meterlo aqui costaria una consulta extra por
 * peticion a cambio de nada.
 */
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { saasNotice, saasPrice } from '@sinchi/shared';
import { SaasService } from './saas.service';

const ALLOWED_WHEN_READ_ONLY = 'sinchi:saas-bypass';

/**
 * Deja pasar la ruta aunque el gimnasio no haya pagado.
 *
 * Solo para lo que sostiene la promesa de que la puerta sigue: marcar, subir la
 * cola offline del mostrador, y lo que hace falta para poder marcar —fijar el
 * PIN de turno y registrar un equipo—. Sin esas dos ultimas, una tablet rota
 * dejaria al gimnasio sin puerta, que es exactamente lo que se prometio no
 * hacer.
 */
export const AllowedWhenReadOnly = () => SetMetadata(ALLOWED_WHEN_READ_ONLY, true);

/** Los verbos que no crean nada. Leer nunca se corta: sus datos siguen siendo suyos. */
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class SaasGuard implements CanActivate {
  constructor(
    private readonly saas: SaasService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    if (READ_METHODS.has(request.method)) return true;

    const allowed = this.reflector.getAllAndOverride<boolean>(ALLOWED_WHEN_READ_ONLY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowed === true) return true;

    const session = request.session;
    if (session === undefined || !session.isStaff || session.tenantId === undefined) return true;

    const state = await this.saas.stateFor(session.tenantId);
    if (state.canWrite) return true;

    // El motivo va estructurado y con el texto de `shared`, no un 403 pelado:
    // quien lo lee es una recepcionista con un alumno delante, y "prohibido" no
    // le dice que hacer. El precio no importa aqui —el corte no depende del
    // escalon— asi que se usa la tarifa base para no contar el padron en una
    // peticion que ya fallo.
    const notice = saasNotice(state, saasPrice('up_to_60'));
    throw new ForbiddenException({
      code: 'saas_read_only',
      message: `${notice.title}. ${notice.detail}`,
      saas: { status: state.status },
    });
  }
}
