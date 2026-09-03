/**
 * Las plazas de un evento.
 *
 * Dos caminos hasta la misma fila y por eso el mismo servicio:
 *
 *  · **el mostrador** inscribe a un alumno del padron, que es lo que pasa cuando
 *    alguien pregunta por el seminario mientras paga su mensualidad;
 *  · **el directorio** deja reservar a cualquiera con su cuenta, y eso es lo que
 *    llena un seminario: gente que todavia no entrena ahi.
 *
 * El cupo se cuenta contra la base en la MISMA transaccion que inserta, y aun
 * asi la ultima palabra la tiene el indice `event_registrations_one_per_phone`:
 * dos personas cogiendo la ultima plaza a la vez es la carrera que ningun
 * `select` previo atrapa.
 *
 * Cobrar es un paso APARTE de reservar, a proposito. En la version 1 no hay
 * tarjeta: se reserva por la app y se paga en el mostrador, que es como funciona
 * un seminario de barrio. Por eso `charge_id` nace nulo y la lista del dia
 * distingue "tiene plaza" de "ya pago".
 */
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, ne, or, sql } from 'drizzle-orm';
import {
  eventPriceFor,
  validateEventBooking,
  type EventBookingDenial,
  type EventRegistration,
  type EventRegistrationStatus,
  type GymEvent,
} from '@sinchi/shared';
import { InjectDb } from '../../db/db.module';
import {
  schema,
  withContext,
  withTenant,
  withoutTenantIsolation,
  type Database,
  type Tx,
} from '../../db/client';
import { toEventRegistration } from '../../common/mappers';
import { Clock } from '../../common/clock';
import { SaasService } from '../saas/saas.service';
import { VisitorService, type VisitorAccount } from '../identity/visitor.service';
import { EventsService } from './events.service';

/** Una plaza con lo que el mostrador necesita leer de un vistazo. */
export interface RegistrationView {
  readonly registration: EventRegistration;
  /** En la version 1 todo cargo manual nace `succeeded`, asi que basta tenerlo. */
  readonly paid: boolean;
  /** `true` cuando entrena aqui: explica por que paga el precio que paga. */
  readonly isMember: boolean;
}

/**
 * Union discriminada y 200 en los dos casos, igual que el check-in: un rechazo
 * no es un error de la peticion sino el resultado del negocio, y quien lo lee
 * necesita el motivo para saber que hacer.
 */
export type BookEventOutcome =
  | { readonly booked: true; readonly registration: RegistrationView; readonly event: GymEvent }
  | { readonly booked: false; readonly reason: EventBookingDenial; readonly event: GymEvent };

