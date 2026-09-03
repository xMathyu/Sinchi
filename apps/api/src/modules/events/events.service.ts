/**
 * Los eventos del gimnasio: seminarios, talleres, la clase del invitado.
 *
 * Es lo tercero que un local vende, despues de las mensualidades y la clase
 * suelta, y es el unico que le trae gente NUEVA por la puerta: un seminario con
 * alguien conocido lo llenan personas que todavia no entrenan ahi. De ahi salen
 * las dos decisiones que se ven en este archivo:
 *
 *  1. **dos precios**, el del alumno de casa y el del que viene de fuera;
 *  2. **cancelar no es despublicar.** Despublicar es "todavia no lo ofrezco";
 *     cancelar es "habia gente con plaza y se cayo", y esa gente hay que poder
 *     listarla para avisarle. Un booleano perdia esa diferencia.
 *
 * El cupo se cuenta SIEMPRE contra la base y nunca contra un contador guardado:
 * dos personas reservando la ultima plaza a la vez es la carrera que un numero
 * en una columna pierde, y el indice `event_registrations_one_per_phone` es lo
 * unico que de verdad la para.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import {
  checkEventDraft,
  eventDenialMessage,
  formatPlainDate,
  parsePlainDate,
  seatsLeft,
  type GymEvent,
  type GymEventStatus,
  type LocalTime,
  type PlainDate,
} from '@sinchi/shared';
import { InjectDb } from '../../db/db.module';
import { schema, withTenant, type Database, type Tx } from '../../db/client';
import { toGymEvent } from '../../common/mappers';
import { Clock } from '../../common/clock';

export interface EventInput {
  readonly name: string;
  readonly description: string | null;
  readonly instructor: string | null;
  /** `YYYY-MM-DD`. */
  readonly date: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly capacity: number | null;
  readonly memberPriceCents: number;
  readonly guestPriceCents: number;
  readonly published: boolean;
}

/** Un evento con lo que hace falta para decidir sobre el. */
export interface EventWithSeats {
  readonly event: GymEvent;
  /** Plazas vivas: reservadas, pagadas o no. Canceladas no cuentan. */
  readonly seatsTaken: number;
  /** `null` cuando el evento no limita el cupo. */
  readonly seatsLeft: number | null;
  /** Cuantas estan pagadas. Es la cifra que el dueno mira antes del dia. */
  readonly paidSeats: number;
}

