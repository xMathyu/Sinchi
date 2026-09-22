/**
 * El panel de Sinchi.
 *
 * Todo lo que cruza gimnasios vive bajo `/admin` y en ningún otro sitio: un
 * `GET /staff/...` que a veces devuelve datos de otro local según quién pregunte
 * es la forma segura de que un día los devuelva a quien no debe.
 *
 * Dos guards, y los dos hacen falta:
 *
 *   @AdminOnly()          el TOKEN es del panel de Sinchi y no de un gimnasio.
 *                         Lo comprueba `AuthGuard`, donde se verifica la firma.
 *   PlatformAdminGuard    el acceso SIGUE VIGENTE. Relee la fila en cada
 *                         petición: retirarle el acceso a alguien corta el que
 *                         ya tiene abierto, no espera a que caduque.
 *
 * `POST /admin/session` es la excepción: es `@Public()` porque es la petición
 * que crea la sesión, igual que `/auth/google`.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import {
  SUSPENSION_REASON_MAX,
  SUSPENSION_REASON_MIN,
  ADMIN_EMAIL_MAX,
  ADMIN_NAME_MAX,
  PROMO_CODE_MAX_LENGTH,
  PROMO_MAX_FREE_MONTHS,
  BAN_REASON_MAX,
  BAN_REASON_MIN,
  DOCUMENT_ID_MAX,
} from '@sinchi/shared';
import { AdminOnly, CurrentAdmin, Public } from '../../auth/auth.guard';
import type { AdminClaims } from '../../auth/session';
import { parseWith } from '../../common/zod.pipe';
import { PlatformAdminGuard } from './admin.guard';
import {
  PlatformAdminService,
  type AdminSession,
  type PlatformActionView,
  type PlatformAdminView,
} from './platform-admin.service';
import {
  PlatformGymsService,
  type GymDetail,
  type GymRow,
  type PlatformOverview,
} from './platform-gyms.service';
import { PlatformPromosService, type PromoView } from './platform-promos.service';
import {
  PlatformPeopleService,
  type AccountDetail,
  type DeletionOutcome,
  type IdentityDetail,
  type PeoplePage,
  type PendingDeletion,
} from './platform-people.service';

const sessionSchema = z.object({
  idToken: z.string().min(100).max(4096),
});

/**
 * El parche de un gimnasio: todo opcional.
 *
 * `.strict()` no hace falta —Zod descarta lo que no declara— pero sí hace falta
 * que ningún campo peligroso entre por descuido: `status` NO está aquí. Suspender
 * tiene su propia ruta porque exige un motivo, y dejarlo colarse como un campo
 * más del formulario de edición sería saltarse esa regla sin querer.
 */
const gymPatchSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  slug: z.string().min(3).max(60).optional(),
  taxId: z.string().max(20).nullable().optional(),
  timezone: z.string().min(3).max(60).optional(),
  graceDays: z.number().int().min(0).max(60).optional(),
  saasTier: z.enum(['free', 'up_to_60', 'up_to_150', 'unlimited']).optional(),
  address: z.string().max(300).nullable().optional(),
  dropInPriceCents: z.number().int().min(0).max(1_000_000).nullable().optional(),
  enrollmentFeeCents: z.number().int().min(0).max(1_000_000).optional(),
  trialClassEnabled: z.boolean().optional(),
  trialClassPriceCents: z.number().int().min(0).max(1_000_000).optional(),
});

const suspendSchema = z.object({
  reason: z.string().min(SUSPENSION_REASON_MIN).max(SUSPENSION_REASON_MAX),
});

/**
 * Borrar exige escribir el identificador.
 *
 * Va en el CUERPO y no en la URL: un `DELETE /admin/gyms/:id?slug=...` acaba en
 * el historial del navegador y en los logs del balanceador, y con él la
 * confirmación que debía costar teclearla.
 */
const deleteSchema = z.object({
  slug: z.string().min(1).max(60),
});

const paymentSchema = z.object({
  rail: z.enum(['cash', 'yape', 'bank_transfer', 'card']),
  reference: z.string().max(60).nullable().optional(),
  amountCents: z.number().int().min(0).max(10_000_000).optional(),
});

