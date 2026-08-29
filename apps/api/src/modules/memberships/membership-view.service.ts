/**
 * Modelo de lectura de una membresía.
 *
 * Es el mismo cálculo que hace la app en su store, con las mismas funciones
 * puras de `@sinchi/shared`. Eso no es duplicación: son dos superficies
 * consumiendo el mismo dominio, que es exactamente lo que el monorepo existe
 * para permitir (MD 9). Lo que no se repite es la regla.
 *
 * Dos cosas que se resuelven aquí y no en la base:
 *  - el estado de la suscripción se RECALCULA con `evaluateDelinquency`. La
 *    columna `status` es un caché para poder filtrar en SQL; si discrepan, manda
 *    la función;
 *  - la deuda se DERIVA con `computeReceivable`. No hay columna de saldo, porque
 *    un saldo guardado se desincroniza del ledger y después nadie sabe cuál de
 *    los dos miente (MD 4.5).
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  computeReceivable,
  evaluateDelinquency,
  isoWeekOf,
  membershipStatus,
  quotaFromCount,
  type AccessLevel,
  type Attendance,
  type Charge,
  type DelinquencyState,
  type Membership,
  type Plan,
  type PlainDate,
  type QuotaState,
  type Receivable,
  type Subscription,
  type Tenant,
  type User,
} from '@sinchi/shared';
import { InjectDb } from '../../db/db.module';
import { schema, withTenant, withUser, type Database, type Tx } from '../../db/client';
import {
  toAttendance,
  toCharge,
  toMembership,
  toPlan,
  toSubscription,
  toTenant,
  toUser,
} from '../../common/mappers';
import { Clock } from '../../common/clock';

export interface MembershipView {
  readonly membership: Membership;
  /** Identidad global: vive fuera del tenant (MD 5). */
  readonly user: User;
  readonly tenant: Tenant;
  readonly plan: Plan;
  /** Con el estado recalculado por el dominio, no el guardado. */
  readonly subscription: Subscription;
  readonly pendingPlan: Plan | null;
  readonly quota: QuotaState;
  readonly receivable: Receivable;
  readonly delinquency: DelinquencyState;
  readonly level: AccessLevel;
  readonly badge: string;
}

export interface MembershipDetail extends MembershipView {
  readonly charges: readonly Charge[];
  readonly attendances: readonly Attendance[];
}

