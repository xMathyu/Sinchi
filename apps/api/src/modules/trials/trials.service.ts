/**
 * La clase gratis: el directorio publico y la reserva.
 *
 * Es la unica parte de la api que atiende a alguien que **todavia no es de
 * ningun gimnasio**, y eso condiciona todo lo demas:
 *
 *  · el directorio se sirve sin sesion — quien busca dojo no tiene cuenta aun;
 *  · la reserva se identifica con un ID token de Firebase ya verificado, igual
 *    que hace `/invites/:token/claim`. No hace falta ficha en ningun padron: la
 *    persona da su nombre y su celular, que es lo unico que el gimnasio necesita
 *    para atenderla el martes;
 *  · quien SI tiene identidad Sinchi reserva con su sesion y no repite datos.
 *
 * La regla —una clase gratis por persona y por gimnasio— la decide
 * `validateTrialBooking` en `@sinchi/shared`, la misma funcion que corre la app
 * para no ofrecer lo que va a fallar. Aqui solo se le dan los hechos.
 */
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, desc, eq, gte, ne, or, sql, type SQL } from 'drizzle-orm';
import {
  formatPlainDate,
  parsePlainDate,
  upcomingClassSlots,
  validateTrialBooking,
  trialMessage,
  weekdayName,
  isoWeekday,
  type ClassSchedule,
  type Plan,
  type PlainDate,
  type TrialBooking,
  type TrialDenialReason,
  type TrialSlot,
} from '@sinchi/shared';
import { InjectDb } from '../../db/db.module';
import {
  adoptTenant,
  schema,
  withTenant,
  withTrialAccount,
  withUser,
  withoutTenantIsolation,
  type Database,
  type Tx,
} from '../../db/client';
import { toClassSchedule, toPlan, toTrialBooking } from '../../common/mappers';
import { Clock } from '../../common/clock';
import { MailService } from '../mail/mail.service';

/** Ficha del gimnasio en la lista. Lo justo para decidir si abrirlo. */
export interface GymCard {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly trialClassEnabled: boolean;
  /** Plan mas barato. `null` si el gimnasio todavia no publico ninguno. */
  readonly fromPriceCents: number | null;
  /** Bloques de horario a la semana: dice si el local esta vivo. */
  readonly weeklyClasses: number;
  /** Nombres distintos de clase: "Judo Kids", "Judo Adultos"… */
  readonly disciplines: readonly string[];
}

export interface GymDetail extends GymCard {
  readonly timezone: string;
  readonly enrollmentFeeCents: number;
  readonly dropInPriceCents: number | null;
  readonly plans: readonly Plan[];
  readonly schedules: readonly ClassSchedule[];
  /** Las clases concretas que se pueden reservar, con fecha. */
  readonly slots: readonly TrialSlot[];
}

/** Quien reserva, ya identificado por el controlador. */
export type TrialAccount =
  | { readonly kind: 'user'; readonly userId: string }
  | {
      readonly kind: 'firebase';
      readonly uid: string;
      readonly email: string | null;
      readonly displayName: string | null;
    };

export interface BookInput {
  readonly slug: string;
  readonly account: TrialAccount;
  /** Solo hacen falta cuando la persona no tiene ficha en ningun padron. */
  readonly fullName?: string | undefined;
  readonly phone?: string | undefined;
  readonly classScheduleId: string;
  /** `YYYY-MM-DD`, la fecha civil del gimnasio. */
  readonly date: string;
}

/**
 * Resultado de intentar reservar.
 *
 * Union discriminada y 200 en los dos casos, igual que el check-in: un rechazo
 * no es un error de la peticion sino el resultado del negocio, y quien lo lee
 * necesita el motivo para saber que hacer. Ver `docs/api.md`.
 */
export type BookOutcome =
  | { readonly booked: true; readonly booking: TrialBookingView }
  | {
      readonly booked: false;
      readonly reason: TrialDenialReason;
      readonly message: { readonly title: string; readonly detail: string };
    };

