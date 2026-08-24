/**
 * Refresco diario del estado de morosidad.
 *
 * La columna `subscriptions.status` es un CACHÉ. La verdad la calcula
 * `evaluateDelinquency` cada vez que se lee una membresía, así que un caché
 * desactualizado no deja entrar a un moroso ni bloquea a quien está al día: el
 * check-in no lo consulta.
 *
 * Existe para lo que el cálculo en vivo no puede hacer:
 *  - que el panel web pueda listar y ordenar morosos en SQL sin traer el padrón
 *    completo a memoria;
 *  - tener un momento definido en el día para notificar al alumno que entró en
 *    gracia o que se le suspendió el acceso (MD 4.4: "notificación al alumno en
 *    cada fallo y al suspender").
 *
 * Va gimnasio por gimnasio, no con un UPDATE global, por dos razones: las
 * políticas RLS exigen contexto de tenant, y cada gimnasio tiene su propia zona
 * horaria y sus propios días de gracia.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { eq, ne } from 'drizzle-orm';
import { evaluateDelinquency, computeReceivable, type SubscriptionStatus } from '@sinchi/shared';
import { InjectDb } from '../db/db.module';
import { loadEnv } from '../config/env';
import { schema, withTenant, withoutTenantIsolation, type Database } from '../db/client';
import { toPlan, toSubscription, toTenant } from '../common/mappers';
import { Clock } from '../common/clock';

export interface RefreshReport {
  readonly tenants: number;
  readonly reviewed: number;
  readonly changed: number;
  readonly enteredGrace: number;
  readonly suspended: number;
  readonly reactivated: number;
}

@Injectable()
export class RefreshDelinquencyJob {
  private readonly logger = new Logger(RefreshDelinquencyJob.name);

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly clock: Clock,
  ) {}

  /**
   * 06:00 en Lima = 11:00 UTC.
   *
   * A esa hora ningún gimnasio está abierto todavía, así que nadie ve un estado
   * a medio actualizar en la puerta, y las notificaciones llegan a una hora en
   * la que un aviso de cobro no molesta.
   */
  @Cron('0 11 * * *', { name: 'refresh-delinquency' })
  async runScheduled(): Promise<void> {
    // Con `external`, quien dispara es Cloud Scheduler contra `/v1/jobs/...`.
    // El decorador se registra igual —no se puede condicionar— asi que la
    // comprobacion va aqui.
    if (loadEnv().SCHEDULER_MODE === 'external') return;

    const report = await this.run();
    this.logger.log(
      `Morosidad refrescada: ${report.reviewed} suscripciones en ${report.tenants} gimnasios, ` +
        `${report.changed} cambios (${report.enteredGrace} en gracia, ${report.suspended} suspendidas, ` +
        `${report.reactivated} reactivadas).`,
    );
  }

  async run(): Promise<RefreshReport> {
    const tenants = await withoutTenantIsolation(this.db, (tx) =>
      tx.select().from(schema.tenants).where(eq(schema.tenants.status, 'active')),
    );

    const report = {
      tenants: tenants.length,
      reviewed: 0,
      changed: 0,
      enteredGrace: 0,
      suspended: 0,
      reactivated: 0,
    };

    for (const tenantRow of tenants) {
      const tenant = toTenant(tenantRow);
      const today = this.clock.today(tenant.timezone);

      try {
        const rows = await withTenant(this.db, tenant.id, (tx) =>
          tx
            .select({ subscription: schema.subscriptions, plan: schema.plans })
            .from(schema.subscriptions)
            .innerJoin(schema.plans, eq(schema.plans.id, schema.subscriptions.planId))
            .where(ne(schema.subscriptions.status, 'canceled')),
        );

        for (const row of rows) {
          report.reviewed += 1;
          const subscription = toSubscription(row.subscription);
          const plan = toPlan(row.plan);

          const receivable = computeReceivable({
            subscription,
            plan,
            policy: tenant.billingDatePolicy,
            today,
          });

          const next = evaluateDelinquency({
            nextBillingDate: subscription.nextBillingDate,
            today,
            graceDays: tenant.graceDays,
            periodPaid: !receivable.due,
          }).status;

          if (next === subscription.status) continue;

          await withTenant(this.db, tenant.id, (tx) =>
            tx
              .update(schema.subscriptions)
              .set({ status: next })
              .where(eq(schema.subscriptions.id, subscription.id)),
          );

          report.changed += 1;
          this.countTransition(report, subscription.status, next);

          // PENDIENTE: aquí va el envío de la notificación al alumno. No se
          // implementa a medias porque el canal (SMS, push, WhatsApp) no está
          // decidido, y un `console.log` disfrazado de notificación es peor que
          // no tenerla: parece que el alumno fue avisado y no lo fue.
          this.logger.debug(
            `[${tenant.slug}] suscripción ${subscription.id}: ${subscription.status} → ${next}`,
          );
        }
      } catch (error) {
        // Un gimnasio con datos raros no puede dejar sin refrescar a los demás.
        this.logger.error(
          `No se pudo refrescar ${tenant.slug}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }

    return report;
  }

  private countTransition(
    report: { enteredGrace: number; suspended: number; reactivated: number },
    from: SubscriptionStatus,
    to: SubscriptionStatus,
  ): void {
    if (to === 'in_grace') report.enteredGrace += 1;
    else if (to === 'suspended') report.suspended += 1;
    else if (to === 'active' && from !== 'active') report.reactivated += 1;
  }
}
