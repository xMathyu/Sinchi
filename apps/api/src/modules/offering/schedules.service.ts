/**
 * Los horarios del gimnasio, escritos por su dueno.
 *
 * Era el ultimo agujero del alta desde la app, y era el peor porque no daba la
 * cara: el gimnasio que se registraba nacia con sus planes —eso ya lo arreglo
 * `PLANES_DE_ARRANQUE`— pero con CERO bloques de horario, y `class_schedules`
 * solo la sabia llenar un script nuestro. Sin bloques:
 *
 *  · la ficha publica no tiene ni una hora que reservar, asi que la tarjeta del
 *    directorio ofrece "1 clase gratis" y la pantalla de dentro contesta "este
 *    gimnasio todavia no publico sus horarios". La UNICA via de alta que empieza
 *    fuera del local —la que atiende a quien no entrena en ningun sitio— estaba
 *    muerta para todos los locales nuevos;
 *  · el directorio lo lista con "0 clases por semana" y sin ninguna disciplina,
 *    que es exactamente como se ve un local cerrado.
 *
 * Tres reglas que ordenan lo de abajo:
 *
 *  1. **Se archiva Y se borra.** Al reves que los planes: `attendance` y
 *     `trial_bookings` apuntan al bloque con ON DELETE **set null** y los dos se
 *     guardan copiado lo que importa —`class_name`, `start_time`—, asi que
 *     borrar un bloque no deja ningun historial sin explicacion. Archivar sigue
 *     existiendo para el bloque de temporada: el local que quita la clase de
 *     verano en marzo la recupera en diciembre sin volver a teclearla.
 *
 *  2. **Solapar AVISA, no impide.** Un local con dos tatamis da dos clases a las
 *     19:00 del lunes, y eso es legitimo. Quien decide es el dueno; lo que no
 *     puede pasar es que lo descubra al ver el horario publicado.
 *
 *  3. **Cambiar un bloque no toca lo ya reservado.** Quien reservo el martes a
 *     las 19:00 sigue esperado a esa hora: su reserva lleva la clase y la hora
 *     copiadas. Mover el bloque cambia lo que se ofrece de aqui en adelante.
 */
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { and, asc, eq, gte, ne, sql } from 'drizzle-orm';
import {
  checkScheduleDraft,
  formatPlainDate,
  scheduleDenialMessage,
  schedulesOverlap,
  TZ_LIMA,
  type ClassSchedule,
  type IsoWeekday,
} from '@sinchi/shared';
import { InjectDb } from '../../db/db.module';
import { schema, withTenant, type Database, type Tx } from '../../db/client';
import { toClassSchedule } from '../../common/mappers';
import { Clock } from '../../common/clock';

export interface ScheduleInput {
  readonly name: string;
  readonly weekday: number;
  readonly startTime: string;
  readonly endTime: string;
  readonly capacity: number | null;
  readonly instructor: string | null;
  readonly active: boolean;
}

/**
 * Un bloque con lo que el dueno necesita saber ANTES de tocarlo.
 *
 * `upcomingTrials` es el equivalente de `activeMembers` en un plan: la
 * diferencia entre "esto se puede quitar" y "hay tres personas que vienen a
 * probar aqui el jueves". La reserva sobrevive al borrado —lleva la hora
 * copiada— pero el dueno tiene que enterarse antes, no despues.
 *
 * `overlaps` es el aviso del punto 2: no impide guardar, pero la lista lo marca.
 */
export interface ScheduleWithUsage {
  readonly schedule: ClassSchedule;
  readonly active: boolean;
  readonly upcomingTrials: number;
  readonly overlaps: boolean;
}

