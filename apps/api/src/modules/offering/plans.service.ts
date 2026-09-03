/**
 * Los planes del gimnasio, escritos por su dueno.
 *
 * Antes de esto, `plans` solo se llenaba desde un script nuestro
 * (`db:seed:kaizen`). Servia para los tres primeros clientes y dejo de servir el
 * dia que un gimnasio se puede dar de alta solo: nacia SIN NINGUN PLAN, y sin
 * plan no se puede inscribir a nadie porque el alta exige `plan_id`. El local
 * que se registraba un martes no podia usar el producto hasta que alguien de
 * aqui le sembrara la tarifa a mano.
 *
 * Dos reglas que ordenan todo lo de abajo:
 *
 *  1. **Se archiva, no se borra.** `subscriptions.plan_id` es ON DELETE restrict,
 *     y con razon: el plan es lo que explica cuanto cobraba una suscripcion. Se
 *     borra solo el que no ha llegado a usarse nunca — el tipeo de hace dos
 *     minutos— y ese caso se detecta preguntandole a la base, no adivinando.
 *
 *  2. **Cambiar un plan cambia lo que se cobra manana, nunca lo ya cobrado.** El
 *     ledger es append-only y aqui no se toca: subir el precio de "Ilimitado"
 *     mueve la proxima renovacion de todos los que lo tienen, y eso es
 *     exactamente lo que el dueno quiere decir cuando sube un precio. Lo que no
 *     puede pasar es que se recalculen cargos viejos.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import {
  checkPlanDraft,
  planDenialMessage,
  type IsoWeekday,
  type Plan,
  type PlanType,
} from '@sinchi/shared';
import { InjectDb } from '../../db/db.module';
import { schema, withTenant, type Database, type Tx } from '../../db/client';
import { toPlan } from '../../common/mappers';

export interface PlanInput {
  readonly name: string;
  readonly type: PlanType;
  readonly sessionsPerWeek: number | null;
  readonly allowedDays: readonly number[] | null;
  readonly priceCents: number;
  readonly active: boolean;
}

/**
 * Un plan con lo que el dueno necesita saber ANTES de tocarlo.
 *
 * `activeMembers` no es adorno: es la diferencia entre "esto se puede borrar" y
 * "esto lo estan pagando catorce personas". Sin el numero delante, archivar un
 * plan es una decision a ciegas.
 */
export interface PlanWithUsage {
  readonly plan: Plan;
  readonly activeMembers: number;
  /** `false` cuando alguien lo apunta: entonces solo se puede archivar. */
  readonly deletable: boolean;
}

@Injectable()
export class PlansService {
  constructor(@InjectDb() private readonly db: Database) {}

  /**
   * Todos los planes del local, activos y archivados.
   *
   * Es la lista del DUENO. La del mostrador (`MembersService.plans`) sigue
   * devolviendo solo los activos, porque inscribir a alguien en un plan
   * archivado es justo lo que archivar tiene que impedir.
   */
  async listForOwner(tenantId: string): Promise<readonly PlanWithUsage[]> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(schema.plans)
        .orderBy(sql`${schema.plans.active} desc`, asc(schema.plans.priceCents));

      const usage = await this.countMembersByPlan(tx);

