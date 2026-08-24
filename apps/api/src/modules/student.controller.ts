/**
 * Rutas del alumno.
 *
 * Todas cuelgan de `/me` y ninguna recibe un `tenantId` del cliente: el gimnasio
 * se deduce de la membresía que pide, y `resolveOwnMembership` verifica que sea
 * suya antes de tocar nada. Aceptar un `tenantId` del cliente sería dejar que
 * cualquiera lea el padrón de otro local escribiendo otro uuid.
 */
import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { z } from 'zod';
import { CurrentSession } from '../auth/auth.guard';
import type { Session } from '../auth/session';
import { parseWith } from '../common/zod.pipe';
import { IdentityService } from './identity/identity.service';
import { MembershipViewService } from './memberships/membership-view.service';
import { CheckInService } from './checkin/checkin.service';
import { BillingService } from './billing/billing.service';
import { MembersService } from './members/members.service';

const planChangeSchema = z.object({ planId: z.string().uuid() });
const linkDeviceSchema = z.object({
  /** `true` cuando el alumno perdió el celular: invalida los códigos viejos. */
  rotate: z.boolean().optional(),
});

@Controller('me')
export class StudentController {
  constructor(
    private readonly identity: IdentityService,
    private readonly views: MembershipViewService,
    private readonly checkin: CheckInService,
    private readonly billing: BillingService,
    private readonly members: MembersService,
  ) {}

  /** Identidad + billetera: es la primera pantalla de la app. */
  @Get()
  async me(@CurrentSession() session: Session) {
    const [user, wallet] = await Promise.all([
      this.identity.me(session.sub),
      this.views.wallet(session.sub),
    ]);
    return { user, wallet };
  }

  @Get('wallet')
  wallet(@CurrentSession() session: Session) {
    return this.views.wallet(session.sub);
  }

  /**
   * Siembra el secreto con el que el dispositivo genera su QR.
   *
   * Se entrega una sola vez por dispositivo. A partir de aquí el alumno genera
   * códigos sin internet, que es el requisito del MD 4.6.
   */
  @Post('device')
  linkDevice(
    @CurrentSession() session: Session,
    @Body(parseWith(linkDeviceSchema)) body: z.infer<typeof linkDeviceSchema>,
  ) {
    return this.identity.linkDevice(session.sub, body.rotate === true);
  }

  @Get('memberships/:membershipId')
  async membership(
    @CurrentSession() session: Session,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
  ) {
    const tenantId = await this.views.resolveOwnMembership(session.sub, membershipId);
    return this.views.detail(tenantId, membershipId);
  }

  /**
   * Qué pasaría si marcara ahora.
   *
   * Alimenta la pantalla "Mi QR": el mismo veredicto que verá el staff, con la
   * misma función. Si aquí dice que puede entrar, en la puerta pasa.
   */
  @Get('memberships/:membershipId/checkin-preview')
  async checkInPreview(
    @CurrentSession() session: Session,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
  ) {
    const tenantId = await this.views.resolveOwnMembership(session.sub, membershipId);
    const { result, message, view } = await this.checkin.evaluate(tenantId, membershipId);
    return { result, message, quota: view.quota, receivable: view.receivable };
  }

  @Get('memberships/:membershipId/plans')
  async availablePlans(
    @CurrentSession() session: Session,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
  ) {
    const tenantId = await this.views.resolveOwnMembership(session.sub, membershipId);
    return this.members.plans(tenantId);
  }

  /**
   * Cambio de plan.
   *
   * Devuelve la decisión completa, no solo "ok": el alumno tiene derecho a ver
   * por qué le cobran S/ 14 y no S/ 30 antes de que aparezca en su cuenta.
   */
  @Post('memberships/:membershipId/plan')
  async changePlan(
    @CurrentSession() session: Session,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Body(parseWith(planChangeSchema)) body: z.infer<typeof planChangeSchema>,
  ) {
    const tenantId = await this.views.resolveOwnMembership(session.sub, membershipId);
    return this.billing.changePlan(tenantId, membershipId, body.planId);
  }

  @Post('memberships/:membershipId/cancel')
  async cancel(
    @CurrentSession() session: Session,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
  ) {
    const tenantId = await this.views.resolveOwnMembership(session.sub, membershipId);
    await this.billing.cancelSubscription(tenantId, membershipId);
    return { canceled: true };
  }
}
