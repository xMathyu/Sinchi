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
import { SchedulesService } from './schedules.service';

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

/**
 * El bloque de horario que llega del formulario.
 *
 * Igual que `planSchema`: aqui solo se acota la FORMA. La regla de que una clase
 * no pueda terminar antes de empezar vive en `checkScheduleDraft`, en el
 * dominio, porque es la misma que apaga el boton en la app.
 */
const scheduleSchema = z.object({
  name: z.string().min(1).max(120),
  /** Dia ISO: 1 = lunes .. 7 = domingo. */
  weekday: z.number().int(),
  startTime: z.string().max(5),
  endTime: z.string().max(5),
  capacity: z.number().int().nullable().default(null),
  instructor: z.string().max(120).nullable().default(null),
  active: z.boolean().default(true),
});

/**
 * Crear acepta VARIOS dias; editar sigue siendo de uno.
 *
 * Ver `ScheduleCreateInput`: al editar, «marca tres dias» no tiene un
 * significado unico —¿mover el bloque o clonarlo?— y ninguno se adivina.
 */
const scheduleCreateSchema = scheduleSchema.omit({ weekday: true }).extend({
  weekdays: z.array(z.number().int()).min(1).max(7),
});

/**
 * Donde queda el local.
 *
 * El rango de las coordenadas se acota aqui y ademas en el servicio y ademas en
 * la base (`tenants_coords_range`). No es paranoia repetida: teclear «-77.0» sin
 * el punto da 770, y un pin en un sitio que no existe manda a alguien a la calle
 * a las siete de la tarde.
 */
const locationSchema = z.object({
  address: z.string().min(1).max(240),
  latitude: z.number().min(-90).max(90).nullable().default(null),
  longitude: z.number().min(-180).max(180).nullable().default(null),
});

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
    private readonly schedules: SchedulesService,
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
  // Horarios
  // -------------------------------------------------------------------------

  /**
   * La lista del dueno: tambien los archivados, con cuanta gente viene a probar
   * en cada bloque y cuales se pisan entre si.
   *
   * `GET /staff/schedules` —la del mostrador— se queda en `StaffController` y
   * sigue devolviendo solo los activos: el escaner valida contra lo que el local
   * da HOY, y un bloque archivado abriria la puerta a deshora.
   */
  @OwnerOnly()
  @Get('schedules/all')
  allSchedules(@CurrentSession() session: Session) {
    return this.schedules.listForOwner(assertStaffSession(session).tenantId);
  }

  /**
   * Publica la misma clase en uno o varios dias, de golpe y en una transaccion.
   *
   * Devuelve una LISTA aunque se haya pedido un solo dia: que la forma de la
   * respuesta dependa de cuantos dias se mandaron es la clase de detalle que la
   * app acaba comprobando en dos sitios y olvidando en un tercero.
   */
  @OwnerOnly()
  @Post('schedules')
  createSchedule(
    @CurrentSession() session: Session,
    @Body(parseWith(scheduleCreateSchema)) body: z.infer<typeof scheduleCreateSchema>,
  ) {
    return this.schedules.create(assertStaffSession(session).tenantId, body);
  }

  @OwnerOnly()
  @Post('schedules/:scheduleId')
  updateSchedule(
    @CurrentSession() session: Session,
    @Param('scheduleId', ParseUUIDPipe) scheduleId: string,
    @Body(parseWith(scheduleSchema)) body: z.infer<typeof scheduleSchema>,
  ) {
    return this.schedules.update(assertStaffSession(session).tenantId, scheduleId, body);
  }

  /**
   * Quitar del horario publicado y devolver.
   *
   * Es el bloque de temporada: la clase de las 7am que el local suspende en
   * vacaciones deja de ofrecerse y en diciembre vuelve con un toque, sin
   * volver a teclearla.
   */
  @OwnerOnly()
  @Post('schedules/:scheduleId/active')
  setScheduleActive(
    @CurrentSession() session: Session,
    @Param('scheduleId', ParseUUIDPipe) scheduleId: string,
    @Body(parseWith(activeSchema)) body: z.infer<typeof activeSchema>,
  ) {
    return this.schedules.setActive(
      assertStaffSession(session).tenantId,
      scheduleId,
      body.active,
    );
  }

  /**
   * Borra el bloque de verdad, y siempre.
   *
   * Al reves que un plan: las dos tablas que lo apuntan —`attendance` y
   * `trial_bookings`— son ON DELETE set null y llevan copiado lo que hace falta
   * para leerlas despues, asi que borrar no deja ningun historial sin explicar.
   */
  @OwnerOnly()
  @Delete('schedules/:scheduleId')
  deleteSchedule(
    @CurrentSession() session: Session,
    @Param('scheduleId', ParseUUIDPipe) scheduleId: string,
  ) {
    return this.schedules.remove(assertStaffSession(session).tenantId, scheduleId);
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

  // -------------------------------------------------------------------------
  // Donde queda el local
  // -------------------------------------------------------------------------

  /**
   * Lo lee todo el staff: a recepcion le preguntan por telefono como llegar
   * tanto como por el precio.
   */
  @Get('location')
  location(@CurrentSession() session: Session) {
    return this.settings.readLocation(assertStaffSession(session).tenantId);
  }

  @OwnerOnly()
  @Post('location')
  setLocation(
    @CurrentSession() session: Session,
    @Body(parseWith(locationSchema)) body: z.infer<typeof locationSchema>,
  ) {
    return this.settings.writeLocation(assertStaffSession(session).tenantId, body);
  }
}