      return rows.map((row) => {
        const activeMembers = usage.get(row.id) ?? 0;
        return { plan: toPlan(row), activeMembers, deletable: activeMembers === 0 };
      });
    });
  }

  async create(tenantId: string, input: PlanInput): Promise<Plan> {
    this.assertValid(input);

    return withTenant(this.db, tenantId, async (tx) => {
      const [row] = await tx
        .insert(schema.plans)
        .values(this.toColumns(tenantId, input))
        // Choca con `plans_active_name_per_tenant`: dos planes activos con el
        // mismo nombre son la misma tarifa leida dos veces.
        .onConflictDoNothing()
        .returning();

      if (row === undefined) {
        // El nombre que se devuelve es el del plan QUE YA ESTA, no el que
        // acaban de teclear: el indice ignora mayusculas, asi que decir
        // «ya tienes "mañanas"» cuando en la lista pone "Mañanas" manda al dueno
        // a buscar algo que no va a encontrar escrito asi.
        const existente = await this.findActiveByName(tx, input.name);
        throw new ConflictException(
          `Ya tienes un plan activo que se llama "${existente ?? input.name.trim()}". Ponle otro nombre o archiva el anterior.`,
        );
      }
      return toPlan(row);
    });
  }

  async update(tenantId: string, planId: string, input: PlanInput): Promise<Plan> {
    this.assertValid(input);

    return withTenant(this.db, tenantId, async (tx) => {
      const [row] = await tx
        .update(schema.plans)
        .set(this.toColumns(tenantId, input))
        .where(eq(schema.plans.id, planId))
        .returning();

      if (row === undefined) throw new NotFoundException('Ese plan no existe en este gimnasio.');
      return toPlan(row);
    });
  }

  /**
   * Apaga un plan sin borrarlo.
   *
   * Quien ya lo tiene sigue pagandolo: archivar saca el plan del alta y del
   * cambio de plan, no echa a nadie. Es como se sube un precio sin tocarle la
   * cuota a los alumnos viejos.
   */
  async setActive(tenantId: string, planId: string, active: boolean): Promise<Plan> {
    return withTenant(this.db, tenantId, async (tx) => {
      if (active) await this.assertNameFree(tx, planId);

      const [row] = await tx
        .update(schema.plans)
        .set({ active })
        .where(eq(schema.plans.id, planId))
        .returning();

      if (row === undefined) throw new NotFoundException('Ese plan no existe en este gimnasio.');
      return toPlan(row);
    });
  }

  /**
   * Borra de verdad, y solo el plan que nunca se uso.
   *
   * Existe por un caso concreto: el dueno escribio "Ilimitdo" con un dedo torpe
   * hace dos minutos y no quiere una lista de archivados llena de basura. En
   * cuanto una suscripcion lo apunta, la unica salida es archivar — borrarlo
   * dejaria un cargo del mes pasado sin nada que explique cuanto se cobro.
   */
  async remove(tenantId: string, planId: string): Promise<{ readonly deleted: true }> {
    return withTenant(this.db, tenantId, async (tx) => {
      const [existing] = await tx
        .select({ id: schema.plans.id })
        .from(schema.plans)
        .where(eq(schema.plans.id, planId))
        .limit(1);
      if (existing === undefined) {
        throw new NotFoundException('Ese plan no existe en este gimnasio.');
      }

      const [row] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.subscriptions)
        .where(eq(schema.subscriptions.planId, planId));
      const count = row?.count ?? 0;

      if (count > 0) {
        throw new ConflictException(
          count === 1
            ? 'Un alumno tiene este plan. Archívalo en vez de borrarlo: así deja de ofrecerse y quien lo tiene lo conserva.'
            : `${count} alumnos tienen este plan. Archívalo en vez de borrarlo: así deja de ofrecerse y quienes lo tienen lo conservan.`,
        );
      }

      // `pending_plan_id` es ON DELETE set null, asi que un downgrade guardado
      // contra este plan no impide el borrado — pero tampoco puede quedarse
      // apuntando al vacio en silencio. Con cero suscripciones no hay ninguno.
      await tx.delete(schema.plans).where(eq(schema.plans.id, planId));
      return { deleted: true as const };
    });
  }

  // -------------------------------------------------------------------------
  // Interno
  // -------------------------------------------------------------------------

  /**
   * Cuantos alumnos vivos tiene cada plan.
   *
   * Una consulta para todos y no una por plan: la lista del dueno son cinco o
   * seis tarifas, pero el N+1 se escribe igual de facil y despues nadie lo
   * quita.
   */
  private async countMembersByPlan(tx: Tx): Promise<Map<string, number>> {
    const rows = await tx
      .select({
        planId: schema.subscriptions.planId,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.subscriptions)
      .where(ne(schema.subscriptions.status, 'canceled'))
      .groupBy(schema.subscriptions.planId);

    return new Map(rows.map((row) => [row.planId, row.count]));
  }

  /**
   * El motivo del dominio, con su texto, antes de que hable la base.
   *
   * `checkPlanDraft` es la MISMA funcion que apaga el boton en la app. La
   * restriccion `plans_type_consistent` sigue estando debajo y es la que no se
   * puede saltar; esto es lo que evita que el dueno llegue hasta ella para
   * enterarse de que le falta un dato.
   */
  private assertValid(input: PlanInput): void {
    const denial = checkPlanDraft({
      name: input.name,
      type: input.type,
      sessionsPerWeek: input.sessionsPerWeek,
      allowedDays: input.allowedDays,
      priceCents: input.priceCents,
    });
    if (denial !== null) throw new BadRequestException(planDenialMessage(denial));
  }

  /** El plan activo que ocupa ese nombre, tal como esta escrito en la lista. */
  private async findActiveByName(
    tx: Tx,
    name: string,
    exceptId?: string,
  ): Promise<string | null> {
    const [row] = await tx
      .select({ name: schema.plans.name })
      .from(schema.plans)
      .where(
        and(
          eq(schema.plans.active, true),
          sql`lower(${schema.plans.name}) = lower(${name.trim()})`,
          ...(exceptId === undefined ? [] : [ne(schema.plans.id, exceptId)]),
        ),
      )
      .limit(1);
    return row?.name ?? null;
  }

  /** Reactivar choca con el indice igual que crear: se avisa antes y con nombre. */
  private async assertNameFree(tx: Tx, planId: string): Promise<void> {
    const [plan] = await tx
      .select({ name: schema.plans.name })
      .from(schema.plans)
      .where(eq(schema.plans.id, planId))
      .limit(1);
    if (plan === undefined) return;

    const clash = await this.findActiveByName(tx, plan.name, planId);
    if (clash !== null) {
      throw new ConflictException(
        `Ya tienes un plan activo que se llama "${clash}". Archiva ese primero o cámbiale el nombre.`,
      );
    }
  }

  private toColumns(tenantId: string, input: PlanInput) {
    return {
      tenantId,
      name: input.name.trim(),
      type: input.type,
      // Las columnas siguen la restriccion de la base, no lo que llegue: un
      // `sessionsPerWeek` colado en un plan ilimitado la rompe, y el error que
      // sale de ahi no lo entiende nadie.
      sessionsPerWeek: input.type === 'sessions_per_week' ? input.sessionsPerWeek : null,
      allowedDays:
        input.allowedDays === null ? null : ([...input.allowedDays] as IsoWeekday[]),
      priceCents: input.priceCents,
      active: input.active,
    };
  }
}
