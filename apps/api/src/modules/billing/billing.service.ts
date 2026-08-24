/**
 * Cobro.
 *
 * En la versión 1 el único camino por el que entra dinero es un pago manual
 * registrado por el staff en mostrador. No hay cargo automático con tarjeta.
 *
 * Eso NO convierte el pago manual en un caso especial: crea un cargo en el
 * ledger y activa el mismo ciclo que activaría un cobro con tarjeta —extiende la
 * renovación, reactiva la suscripción y libera el check-in (MD 4.5). Cuando
 * entre Culqi, se suma un origen de cargos; el resto de este archivo no cambia.
 */
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { and, eq, gte, sql } from 'drizzle-orm';
import {
  applyPayment,
  cents,
  decidePlanChange,
  type Charge,
  type ChargeType,
  type PaymentRail,
  type PlanChangeDecision,
} from '@sinchi/shared';
import { InjectDb } from '../../db/db.module';
import { schema, withTenant, type Database, type Tx } from '../../db/client';
import { dateToColumn, toCharge, toPlan } from '../../common/mappers';
import { Clock } from '../../common/clock';
import {
  MembershipViewService,
  type MembershipView,
} from '../memberships/membership-view.service';

export interface ManualPaymentInput {
  readonly membershipId: string;
  readonly type: ChargeType;
  readonly rail: PaymentRail;
  /** Periodos que cubre. Solo aplica a `renewal`; por defecto, lo que se debe. */
  readonly periods?: number | undefined;
  /** Monto para matrícula y clase suelta, donde no hay tarifa derivable. */
  readonly amountCents?: number | undefined;
  readonly staffId: string;
  /** Idempotencia de la cola offline del dispositivo de mostrador. */
  readonly clientId?: string | null | undefined;
}

export interface ManualPaymentResult {
  readonly charge: Charge;
  /** Estado resultante, ya recalculado. Es lo que el mostrador tiene que ver. */
  readonly view: MembershipView;
  /** `true` si el cargo ya existía: la cola reintentó. */
  readonly alreadyRecorded: boolean;
}

