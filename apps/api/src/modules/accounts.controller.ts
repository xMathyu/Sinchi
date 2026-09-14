/**
 * La identidad de los alumnos, del lado del staff: invitaciones, el QR de una
 * cuenta y las solicitudes de vínculo.
 *
 * Vive aparte de `staff.controller.ts` porque es otro asunto —identidad y
 * acceso, no la operación diaria de la puerta—.
 *
 * Aquí vivía también la confirmación del código de 6 dígitos, `/staff/claims`.
 * Se retiró con la migración 0023: el vínculo ya no lo confirma recepción, lo
 * acepta la persona en su app (ver `LinkRequestsService`).
 */
import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { z } from 'zod';
import { CurrentSession, OwnerOnly, StaffOnly } from '../auth/auth.guard';
import { AllowedWhenReadOnly } from './saas/saas.guard';
import { assertStaffSession, type Session } from '../auth/session';
import { parseWith } from '../common/zod.pipe';
import { phoneSchema } from '../common/phone';
import { loadEnv } from '../config/env';
import { MailService } from './mail/mail.service';
import { AccountLinkService } from '../auth/account-link.service';
import { InviteService } from '../auth/invite.service';
import { LinkRequestsService } from './identity/link-requests.service';
import { CheckInService } from './checkin/checkin.service';
import { IdentityService } from './identity/identity.service';

const inviteSchema = z.object({
  fullName: z.string().min(2).max(120),
  /**
   * Con correo, la cuenta se activa sola al entrar con Google. Sin el, la
   * persona entra por el enlace.
   */
  email: z.string().email().max(254).optional(),
  /** DNI peruano: 8 digitos. CE y pasaporte no caben aqui todavia. */
  documentId: z.string().regex(/^\d{8}$/),
  phone: phoneSchema,
  planId: z.string().uuid(),
  /** Ficha existente. Sin esto se crea una nueva al aceptar. */
  membershipId: z.string().uuid().optional(),
  ttlDays: z.number().int().min(1).max(30).optional(),
});

const accountQrSchema = z.object({
  /** Lo que sigue a `SINCHI1:a:` en el QR de la cuenta. */
  token: z.string().regex(/^[A-Za-z0-9_-]{20,64}$/),
});

const memberQrSchema = z.object({
  /** El QR de alumno tal cual: `SINCHI1:u:<userId>:<code>`. */
  payload: z.string().min(10).max(200),
});

@StaffOnly()
@Controller('staff')
export class AccountsController {
  constructor(
    private readonly accountLink: AccountLinkService,
    private readonly invites: InviteService,
    private readonly mail: MailService,
    private readonly linkRequests: LinkRequestsService,
    private readonly checkin: CheckInService,
    private readonly identity: IdentityService,
  ) {}

  // -------------------------------------------------------------------------
  // Invitar por enlace
  // -------------------------------------------------------------------------

  /**
   * Crea la invitacion y devuelve el token **una vez**.
   *
   * Sirve a quien todavia no tiene Sinchi instalado: el staff decide ficha y
   * plan aqui, manda el enlace, y quien lo abre crea su cuenta y entra ya
   * inscrito. Abrirlo es su forma de aceptar, y por eso no deja solicitud. El
   * token no vuelve a estar disponible — si se pierde, se revoca y se invita otra
   * vez.
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
  // El QR de una cuenta y las solicitudes
  // -------------------------------------------------------------------------

  /**
   * Canjea el QR de una cuenta por su nombre y su contacto.
   *
   * Es lo que evita teclearlos al inscribir a alguien que ya tiene la app. El
   * uid de Firebase no sale de aquí: la inscripción vuelve a mandar el token y
   * lo resuelve la api, que es quien decide a qué cuenta va la solicitud.
   *
   * POST y no GET porque el token va en el cuerpo: en la URL acabaría en los
   * logs del balanceador.
   */
  @Post('accounts/lookup')
  async previewAccount(@Body(parseWith(accountQrSchema)) body: z.infer<typeof accountQrSchema>) {
    const { displayName, phone, email } = await this.accountLink.previewByQrToken(body.token);
    return { displayName, phone, email };
  }

  /**
   * Canjea el QR de alumno de quien no está en este padrón.
   *
   * Es el QR de la puerta y no uno aparte: la billetera promete que «tu QR
   * funciona en cualquier local de la red», y quien ya entrena en otro gimnasio
   * —o tuvo ficha y ninguna membresía— lo muestra en el mostrador para que lo
   * inscriban. Devuelve también el documento, para que el alta no tenga que pedir
   * el carné: la identidad ya existe, y es por el documento que se reutiliza.
   *
   * Entregarlo no es una fuga por la misma razón que el QR de la cuenta: la
   * persona lo está mostrando delante del mostrador para eso. Y la firma se
   * verifica, así que una captura vieja no le da a nadie el documento de otro.
   */
  @Post('accounts/lookup-member')
  async previewMember(@Body(parseWith(memberQrSchema)) body: z.infer<typeof memberQrSchema>) {
    const user = await this.identity.me(await this.checkin.verifyUserQr(body.payload));
    return {
      displayName: user.name,
      phone: user.phone,
      email: user.email,
      documentId: user.documentId,
    };
  }

  /** Cómo está la ficha frente a la app de la persona. */
  @Get('members/:membershipId/link-request')
  linkState(
    @CurrentSession() session: Session,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
  ) {
    return this.linkRequests.forMembership(assertStaffSession(session).tenantId, membershipId);
  }

  /** Vuelve a mandarle la solicitud: la rechazó sin querer, o el gimnasio la retiró. */
  @Post('members/:membershipId/link-request')
  resendLinkRequest(
    @CurrentSession() session: Session,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
  ) {
    const staff = assertStaffSession(session);
    return this.linkRequests.resend(staff.tenantId, membershipId, staff.staffId);
  }

  /** Retira una solicitud sin contestar. Quita, no crea: abierta en solo lectura. */
  @AllowedWhenReadOnly()
  @Delete('link-requests/:requestId')
  async cancelLinkRequest(
    @CurrentSession() session: Session,
    @Param('requestId', ParseUUIDPipe) requestId: string,
  ) {
    await this.linkRequests.cancel(assertStaffSession(session).tenantId, requestId);
    return { canceled: true };
  }

  /**
   * Desvincula. Solo el dueño.
   *
   * El vínculo lo acepta una persona sobre un celular que no se verifica: si
   * alguien se registró con el de otra y aceptó su solicitud, tiene que haber
   * forma de deshacerlo sin entrar a la base a mano.
   *
   * Abierta en solo lectura por lo mismo que revocar la invitación: solo quita
   * acceso.
   */
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