const promoSchema = z.object({
  code: z.string().min(1).max(PROMO_CODE_MAX_LENGTH * 2),
  freeMonths: z.number().int().min(1).max(PROMO_MAX_FREE_MONTHS),
  maxRedemptions: z.number().int().min(1).max(100_000).nullable(),
  expiresOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha va como 2026-12-31.')
    .nullable()
    .optional(),
  note: z.string().max(300).nullable().optional(),
});

const promoStatusSchema = z.object({ active: z.boolean() });

/**
 * Los cuatro datos de una ficha, completos.
 *
 * No es un parche como el del gimnasio: la regla (`checkPersonDetails`) juzga la
 * ficha entera —un celular vale o no vale junto al resto—, y el formulario manda
 * siempre los cuatro. Los topes finos los pone esa regla; estos solo impiden que
 * alguien mande un documento de un megabyte.
 */
const personSchema = z.object({
  name: z.string().max(200),
  phone: z.string().max(40),
  documentId: z.string().max(DOCUMENT_ID_MAX * 2),
  email: z.string().max(ADMIN_EMAIL_MAX).default(''),
});

const banSchema = z.object({
  reason: z.string().min(BAN_REASON_MIN).max(BAN_REASON_MAX),
});

/** Lo que se escribe para confirmar. En el cuerpo, igual que el slug del gimnasio. */
const confirmSchema = z.object({
  confirm: z.string().min(1).max(ADMIN_EMAIL_MAX),
});

/**
 * Un uid de Firebase: 28 caracteres alfanuméricos en la práctica.
 *
 * Se valida la forma antes de llevarlo a una consulta, por lo mismo que los
 * uuid pasan por `ParseUUIDPipe`: un parámetro de ruta es texto del navegador.
 */
const firebaseUidSchema = z.string().regex(/^[A-Za-z0-9_-]{6,128}$/, 'Esa cuenta no existe.');

const inviteSchema = z.object({
  email: z.string().min(3).max(ADMIN_EMAIL_MAX),
  name: z.string().max(ADMIN_NAME_MAX).nullable().optional(),
});

@Controller('admin')
export class AdminController {
  constructor(private readonly admins: PlatformAdminService) {}

  /**
   * Entrar al panel de Sinchi.
   *
   * Pública como `/auth/google`, y por lo mismo: es la petición que crea la
   * sesión. Lo que la protege es que el correo tiene que venir verificado por
   * Google Y estar en `platform_admins`.
   */
  @Public()
  @Post('session')
  signIn(
    @Body(parseWith(sessionSchema)) body: z.infer<typeof sessionSchema>,
  ): Promise<AdminSession> {
    return this.admins.signIn(body.idToken);
  }
}

/**
 * Todo lo demás, detrás de los dos guards.
 *
 * Es un controlador APARTE del de la sesión y no un `@Public()` suelto entre
 * rutas protegidas: `PlatformAdminGuard` se registra sobre la clase, así que
 * cualquier ruta que se agregue aquí nace comprobada. Mezclarlas obligaría a
 * marcar la excepción a mano, y la marca es lo que un día se pone en la ruta
 * equivocada.
 */
@AdminOnly()
@UseGuards(PlatformAdminGuard)
@Controller('admin')
export class AdminPanelController {
  constructor(
    private readonly admins: PlatformAdminService,
    private readonly gyms: PlatformGymsService,
    private readonly promos: PlatformPromosService,
    private readonly people: PlatformPeopleService,
  ) {}

  /** Quién soy, para que el panel se pinte sin volver a leer la cookie. */
  @Get('me')
  me(@CurrentAdmin() admin: AdminClaims): { readonly id: string; readonly email: string } {
    return { id: admin.sub, email: admin.email };
  }

  @Get('overview')
  overview(): Promise<PlatformOverview> {
    return this.gyms.overview();
  }

  // -------------------------------------------------------------------------
  // Gimnasios
  // -------------------------------------------------------------------------

  @Get('gyms')
  listGyms(): Promise<readonly GymRow[]> {
    return this.gyms.list();
  }

  @Get('gyms/:tenantId')
  gymDetail(@Param('tenantId') tenantId: string): Promise<GymDetail> {
    return this.gyms.detail(tenantId);
  }