@Injectable()
export class EventsService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly clock: Clock,
  ) {}

  /**
   * Los eventos del local.
   *
   * `onlyUpcoming` es lo que pide el mostrador —quien viene esta semana— y sin
   * el sale el historial, que es donde el dueno ve si el seminario del mes
   * pasado lleno. Las dos listas son disjuntas a proposito: ver el mismo evento
   * en "lo que viene" y en "lo que paso" no es mas informacion, es una duda.
   */
  async list(
    tenantId: string,
    options: { readonly onlyUpcoming?: boolean; readonly includeDrafts?: boolean } = {},
  ): Promise<readonly EventWithSeats[]> {
    return withTenant(this.db, tenantId, async (tx) => {
      const today = formatPlainDate(await this.todayIn(tx, tenantId));

      const filtros = [
        options.onlyUpcoming === true
          ? sql`${schema.gymEvents.localDate} >= ${today}`
          : sql`${schema.gymEvents.localDate} < ${today}`,
      ];
      if (options.includeDrafts !== true) {
        filtros.push(ne(schema.gymEvents.status, 'draft'));
      }

      const rows = await tx
        .select()
        .from(schema.gymEvents)
        .where(and(...filtros))
        .orderBy(
          options.onlyUpcoming === true
            ? asc(schema.gymEvents.localDate)
            : desc(schema.gymEvents.localDate),
          asc(schema.gymEvents.startTime),
        );

      return this.withSeats(tx, rows.map(toGymEvent));
    });
  }

  /**
   * Lo que ve alguien desde la calle: solo lo PUBLICADO y que no ha pasado.
   *
   * Un borrador ahi seria vender algo que el dueno todavia no decidio, y un
   * cancelado seria peor: llenaria de reservas un evento que no existe. La lista
   * del staff si los ensena, porque el cancelado es la lista de a quien avisar.
   */
  async publicUpcoming(tenantId: string): Promise<readonly EventWithSeats[]> {
    return withTenant(this.db, tenantId, async (tx) => {
      const today = formatPlainDate(await this.todayIn(tx, tenantId));

      const rows = await tx
        .select()
        .from(schema.gymEvents)
        .where(
          and(
            eq(schema.gymEvents.status, 'published'),
            sql`${schema.gymEvents.localDate} >= ${today}`,
          ),
        )
        .orderBy(asc(schema.gymEvents.localDate), asc(schema.gymEvents.startTime));

      return this.withSeats(tx, rows.map(toGymEvent));
    });
  }

  async find(tenantId: string, eventId: string): Promise<EventWithSeats> {
    return withTenant(this.db, tenantId, async (tx) => {
      const evento = await this.findInTx(tx, eventId);
      const [conCupo] = await this.withSeats(tx, [evento]);
      return conCupo!;
    });
  }

  async create(tenantId: string, input: EventInput): Promise<GymEvent> {
    return withTenant(this.db, tenantId, async (tx) => {
      const today = await this.todayIn(tx, tenantId);
      // Al CREARLO si se exige que la fecha no sea pasada; al editar no, porque
      // corregir el nombre del invitado despues del seminario es legitimo.
      this.assertValid(input, today);

      const [row] = await tx
        .insert(schema.gymEvents)
        .values(this.toColumns(tenantId, input))
        .returning();
      return toGymEvent(row!);
    });
  }

  async update(tenantId: string, eventId: string, input: EventInput): Promise<GymEvent> {
    this.assertValid(input);

    return withTenant(this.db, tenantId, async (tx) => {
      const actual = await this.findInTx(tx, eventId);

      /**
       * Un evento cancelado no se edita: se veria como si volviera a estar en
       * pie sin que nadie lo decidiera, y hay gente a la que ya se le dijo que
       * no. Para revivirlo esta `setStatus`.
       */
      if (actual.status === 'canceled') {
        throw new ConflictException(
          'Este evento está cancelado. Vuelve a publicarlo antes de cambiarle nada.',
        );
      }

      /**
       * Bajar el cupo por debajo de las plazas ya vendidas dejaria a gente con
       * reserva fuera de su propio evento, y el mostrador se enteraria el dia
       * del seminario con las personas delante.
       */
      if (input.capacity !== null) {
        const vendidas = await this.countSeats(tx, [eventId]);
        const ocupadas = vendidas.get(eventId)?.taken ?? 0;
        if (input.capacity < ocupadas) {
          throw new ConflictException(
            `Ya hay ${ocupadas} ${ocupadas === 1 ? 'plaza reservada' : 'plazas reservadas'}: el cupo no puede bajar de ahí.`,
          );
        }
      }

      const [row] = await tx
        .update(schema.gymEvents)
        .set(this.toColumns(tenantId, input))
        .where(eq(schema.gymEvents.id, eventId))
        .returning();
      return toGymEvent(row!);
    });
  }

  /**
   * Publicar, volver a borrador o cancelar.
   *
   * Cancelar guarda la fecha —lo exige `gym_events_canceled_has_date`— y NO
   * borra las reservas: son la lista de a quien hay que avisar, y borrarlas
   * dejaria al dueno sin saber a quien le prometio una plaza.
   */
  async setStatus(
    tenantId: string,
    eventId: string,
    status: GymEventStatus,
  ): Promise<GymEvent> {
    return withTenant(this.db, tenantId, async (tx) => {
      const [row] = await tx
        .update(schema.gymEvents)
        .set({
          status,
          canceledAt: status === 'canceled' ? new Date() : null,
        })
        .where(eq(schema.gymEvents.id, eventId))
        .returning();

      if (row === undefined) throw new NotFoundException('Ese evento no existe en este gimnasio.');
      return toGymEvent(row);
    });
  }

  /**
   * Borra el evento que nadie reservo.
   *
   * Con una sola plaza vendida la salida es cancelar: borrarlo se llevaria por
   * delante la lista de a quien avisar, y el cargo de quien ya pago se quedaria
   * sin nada que lo explique.
   */
  async remove(tenantId: string, eventId: string): Promise<{ readonly deleted: true }> {
    return withTenant(this.db, tenantId, async (tx) => {
      await this.findInTx(tx, eventId);

      const seats = await this.countSeats(tx, [eventId]);
      const ocupadas = seats.get(eventId)?.taken ?? 0;
      if (ocupadas > 0) {
        throw new ConflictException(
          `${ocupadas} ${ocupadas === 1 ? 'persona tiene' : 'personas tienen'} plaza. Cancélalo en vez de borrarlo: así conservas a quién avisar.`,
        );
      }

      await tx.delete(schema.gymEvents).where(eq(schema.gymEvents.id, eventId));
      return { deleted: true as const };
    });
  }

  // -------------------------------------------------------------------------
  // Interno
  // -------------------------------------------------------------------------

  async findInTx(tx: Tx, eventId: string): Promise<GymEvent> {
    const [row] = await tx
      .select()
      .from(schema.gymEvents)
      .where(eq(schema.gymEvents.id, eventId))
      .limit(1);
    if (row === undefined) throw new NotFoundException('Ese evento no existe en este gimnasio.');
    return toGymEvent(row);
  }

  /**
   * Plazas de varios eventos en UNA consulta.
   *
   * La lista del dueno son cinco o seis eventos, pero el N+1 se escribe igual de
   * facil y despues nadie lo quita.
   */
  async countSeats(
    tx: Tx,
    eventIds: readonly string[],
  ): Promise<Map<string, { readonly taken: number; readonly paid: number }>> {
    if (eventIds.length === 0) return new Map();

    const rows = await tx
      .select({
        eventId: schema.eventRegistrations.eventId,
        taken: sql<number>`count(*)::int`,
        paid: sql<number>`count(${schema.eventRegistrations.chargeId})::int`,
      })
      .from(schema.eventRegistrations)
      .where(
        and(
          inArray(schema.eventRegistrations.eventId, [...new Set(eventIds)]),
          // Cancelar libera la plaza: es lo que hace que el cupo signifique algo.
          ne(schema.eventRegistrations.status, 'canceled'),
        ),
      )
      .groupBy(schema.eventRegistrations.eventId);

    return new Map(rows.map((row) => [row.eventId, { taken: row.taken, paid: row.paid }]));
  }

  private async withSeats(tx: Tx, events: readonly GymEvent[]): Promise<EventWithSeats[]> {
    const seats = await this.countSeats(
      tx,
      events.map((e) => e.id),
    );
    return events.map((event) => {
      const cuenta = seats.get(event.id) ?? { taken: 0, paid: 0 };
      return {
        event,
        seatsTaken: cuenta.taken,
        seatsLeft: seatsLeft(event, cuenta.taken),
        paidSeats: cuenta.paid,
      };
    });
  }

  private async todayIn(tx: Tx, tenantId: string): Promise<PlainDate> {
    const [row] = await tx
      .select({ timezone: schema.tenants.timezone })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, tenantId))
      .limit(1);
    if (row === undefined) throw new NotFoundException('Ese gimnasio no existe.');
    return this.clock.today(row.timezone);
  }

  /** La MISMA funcion que apaga el botón en la app. */
  private assertValid(input: EventInput, today?: PlainDate): void {
    const denial = checkEventDraft(
      {
        name: input.name,
        description: input.description,
        instructor: input.instructor,
        date: parsePlainDate(input.date),
        startTime: input.startTime as LocalTime,
        endTime: input.endTime as LocalTime,
        capacity: input.capacity,
        memberPriceCents: input.memberPriceCents,
        guestPriceCents: input.guestPriceCents,
      },
      today,
    );
    if (denial !== null) throw new BadRequestException(eventDenialMessage(denial));
  }

  private toColumns(tenantId: string, input: EventInput) {
    return {
      tenantId,
      name: input.name.trim(),
      description: input.description === null ? null : input.description.trim() || null,
      instructor: input.instructor === null ? null : input.instructor.trim() || null,
      localDate: input.date,
      startTime: input.startTime,
      endTime: input.endTime,
      capacity: input.capacity,
      memberPriceCents: input.memberPriceCents,
      guestPriceCents: input.guestPriceCents,
      status: (input.published ? 'published' : 'draft') as GymEventStatus,
      canceledAt: null,
    };
  }
}