@Injectable()
export class SchedulesService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly clock: Clock,
  ) {}

  /**
   * Todos los bloques del local, publicados y archivados.
   *
   * Es la lista del DUENO. La del mostrador (`CheckInService.schedules`) sigue
   * devolviendo solo los activos, porque el escaner valida contra lo que el
   * local da HOY.
   */
  async listForOwner(tenantId: string): Promise<readonly ScheduleWithUsage[]> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(schema.classSchedules)
        .orderBy(
          sql`${schema.classSchedules.active} desc`,
          asc(schema.classSchedules.weekday),
          asc(schema.classSchedules.startTime),
        );

      const trials = await this.countUpcomingTrials(tx, tenantId);
      const activos = rows.filter((row) => row.active);

      return rows.map((row) => ({
        schedule: toClassSchedule(row),
        active: row.active,
        upcomingTrials: trials.get(row.id) ?? 0,
        // Solo entre publicados: un bloque archivado no le pisa la hora a nadie.
        overlaps:
          row.active &&
          activos.some((otro) => otro.id !== row.id && schedulesOverlap(row, otro)),
      }));
    });
  }

  async create(tenantId: string, input: ScheduleInput): Promise<ClassSchedule> {
    this.assertValid(input);

    return withTenant(this.db, tenantId, async (tx) => {
      const [row] = await tx
        .insert(schema.classSchedules)
        .values(this.toColumns(tenantId, input))
        .returning();
      return toClassSchedule(row!);
    });
  }

  async update(
    tenantId: string,
    scheduleId: string,
    input: ScheduleInput,
  ): Promise<ClassSchedule> {
    this.assertValid(input);

    return withTenant(this.db, tenantId, async (tx) => {
      const [row] = await tx
        .update(schema.classSchedules)
        .set(this.toColumns(tenantId, input))
        .where(eq(schema.classSchedules.id, scheduleId))
        .returning();

      if (row === undefined) {
        throw new NotFoundException('Ese horario no existe en este gimnasio.');
      }
      return toClassSchedule(row);
    });
  }

  /**
   * Quita el bloque del horario publicado sin perderlo.
   *
   * Es lo que hace el local que suspende la clase de las 7am en vacaciones: deja
   * de ofrecerse, deja de contar como clase de la semana en el directorio y deja
   * de validar en la puerta, pero en diciembre vuelve con un toque.
   */
  async setActive(
    tenantId: string,
    scheduleId: string,
    active: boolean,
  ): Promise<ClassSchedule> {
    return withTenant(this.db, tenantId, async (tx) => {
      const [row] = await tx
        .update(schema.classSchedules)
        .set({ active })
        .where(eq(schema.classSchedules.id, scheduleId))
        .returning();

      if (row === undefined) {
        throw new NotFoundException('Ese horario no existe en este gimnasio.');
      }
      return toClassSchedule(row);
    });
  }

  /**
   * Borra el bloque de verdad.
   *
   * Se permite siempre, al reves que un plan: las dos tablas que lo apuntan
   * —`attendance` y `trial_bookings`— son ON DELETE set null y las dos llevan
   * copiado lo que hace falta para leerlas despues. Lo que se pierde es el
   * enlace, no el dato, y a cambio el dueno puede limpiar el bloque que escribio
   * con el dedo torpe hace dos minutos.
   */
  async remove(tenantId: string, scheduleId: string): Promise<{ readonly deleted: true }> {
    return withTenant(this.db, tenantId, async (tx) => {
      const [row] = await tx
        .delete(schema.classSchedules)
        .where(eq(schema.classSchedules.id, scheduleId))
        .returning({ id: schema.classSchedules.id });

      if (row === undefined) {
        throw new NotFoundException('Ese horario no existe en este gimnasio.');
      }
      return { deleted: true as const };
    });
  }

  // -------------------------------------------------------------------------
  // Interno
  // -------------------------------------------------------------------------

  /**
   * Cuantas clases de prueba vivas apuntan a cada bloque, de hoy en adelante.
   *
   * Una consulta para todos y no una por bloque: son diez o quince filas, pero
   * el N+1 se escribe igual de facil y despues nadie lo quita.
   */
  private async countUpcomingTrials(tx: Tx, tenantId: string): Promise<Map<string, number>> {
    const [tenant] = await tx
      .select({ timezone: schema.tenants.timezone })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, tenantId))
      .limit(1);

    const desde = formatPlainDate(this.clock.today(tenant?.timezone ?? TZ_LIMA));

    const rows = await tx
      .select({
        scheduleId: schema.trialBookings.classScheduleId,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.trialBookings)
      // Sin filtro de tenant: `trial_bookings` va bajo RLS y `withTenant` ya
      // puso el contexto. Repetirlo aqui solo invita a creer que hace falta.
      .where(
        and(
          gte(schema.trialBookings.localDate, desde),
          ne(schema.trialBookings.status, 'canceled'),
        ),
      )
      .groupBy(schema.trialBookings.classScheduleId);

    return new Map(
      rows
        .filter((row): row is typeof row & { scheduleId: string } => row.scheduleId !== null)
        .map((row) => [row.scheduleId, row.count]),
    );
  }

  /**
   * El motivo del dominio, con su texto, antes de que hable la base.
   *
   * `checkScheduleDraft` es la MISMA funcion que apaga el boton en la app, igual
   * que `checkPlanDraft` con los planes.
   */
  private assertValid(input: ScheduleInput): void {
    const denial = checkScheduleDraft({
      name: input.name,
      weekday: input.weekday,
      startTime: input.startTime,
      endTime: input.endTime,
      capacity: input.capacity,
      instructor: input.instructor,
    });
    if (denial !== null) throw new BadRequestException(scheduleDenialMessage(denial));
  }

  private toColumns(tenantId: string, input: ScheduleInput) {
    return {
      tenantId,
      name: input.name.trim(),
      weekday: input.weekday as IsoWeekday,
      startTime: input.startTime,
      endTime: input.endTime,
      capacity: input.capacity,
      instructor:
        input.instructor === null || input.instructor.trim().length === 0
          ? null
          : input.instructor.trim(),
      active: input.active,
    };
  }
}
