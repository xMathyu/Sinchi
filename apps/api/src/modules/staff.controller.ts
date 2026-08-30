/**
 * Rutas del staff: la puerta y el mostrador.
 *
 * El `tenantId` sale SIEMPRE del token, nunca del cliente. Un recepcionista
 * autenticado en un dojo no puede leer ni tocar el padrón de otro, por más que
 * escriba otro uuid en la URL.
 *
 * El rechazo de un check-in se devuelve con 200 y un `registered: false`, no con
 * un 4xx. No es un error de la petición: es el resultado del negocio, y el staff
 * necesita el motivo estructurado en pantalla para saber qué hacer (MD 4.3).
 */
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { CurrentSession, OwnerOnly, StaffOnly } from '../auth/auth.guard';
import { assertStaffSession, type Session } from '../auth/session';
import { parseWith } from '../common/zod.pipe';
import { MembershipViewService } from './memberships/membership-view.service';
import { CheckInService } from './checkin/checkin.service';
import { BillingService } from './billing/billing.service';
import { MembersService } from './members/members.service';
import { TrialsService } from './trials/trials.service';

const qrScanSchema = z.object({
  /** Contenido crudo del QR: `SINCHI1:u:<userId>:<code>`. */
  payload: z.string().min(10).max(200),
  /** `false` para solo consultar sin registrar. */
  record: z.boolean().default(true),
  clientId: z.string().uuid().optional(),
  deviceId: z.string().uuid().optional(),
});

const manualCheckInSchema = z.object({
  membershipId: z.string().uuid(),
  /** Dejar pasar a pesar de un rechazo. Queda auditado con el nombre del staff. */
  overrideDenial: z.boolean().default(false),
  clientId: z.string().uuid().optional(),
  occurredAt: z.coerce.date().optional(),
});

const paymentSchema = z.object({
  membershipId: z.string().uuid(),
  type: z.enum(['renewal', 'enrollment', 'drop_in']),
  rail: z.enum(['cash', 'yape', 'bank_transfer']),
  periods: z.number().int().min(1).max(12).optional(),
  /** En céntimos enteros. Obligatorio para matrícula y clase suelta. */
  amountCents: z.number().int().min(0).optional(),
  clientId: z.string().uuid().optional(),
});

/**
 * Alta de un alumno.
 *
 * `name` y `phone` son opcionales porque el ancla es el DOCUMENTO: si ya hay una
 * identidad con ese documento, se reutiliza y esos datos ya se saben. Solo hacen
 * falta cuando la persona es nueva, y el servicio lo exige entonces.
 */
const enrollSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  documentId: z.string().min(6).max(20),
  phone: z.string().min(6).max(20).optional(),
  email: z.string().email().optional(),
  planId: z.string().uuid(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha va en formato YYYY-MM-DD.')
    .optional(),
  internalAlias: z.string().max(60).optional(),
});

const resubscribeSchema = z.object({ planId: z.string().uuid() });

/**
 * Que paso con quien reservo una clase gratis.
 *
 * `no_show` va separado de `canceled` porque no son lo mismo para el gimnasio:
 * quien avisa que no viene sigue siendo un interesado; quien no aparece sin
 * avisar es otro dato sobre el mismo posible alumno.
 */
const trialStatusSchema = z.object({
  status: z.enum(['booked', 'attended', 'no_show', 'canceled']),
});

/** El interruptor de la clase gratis. No todos los gimnasios la dan. */
const trialClassSchema = z.object({ enabled: z.boolean() });

/**
 * Cola offline.
 *
 * Un solo viaje para subir todo lo acumulado. En una red de gimnasio, veinte
 * peticiones sueltas es veinte oportunidades de que se corte a la mitad; una
 * sola con veinte items falla o funciona completa.
 *
 * Cada item lleva su `clientId`: reintentar el lote entero no duplica nada, ni
 * asistencias ni cobros.
 */