/** Una reserva con el nombre del gimnasio: la app la muestra fuera de contexto. */
export interface TrialBookingView extends TrialBooking {
  readonly gymName: string;
  readonly gymSlug: string;
}

const MONTH_LONG = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'setiembre',
  'octubre',
  'noviembre',
  'diciembre',
] as const;

/** "martes 2 de setiembre". Solo lo usa el correo al gimnasio. */
const describeDate = (date: PlainDate): string =>
  `${weekdayName(isoWeekday(date))} ${date.day} de ${MONTH_LONG[date.month - 1] ?? ''}`;

/**
 * Celular normalizado.
 *
 * El indice unico que garantiza "una clase gratis por persona" compara texto, y
 * "987 654 321" y "987654321" son la misma persona con dos filas. Se guarda ya
 * normalizado en vez de comparar normalizando: un indice sobre una expresion no
 * lo ve la restriccion.
 */
const normalizePhone = (raw: string): string => raw.replace(/[^\d+]/g, '');

/** `23505` es la violacion de un indice unico en Postgres. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === '23505'
  );
}

@Injectable()
export class TrialsService {
  private readonly logger = new Logger(TrialsService.name);

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly clock: Clock,
    private readonly mail: MailService,
  ) {}

  // -------------------------------------------------------------------------
  // Directorio
  // -------------------------------------------------------------------------

  /**
   * Gimnasios activos de la red.
   *
   * Los agregados de cada local —desde cuanto, cuantas clases, que se entrena—
   * salen de una consulta POR GIMNASIO, y eso es deliberado: `plans` y
   * `class_schedules` tienen RLS por tenant, asi que una sola consulta sobre
   * todos no devolveria ninguna fila. Van dentro de una unica transaccion
   * adoptando cada gimnasio por turno: son N viajes por UNA conexion, no N
   * conexiones.
   *
   * Con los locales que caben en `LIMITE` esto es barato. El dia que el
   * directorio crezca de verdad, lo que toca no es paralelizarlo sino
   * mantener los agregados en `tenants` — no abrir un hueco en el aislamiento.
   */
  async directory(): Promise<readonly GymCard[]> {
    const LIMITE = 60;

    return withoutTenantIsolation(this.db, async (tx) => {
      const gyms = await tx
        .select({
          id: schema.tenants.id,
          slug: schema.tenants.slug,
          name: schema.tenants.name,
          trialClassEnabled: schema.tenants.trialClassEnabled,
        })
        .from(schema.tenants)
        .where(eq(schema.tenants.status, 'active'))
        .orderBy(schema.tenants.name)
        .limit(LIMITE);

      const cards: GymCard[] = [];
      for (const gym of gyms) {
        await adoptTenant(tx, gym.id);
        cards.push({ ...gym, ...(await this.aggregates(tx)) });
      }
      return cards;
    });
  }

  /** Los tres numeros de la tarjeta, en un viaje. Exige contexto de gimnasio. */
  private async aggregates(
    tx: Tx,
  ): Promise<Pick<GymCard, 'fromPriceCents' | 'weeklyClasses' | 'disciplines'>> {
    const { rows } = await tx.execute<{
      from_price_cents: number | null;
      weekly_classes: number;
      disciplines: string[] | null;
    }>(sql`
      select
        (select min(price_cents)::int from plans where active) as from_price_cents,
        (select count(*)::int from class_schedules where active) as weekly_classes,
        (select array_agg(distinct name) from class_schedules where active) as disciplines
    `);

    const row = rows[0];
    return {
      fromPriceCents: row?.from_price_cents ?? null,
      weeklyClasses: row?.weekly_classes ?? 0,
      disciplines: (row?.disciplines ?? []).slice().sort(),
    };
  }

  /**
   * La pagina del gimnasio: horarios, precios y las clases que se pueden probar.
   *
   * Un gimnasio suspendido no se puede abrir. No es una tecnicidad: quien
   * reservara ahi se presentaria en un local que ya no opera, y la app no tiene
   * forma de saberlo despues.
   */
  async gym(slug: string): Promise<GymDetail> {
    const gym = await this.findGym(slug);
    if (gym === null || gym.status !== 'active') {
      throw new NotFoundException('Ese gimnasio no está disponible.');
    }

    return withTenant(this.db, gym.id, async (tx) => {
      const [planRows, scheduleRows] = await Promise.all([
        tx
          .select()
          .from(schema.plans)
          .where(eq(schema.plans.active, true))
          .orderBy(schema.plans.priceCents),
        tx
          .select()
          .from(schema.classSchedules)
          .where(eq(schema.classSchedules.active, true))
          .orderBy(schema.classSchedules.weekday, schema.classSchedules.startTime),
      ]);

      const schedules = scheduleRows.map(toClassSchedule);
      const plans = planRows.map(toPlan);

      return {
        id: gym.id,
        slug: gym.slug,
        name: gym.name,
        trialClassEnabled: gym.trialClassEnabled,
        timezone: gym.timezone,
        enrollmentFeeCents: gym.enrollmentFeeCents,
        dropInPriceCents: gym.dropInPriceCents,
        fromPriceCents: plans[0]?.priceCents ?? null,
        weeklyClasses: schedules.length,
        disciplines: [...new Set(schedules.map((s) => s.name))].sort(),
        plans,
        schedules,
        // Solo si el gimnasio la ofrece: una lista de horas reservables en un
        // local que no da clase gratis promete algo que la reserva rechazaria.
        slots: gym.trialClassEnabled ? this.slotsFor(schedules, gym.timezone) : [],
      };
    });
  }

  private slotsFor(schedules: readonly ClassSchedule[], timezone: string): readonly TrialSlot[] {
    return upcomingClassSlots({
      schedules,
      today: this.clock.today(timezone),
      now: this.clock.timeOfDay(timezone),
    });
  }

  // -------------------------------------------------------------------------
  // Reservar
  // -------------------------------------------------------------------------

  async book(input: BookInput): Promise<BookOutcome> {
    const gym = await this.findGym(input.slug);
    if (gym === null) throw new NotFoundException('Ese gimnasio no existe.');

    const person = await this.resolvePerson(input);

    const outcome = await withTenant(this.db, gym.id, async (tx): Promise<BookOutcome> => {
      const scheduleRows = await tx
        .select()
        .from(schema.classSchedules)
        .where(eq(schema.classSchedules.active, true));
      const schedules = scheduleRows.map(toClassSchedule);

      const [existing] = await tx
        .select()
        .from(schema.trialBookings)
        .where(
          and(
            ne(schema.trialBookings.status, 'canceled'),
            person.userId === null
              ? eq(schema.trialBookings.phone, person.phone)
              : or(
                  eq(schema.trialBookings.phone, person.phone),
                  eq(schema.trialBookings.userId, person.userId),
                ),
          ),
        )
        .limit(1);

      // Ya entrena aqui: la clase gratis es para conocer un local nuevo.
      const membership =
        person.userId === null
          ? []
          : await tx
              .select({ id: schema.memberships.id })
              .from(schema.memberships)
              .where(eq(schema.memberships.userId, person.userId))
              .limit(1);

      const verdict = validateTrialBooking({
        gymActive: gym.status === 'active',
        trialOffered: gym.trialClassEnabled,
        alreadyMember: membership.length > 0,
        existing:
          existing === undefined
            ? null
            : {
                date: parsePlainDate(existing.localDate),
                startTime: existing.startTime,
                className: existing.className,
              },
        slots: this.slotsFor(schedules, gym.timezone),
        scheduleId: input.classScheduleId,
        date: parsePlainDate(input.date),
      });

      if (!verdict.allowed) {
        return { booked: false, reason: verdict.reason, message: trialMessage(verdict.reason) };
      }

      try {
        const [row] = await tx
          .insert(schema.trialBookings)
          .values({
            tenantId: gym.id,
            classScheduleId: verdict.slot.scheduleId,
            userId: person.userId,
            firebaseUid: person.firebaseUid,
            fullName: person.fullName,
            phone: person.phone,
            email: person.email,
            className: verdict.slot.name,
            localDate: formatPlainDate(verdict.slot.date),
            startTime: verdict.slot.startTime,
            endTime: verdict.slot.endTime,
          })
          .returning();

        return {
          booked: true,
          booking: { ...toTrialBooking(row!), gymName: gym.name, gymSlug: gym.slug },
        };
      } catch (error) {
        // La otra mitad de la regla. El `select` de arriba no ve la reserva que
        // otra peticion esta insertando en este mismo instante —dos toques
        // seguidos con la red lenta bastan— y quien la atrapa es el indice
        // unico. Aqui solo se traduce a lo que la primera habria contestado.
        if (!isUniqueViolation(error)) throw error;

        const reason: TrialDenialReason = {
          code: 'already_booked',
          date: verdict.slot.date,
          startTime: verdict.slot.startTime,
          className: verdict.slot.name,
        };
        return { booked: false, reason, message: trialMessage(reason) };
      }
    });

    if (outcome.booked) await this.notify(gym, outcome.booking);
    return outcome;
  }

  /**
   * Quien esta reservando.
   *
   * Una cuenta de Firebase que YA tiene ficha se resuelve a su identidad: es la
   * misma persona, y sin esto tendria dos reservas en el mismo gimnasio —una por
   * cada camino de entrada— y el indice unico por celular la rechazaria con un
   * mensaje que no explica nada.
   */
  private async resolvePerson(input: BookInput): Promise<{
    readonly userId: string | null;
    readonly firebaseUid: string | null;
    readonly fullName: string;
    readonly phone: string;
    readonly email: string | null;
  }> {
    const known = await withoutTenantIsolation(this.db, async (tx) => {
      const [row] = await tx
        .select({
          id: schema.users.id,
          name: schema.users.name,
          phone: schema.users.phone,
          email: schema.users.email,
        })
        .from(schema.users)
        .where(
          input.account.kind === 'user'
            ? eq(schema.users.id, input.account.userId)
            : eq(schema.users.firebaseUid, input.account.uid),
        )
        .limit(1);
      return row ?? null;
    });

    if (known !== null) {
      return {
        userId: known.id,
        firebaseUid: input.account.kind === 'firebase' ? input.account.uid : null,
        fullName: known.name,
        phone: normalizePhone(known.phone),
        // A minusculas porque la tabla lo exige y `users.email` no lo garantiza:
        // lo escribe recepcion a mano al dar de alta. Sin esto, reservar con una
        // ficha cuyo correo lleva mayusculas revienta contra el CHECK.
        email: known.email === null ? null : known.email.toLowerCase(),
      };
    }

    if (input.account.kind === 'user') {
      // El token de sesion apunta a una identidad que ya no existe.
      throw new NotFoundException('No encontramos tu cuenta.');
    }

    const fullName = (input.fullName ?? input.account.displayName ?? '').trim();
    const phone = normalizePhone(input.phone ?? '');
    if (fullName.length < 2 || phone.length < 6) {
      // Nombre y celular no son burocracia: son lo unico con lo que el gimnasio
      // puede reconocer y llamar a quien dijo que vendria.
      throw new BadRequestException('Faltan tu nombre y tu celular para avisarle al gimnasio.');
    }

    return {
      userId: null,
      firebaseUid: input.account.uid,
      fullName,
      phone,
      email: input.account.email === null ? null : input.account.email.toLowerCase(),
    };
  }

  /**
   * Avisa al gimnasio, sin poder romper la reserva.
   *
   * Va al dueno; si el local no tiene dueno registrado, a recepcion. El fallo se
   * traga a proposito: la reserva ya existe y sale en la app del mostrador
   * aunque el correo no salga nunca. `notified_at` deja ver cual si salio.
   */
  private async notify(
    gym: { readonly id: string; readonly name: string; readonly timezone: string },
    booking: TrialBookingView,
  ): Promise<void> {
    try {
      const destinatarios = await withTenant(this.db, gym.id, async (tx) =>
        tx
          .select({ email: schema.users.email, role: schema.staff.role })
          .from(schema.staff)
          .innerJoin(schema.users, eq(schema.users.id, schema.staff.userId))
          .orderBy(schema.staff.role),
      );

      const para = destinatarios.find((row) => row.email !== null)?.email;
      if (para === undefined || para === null || !this.mail.disponible) return;

      const enviado = await this.mail.avisarClaseGratis({
        para,
        gimnasio: gym.name,
        nombre: booking.fullName,
        telefono: booking.phone,
        clase: booking.className,
        cuando: describeDate(booking.date),
        hora: booking.startTime,
      });

      if (enviado.enviado) {
        await withTenant(this.db, gym.id, (tx) =>
          tx
            .update(schema.trialBookings)
            .set({ notifiedAt: new Date() })
            .where(eq(schema.trialBookings.id, booking.id)),
        );
      }
    } catch (error) {
      this.logger.warn(
        `No se pudo avisar de la clase gratis: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Listas
  // -------------------------------------------------------------------------

  /**
   * Quien viene a probar. La lista del mostrador.
   *
   * Por defecto solo lo que falta: el dueno abre esto para saber a quien espera
   * esta semana, no para leer el historial. `includePast` trae lo anterior, que
   * es donde se ve cuantos vinieron de verdad.
   */
  async forTenant(
    tenantId: string,
    options: { readonly includePast?: boolean } = {},
  ): Promise<readonly TrialBooking[]> {
    return withTenant(this.db, tenantId, async (tx) => {
      const [gym] = await tx
        .select({ timezone: schema.tenants.timezone })
        .from(schema.tenants)
        .where(eq(schema.tenants.id, tenantId))
        .limit(1);

      const hoy = formatPlainDate(this.clock.today(gym?.timezone ?? 'America/Lima'));

      const proximas = options.includePast !== true;
      const rows = proximas
        ? await tx
            .select()
            .from(schema.trialBookings)
            .where(gte(schema.trialBookings.localDate, hoy))
            .orderBy(schema.trialBookings.localDate, schema.trialBookings.startTime)
            .limit(200)
        : await tx
            .select()
            .from(schema.trialBookings)
            .orderBy(desc(schema.trialBookings.localDate), schema.trialBookings.startTime)
            .limit(200);

      return rows.map(toTrialBooking);
    });
  }

  /** Las reservas de quien ya tiene identidad Sinchi, en toda la red. */
  async forUser(userId: string): Promise<readonly TrialBookingView[]> {
    return withUser(this.db, userId, (tx) =>
      this.withGymNames(tx, eq(schema.trialBookings.userId, userId)),
    );
  }

  /** Las de quien todavia es solo una cuenta de Google. */
  async forAccount(firebaseUid: string): Promise<readonly TrialBookingView[]> {
    return withTrialAccount(this.db, firebaseUid, (tx) =>
      this.withGymNames(tx, eq(schema.trialBookings.firebaseUid, firebaseUid)),
    );
  }

  /**
   * La reserva con el nombre de su gimnasio.
   *
   * `tenants` no tiene RLS —es la tabla que dice que gimnasios existen— asi que
   * el JOIN funciona sin contexto de gimnasio, que es justo lo que no hay aqui:
   * quien mira sus reservas puede tenerlas en tres locales distintos.
   */
  private async withGymNames(tx: Tx, condition: SQL): Promise<readonly TrialBookingView[]> {
    const rows = await tx
      .select({ booking: schema.trialBookings, name: schema.tenants.name, slug: schema.tenants.slug })
      .from(schema.trialBookings)
      .innerJoin(schema.tenants, eq(schema.tenants.id, schema.trialBookings.tenantId))
      .where(condition)
      .orderBy(desc(schema.trialBookings.localDate))
      .limit(50);

    return rows.map((row) => ({
      ...toTrialBooking(row.booking),
      gymName: row.name,
      gymSlug: row.slug,
    }));
  }

  // -------------------------------------------------------------------------
  // Cambiar el estado
  // -------------------------------------------------------------------------

  /** El mostrador marca quien vino y quien no. Es lo que convierte la lista en dato. */
  async setStatus(
    tenantId: string,
    bookingId: string,
    status: 'booked' | 'attended' | 'no_show' | 'canceled',
  ): Promise<TrialBooking> {
    return withTenant(this.db, tenantId, async (tx) => {
      const [row] = await tx
        .update(schema.trialBookings)
        .set({ status, canceledAt: status === 'canceled' ? new Date() : null })
        .where(eq(schema.trialBookings.id, bookingId))
        .returning();

      if (row === undefined) throw new NotFoundException('Esa reserva no existe.');
      return toTrialBooking(row);
    });
  }

  /**
   * Cancela su propia reserva.
   *
   * Se lee con la identidad de quien pide y se escribe con la del gimnasio: la
   * politica deja VER la fila propia sin contexto de local, pero escribir sigue
   * exigiendolo. Por eso se adopta el gimnasio a mitad de la transaccion, que es
   * exactamente para lo que existe `adoptTenant`.
   *
   * Cancelar libera el cupo: el indice unico solo mira las vigentes. Quien avisa
   * que no puede ir el martes merece poder venir el jueves.
   */
  async cancelOwn(
    account: TrialAccount,
    bookingId: string,
  ): Promise<{ readonly canceled: true }> {
    const run = async (tx: Tx): Promise<{ readonly canceled: true }> => {
      const [row] = await tx
        .select({ id: schema.trialBookings.id, tenantId: schema.trialBookings.tenantId })
        .from(schema.trialBookings)
        .where(
          and(
            eq(schema.trialBookings.id, bookingId),
            ne(schema.trialBookings.status, 'canceled'),
            account.kind === 'user'
              ? eq(schema.trialBookings.userId, account.userId)
              : eq(schema.trialBookings.firebaseUid, account.uid),
          ),
        )
        .limit(1);

      if (row === undefined) throw new NotFoundException('Esa reserva no existe.');

      await adoptTenant(tx, row.tenantId);
      await tx
        .update(schema.trialBookings)
        .set({ status: 'canceled', canceledAt: new Date() })
        .where(eq(schema.trialBookings.id, row.id));

      return { canceled: true };
    };

    return account.kind === 'user'
      ? withUser(this.db, account.userId, run)
      : withTrialAccount(this.db, account.uid, run);
  }

  // -------------------------------------------------------------------------

  /** El gimnasio por su slug. `tenants` es global: no lleva RLS. */
  private async findGym(slug: string) {
    return withoutTenantIsolation(this.db, async (tx) => {
      const [row] = await tx
        .select({
          id: schema.tenants.id,
          slug: schema.tenants.slug,
          name: schema.tenants.name,
          timezone: schema.tenants.timezone,
          status: schema.tenants.status,
          trialClassEnabled: schema.tenants.trialClassEnabled,
          enrollmentFeeCents: schema.tenants.enrollmentFeeCents,
          dropInPriceCents: schema.tenants.dropInPriceCents,
        })
        .from(schema.tenants)
        .where(eq(schema.tenants.slug, slug))
        .limit(1);
      return row ?? null;
    });
  }
}
