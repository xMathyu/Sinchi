/**
 * Eventos: lo que escribe el dueno y lo que opera el mostrador.
 *
 * Misma reparticion que la oferta del gimnasio: escribir el evento es del DUENO
 * —es una decision comercial, con precios— y la lista del dia es de todo el
 * staff, porque quien recibe a la gente en la puerta es recepcion.
 *
 * Inscribir y cobrar tambien son de recepcion: pasan en el mostrador, con la
 * persona delante, y hacerlos del dueno dejaria al local sin poder vender una
 * plaza cuando el dueno no esta.
 */
import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { CurrentSession, OwnerOnly, StaffOnly } from '../../auth/auth.guard';
import { assertStaffSession, type Session } from '../../auth/session';
import { parseWith } from '../../common/zod.pipe';
import { EventsService } from './events.service';
import { EventRegistrationsService } from './registrations.service';

/**
 * Aqui solo se acota la FORMA. Que la hora de fin vaya despues de la de inicio,
 * o que el cupo sea positivo, vive en `checkEventDraft` — en el dominio, porque
 * la misma regla apaga el boton en la app.
 */
const eventSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).nullable().default(null),
  instructor: z.string().max(120).nullable().default(null),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha va en formato YYYY-MM-DD.'),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'La hora va en formato HH:MM.'),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, 'La hora va en formato HH:MM.'),
  capacity: z.number().int().nullable().default(null),
  memberPriceCents: z.number().int(),
  guestPriceCents: z.number().int(),
  published: z.boolean().default(false),
});

const statusSchema = z.object({ status: z.enum(['draft', 'published', 'canceled']) });

const registrationStatusSchema = z.object({
  status: z.enum(['booked', 'attended', 'no_show', 'canceled']),
});

const registerSchema = z.object({ membershipId: z.string().uuid() });

const paySchema = z.object({
  rail: z.enum(['cash', 'yape', 'bank_transfer']),
  clientId: z.string().uuid().optional(),
});

@StaffOnly()
@Controller('staff/events')
export class EventsController {
  constructor(
    private readonly events: EventsService,
    private readonly registrations: EventRegistrationsService,
  ) {}

  /**
   * Lo que viene, y con `?past=true` lo que ya paso.
   *
   * Las dos listas son disjuntas: ver el mismo seminario en las dos no es mas
   * informacion, es una duda. Los borradores solo salen para el dueno — a
   * recepcion, un evento sin publicar no le sirve para nada y le ensucia la
   * lista de a quien espera.
   */
  @Get()
  list(
    @CurrentSession() session: Session,
    @Query('past') past?: string,
    @Query('drafts') drafts?: string,
  ) {
    const staff = assertStaffSession(session);
    return this.events.list(staff.tenantId, {
      onlyUpcoming: past !== 'true',
      includeDrafts: drafts === 'true' && staff.role === 'owner',
    });
  }

  @Get(':eventId')
  find(
    @CurrentSession() session: Session,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.events.find(assertStaffSession(session).tenantId, eventId);
  }

  @OwnerOnly()
  @Post()
  create(
    @CurrentSession() session: Session,
    @Body(parseWith(eventSchema)) body: z.infer<typeof eventSchema>,
  ) {
    return this.events.create(assertStaffSession(session).tenantId, body);
  }

  @OwnerOnly()
  @Post(':eventId')
  update(
    @CurrentSession() session: Session,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body(parseWith(eventSchema)) body: z.infer<typeof eventSchema>,
  ) {
    return this.events.update(assertStaffSession(session).tenantId, eventId, body);
  }

  /**
   * Publicar, volver a borrador o cancelar.
   *
   * Cancelar NO borra las reservas: son la lista de a quien hay que avisar.
   */
  @OwnerOnly()
  @Post(':eventId/status')
  setStatus(
    @CurrentSession() session: Session,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body(parseWith(statusSchema)) body: z.infer<typeof statusSchema>,
  ) {
    return this.events.setStatus(assertStaffSession(session).tenantId, eventId, body.status);
  }

  /** Solo el que nadie reservó. Con una plaza vendida, la salida es cancelar. */
  @OwnerOnly()
  @Delete(':eventId')
  remove(
    @CurrentSession() session: Session,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.events.remove(assertStaffSession(session).tenantId, eventId);
  }

  // -------------------------------------------------------------------------
  // Las plazas
  // -------------------------------------------------------------------------

  /** La lista del día: quién tiene plaza, quién pagó y quién vino. */
  @Get(':eventId/registrations')
  registrationsFor(
    @CurrentSession() session: Session,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.registrations.forEvent(assertStaffSession(session).tenantId, eventId);
  }

  /**
   * El mostrador mete a un alumno del padrón.
   *
   * Un rechazo vuelve con 200 y `booked: false`: que el seminario esté lleno no
   * es un error de la petición, y el recepcionista necesita el motivo con la
   * persona delante.
   */
  @Post(':eventId/registrations')
  register(
    @CurrentSession() session: Session,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body(parseWith(registerSchema)) body: z.infer<typeof registerSchema>,
  ) {
    return this.registrations.registerMember(
      assertStaffSession(session).tenantId,
      eventId,
      body.membershipId,
    );
  }

  /** Vino, no vino, o canceló. */
  @Post('registrations/:registrationId/status')
  setRegistrationStatus(
    @CurrentSession() session: Session,
    @Param('registrationId', ParseUUIDPipe) registrationId: string,
    @Body(parseWith(registrationStatusSchema)) body: z.infer<typeof registrationStatusSchema>,
  ) {
    return this.registrations.setStatus(
      assertStaffSession(session).tenantId,
      registrationId,
      body.status,
    );
  }

  /** Cobra la plaza. Idempotente: tocar dos veces no cobra dos veces. */
  @Post('registrations/:registrationId/pay')
  pay(
    @CurrentSession() session: Session,
    @Param('registrationId', ParseUUIDPipe) registrationId: string,
    @Body(parseWith(paySchema)) body: z.infer<typeof paySchema>,
  ) {
    const staff = assertStaffSession(session);
    return this.registrations.pay(staff.tenantId, registrationId, {
      rail: body.rail,
      staffId: staff.staffId,
      clientId: body.clientId ?? null,
    });
  }
}