const syncSchema = z.object({
  attendances: z
    .array(
      z.object({
        clientId: z.string().uuid(),
        membershipId: z.string().uuid(),
        method: z.enum(['qr', 'manual']),
        overrideDenial: z.boolean().default(false),
        occurredAt: z.coerce.date(),
      }),
    )
    .max(200)
    .default([]),
  payments: z
    .array(
      z.object({
        clientId: z.string().uuid(),
        membershipId: z.string().uuid(),
        type: z.enum(['renewal', 'enrollment', 'drop_in']),
        rail: z.enum(['cash', 'yape', 'bank_transfer']),
        periods: z.number().int().min(1).max(12).optional(),
        amountCents: z.number().int().min(0).optional(),
      }),
    )
    .max(200)
    .default([]),
});

@StaffOnly()
@Controller('staff')
export class StaffController {
  constructor(
    private readonly views: MembershipViewService,
    private readonly checkin: CheckInService,
    private readonly billing: BillingService,
    private readonly members: MembersService,
    private readonly trials: TrialsService,
  ) {}

  // -------------------------------------------------------------------------
  // Padrón
  // -------------------------------------------------------------------------

  /**
   * Padrón completo con estado.
   *
   * Es lo que el dispositivo de la puerta descarga para validar sin conexión, y
   * se sirve en dos consultas: con 150 alumnos, un N+1 aquí serían 150 viajes
   * por la red del gimnasio, que es justo la que no funciona (MD 4.6).
   *
   * `?includeCanceled=true` trae además las bajas. Sin eso, cancelar dejaba a la
   * persona sin salida: desaparece del padrón y su `membershipId` deja de ser
   * alcanzable, así que `resubscribe` —que existe justo para volver— no se podía
   * llamar desde ninguna pantalla.
   */
  @Get('roster')
  roster(
    @CurrentSession() session: Session,
    @Query('includeCanceled') includeCanceled?: string,
  ) {
    return this.views.roster(assertStaffSession(session).tenantId, undefined, {
      includeCanceled: includeCanceled === 'true',
    });
  }

  /**
   * ¿Hay ya una identidad Sinchi con ese correo?
   *
   * Devuelve un booleano y NADA MAS. La tentacion es responder con el nombre y
   * el documento para que el alta se rellene sola, y eso convierte esta ruta en
   * un buscador de personas: `users` es global, asi que cualquier recepcion
   * podria cosechar datos de gente que entrena en otro local, o comprobar si un
   * correo cualquiera es usuario de Sinchi.
   *
   * Lo que se ahorra igual: saber si hara falta pedirle el nombre y el celular.
   * Los datos aparecen despues, al inscribirla con su documento — cuando ya es
   * alumna de este gimnasio y por tanto son suyos de ver.
   *
   * `exactamente una` a proposito: el correo NO es unico en `users`, asi que dos
   * coincidencias no identifican a nadie.
   */
  @Get('members/identity')
  async identityByEmail(@CurrentSession() session: Session, @Query('email') email = '') {
    assertStaffSession(session);
    return this.members.identityExists(email.trim());
  }

  @Get('roster/search')
  async search(@CurrentSession() session: Session, @Query('q') query = '') {
    const needle = query.trim().toLowerCase();
    const roster = await this.views.roster(assertStaffSession(session).tenantId);
    if (needle.length === 0) return roster;

    const digits = needle.replace(/\D/g, '');
    return roster.filter(
      (entry) =>
        entry.user.name.toLowerCase().includes(needle) ||
        (digits.length > 0 && entry.user.documentId.includes(digits)),
    );
  }

  /**
   * Ficha del alumno para el mostrador.
   *
   * Incluye las bajas: si el mostrador puede verlas en el padrón, tiene que
   * poder abrirlas — es desde aquí desde donde se reactiva a alguien que canceló.
   */
  @Get('members/:membershipId')
  membership(
    @CurrentSession() session: Session,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
  ) {
    return this.views.detail(assertStaffSession(session).tenantId, membershipId, {
      includeCanceled: true,
    });
  }

  @Post('members')
  enroll(
    @CurrentSession() session: Session,
    @Body(parseWith(enrollSchema)) body: z.infer<typeof enrollSchema>,
  ) {
    return this.members.enroll(assertStaffSession(session).tenantId, body);
  }