  /**
   * Editar.
   *
   * `POST` y no `PATCH` por consistencia con el resto de la api —el mostrador
   * escribe todo con POST— y porque el cuerpo ya es un parche: lo que no viene,
   * no se toca.
   */
  @Post('gyms/:tenantId')
  updateGym(
    @CurrentAdmin() admin: AdminClaims,
    @Param('tenantId') tenantId: string,
    @Body(parseWith(gymPatchSchema)) body: z.infer<typeof gymPatchSchema>,
  ): Promise<GymDetail> {
    return this.gyms.update(admin.sub, tenantId, body);
  }

  @Post('gyms/:tenantId/suspend')
  suspendGym(
    @CurrentAdmin() admin: AdminClaims,
    @Param('tenantId') tenantId: string,
    @Body(parseWith(suspendSchema)) body: z.infer<typeof suspendSchema>,
  ): Promise<GymDetail> {
    return this.gyms.suspend(admin.sub, tenantId, body.reason);
  }

  @Post('gyms/:tenantId/restore')
  restoreGym(
    @CurrentAdmin() admin: AdminClaims,
    @Param('tenantId') tenantId: string,
  ): Promise<GymDetail> {
    return this.gyms.restore(admin.sub, tenantId);
  }

  @Delete('gyms/:tenantId')
  deleteGym(
    @CurrentAdmin() admin: AdminClaims,
    @Param('tenantId') tenantId: string,
    @Body(parseWith(deleteSchema)) body: z.infer<typeof deleteSchema>,
  ): Promise<{ readonly slug: string }> {
    return this.gyms.remove(admin.sub, tenantId, body.slug);
  }

  /** Lo que el gimnasio le pagó a Sinchi. El mismo camino que `saas:pay`. */
  @Post('gyms/:tenantId/payments')
  recordPayment(
    @CurrentAdmin() admin: AdminClaims,
    @Param('tenantId') tenantId: string,
    @Body(parseWith(paymentSchema)) body: z.infer<typeof paymentSchema>,
  ): Promise<{ readonly alreadyRecorded: boolean; readonly amountCents: number }> {
    return this.gyms.recordPayment(admin.sub, tenantId, {
      rail: body.rail,
      reference: body.reference ?? null,
      amountCents: body.amountCents,
    });
  }

  // -------------------------------------------------------------------------
  // Códigos
  // -------------------------------------------------------------------------

  @Get('promos')
  listPromos(): Promise<readonly PromoView[]> {
    return this.promos.list();
  }

  @Post('promos')
  createPromo(
    @CurrentAdmin() admin: AdminClaims,
    @Body(parseWith(promoSchema)) body: z.infer<typeof promoSchema>,
  ): Promise<PromoView> {
    return this.promos.create(admin.sub, {
      code: body.code,
      freeMonths: body.freeMonths,
      maxRedemptions: body.maxRedemptions,
      expiresOn: body.expiresOn ?? null,
      note: body.note ?? null,
    });
  }

  @Post('promos/:promoId/status')
  setPromoStatus(
    @CurrentAdmin() admin: AdminClaims,
    @Param('promoId') promoId: string,
    @Body(parseWith(promoStatusSchema)) body: z.infer<typeof promoStatusSchema>,
  ): Promise<PromoView> {
    return this.promos.setActive(admin.sub, promoId, body.active);
  }

  // -------------------------------------------------------------------------
  // Personas
  // -------------------------------------------------------------------------

  /** Una página de personas. `kind=account` son las cuentas sin ficha. */
  @Get('people')
  listPeople(
    @Query('kind') kind?: string,
    @Query('q') q?: string,
    @Query('page') page?: string,
  ): Promise<PeoplePage> {
    return this.people.list({
      kind: kind === 'account' ? 'account' : 'identity',
      ...(q === undefined ? {} : { q: q.slice(0, 100) }),
      page: Number.isFinite(Number(page)) ? Number(page) : 1,
    });
  }

  /**
   * Las bajas pedidas sin ejecutar. Declarada ANTES de `people/:userId`: Nest
   * empareja en orden, y al revés esta ruta se leería como la ficha de alguien
   * llamado «deletion-requests».
   */
  @Get('people/deletion-requests')
  pendingDeletions(): Promise<readonly PendingDeletion[]> {
    return this.people.pendingDeletions();
  }

