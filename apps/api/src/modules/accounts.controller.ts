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
import { assertStaffSession, type Session } from '../auth/session';
import { parseWith } from '../common/zod.pipe';
import { AccountLinkService } from '../auth/account-link.service';
import { AuthService } from '../auth/auth.service';
import { InviteService } from '../auth/invite.service';
import { PIN_MAX_LENGTH, PIN_MIN_LENGTH } from '../auth/secrets';

const confirmSchema = z.object({
  /** Los 6 dígitos que el alumno muestra en su app. */
  code: z.string().regex(/^\d{6}$/),
  /** A quién pertenece. Recepción lo elige del padrón. */
  membershipId: z.string().uuid(),
});

const pinSchema = z.object({
  pin: z.string().regex(new RegExp(`^\\d{${PIN_MIN_LENGTH},${PIN_MAX_LENGTH}}$`)),
  /** Solo el dueño puede fijar el PIN de otra persona. */
  staffId: z.string().uuid().optional(),
});

const deviceSchema = z.object({
  name: z.string().min(2).max(60),
});

const inviteSchema = z.object({
  fullName: z.string().min(2).max(120),
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
    return this.invites.create({
      tenantId: staff.tenantId,
      staffId: staff.staffId,
      planId: body.planId,
      fullName: body.fullName,
      documentId: body.documentId,
      phone: body.phone,
      membershipId: body.membershipId ?? null,
      ttlDays: body.ttlDays,
    });
  }

  /** Invitaciones vigentes. Sin el token: no se guarda en claro. */
  @Get('invites')
  pendingInvites(@CurrentSession() session: Session) {
    return this.invites.listPending(assertStaffSession(session).tenantId);
  }

  /** Revoca una invitación: corta el enlace al instante. */
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
  @OwnerOnly()
  @Delete('members/:membershipId/account')
  async unlink(
    @CurrentSession() session: Session,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
  ) {
    await this.accountLink.unlink(assertStaffSession(session).tenantId, membershipId);
    return { unlinked: true };
  }

  // -------------------------------------------------------------------------
  // PIN
  // -------------------------------------------------------------------------

  /** Cada persona fija el suyo; el dueño puede fijar el de cualquiera. */
  @Post('pin')
  async setPin(
    @CurrentSession() session: Session,
    @Body(parseWith(pinSchema)) body: z.infer<typeof pinSchema>,
  ) {
    const staff = assertStaffSession(session);
    const target = body.staffId ?? staff.staffId;

    if (target !== staff.staffId && staff.role !== 'owner') {
      // Sin esto, recepción podría cambiarle el PIN a otra persona y marcar
      // asistencia a su nombre. La auditoría dejaría de servir.
      return { changed: false, reason: 'Solo el dueño puede cambiar el PIN de otra persona.' };
    }

    await this.auth.setPin({ tenantId: staff.tenantId, targetStaffId: target, pin: body.pin });
    return { changed: true, staffId: target };
  }

  // -------------------------------------------------------------------------
  // Equipos del mostrador
  // -------------------------------------------------------------------------

  @OwnerOnly()
  @Get('devices')
  devices(@CurrentSession() session: Session) {
    return this.auth.listDevices(assertStaffSession(session).tenantId);
  }

  /**
   * Registra un equipo y devuelve su token.
   *
   * El token se muestra UNA vez: la base guarda solo el hash. Si se pierde, se
   * registra otro equipo y se revoca este, que es más seguro que poder
   * recuperarlo.
   */
  @OwnerOnly()
  @Post('devices')
  registerDevice(
    @CurrentSession() session: Session,
    @Body(parseWith(deviceSchema)) body: z.infer<typeof deviceSchema>,
  ) {
    return this.auth.registerDevice(assertStaffSession(session).tenantId, body.name);
  }

  /** Revoca un equipo: una tablet que se pierde en el gimnasio. */
  @OwnerOnly()
  @Delete('devices/:deviceId')
  async revokeDevice(
    @CurrentSession() session: Session,
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
  ) {
    await this.auth.revokeDevice(assertStaffSession(session).tenantId, deviceId);
    return { revoked: true };
  }
}