  @Post('members/:membershipId/resubscribe')
  resubscribe(
    @CurrentSession() session: Session,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Body(parseWith(resubscribeSchema)) body: z.infer<typeof resubscribeSchema>,
  ) {
    return this.members.resubscribe(
      assertStaffSession(session).tenantId,
      membershipId,
      body.planId,
    );
  }

  @Get('plans')
  plans(@CurrentSession() session: Session) {
    return this.members.plans(assertStaffSession(session).tenantId);
  }

  @Get('schedules')
  schedules(@CurrentSession() session: Session) {
    return this.checkin.schedules(assertStaffSession(session).tenantId);
  }

  // -------------------------------------------------------------------------
  // Clases gratis
  // -------------------------------------------------------------------------

  /**
   * Quien viene a probar.
   *
   * Es la lista de posibles alumnos: gente que encontro el gimnasio en la app y
   * dijo a que hora vendria. Por defecto solo lo que falta —el mostrador la abre
   * para saber a quien espera— y con `?includePast=true` sale el historial, que
   * es donde se ve cuantos vinieron de verdad.
   */
  @Get('trials')
  trialBookings(@CurrentSession() session: Session, @Query('includePast') includePast?: string) {
    return this.trials.forTenant(assertStaffSession(session).tenantId, {
      includePast: includePast === 'true',
    });
  }

  /**
   * ¿Este gimnasio ofrece la clase gratis?
   *
   * Lo lee recepción también, aunque no pueda cambiarlo: la pantalla tiene que
   * poder decir por qué no llega nadie a probar.
   */
  @Get('trials/settings')
  trialSettings(@CurrentSession() session: Session) {
    return this.trials.settings(assertStaffSession(session).tenantId);
  }

  /**
   * Enciende o apaga la clase gratis del local.
   *
   * Del dueño, no de recepción: es una decisión comercial, del mismo orden que
   * el precio de los planes.
   *
   * Apagarla no cancela lo ya reservado —esa promesa ya se hizo— sino que corta
   * lo de adelante: el gimnasio deja de ofrecer horas y una reserva nueva vuelve
   * con `not_offered`.
   */
  @OwnerOnly()
  @Post('trials/settings')
  setTrialClass(
    @CurrentSession() session: Session,
    @Body(parseWith(trialClassSchema)) body: z.infer<typeof trialClassSchema>,
  ) {
    return this.trials.setTrialClassEnabled(
      assertStaffSession(session).tenantId,
      body.enabled,
    );
  }

  /** Vino, no vino, o canceló. Es lo que convierte la lista en un dato. */
  @Post('trials/:bookingId/status')
  setTrialStatus(
    @CurrentSession() session: Session,
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
    @Body(parseWith(trialStatusSchema)) body: z.infer<typeof trialStatusSchema>,
  ) {
    return this.trials.setStatus(
      assertStaffSession(session).tenantId,
      bookingId,
      body.status,
    );
  }

  // -------------------------------------------------------------------------
  // Puerta
  // -------------------------------------------------------------------------

  /** Modo A del MD 4.6: el staff escanea el QR del alumno. */
  @Post('checkin/qr')
  async scanQr(
    @CurrentSession() session: Session,
    @Body(parseWith(qrScanSchema)) body: z.infer<typeof qrScanSchema>,
  ) {
    const staff = assertStaffSession(session);
    const evaluation = await this.checkin.evaluateQr(staff.tenantId, body.payload);

    if (!body.record || !evaluation.result.allowed) {
      return { ...evaluation, registered: false };
    }

    return this.checkin.record(staff.tenantId, {
      membershipId: evaluation.view.membership.id,
      method: 'qr',
      staffId: staff.staffId,
      deviceId: body.deviceId ?? null,
      clientId: body.clientId ?? null,
    });
  }

