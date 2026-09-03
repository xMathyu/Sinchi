/**
 * La suscripcion del gimnasio a Sinchi.
 *
 * Todo gimnasio entra con un mes gratis contado desde su alta. Al vencer se
 * cobra por adelantado con la tarifa de su escalon y, si no paga, la cuenta cae
 * a SOLO LECTURA: la puerta sigue marcando y los datos siguen visibles, pero no
 * se dan de alta alumnos ni se registran pagos. Quien decide eso es
 * `evaluateSaas` en `packages/shared`; aqui solo se lee y se escribe.
 *
 * En la version 1 el gimnasio paga por transferencia y alguien lo registra a
 * mano (`npm run saas:pay`), igual que sus alumnos pagan en mostrador. Cuando
 * entre Culqi se suma un origen de cargos y el resto de este archivo no cambia.
 *
 * LEER NUNCA ESCRIBE. Un gimnasio sin fila en `saas_subscriptions` —recien
 * sembrado, o dado de alta antes de que esto existiera— no esta en un estado
 * invalido: esta en su mes gratis, contado desde `tenants.created_at`. Se
 * calcula sin insertar nada, y quien materializa la fila es el job diario. La
 * primera version insertaba en la lectura y el directorio publico se vaciaba
 * hasta que alguien abriera la app: `listedTenantIds` solo veia gimnasios con
 * fila, y ninguno la tenia.
 */
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, count, eq, sql } from 'drizzle-orm';
import {
  advanceBillingDate,
  cents,
  evaluateSaas,
  formatPlainDate,
  freeUntilFrom,
  parsePlainDate,
  plainDateInZone,
  saasNotice,
  saasPrice,
  tierForMembers,
  SAAS_GRACE_DAYS,
  type Cents,
  type PaymentRail,
  type PlainDate,
  type SaasNotice,
  type SaasState,
  type SaasStatus,
  type SaasTier,
} from '@sinchi/shared';
import { InjectDb } from '../../db/db.module';
import { dateToColumn } from '../../common/mappers';
import { Clock } from '../../common/clock';
import {
  schema,
  withTenant,
  withoutTenantIsolation,
  type Database,
  type Tx,
} from '../../db/client';

/** Un mes de suscripcion. La misma politica que el aniversario del alumno. */
const MENSUAL = { mode: 'anniversary' } as const;

type SaasSubscriptionRow = typeof schema.saasSubscriptions.$inferSelect;

/** La fila, o la que le tocaria a un gimnasio que todavia no la tiene. */
interface SaasPlan {
  readonly tenantId: string;
  readonly tier: SaasTier;
  readonly status: SaasStatus;
  readonly freeUntil: PlainDate;
  readonly nextBillingDate: PlainDate;
  readonly graceDays: number;
  readonly canceled: boolean;
  /** `false` si todavia no hay fila en la base. */
  readonly persisted: boolean;
}

interface LoadedSaas {
  readonly plan: SaasPlan;
  readonly slug: string;
  readonly state: SaasState;
}

export interface SaasSummary {
  readonly state: SaasState;
  readonly tier: SaasTier;
  readonly priceCents: Cents;
  readonly freeUntil: PlainDate;
  readonly nextBillingDate: PlainDate;
  readonly notice: SaasNotice;
}

export interface RecordSaasPaymentInput {
  readonly tenantId: string;
  readonly rail: PaymentRail;
  /** Numero de operacion de la transferencia. Es la llave de idempotencia. */
  readonly reference?: string | null;
  /** Solo para un precio pactado distinto de la tarifa. */
  readonly amountCents?: number | undefined;
}

export interface RecordSaasPaymentResult {
  readonly periodStart: PlainDate;
  readonly periodEnd: PlainDate;
  readonly amountCents: Cents;
  readonly tier: SaasTier;
  /** `true` si ese deposito ya estaba registrado: alguien lo anoto dos veces. */
  readonly alreadyRecorded: boolean;
}

export interface SaasRefreshReport {
  readonly reviewed: number;
  readonly started: number;
  readonly changed: number;
  readonly enteredGrace: number;
  readonly readOnly: number;
  readonly reactivated: number;
}

