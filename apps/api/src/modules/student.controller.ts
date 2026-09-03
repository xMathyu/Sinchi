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
import { accessMessage, isDropInPlan } from '@sinchi/shared';
import { CurrentSession } from '../auth/auth.guard';
import type { Session } from '../auth/session';
import { parseWith } from '../common/zod.pipe';
import { IdentityService } from './identity/identity.service';
import { MembershipViewService } from './memberships/membership-view.service';
import { CheckInService } from './checkin/checkin.service';
import { BillingService } from './billing/billing.service';
import { MembersService } from './members/members.service';
import { TrialsService } from './trials/trials.service';
import { EventRegistrationsService } from './events/registrations.service';

const planChangeSchema = z.object({ planId: z.string().uuid() });
const trialSchema = z.object({
  /** El gimnasio se nombra por su slug: es lo que la app tiene del directorio. */
  slug: z.string().min(2).max(80),
  classScheduleId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha va en formato YYYY-MM-DD.'),
});
const eventBookingSchema = z.object({
  slug: z.string().min(2).max(80),
  eventId: z.string().uuid(),
});
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
    private readonly trials: TrialsService,
    private readonly registrations: EventRegistrationsService,
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
    const { result, view } = await this.checkin.evaluate(tenantId, membershipId);
    // El mensaje se rearma en la voz del alumno: `evaluate` lo devuelve en la
    // del staff, que es quien lee la mayoria. Es el mismo veredicto —el mismo
    // `result`— dicho a quien lo esta mirando.
    return {
      result,
      message: accessMessage(result, 'student'),
      quota: view.quota,
      receivable: view.receivable,
    };
  }

  /**
   * Horario de clases del gimnasio.
   *
   * El alumno no podia verlo desde ningun sitio: `/staff/schedules` es del
   * mostrador y `/me` no lo devolvia. Y sin el, el escaner le rechaza por "fuera
   * de horario" sin que haya tenido forma de saber cuando puede ir — la app
   * conocia la regla y no la compartia con quien tiene que cumplirla.
   *
   * Va por membresia y no suelto porque el horario es del LOCAL: un alumno con
   * tres gimnasios tiene tres horarios distintos, y `resolveOwnMembership`
   * comprueba ademas que la membresia sea suya.
   */
  @Get('memberships/:membershipId/schedules')
  async schedules(
    @CurrentSession() session: Session,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
  ) {
    const tenantId = await this.views.resolveOwnMembership(session.sub, membershipId);
    return this.checkin.schedules(tenantId);
  }

  /**
   * A que planes puede cambiarse el alumno solo.
   *
   * Sin los de clase suelta: su precio esta en otra unidad —lo que cuesta UNA
   * clase, no el mes— y ofrecerlos aqui los pinta al lado de una mensualidad
   * como si fueran S/ 125 mas baratos. Entrar o salir de pagar por clase es un
   * cambio de modelo de cobro y se hace en el mostrador; la api tambien lo
   * rechaza, porque una lista no es un guardia.
   */
  @Get('memberships/:membershipId/plans')
  async availablePlans(
    @CurrentSession() session: Session,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
  ) {
    const tenantId = await this.views.resolveOwnMembership(session.sub, membershipId);
    const planes = await this.members.plans(tenantId);
    return planes.filter((plan) => !isDropInPlan(plan));
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

  // -------------------------------------------------------------------------
  // Clase gratis
  // -------------------------------------------------------------------------

  /**
   * Las clases gratis que reservo, en toda la red.
   *
   * Existe aqui —y no solo en la ruta publica— porque un alumno de un gimnasio
   * es tambien un posible alumno de otro: la billetera y el directorio son el
   * mismo producto visto de los dos lados.
   */
  @Get('trials')
  myTrials(@CurrentSession() session: Session) {
    return this.trials.forUser(session.sub);
  }

  /**
   * Reserva con la sesion puesta.
   *
   * No pide nombre ni celular: ya los sabemos, y volver a preguntarlos dejaria
   * dos versiones de la misma persona en la lista del gimnasio. El resto —una
   * por gimnasio, no si ya entrenas ahi— lo decide la misma funcion pura que
   * usa la ruta publica.
   */
  @Post('trials')
  bookTrial(
    @CurrentSession() session: Session,
    @Body(parseWith(trialSchema)) body: z.infer<typeof trialSchema>,
  ) {
    return this.trials.book({
      slug: body.slug,
      account: { kind: 'user', userId: session.sub },
      classScheduleId: body.classScheduleId,
      date: body.date,
    });
  }

  // -------------------------------------------------------------------------
  // Eventos
  // -------------------------------------------------------------------------

  /**
   * Las plazas que tiene en eventos, en toda la red.
   *
   * Existe por lo mismo que `GET /me/trials`: un alumno de un gimnasio es
   * tambien un posible asistente al seminario de otro, y la billetera y el
   * directorio son el mismo producto visto de los dos lados.
   */
  @Get('events')
  myEvents(@CurrentSession() session: Session) {
    return this.registrations.mine({ kind: 'user', userId: session.sub });
  }

  /**
   * Coge plaza con la sesion puesta.
   *
   * No pide nombre ni celular: ya los sabemos, y volver a preguntarlos dejaria
   * dos versiones de la misma persona en la lista del seminario. Si entrena en
   * ese local le toca el precio de alumno, y eso lo decide el servicio mirando
   * su membresia, no el camino por el que llego.
   */
  @Post('events')
  bookEvent(
    @CurrentSession() session: Session,
    @Body(parseWith(eventBookingSchema)) body: z.infer<typeof eventBookingSchema>,
  ) {
    return this.registrations.book({
      slug: body.slug,
      eventId: body.eventId,
      account: { kind: 'user', userId: session.sub },
    });
  }

  @Post('trials/:bookingId/cancel')
  cancelTrial(
    @CurrentSession() session: Session,
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
  ) {
    return this.trials.cancelOwn({ kind: 'user', userId: session.sub }, bookingId);
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