  /**
   * Marcado manual: el alumno sin celular o con la batería muerta.
   *
   * Queda registrado con `method = manual` y con quién lo hizo, porque es el
   * hueco por donde se cuelan favores (MD 4.6).
   */
  @Post('checkin/manual')
  manualCheckIn(
    @CurrentSession() session: Session,
    @Body(parseWith(manualCheckInSchema)) body: z.infer<typeof manualCheckInSchema>,
  ) {
    const staff = assertStaffSession(session);
    return this.checkin.record(staff.tenantId, {
      membershipId: body.membershipId,
      method: 'manual',
      overrideDenial: body.overrideDenial,
      staffId: staff.staffId,
      clientId: body.clientId ?? null,
      occurredAt: body.occurredAt,
    });
  }

  @Get('checkin/recent')
  recent(@CurrentSession() session: Session) {
    return this.checkin.recentToday(assertStaffSession(session).tenantId);
  }

  // -------------------------------------------------------------------------
  // Mostrador
  // -------------------------------------------------------------------------

  /**
   * Registra un pago hecho en mostrador.
   *
   * En la versión 1 es el único camino por el que entra dinero. Devuelve el
   * estado resultante ya recalculado, para que el recepcionista vea que el
   * acceso quedó liberado sin tener que recargar la pantalla.
   */
  @Post('payments')
  recordPayment(
    @CurrentSession() session: Session,
    @Body(parseWith(paymentSchema)) body: z.infer<typeof paymentSchema>,
  ) {
    const staff = assertStaffSession(session);
    return this.billing.recordManualPayment(staff.tenantId, {
      ...body,
      staffId: staff.staffId,
      clientId: body.clientId ?? null,
    });
  }

  // -------------------------------------------------------------------------
  // Sincronización
  // -------------------------------------------------------------------------

  /**
   * Sube la cola acumulada sin conexión.
   *
   * Cada item se procesa por separado y se devuelve su resultado: un cobro que
   * falla porque el periodo ya estaba pagado no debe impedir que suban las otras
   * diecinueve asistencias. El dispositivo borra de su cola lo que vuelve con
   * `ok: true` y conserva el resto para revisarlo.
   *
   * El servidor reconcilia y tiene la última palabra (MD 4.6): si la validación
   * local del dispositivo dejó pasar a alguien que aquí sale rechazado, la
   * respuesta lo dice y queda registrado como excepción, no se borra.
   */
  @Post('sync')
  async sync(
    @CurrentSession() session: Session,
    @Body(parseWith(syncSchema)) body: z.infer<typeof syncSchema>,
  ) {
    const staff = assertStaffSession(session);

    const attendances = await Promise.all(
      body.attendances.map(async (item) => {
        try {
          const outcome = await this.checkin.record(staff.tenantId, {
            membershipId: item.membershipId,
            method: item.method,
            overrideDenial: item.overrideDenial,
            staffId: staff.staffId,
            clientId: item.clientId,
            occurredAt: item.occurredAt,
          });
          return { clientId: item.clientId, ok: true as const, outcome };
        } catch (error) {
          return { clientId: item.clientId, ok: false as const, error: describe(error) };
        }
      }),
    );

    const payments = await Promise.all(
      body.payments.map(async (item) => {
        try {
          const result = await this.billing.recordManualPayment(staff.tenantId, {
            ...item,
            staffId: staff.staffId,
          });
          return { clientId: item.clientId, ok: true as const, result };
        } catch (error) {
          return { clientId: item.clientId, ok: false as const, error: describe(error) };
        }
      }),
    );

    return {
      attendances,
      payments,
      syncedAt: new Date().toISOString(),
      // El padrón vuelve en la misma respuesta: el dispositivo refresca su caché
      // justo cuando acaba de recuperar la conexión, que es cuando puede.
      roster: await this.views.roster(staff.tenantId),
    };
  }

  // -------------------------------------------------------------------------
  // Reportes
  // -------------------------------------------------------------------------

  /** Solo el dueño ve los números del local (MD 4.6). */
  @OwnerOnly()
  @Get('summary')
  summary(@CurrentSession() session: Session) {
    return this.billing.summary(assertStaffSession(session).tenantId);
  }
}

/** Mensaje legible de un error, sin filtrar detalles internos. */
function describe(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === 'string') return message;
    // Nest empaqueta los errores de validacion como objeto.
    if (typeof message === 'object' && message !== null) return JSON.stringify(message);
  }
  return 'No se pudo procesar.';
}
