/**
 * Vinculación de cuentas, PIN y equipos: lo que el staff administra.
 *
 * Vive aparte de `staff.controller.ts` porque es otro asunto —identidad y
 * acceso, no la operación diaria de la puerta— y porque casi todo aquí es del
 * dueño, no de recepción.
 */
import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { z } from 'zod';
import { CurrentSession, OwnerOnly, StaffOnly } from '../auth/auth.guard';
import { AllowedWhenReadOnly } from './saas/saas.guard';
import { assertStaffSession, type Session } from '../auth/session';
import { parseWith } from '../common/zod.pipe';
import { loadEnv } from '../config/env';
import { MailService } from './mail/mail.service';
import { AccountLinkService } from '../auth/account-link.service';
import { AuthService } from '../auth/auth.service';
import { InviteService } from '../auth/invite.service';

const confirmSchema = z.object({
  /** Los 6 dígitos que el alumno muestra en su app. */
  code: z.string().regex(/^\d{6}$/),
  /** A quién pertenece. Recepción lo elige del padrón. */
  membershipId: z.string().uuid(),
});

const inviteSchema = z.object({
  fullName: z.string().min(2).max(120),
  /**
   * Con correo, la cuenta se activa sola al entrar con Google. Es el camino
   * normal; sin el, la persona recibe el codigo de 6 digitos.
   */
  email: z.string().email().max(254).optional(),
  /** DNI peruano: 8 digitos. CE y pasaporte no caben aqui todavia. */
  documentId: z.string().regex(/^\d{8}$/),
  phone: z.string().min(6).max(20),
  planId: z.string().uuid(),
  /** Ficha existente. Sin esto se crea una nueva al aceptar. */
  membershipId: z.string().uuid().optional(),
  ttlDays: z.number().int().min(1).max(30).optional(),
});

@StaffOnly()
@Controller('staff')
export class AccountsController {
  constructor(
    private readonly accountLink: AccountLinkService,
    private readonly auth: AuthService,
    private readonly invites: InviteService,
    private readonly mail: MailService,
  ) {}

  // -------------------------------------------------------------------------
  // Invitar por enlace
  // -------------------------------------------------------------------------

  /**
   * Crea la invitacion y devuelve el token **una vez**.
   *
   * Es la alternativa al codigo de 6 digitos: en vez de que el alumno lo dicte
   * en el mostrador, el staff decide ficha y plan aqui y manda el enlace. El
   * token no vuelve a estar disponible — si se pierde, se revoca y se invita
   * otra vez.
   */
  @Post('invites')
  async createInvite(
    @CurrentSession() session: Session,
    @Body(parseWith(inviteSchema)) body: z.infer<typeof inviteSchema>,
  ) {
    const staff = assertStaffSession(session);
    const invite = await this.invites.create({
      tenantId: staff.tenantId,
      staffId: staff.staffId,
      planId: body.planId,
      fullName: body.fullName,
      email: body.email ?? null,
      documentId: body.documentId,
      phone: body.phone,
      membershipId: body.membershipId ?? null,
      ttlDays: body.ttlDays,
    });

    // El correo se manda DESPUÉS de que la invitación exista, y su fallo no la
    // deshace: el enlace ya es válido y se puede compartir por donde sea. El
    // correo es entrega, no la fuente del vínculo — si Resend estuviera caído,
    // impedir el alta de alguien que espera en el mostrador sería peor.
    const href = `${loadEnv().PUBLIC_BASE_URL}/v1/invites/${invite.token}/abrir`;
    let correo = { enviado: false, denial: 'Sin correo: comparte el enlace.' as string | null };

    if (body.email !== undefined && this.mail.disponible) {
      const detail = await this.invites.preview(invite.token);
      correo = await this.mail.sendInvite({
        recipient: body.email,
        personName: invite.fullName,
        gym: detail.gymName,
        plan: detail.planName,
        href,
      });
    }

    return { ...invite, href, correo };
  }

  /** Invitaciones vigentes. Sin el token: no se guarda en claro. */
  @Get('invites')
  pendingInvites(@CurrentSession() session: Session) {
    return this.invites.listPending(assertStaffSession(session).tenantId);
  }

  /**
   * Revoca una invitación: corta el enlace al instante.
   *
   * Abierta con la cuenta impaga: revocar no crea futuro, lo quita. Cortarla
   * dejaría vivo un enlace de alta que el gimnasio ya no quiere, que es peor
   * para todos que dejarlo revocar.
   */
  @AllowedWhenReadOnly()
  @Delete('invites/:inviteId')
  async revokeInvite(
    @CurrentSession() session: Session,
    @Param('inviteId', ParseUUIDPipe) inviteId: string,
  ) {
    await this.invites.revoke(assertStaffSession(session).tenantId, inviteId);
    return { revoked: true };
  }

  // -------------------------------------------------------------------------
  // Vincular cuentas
  // -------------------------------------------------------------------------

  /**
   * Códigos vigentes.
   *
   * Existe para que recepción no dependa de que el alumno le dicte bien seis
   * dígitos: si su cuenta aparece en la lista, basta tocarla.
   */
  @Get('claims')
  pendingClaims() {
    return this.accountLink.listPending();
  }

  /**
   * Confirma que esa cuenta de Google es de este alumno.
   *
   * Es LA operación sensible del módulo: vincular mal significa entregarle a
   * alguien el historial de pagos y el QR de otro. Por eso la confirma una
   * persona que tiene al alumno enfrente, y por eso la membresía se resuelve con
   * aislamiento por tenant — recepción solo puede vincular contra su padrón.
   */
  @Post('claims/confirm')
  async confirmClaim(
    @CurrentSession() session: Session,
    @Body(parseWith(confirmSchema)) body: z.infer<typeof confirmSchema>,
  ) {
    const staff = assertStaffSession(session);
    const result = await this.accountLink.confirmClaim({
      tenantId: staff.tenantId,
      staffId: staff.staffId,
      code: body.code,
      membershipId: body.membershipId,
    });
    return { linked: true, ...result };
  }

  /**
   * Desvincula. Solo el dueño.
   *
   * El vínculo lo hace una persona y las personas se equivocan: si recepción
   * asocia la cuenta de Diego a la ficha de Julio, tiene que haber forma de
   * deshacerlo sin entrar a la base a mano.
   */
  /** Misma razón que revocar la invitación: desvincular solo quita acceso. */
  @AllowedWhenReadOnly()
  @OwnerOnly()
  @Delete('members/:membershipId/account')
  async unlink(
    @CurrentSession() session: Session,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
  ) {
    await this.accountLink.unlink(assertStaffSession(session).tenantId, membershipId);
    return { unlinked: true };
  }

}