  @Get('people/:userId')
  identity(@Param('userId', new ParseUUIDPipe()) userId: string): Promise<IdentityDetail> {
    return this.people.identityDetail(userId);
  }

  @Post('people/:userId')
  updateIdentity(
    @CurrentAdmin() admin: AdminClaims,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body(parseWith(personSchema)) body: z.infer<typeof personSchema>,
  ): Promise<IdentityDetail> {
    return this.people.updateIdentity(admin.sub, userId, body);
  }

  @Post('people/:userId/ban')
  async banIdentity(
    @CurrentAdmin() admin: AdminClaims,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body(parseWith(banSchema)) body: z.infer<typeof banSchema>,
  ): Promise<{ readonly banned: true }> {
    await this.people.ban(admin.sub, { userId }, body.reason);
    return { banned: true };
  }

  @Delete('people/:userId')
  removeIdentity(
    @CurrentAdmin() admin: AdminClaims,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body(parseWith(confirmSchema)) body: z.infer<typeof confirmSchema>,
  ): Promise<DeletionOutcome> {
    return this.people.removeIdentity(admin.sub, userId, body.confirm);
  }

  @Get('accounts/:firebaseUid')
  account(
    @Param('firebaseUid', parseWith(firebaseUidSchema)) firebaseUid: string,
  ): Promise<AccountDetail> {
    return this.people.accountDetail(firebaseUid);
  }

  @Post('accounts/:firebaseUid/ban')
  async banAccount(
    @CurrentAdmin() admin: AdminClaims,
    @Param('firebaseUid', parseWith(firebaseUidSchema)) firebaseUid: string,
    @Body(parseWith(banSchema)) body: z.infer<typeof banSchema>,
  ): Promise<{ readonly banned: true }> {
    await this.people.ban(admin.sub, { firebaseUid }, body.reason);
    return { banned: true };
  }

  @Delete('accounts/:firebaseUid')
  removeAccount(
    @CurrentAdmin() admin: AdminClaims,
    @Param('firebaseUid', parseWith(firebaseUidSchema)) firebaseUid: string,
    @Body(parseWith(confirmSchema)) body: z.infer<typeof confirmSchema>,
  ): Promise<DeletionOutcome> {
    return this.people.removeAccount(admin.sub, firebaseUid, body.confirm);
  }

  /** Levantar un baneo. Por su id: una persona puede tener varios en su historia. */
  @Post('bans/:banId/lift')
  async liftBan(
    @CurrentAdmin() admin: AdminClaims,
    @Param('banId', new ParseUUIDPipe()) banId: string,
  ): Promise<{ readonly lifted: true }> {
    await this.people.lift(admin.sub, banId);
    return { lifted: true };
  }

  // -------------------------------------------------------------------------
  // El equipo
  // -------------------------------------------------------------------------

  @Get('admins')
  listAdmins(): Promise<readonly PlatformAdminView[]> {
    return this.admins.list();
  }

  @Post('admins')
  invite(
    @CurrentAdmin() admin: AdminClaims,
    @Body(parseWith(inviteSchema)) body: z.infer<typeof inviteSchema>,
  ): Promise<PlatformAdminView> {
    return this.admins.invite(admin.sub, { email: body.email, name: body.name ?? null });
  }

  @Delete('admins/:adminId')
  async revoke(
    @CurrentAdmin() admin: AdminClaims,
    @Param('adminId') adminId: string,
  ): Promise<{ readonly revoked: true }> {
    await this.admins.revoke(admin.sub, adminId);
    return { revoked: true };
  }

  /**
   * El registro. Con `tenantId`, solo lo de ese gimnasio; con `subject`, solo lo
   * de esa persona (su `users.id`, o el uid de su cuenta sin ficha).
   */
  @Get('actions')
  actions(
    @Query('limit') limit?: string,
    @Query('tenantId') tenantId?: string,
    @Query('subject') subject?: string,
  ): Promise<readonly PlatformActionView[]> {
    const parsed = Number(limit ?? '50');
    return this.admins.actions(Number.isFinite(parsed) ? parsed : 50, tenantId, subject);
  }
}
