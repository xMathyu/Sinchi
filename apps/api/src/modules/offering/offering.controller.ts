/**
 * La oferta del gimnasio: sus planes y lo que cobra aparte.
 *
 * Escribir es del DUENO; leer, de todo el staff. No es simetria por gusto: la
 * recepcionista necesita la lista de planes para inscribir a alguien y necesita
 * saber cuanto cuesta la matricula para cobrarla, pero el precio es una decision
 * comercial, del mismo orden que el interruptor de la clase gratis.
 *
 * `GET /staff/plans` vivia en `StaffController` y se muda aqui entera: la ruta
 * es la misma —la app la sigue llamando igual— pero tener la lectura en un
 * archivo y las cuatro escrituras en otro es como se le olvida a alguien que
 * archivar tambien tiene que sacar el plan de esta lista.
 */
import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { z } from 'zod';
import { CurrentSession, OwnerOnly, StaffOnly } from '../../auth/auth.guard';
import { assertStaffSession, type Session } from '../../auth/session';
import { parseWith } from '../../common/zod.pipe';
import { MembersService } from '../members/members.service';
import { GymSettingsService } from './settings.service';
import { PlansService } from './plans.service';

/**
 * El plan que llega del formulario.
 *
 * Aqui solo se acota la FORMA —que sea un numero, que el tipo exista—; la regla
 * de que un plan por sesiones necesite sesiones vive en `checkPlanDraft`, en el
 * dominio, porque la misma tiene que apagar el boton en la app. Repartirla entre
 * este zod y aquella funcion es como acaban discrepando.
 */
const planSchema = z.object({
  name: z.string().min(1).max(120),
  type: z.enum(['unlimited', 'sessions_per_week', 'fixed_days', 'drop_in']),
  sessionsPerWeek: z.number().int().nullable().default(null),
  allowedDays: z.array(z.number().int()).nullable().default(null),
  priceCents: z.number().int(),
  active: z.boolean().default(true),
});

const activeSchema = z.object({ active: z.boolean() });

const pricingSchema = z.object({
  enrollmentFeeCents: z.number().int(),
  dropInPriceCents: z.number().int().nullable(),
  quotaOverflowPolicy: z.enum(['block', 'offer_drop_in']),
  trialClassEnabled: z.boolean(),
  trialClassPriceCents: z.number().int(),
});

@StaffOnly()
@Controller('staff')
export class OfferingController {
  constructor(
    private readonly plans: PlansService,
    private readonly settings: GymSettingsService,
    private readonly members: MembersService,
  ) {}

  // -------------------------------------------------------------------------
  // Planes
  // -------------------------------------------------------------------------

  /**
   * Los planes que se pueden vender hoy.
   *
   * Solo los ACTIVOS, y por eso sigue siendo la del mostrador: inscribir a
   * alguien en un plan archivado es justo lo que archivar tiene que impedir.
   */
  @Get('plans')
  plansForCounter(@CurrentSession() session: Session) {
    return this.members.plans(assertStaffSession(session).tenantId);
  }

  /**
   * La lista del dueno: tambien los archivados, y con cuanta gente tiene cada
   * uno. Sin ese numero delante, archivar un plan es una decision a ciegas.
   */
  @OwnerOnly()
  @Get('plans/all')
  allPlans(@CurrentSession() session: Session) {
    return this.plans.listForOwner(assertStaffSession(session).tenantId);
  }

  @OwnerOnly()
  @Post('plans')
  createPlan(
    @CurrentSession() session: Session,
    @Body(parseWith(planSchema)) body: z.infer<typeof planSchema>,
  ) {
    return this.plans.create(assertStaffSession(session).tenantId, body);
  }

  @OwnerOnly()
  @Post('plans/:planId')
  updatePlan(
    @CurrentSession() session: Session,
    @Param('planId', ParseUUIDPipe) planId: string,
    @Body(parseWith(planSchema)) body: z.infer<typeof planSchema>,
  ) {
    return this.plans.update(assertStaffSession(session).tenantId, planId, body);
  }

  /** Archivar y desarchivar. Quien ya lo tiene lo conserva; deja de ofrecerse. */
  @OwnerOnly()
  @Post('plans/:planId/active')
  setPlanActive(
    @CurrentSession() session: Session,
    @Param('planId', ParseUUIDPipe) planId: string,
    @Body(parseWith(activeSchema)) body: z.infer<typeof activeSchema>,
  ) {
    return this.plans.setActive(assertStaffSession(session).tenantId, planId, body.active);
  }

  /**
   * Borra el plan que nunca se uso.
   *
   * Con un solo alumno apuntando vuelve 409 y el mensaje dice que archive. Es a
   * proposito: el plan es lo que explica cuanto cobraba una suscripcion, y
   * borrarlo dejaria el cargo del mes pasado sin nada detras.
   */
  @OwnerOnly()
  @Delete('plans/:planId')
  deletePlan(
    @CurrentSession() session: Session,
    @Param('planId', ParseUUIDPipe) planId: string,
  ) {
    return this.plans.remove(assertStaffSession(session).tenantId, planId);
  }

  // -------------------------------------------------------------------------
  // Lo que se cobra aparte
  // -------------------------------------------------------------------------

  /**
   * Lo lee tambien recepcion, aunque no pueda cambiarlo: es quien cobra la
   * matricula y la clase suelta, y necesita el numero delante.
   */
  @Get('pricing')
  pricing(@CurrentSession() session: Session) {
    return this.settings.read(assertStaffSession(session).tenantId);
  }

  @OwnerOnly()
  @Post('pricing')
  setPricing(
    @CurrentSession() session: Session,
    @Body(parseWith(pricingSchema)) body: z.infer<typeof pricingSchema>,
  ) {
    return this.settings.write(assertStaffSession(session).tenantId, body);
  }
}