@Injectable()
export class EventRegistrationsService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly clock: Clock,
    private readonly events: EventsService,
    private readonly visitors: VisitorService,
    private readonly saas: SaasService,
  ) {}

  /** La lista del dia: quien tiene plaza, quien pago y quien vino. */
  async forEvent(tenantId: string, eventId: string): Promise<readonly RegistrationView[]> {
    return withTenant(this.db, tenantId, async (tx) => {
      await this.events.findInTx(tx, eventId);

      const rows = await tx
        .select()
        .from(schema.eventRegistrations)
        .where(eq(schema.eventRegistrations.eventId, eventId))
        .orderBy(asc(schema.eventRegistrations.createdAt));

      return rows.map((row) => this.toView(row));
    });
  }

  /**
   * El mostrador mete a un alumno del padron.
   *
   * Se le aplica el precio de alumno sin preguntarlo: es lo que significa tener
   * membresia aqui, y dejarlo a eleccion del recepcionista convierte un precio
   * en un favor.
   */
  async registerMember(
    tenantId: string,
    eventId: string,
    membershipId: string,
  ): Promise<BookEventOutcome> {
    return withTenant(this.db, tenantId, async (tx) => {
      const event = await this.events.findInTx(tx, eventId);

      const [row] = await tx
        .select({
          membershipId: schema.memberships.id,
          userId: schema.users.id,
          fullName: schema.users.name,
          phone: schema.users.phone,
          email: schema.users.email,
        })
        .from(schema.memberships)
        .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
        .where(eq(schema.memberships.id, membershipId))
        .limit(1);

      if (row === undefined) {
        throw new NotFoundException('Ese alumno no está en el padrón de este gimnasio.');
      }

      return this.insert(tx, event, {
        membershipId: row.membershipId,
        userId: row.userId,
        firebaseUid: null,
        fullName: row.fullName,
        phone: row.phone,
        email: row.email === null ? null : row.email.toLowerCase(),
        isMember: true,
        // El mostrador ve el evento entero y decide inscribir: el estado del
        // gimnasio ya lo comprobo el guard de la ruta.
        gymActive: true,
      });
    });
  }

  /**
   * Alguien reserva desde el directorio.
   *
   * `slug` y no `tenantId` porque quien reserva no tiene sesion de este
   * gimnasio: llega desde la ficha publica, igual que en la clase gratis.
   */
  async book(input: {
    readonly slug: string;
    readonly eventId: string;
    readonly account: VisitorAccount;
    readonly fullName?: string | undefined;
    readonly phone?: string | undefined;
  }): Promise<BookEventOutcome> {
    const gym = await this.findGym(input.slug);
    if (gym === null) throw new NotFoundException('Ese gimnasio no existe.');

    const visitor = await this.visitors.resolve(input.account, {
      fullName: input.fullName,
      phone: input.phone,
    });
    // El gimnasio que no le paga a Sinchi no recibe reservas nuevas. Mismo
    // criterio que la clase gratis: lo ya reservado se respeta.
    const listed = (await this.saas.stateFor(gym.id)).listed;

    return withTenant(this.db, gym.id, async (tx) => {
      const event = await this.events.findInTx(tx, input.eventId);

      // Entrena aqui: le toca el precio de alumno aunque llegue por el
      // directorio. Cobrarle el de visitante por el camino que eligio seria
      // arbitrario, y lo notaria en el mostrador.
      const membership =
        visitor.userId === null
          ? null
          : ((
              await tx
                .select({ id: schema.memberships.id })
                .from(schema.memberships)
                .where(
                  and(
                    eq(schema.memberships.userId, visitor.userId),
                    eq(schema.memberships.status, 'active'),
                  ),
                )
                .limit(1)
            )[0]?.id ?? null);

      return this.insert(tx, event, {
        membershipId: membership,
        userId: visitor.userId,
        firebaseUid: visitor.firebaseUid,
        fullName: visitor.fullName,
        phone: visitor.phone,
        email: visitor.email,
        isMember: membership !== null,
        gymActive: gym.status === 'active' && listed,
      });
    });
  }

  /** Vino, no vino, o cancelo. Es lo que convierte la lista en un dato. */
  async setStatus(
    tenantId: string,
    registrationId: string,
    status: EventRegistrationStatus,
  ): Promise<RegistrationView> {
    return withTenant(this.db, tenantId, async (tx) => {
      const [row] = await tx
        .update(schema.eventRegistrations)
        .set({ status, canceledAt: status === 'canceled' ? new Date() : null })
        .where(eq(schema.eventRegistrations.id, registrationId))
        .returning();

      if (row === undefined) throw new NotFoundException('Esa plaza no existe.');
      return this.toView(row);
    });
  }

  /**
   * Cobra la plaza en el mostrador.
   *
   * NO pasa por `recordManualPayment`, y no es por comodidad: aquel arranca
   * leyendo la vista de una MEMBRESIA —su plan, su deuda, su ciclo— y la mitad
   * de la gente de un seminario no tiene ninguna. Forzarlo pediria inventarle
   * una ficha en el padron a quien vino a una clase, que es exactamente la
   * mentira que la columna nulable de `charges` existe para evitar.
   *
   * Lo que si comparte es el ledger: el cargo va a `charges` como cualquier otro
   * y entra en "cobrado este mes" sin que nadie sume dos tablas.
   */
  async pay(
    tenantId: string,
    registrationId: string,
    input: {
      readonly rail: 'cash' | 'yape' | 'bank_transfer';
      readonly staffId: string;
      readonly clientId?: string | null;
    },
  ): Promise<RegistrationView> {
    return withTenant(this.db, tenantId, async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.eventRegistrations)
        .where(eq(schema.eventRegistrations.id, registrationId))
        .limit(1);

      if (row === undefined) throw new NotFoundException('Esa plaza no existe.');
      if (row.status === 'canceled') {
        throw new ConflictException('Esa plaza está cancelada. Vuelve a inscribir a la persona.');
      }
      // Idempotente de verdad: el mostrador toca dos veces y no cobra dos veces.
      if (row.chargeId !== null) return this.toView(row);

      const [charge] = await tx
        .insert(schema.charges)
        .values({
          tenantId,
          subscriptionId: null,
          // `null` cuando quien paga no entrena aqui. Es el unico tipo de cargo
          // que lo permite (`charges_membership_unless_event`).
          membershipId: row.membershipId,
          type: 'event',
          amountCents: row.priceCents,
          status: 'succeeded',
          rail: input.rail,
          attempt: 1,
          recordedBy: input.staffId,
          clientId: input.clientId ?? null,
        })
        .onConflictDoNothing()
        .returning();

      if (charge === undefined) {
        // Choco con `charges_client_id_key`: la cola offline reintento un cobro
        // que ya entro. Se relee la plaza, que es lo que el mostrador espera ver.
        const [releida] = await tx
          .select()
          .from(schema.eventRegistrations)
          .where(eq(schema.eventRegistrations.id, registrationId))
          .limit(1);
        return this.toView(releida ?? row);
      }

      const [actualizada] = await tx
        .update(schema.eventRegistrations)
        .set({ chargeId: charge.id })
        .where(eq(schema.eventRegistrations.id, registrationId))
        .returning();

      return this.toView(actualizada!);
    });
  }

  /**
   * Las plazas de una persona, en todos los gimnasios.
   *
   * Es lo que la app le enseña: "vas al seminario del sábado". Sin esto, quien
   * reserva desde el directorio no vuelve a ver su reserva en ningun sitio.
   */
  async mine(account: VisitorAccount): Promise<readonly RegistrationView[]> {
    // `identify` y no `resolve`: leer las plazas de alguien no puede exigirle un
    // nombre y un celular que solo hacen falta para escribir una reserva nueva.
    const visitor = await this.visitors.identify(account);
    if (visitor.userId === null && visitor.firebaseUid === null) return [];

    /**
     * Sin este contexto la lista vuelve VACIA y no falla nada.
     *
     * La politica de `event_registrations` abre las filas por tres puertas
     * —gimnasio, identidad global o cuenta de Firebase verificada— y aqui no hay
     * gimnasio: quien pregunta puede no entrenar en ninguno. `withoutTenantIsolation`
     * no abre ninguna de las tres, asi que RLS lo escondia todo en silencio.
     * Se abren las dos que le corresponden a esta persona a la vez, porque quien
     * reservo antes de tener ficha tiene plazas colgadas de su `firebase_uid` y
     * las de despues, de su `user_id`.
     */
    return withContext(
      this.db,
      {
        ...(visitor.userId === null ? {} : { userId: visitor.userId }),
        ...(visitor.firebaseUid === null ? {} : { trialAccount: visitor.firebaseUid }),
      },
      async (tx) => {
        const rows = await tx
          .select()
          .from(schema.eventRegistrations)
          .where(
            and(
              ne(schema.eventRegistrations.status, 'canceled'),
              or(
                ...(visitor.userId === null
                  ? []
                  : [eq(schema.eventRegistrations.userId, visitor.userId)]),
                ...(visitor.firebaseUid === null
                  ? []
                  : [eq(schema.eventRegistrations.firebaseUid, visitor.firebaseUid)]),
              ),
            ),
          )
          .orderBy(asc(schema.eventRegistrations.createdAt));

        return rows.map((row) => this.toView(row));
      },
    );
  }

  // -------------------------------------------------------------------------
  // Interno
  // -------------------------------------------------------------------------

  private async insert(
    tx: Tx,
    event: GymEvent,
    person: {
      readonly membershipId: string | null;
      readonly userId: string | null;
      readonly firebaseUid: string | null;
      readonly fullName: string;
      readonly phone: string;
      readonly email: string | null;
      readonly isMember: boolean;
      readonly gymActive: boolean;
    },
  ): Promise<BookEventOutcome> {
    /**
     * El cerrojo que hace que el cupo signifique algo.
     *
     * Aqui habia un comentario que decia que la ultima palabra la tenia el
     * indice unico, y era FALSO: `event_registrations_one_per_phone` impide que
     * la MISMA persona coja dos plazas, no que tres personas distintas cojan las
     * dos ultimas. Tres reservas simultaneas contra un evento de dos plazas
     * leian las tres `seatsTaken = 0` y entraban las tres. Lo encontro el e2e de
     * reservas simultaneas, no la lectura del codigo.
     *
     * Bloquear la fila del evento serializa las reservas DE ESE evento y nada
     * mas: dos seminarios distintos se siguen vendiendo en paralelo.
     */
    await tx.execute(sql`select 1 from gym_events where id = ${event.id} for update`);

    /**
     * Su plaza previa, buscada por las TRES llaves.
     *
     * Solo por celular no basta: la misma cuenta escribiendo otro numero se
     * lleva una segunda plaza, y en un evento con cupo eso es una plaza que
     * alguien mas se queda sin comprar.
     */
    const [existingRow] = await tx
      .select()
      .from(schema.eventRegistrations)
      .where(
        and(
          eq(schema.eventRegistrations.eventId, event.id),
          ne(schema.eventRegistrations.status, 'canceled'),
          or(
            eq(schema.eventRegistrations.phone, person.phone),
            ...(person.userId === null
              ? []
              : [eq(schema.eventRegistrations.userId, person.userId)]),
            ...(person.firebaseUid === null
              ? []
              : [eq(schema.eventRegistrations.firebaseUid, person.firebaseUid)]),
          ),
        ),
      )
      .limit(1);

    const seats = await this.events.countSeats(tx, [event.id]);
    const [tenantRow] = await tx
      .select({ timezone: schema.tenants.timezone })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, event.tenantId))
      .limit(1);

    const verdict = validateEventBooking({
      gymActive: person.gymActive,
      event,
      seatsTaken: seats.get(event.id)?.taken ?? 0,
      existing:
        existingRow === undefined ? null : { paid: existingRow.chargeId !== null },
      isMember: person.isMember,
      today: this.clock.today(tenantRow?.timezone ?? 'America/Lima'),
    });

    if (!verdict.allowed) return { booked: false, reason: verdict.reason, event };

    const [row] = await tx
      .insert(schema.eventRegistrations)
      .values({
        tenantId: event.tenantId,
        eventId: event.id,
        membershipId: person.membershipId,
        userId: person.userId,
        firebaseUid: person.firebaseUid,
        fullName: person.fullName,
        phone: person.phone,
        email: person.email,
        priceCents: eventPriceFor(event, person.isMember),
        status: 'booked',
      })
      // Choca con `event_registrations_one_per_phone`: alguien cogio la plaza
      // entre el `select` de arriba y este insert.
      .onConflictDoNothing()
      .returning();

    if (row === undefined) {
      return {
        booked: false,
        reason: { code: 'already_registered', paid: false },
        event,
      };
    }

    return { booked: true, registration: this.toView(row), event };
  }

  private toView(row: typeof schema.eventRegistrations.$inferSelect): RegistrationView {
    return {
      registration: toEventRegistration(row),
      paid: row.chargeId !== null,
      isMember: row.membershipId !== null,
    };
  }

  private async findGym(slug: string) {
    return withoutTenantIsolation(this.db, async (tx) => {
      const [row] = await tx
        .select({
          id: schema.tenants.id,
          slug: schema.tenants.slug,
          name: schema.tenants.name,
          timezone: schema.tenants.timezone,
          status: schema.tenants.status,
        })
        .from(schema.tenants)
        .where(eq(schema.tenants.slug, slug))
        .limit(1);
      return row ?? null;
    });
  }
}