@Injectable()
export class MembershipViewService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly clock: Clock,
  ) {}

  // -------------------------------------------------------------------------
  // Una membresía
  // -------------------------------------------------------------------------

  /**
   * Vista de una membresía dentro de su gimnasio.
   *
   * Recibe la transacción para poder componerse con una escritura: registrar un
   * pago y devolver el estado resultante tiene que ser atómico, o el
   * recepcionista ve un estado que ya cambió.
   */
  /**
   * `includeCanceled` solo lo pide la ficha del mostrador.
   *
   * El check-in NO lo pasa a proposito: ahi una suscripcion cancelada tiene que
   * seguir sin aparecer, y el dominio ya la rechaza con su propio motivo.
   */
  async viewInTx(
    tx: Tx,
    membershipId: string,
    today?: PlainDate,
    options: { readonly includeCanceled?: boolean } = {},
  ): Promise<MembershipView> {
    const [row] = await tx
      .select({
        membership: schema.memberships,
        user: schema.users,
        tenant: schema.tenants,
        subscription: schema.subscriptions,
        plan: schema.plans,
      })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .innerJoin(schema.tenants, eq(schema.tenants.id, schema.memberships.tenantId))
      .innerJoin(
        schema.subscriptions,
        options.includeCanceled === true
          ? eq(schema.subscriptions.membershipId, schema.memberships.id)
          : and(
              eq(schema.subscriptions.membershipId, schema.memberships.id),
              sql`${schema.subscriptions.status} <> 'canceled'`,
            ),
      )
      .innerJoin(schema.plans, eq(schema.plans.id, schema.subscriptions.planId))
      .where(eq(schema.memberships.id, membershipId))
      // Con `includeCanceled` una membresia puede traer VARIAS: la cancelada y
      // la que la reemplazo al reinscribir. Sin orden, Postgres devuelve
      // cualquiera — y devolvia la cancelada, asi que la ficha decia "dado de
      // baja" de alguien que el padron mostraba al dia. La viva manda; la
      // cancelada solo aparece cuando no hay ninguna viva, que es justo el caso
      // en el que hace falta para poder reinscribir.
      .orderBy(
        sql`(${schema.subscriptions.status} = 'canceled') asc`,
        desc(schema.subscriptions.startDate),
      )
      .limit(1);

    if (row === undefined) {
      throw new NotFoundException(`No hay una membresía activa ${membershipId} en este gimnasio.`);
    }

    const tenant = toTenant(row.tenant);
    const day = today ?? this.clock.today(tenant.timezone);
    const week = isoWeekOf(day).key;

    const [{ used }] = (await tx
      .select({ used: sql<number>`count(*)::int` })
      .from(schema.attendance)
      .where(
        and(
          eq(schema.attendance.membershipId, membershipId),
          eq(schema.attendance.isoWeek, week),
        ),
      )) as [{ used: number }];

    const pendingPlan = await this.loadPendingPlan(tx, row.subscription.pendingPlanId);

    return this.assemble({
      membership: toMembership(row.membership),
      user: toUser(row.user),
      tenant,
      plan: toPlan(row.plan),
      subscription: toSubscription(row.subscription),
      pendingPlan,
      used,
      week,
      today: day,
    });
  }

  view(tenantId: string, membershipId: string, today?: PlainDate): Promise<MembershipView> {
    return withTenant(this.db, tenantId, (tx) => this.viewInTx(tx, membershipId, today));
  }

  /** Vista completa, con historial. Alimenta la pantalla de plan y el historial. */
  async detail(
    tenantId: string,
    membershipId: string,
    options: { readonly includeCanceled?: boolean } = {},
  ): Promise<MembershipDetail> {
    return withTenant(this.db, tenantId, async (tx) => {
      const view = await this.viewInTx(tx, membershipId, undefined, options);

      const [chargeRows, attendanceRows] = await Promise.all([
        tx
          .select()
          .from(schema.charges)
          .where(eq(schema.charges.membershipId, membershipId))
          .orderBy(desc(schema.charges.createdAt))
          .limit(100),
        tx
          .select()
          .from(schema.attendance)
          .where(eq(schema.attendance.membershipId, membershipId))
          .orderBy(desc(schema.attendance.checkedInAt))
          .limit(200),
      ]);

      return {
        ...view,
        charges: chargeRows.map(toCharge),
        attendances: attendanceRows.map(toAttendance),
      };
    });
  }

  // -------------------------------------------------------------------------
  // Billetera del alumno
  // -------------------------------------------------------------------------

  /**
   * Todas las membresías de una persona, en todos los gimnasios de la red.
   *
   * Va en dos pasos y es intencional. El primero usa contexto de identidad para
   * listar a qué gimnasios pertenece (la excepción de RLS en `memberships`, ver
   * la migración 0001). El segundo abre una transacción POR gimnasio, porque
   * suscripciones, cargos y asistencia siguen aislados por tenant.
   *
   * Son 1 + N consultas con N = número de gimnasios del alumno, que en la vida
   * real es 1 a 3. Cambiarlo por una consulta única exigiría relajar el
   * aislamiento, y eso no se paga por ahorrar dos viajes.
   */
  async wallet(userId: string): Promise<readonly MembershipView[]> {
    const memberships = await withUser(this.db, userId, (tx) =>
      tx
        .select({ id: schema.memberships.id, tenantId: schema.memberships.tenantId })
        .from(schema.memberships)
        .where(
          and(
            eq(schema.memberships.userId, userId),
            eq(schema.memberships.status, 'active'),
          ),
        ),
    );

    const views = await Promise.all(
      memberships.map(async (row) => {
        try {
          return await this.view(row.tenantId, row.id);
        } catch {
          // Una membresía sin suscripción viva no es un error de la billetera:
          // es alguien que canceló. Se omite en vez de tumbar la pantalla.
          return null;
        }
      }),
    );

    return views.filter((view): view is MembershipView => view !== null);
  }

  /** Verifica que la membresía sea de esta persona y devuelve su gimnasio. */
  async resolveOwnMembership(userId: string, membershipId: string): Promise<string> {
    const [row] = await withUser(this.db, userId, (tx) =>
      tx
        .select({ tenantId: schema.memberships.tenantId })
        .from(schema.memberships)
        .where(
          and(eq(schema.memberships.id, membershipId), eq(schema.memberships.userId, userId)),
        )
        .limit(1),
    );

    if (row === undefined) {
      // Mismo mensaje que si no existiera: decir "existe pero no es tuya"
      // confirma la existencia de una membresía ajena.
      throw new NotFoundException('No encontramos esa membresía.');
    }
    return row.tenantId;
  }

  // -------------------------------------------------------------------------
  // Padrón del gimnasio
  // -------------------------------------------------------------------------

  /**
   * Padrón completo con estado, en dos consultas.
   *
   * Es lo que el dispositivo de staff descarga para validar sin conexión, así
   * que no puede ser un N+1: con 150 alumnos serían 150 viajes por la red del
   * gimnasio, que es justo la que no funciona.
   */
  /**
   * Padron del local.
   *
   * `includeCanceled` existe porque cancelar dejaba a la persona sin salida: la
   * suscripcion se apaga, deja de aparecer aqui, y entonces `resubscribe` es
   * inalcanzable — su `membershipId` no lo devuelve ninguna ruta. La ficha y el
   * historial siguen en la base; lo que faltaba era poder verlos.
   *
   * Por defecto NO vienen: el padron es "quien entrena aqui", y mezclar las
   * bajas en la lista que recepcion mira todo el dia la ensucia.
   */
  async roster(
    tenantId: string,
    today?: PlainDate,
    options: { readonly includeCanceled?: boolean } = {},
  ): Promise<readonly MembershipView[]> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select({
          membership: schema.memberships,
          user: schema.users,
          tenant: schema.tenants,
          subscription: schema.subscriptions,
          plan: schema.plans,
        })
        .from(schema.memberships)
        .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
        .innerJoin(schema.tenants, eq(schema.tenants.id, schema.memberships.tenantId))
        .innerJoin(
          schema.subscriptions,
          options.includeCanceled === true
            ? eq(schema.subscriptions.membershipId, schema.memberships.id)
            : and(
                eq(schema.subscriptions.membershipId, schema.memberships.id),
                sql`${schema.subscriptions.status} <> 'canceled'`,
              ),
        )
        .innerJoin(schema.plans, eq(schema.plans.id, schema.subscriptions.planId))
        .where(eq(schema.memberships.status, 'active'));

      if (rows.length === 0) return [];

      const tenant = toTenant(rows[0]!.tenant);
      const day = today ?? this.clock.today(tenant.timezone);
      const week = isoWeekOf(day).key;

      // Una sola consulta para el consumo de toda la semana del gimnasio.
      const counts = await tx
        .select({
          membershipId: schema.attendance.membershipId,
          used: sql<number>`count(*)::int`,
        })
        .from(schema.attendance)
        .where(eq(schema.attendance.isoWeek, week))
        .groupBy(schema.attendance.membershipId);

      const usedBy = new Map(counts.map((row) => [row.membershipId, row.used]));

      const pendingIds = rows
        .map((row) => row.subscription.pendingPlanId)
        .filter((id): id is string => id !== null);
      const pendingPlans = await this.loadPlans(tx, pendingIds);

      return rows.map((row) =>
        this.assemble({
          membership: toMembership(row.membership),
          user: toUser(row.user),
          tenant: toTenant(row.tenant),
          plan: toPlan(row.plan),
          subscription: toSubscription(row.subscription),
          pendingPlan:
            row.subscription.pendingPlanId === null
              ? null
              : pendingPlans.get(row.subscription.pendingPlanId) ?? null,
          used: usedBy.get(row.membership.id) ?? 0,
          week,
          today: day,
        }),
      );
    });
  }

  // -------------------------------------------------------------------------
  // Ensamblado
  // -------------------------------------------------------------------------

  private assemble(input: {
    membership: Membership;
    user: User;
    tenant: Tenant;
    plan: Plan;
    subscription: Subscription;
    pendingPlan: Plan | null;
    used: number;
    week: string;
    today: PlainDate;
  }): MembershipView {
    const receivable = computeReceivable({
      subscription: input.subscription,
      plan: input.plan,
      policy: input.tenant.billingDatePolicy,
      today: input.today,
    });

    const delinquency = evaluateDelinquency({
      nextBillingDate: input.subscription.nextBillingDate,
      today: input.today,
      graceDays: input.tenant.graceDays,
      periodPaid: !receivable.due,
      canceled: input.subscription.status === 'canceled',
    });

    const quota = quotaFromCount(input.plan, input.used, input.week);
    const { level, badge } = membershipStatus({ delinquency, receivable, quota });

    return {
      membership: input.membership,
      user: input.user,
      tenant: input.tenant,
      plan: input.plan,
      // El estado que sale de la api es el calculado, no el de la columna.
      subscription: { ...input.subscription, status: delinquency.status },
      pendingPlan: input.pendingPlan,
      quota,
      receivable,
      delinquency,
      level,
      badge,
    };
  }

  private async loadPendingPlan(tx: Tx, planId: string | null): Promise<Plan | null> {
    if (planId === null) return null;
    const [row] = await tx
      .select()
      .from(schema.plans)
      .where(eq(schema.plans.id, planId))
      .limit(1);
    return row === undefined ? null : toPlan(row);
  }

  private async loadPlans(tx: Tx, ids: readonly string[]): Promise<Map<string, Plan>> {
    if (ids.length === 0) return new Map();
    const rows = await tx
      .select()
      .from(schema.plans)
      .where(inArray(schema.plans.id, [...new Set(ids)]));
    return new Map(rows.map((row) => [row.id, toPlan(row)]));
  }
}