@Injectable()
export class SaasService {
  private readonly logger = new Logger(SaasService.name);

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly clock: Clock,
  ) {}

  /**
   * Estado de la cuenta, sin contar el padron.
   *
   * Es lo que consulta el guard en CADA escritura del mostrador, asi que hace
   * una sola consulta y no toca `memberships`: el escalon solo cambia el precio
   * que se muestra, y contar alumnos en cada alta seria pagar un viaje a la base
   * por un numero que nadie mira en ese momento.
   */
  async stateFor(tenantId: string): Promise<SaasState> {
    return (await this.load(tenantId)).state;
  }

  /** Lo que ve el dueno: estado, escalon derivado del padron y precio. */
  async summaryFor(tenantId: string): Promise<SaasSummary> {
    const { plan, state } = await this.load(tenantId);
    const tier = await this.tierFor(tenantId);
    const price = saasPrice(tier);

    return {
      state,
      tier,
      priceCents: price,
      freeUntil: plan.freeUntil,
      nextBillingDate: plan.nextBillingDate,
      notice: saasNotice(state, price),
    };
  }

  /**
   * Registra lo que el gimnasio pago y adelanta su fecha de cobro.
   *
   * Idempotente por el numero de operacion, no por el periodo: registrar un pago
   * ADELANTA la fecha, asi que anotar dos veces la misma transferencia no
   * chocaria por periodo — le cobraria dos meses por un solo deposito. Lo para
   * `saas_charges_reference_once`.
   */
  async recordPayment(input: RecordSaasPaymentInput): Promise<RecordSaasPaymentResult> {
    const tier = await this.tierFor(input.tenantId);
    const amount = cents(input.amountCents ?? saasPrice(tier));

    return withoutTenantIsolation(this.db, async (tx) => {
      // Cobrar SI materializa la fila: a partir de aqui hay un ciclo que llevar.
      const row = await this.start(tx, input.tenantId);
      const periodStart = parsePlainDate(row.nextBillingDate);
      const periodEnd = advanceBillingDate(periodStart, MENSUAL);

      const inserted = await tx
        .insert(schema.saasCharges)
        .values({
          tenantId: input.tenantId,
          amountCents: amount,
          tier,
          rail: input.rail,
          status: 'succeeded',
          periodStart: dateToColumn(periodStart),
          periodEnd: dateToColumn(periodEnd),
          reference: input.reference ?? null,
        })
        .onConflictDoNothing()
        .returning({ id: schema.saasCharges.id });

      if (inserted.length === 0) {
        return { periodStart, periodEnd, amountCents: amount, tier, alreadyRecorded: true };
      }

      await tx
        .update(schema.saasSubscriptions)
        .set({
          periodStart: dateToColumn(periodStart),
          nextBillingDate: dateToColumn(periodEnd),
          status: 'active',
          tier,
        })
        .where(eq(schema.saasSubscriptions.tenantId, input.tenantId));

      return { periodStart, periodEnd, amountCents: amount, tier, alreadyRecorded: false };
    });
  }

  /**
   * Refresco diario del cache de estado.
   *
   * Como el de morosidad del alumno: la columna no manda —`evaluateSaas` lo
   * recalcula en cada lectura— pero tener un momento definido del dia en que el
   * corte ocurre es lo que permite avisar al dueno antes de que se entere
   * chocando contra un alta bloqueada.
   *
   * Es tambien quien materializa la fila de los gimnasios que todavia no la
   * tienen. Ese es el sitio: un trabajo que corre una vez al dia, no una lectura
   * de la puerta.
   */
  async refreshAll(): Promise<SaasRefreshReport> {
    const started = await this.startMissing();
    const report = { reviewed: 0, started, changed: 0, enteredGrace: 0, readOnly: 0, reactivated: 0 };

    for (const { plan, state, slug } of await this.loadAll()) {
      report.reviewed += 1;
      if (!plan.persisted || state.status === plan.status) continue;

      await withoutTenantIsolation(this.db, (tx) =>
        tx
          .update(schema.saasSubscriptions)
          .set({ status: state.status })
          .where(eq(schema.saasSubscriptions.tenantId, plan.tenantId)),
      );

      report.changed += 1;
      if (state.status === 'in_grace') report.enteredGrace += 1;
      else if (state.status === 'read_only') report.readOnly += 1;
      else if (state.status === 'active' && plan.status !== 'active') report.reactivated += 1;

      this.logger.log(`[${slug}] suscripción a Sinchi: ${plan.status} → ${state.status}`);
    }

    return report;
  }

  /**
   * Los gimnasios que salen en el directorio: los que pueden recibir interesados.
   *
   * Un local que no paga deja de recibir gente que le llega POR Sinchi. Es la
   * parte del corte que le cuesta algo al dueño sin costarle nada al alumno que
   * ya entrena ahí.
   */
  async listedTenantIds(): Promise<ReadonlySet<string>> {
    const listed = new Set<string>();
    for (const { plan, state } of await this.loadAll()) {
      if (state.listed) listed.add(plan.tenantId);
    }
    return listed;
  }

  // -------------------------------------------------------------------------
  // Interno
  // -------------------------------------------------------------------------

  /**
   * Suscripcion + zona horaria + si el periodo que vence ya se pago, en UNA
   * consulta y sin escribir.
   *
   * Sale de `tenants` y no de `saas_subscriptions` a proposito: un gimnasio sin
   * fila tiene que aparecer igual, en su mes gratis, o desaparece del directorio
   * publico hasta que alguien lo toque.
   *
   * El `leftJoin` de cargos no multiplica filas: `saas_charges_once_per_period`
   * garantiza como mucho un cargo exitoso por (gimnasio, periodo).
   */
  private selectPlans(tx: Tx) {
    return tx
      .select({
        tenantId: schema.tenants.id,
        slug: schema.tenants.slug,
        timezone: schema.tenants.timezone,
        createdAt: schema.tenants.createdAt,
        subscription: schema.saasSubscriptions,
        paidChargeId: schema.saasCharges.id,
      })
      .from(schema.tenants)
      .leftJoin(
        schema.saasSubscriptions,
        eq(schema.saasSubscriptions.tenantId, schema.tenants.id),
      )
      .leftJoin(
        schema.saasCharges,
        and(
          eq(schema.saasCharges.tenantId, schema.saasSubscriptions.tenantId),
          /**
           * Se compara con `next_billing_date` y no con `period_start`: lo que
           * decide si hay corte es el periodo que EMPIEZA, no el que se esta
           * consumiendo. Asi, un gimnasio que paga por adelantado durante su mes
           * gratis no entra en gracia el dia que el regalo termina.
           */
          eq(schema.saasCharges.periodStart, schema.saasSubscriptions.nextBillingDate),
          eq(schema.saasCharges.status, 'succeeded'),
        ),
      );
  }

  private async load(tenantId: string): Promise<LoadedSaas> {
    const [row] = await withoutTenantIsolation(this.db, (tx) =>
      this.selectPlans(tx).where(eq(schema.tenants.id, tenantId)).limit(1),
    );
    if (row === undefined) throw new NotFoundException('No existe el gimnasio.');
    return this.toLoaded(row);
  }

  private async loadAll(): Promise<readonly LoadedSaas[]> {
    const rows = await withoutTenantIsolation(this.db, (tx) => this.selectPlans(tx));
    return rows.map((row) => this.toLoaded(row));
  }

  private toLoaded(row: {
    tenantId: string;
    slug: string;
    timezone: string;
    createdAt: Date;
    subscription: SaasSubscriptionRow | null;
    paidChargeId: string | null;
  }): LoadedSaas {
    const today = this.clock.today(row.timezone);
    const plan = this.toPlan(row);

    return {
      plan,
      slug: row.slug,
      state: evaluateSaas({
        freeUntil: plan.freeUntil,
        nextBillingDate: plan.nextBillingDate,
        today,
        graceDays: plan.graceDays,
        periodPaid: row.paidChargeId !== null,
        canceled: plan.canceled,
      }),
    };
  }

  /** La fila, o el mes gratis que le toca a quien todavia no la tiene. */
  private toPlan(row: {
    tenantId: string;
    timezone: string;
    createdAt: Date;
    subscription: SaasSubscriptionRow | null;
  }): SaasPlan {
    if (row.subscription !== null) {
      return {
        tenantId: row.tenantId,
        tier: row.subscription.tier,
        status: row.subscription.status,
        freeUntil: parsePlainDate(row.subscription.freeUntil),
        nextBillingDate: parsePlainDate(row.subscription.nextBillingDate),
        graceDays: row.subscription.graceDays,
        canceled: row.subscription.canceledAt !== null,
        persisted: true,
      };
    }

    const alta = plainDateInZone(row.createdAt, row.timezone);
    const freeUntil = freeUntilFrom(alta);

    return {
      tenantId: row.tenantId,
      tier: 'up_to_60',
      status: 'trialing',
      freeUntil,
      nextBillingDate: freeUntil,
      graceDays: SAAS_GRACE_DAYS,
      canceled: false,
      persisted: false,
    };
  }

  /**
   * Materializa la fila de un gimnasio concreto. Solo desde caminos que escriben.
   */
  private async start(tx: Tx, tenantId: string): Promise<SaasSubscriptionRow> {
    const [tenant] = await tx
      .select({ createdAt: schema.tenants.createdAt, timezone: schema.tenants.timezone })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, tenantId))
      .limit(1);

    if (tenant === undefined) throw new NotFoundException('No existe el gimnasio.');

    const alta = plainDateInZone(tenant.createdAt, tenant.timezone);
    const freeUntil = freeUntilFrom(alta);

    await tx
      .insert(schema.saasSubscriptions)
      .values({
        tenantId,
        freeUntil: formatPlainDate(freeUntil),
        periodStart: formatPlainDate(alta),
        nextBillingDate: formatPlainDate(freeUntil),
      })
      .onConflictDoNothing();

    const [row] = await tx
      .select()
      .from(schema.saasSubscriptions)
      .where(eq(schema.saasSubscriptions.tenantId, tenantId))
      .limit(1);
    return row!;
  }

  /**
   * Le arranca el mes gratis a todo gimnasio que no lo tenga.
   *
   * En SQL y de una vez, no gimnasio por gimnasio: es el mismo INSERT del
   * backfill de la migracion 0009. La fecha se calcula en la zona del local, que
   * es donde su dia empieza.
   */
  private async startMissing(): Promise<number> {
    return withoutTenantIsolation(this.db, async (tx) => {
      // El mismo INSERT del backfill de la migracion 0009. Va en SQL crudo y no
      // por el constructor de consultas porque este `insert ... select` lleva
      // expresiones, y ahi el constructor exige alias que no aportan nada.
      const { rowCount } = await tx.execute(sql`
        insert into saas_subscriptions (tenant_id, free_until, period_start, next_billing_date)
        select t.id,
               ((t.created_at at time zone t.timezone)::date + interval '1 month')::date,
               (t.created_at at time zone t.timezone)::date,
               ((t.created_at at time zone t.timezone)::date + interval '1 month')::date
          from tenants t
          left join saas_subscriptions s on s.tenant_id = t.id
         where s.tenant_id is null
        on conflict (tenant_id) do nothing
      `);
      return rowCount ?? 0;
    });
  }

  /**
   * Escalon derivado del padron, no de `tenants.saas_tier`.
   *
   * Esa columna se fija a mano al dar de alta y nadie vuelve a tocarla: un dojo
   * que crecio de 40 a 200 alumnos seguiria pagando el escalon mas barato para
   * siempre.
   */
  private async tierFor(tenantId: string): Promise<SaasTier> {
    const [row] = await withTenant(this.db, tenantId, (tx) =>
      tx
        .select({ total: count() })
        .from(schema.memberships)
        .where(eq(schema.memberships.status, 'active')),
    );
    return tierForMembers(row?.total ?? 0);
  }
}