@Injectable()
export class BillingService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly clock: Clock,
    private readonly views: MembershipViewService,
  ) {}

  // -------------------------------------------------------------------------
  // Pago manual
  // -------------------------------------------------------------------------

  async recordManualPayment(
    tenantId: string,
    input: ManualPaymentInput,
  ): Promise<ManualPaymentResult> {
    if (input.rail === 'card') {
      // La restricción `charges_no_card_rail_yet` lo bloquea igual en la base;
      // aquí se explica por qué en vez de devolver un error de constraint.
      throw new BadRequestException(
        'El cobro con tarjeta todavía no está habilitado. Usa efectivo, Yape o transferencia.',
      );
    }

    return withTenant(this.db, tenantId, async (tx) => {
      const view = await this.views.viewInTx(tx, input.membershipId);
      const periods =
        input.type === 'renewal'
          ? (input.periods ?? Math.max(1, view.receivable.periodsOwed))
          : 1;

      if (input.type === 'renewal' && (!Number.isInteger(periods) || periods < 1)) {
        throw new BadRequestException('Los periodos a cobrar deben ser 1 o más.');
      }

      const amount = this.resolveAmount(input, view, periods);

      const applied =
        input.type === 'renewal'
          ? applyPayment({
              subscription: view.subscription,
              policy: view.tenant.billingDatePolicy,
              periodsPaid: periods,
            })
          : null;

      const [inserted] = await tx
        .insert(schema.charges)
        .values({
          tenantId,
          subscriptionId: view.subscription.id,
          membershipId: view.membership.id,
          type: input.type,
          amountCents: amount,
          status: 'succeeded',
          rail: input.rail,
          attempt: 1,
          // Solo la renovación cubre un periodo. La matrícula y la clase suelta
          // no mueven la fecha de cobro, y por eso van sin periodo.
          periodStart:
            applied === null ? null : dateToColumn(view.subscription.nextBillingDate),
          periodEnd: applied === null ? null : dateToColumn(applied.nextBillingDate),
          recordedBy: input.staffId,
          clientId: input.clientId ?? null,
        })
        // Choca con `charges_renewal_once_per_period` o con `charges_client_id_key`.
        // Las dos colisiones significan lo mismo: este pago ya está registrado.
        .onConflictDoNothing()
        .returning();

      if (inserted === undefined) {
        const existing = await this.findExistingCharge(tx, tenantId, input, view);
        if (existing === null) {
          throw new ConflictException(
            'Ese periodo ya está pagado. Refresca el estado del alumno antes de volver a cobrar.',
          );
        }
        return {
          charge: existing,
          view: await this.views.viewInTx(tx, input.membershipId),
          alreadyRecorded: true,
        };
      }

      if (applied !== null) {
        await tx
          .update(schema.subscriptions)
          .set({
            status: applied.status,
            planId: applied.planId,
            pendingPlanId: applied.pendingPlanId,
            periodStart: dateToColumn(applied.periodStart),
            nextBillingDate: dateToColumn(applied.nextBillingDate),
            canceledAt: null,
          })
          .where(eq(schema.subscriptions.id, view.subscription.id));
      }

      return {
        charge: toCharge(inserted),
        // Se relee dentro de la misma transacción: el mostrador tiene que ver el
        // estado de después del pago, no el de antes.
        view: await this.views.viewInTx(tx, input.membershipId),
        alreadyRecorded: false,
      };
    });
  }

  private resolveAmount(
    input: ManualPaymentInput,
    view: MembershipView,
    periods: number,
  ): number {
    if (input.type === 'renewal') {
      // Aritmética entera de punta a punta: nunca se pasa por soles decimales.
      return cents(view.plan.priceCents * periods);
    }

    if (input.amountCents !== undefined) {
      if (!Number.isInteger(input.amountCents) || input.amountCents < 0) {
        throw new BadRequestException('El monto debe ser un entero de céntimos no negativo.');
      }
      return cents(input.amountCents);
    }

    if (input.type === 'drop_in' && view.tenant.dropInPriceCents !== null) {
      return view.tenant.dropInPriceCents;
    }

    throw new BadRequestException(
      `Falta el monto: el gimnasio no tiene tarifa configurada para "${input.type}".`,
    );
  }

  private async findExistingCharge(
    tx: Tx,
    tenantId: string,
    input: ManualPaymentInput,
    view: MembershipView,
  ): Promise<Charge | null> {
    if (input.clientId != null) {
      const [row] = await tx
        .select()
        .from(schema.charges)
        .where(
          and(eq(schema.charges.tenantId, tenantId), eq(schema.charges.clientId, input.clientId)),
        )
        .limit(1);
      if (row !== undefined) return toCharge(row);
    }

    if (input.type === 'renewal') {
      const [row] = await tx
        .select()
        .from(schema.charges)
        .where(
          and(
            eq(schema.charges.subscriptionId, view.subscription.id),
            eq(schema.charges.type, 'renewal'),
            eq(schema.charges.status, 'succeeded'),
            eq(schema.charges.periodStart, dateToColumn(view.subscription.nextBillingDate)),
          ),
        )
        .limit(1);
      if (row !== undefined) return toCharge(row);
    }

    return null;
  }

  // -------------------------------------------------------------------------
  // Cambio de plan
  // -------------------------------------------------------------------------

  /**
   * Cambio de plan (MD 4.2).
   *
   * Upgrade: se aplica de inmediato y el diferencial prorrateado queda como
   * cargo PENDIENTE para cobrar en mostrador, porque en la versión 1 no hay
   * tarjeta que debitar. Downgrade: no se cobra nada y se guarda como plan
   * pendiente para la próxima renovación, así nunca hay devoluciones.
   */
  async changePlan(
    tenantId: string,
    membershipId: string,
    targetPlanId: string,
  ): Promise<{ readonly decision: PlanChangeDecision; readonly view: MembershipView }> {
    return withTenant(this.db, tenantId, async (tx) => {
      const view = await this.views.viewInTx(tx, membershipId);

      const [targetRow] = await tx
        .select()
        .from(schema.plans)
        .where(eq(schema.plans.id, targetPlanId))
        .limit(1);

      if (targetRow === undefined) {
        throw new BadRequestException('Ese plan no existe en este gimnasio.');
      }

      const today = this.clock.today(view.tenant.timezone);
      let decision: PlanChangeDecision;
      try {
        decision = decidePlanChange({
          subscription: view.subscription,
          currentPlan: view.plan,
          targetPlan: toPlan(targetRow),
          today,
        });
      } catch (error) {
        // El dominio rechaza planes inactivos o de otro gimnasio. Es un error
        // del cliente, no del servidor.
        throw new BadRequestException(
          error instanceof Error ? error.message : 'No se puede cambiar a ese plan.',
        );
      }

      switch (decision.kind) {
        case 'no_change':
          return { decision, view };

        case 'upgrade':
        case 'lateral':
          await tx
            .update(schema.subscriptions)
            .set({ planId: decision.planId, pendingPlanId: null })
            .where(eq(schema.subscriptions.id, view.subscription.id));

          if (decision.kind === 'upgrade' && decision.chargeTodayCents > 0) {
            await tx.insert(schema.charges).values({
              tenantId,
              subscriptionId: view.subscription.id,
              membershipId: view.membership.id,
              type: 'proration',
              amountCents: decision.chargeTodayCents,
              // Pendiente: lo cobra el staff en mostrador.
              status: 'pending',
              rail: 'cash',
              attempt: 1,
              recordedBy: null,
            });
          }
          break;

        case 'downgrade':
          await tx
            .update(schema.subscriptions)
            .set({ pendingPlanId: decision.pendingPlanId })
            .where(eq(schema.subscriptions.id, view.subscription.id));
          break;
      }

      return { decision, view: await this.views.viewInTx(tx, membershipId) };
    });
  }

  /**
   * Cancelación.
   *
   * No hay congelamiento en el MVP (MD 4.7): si un alumno para, se cancela. El
   * historial y el ledger se conservan intactos, así que volver es crear una
   * suscripción nueva y no re-registrar a la persona.
   */
  async cancelSubscription(tenantId: string, membershipId: string): Promise<void> {
    await withTenant(this.db, tenantId, async (tx) => {
      const view = await this.views.viewInTx(tx, membershipId);
      await tx
        .update(schema.subscriptions)
        .set({ status: 'canceled', canceledAt: new Date() })
        .where(eq(schema.subscriptions.id, view.subscription.id));
    });
  }

  // -------------------------------------------------------------------------
  // Reportes del dueño
  // -------------------------------------------------------------------------

  /**
   * Resumen del local. Es el número que el dueño mira para decidir si el
   * sistema le sirve: cuánto cobró y cuánto le deben.
   */
  async summary(tenantId: string): Promise<{
    readonly activeMembers: number;
    readonly delinquentMembers: number;
    readonly collectedThisMonthCents: number;
    readonly outstandingCents: number;
    readonly checkInsToday: number;
  }> {
    const roster = await this.views.roster(tenantId);

    return withTenant(this.db, tenantId, async (tx) => {
      const [collected] = (await tx
        .select({ total: sql<number>`coalesce(sum(amount_cents), 0)::int` })
        .from(schema.charges)
        .where(
          and(
            eq(schema.charges.status, 'succeeded'),
            gte(schema.charges.createdAt, startOfMonthUtc(this.clock.now())),
          ),
        )) as [{ total: number }];

      const [checkIns] = (await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(schema.attendance)
        .where(sql`${schema.attendance.checkedInAt} > now() - interval '18 hours'`)) as [
        { total: number },
      ];

      return {
        activeMembers: roster.length,
        delinquentMembers: roster.filter((entry) => entry.receivable.due).length,
        collectedThisMonthCents: collected.total,
        outstandingCents: roster.reduce((sum, entry) => sum + entry.receivable.amountCents, 0),
        checkInsToday: checkIns.total,
      };
    });
  }
}

function startOfMonthUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
