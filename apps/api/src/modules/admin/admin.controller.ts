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

  /** El registro. Con `tenantId`, solo lo de ese gimnasio. */
  @Get('actions')
  actions(
    @Query('limit') limit?: string,
    @Query('tenantId') tenantId?: string,
  ): Promise<readonly PlatformActionView[]> {
    const parsed = Number(limit ?? '50');
    return this.admins.actions(Number.isFinite(parsed) ? parsed : 50, tenantId);
  }
}
