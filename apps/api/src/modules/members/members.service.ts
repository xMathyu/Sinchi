/**
 * Alta de alumnos.
 *
 * El punto delicado: la identidad es GLOBAL. Cuando un dojo inscribe a alguien
 * que ya entrena en otro gimnasio de la red, NO se crea una persona nueva: se le
 * agrega una membresía a la que ya existe. Es lo que hace que el alumno vea sus
 * tres gimnasios en una sola app (MD 5).
 *
 * Por eso `users` se busca por celular antes de insertar. El celular es único en
 * todo el sistema y es la llave con la que la persona se reconoce.
 */
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { and, eq, or, sql } from 'drizzle-orm';
import { firstPeriod, parsePlainDate } from '@sinchi/shared';
import { InjectDb } from '../../db/db.module';
import { schema, withTenant, withoutTenantIsolation, type Database } from '../../db/client';
import { dateToColumn, toPlan, toTenant } from '../../common/mappers';
import { Clock } from '../../common/clock';
import {
  MembershipViewService,
  type MembershipView,
} from '../memberships/membership-view.service';

export interface EnrollMemberInput {
  readonly name: string;
  readonly documentId: string;
  readonly phone: string;
  readonly email?: string | null | undefined;
  readonly planId: string;
  /** `YYYY-MM-DD`. Por defecto, hoy en la zona del gimnasio. */
  readonly startDate?: string | undefined;
  readonly internalAlias?: string | null | undefined;
}

export interface EnrollResult {
  readonly view: MembershipView;
  /** `true` si la persona ya existía en la red y solo se le sumó este gimnasio. */
  readonly reusedIdentity: boolean;
}

@Injectable()
export class MembersService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly clock: Clock,
    private readonly views: MembershipViewService,
  ) {}

  async enroll(tenantId: string, input: EnrollMemberInput): Promise<EnrollResult> {
    const phone = input.phone.trim();
    const documentId = input.documentId.trim();

    // La identidad se resuelve FUERA del contexto del tenant: es global.
    const { userId, reused } = await withoutTenantIsolation(this.db, async (tx) => {
      const [existing] = await tx
        .select({ id: schema.users.id, phone: schema.users.phone, doc: schema.users.documentId })
        .from(schema.users)
        .where(or(eq(schema.users.phone, phone), eq(schema.users.documentId, documentId)))
        .limit(1);

      if (existing !== undefined) {
        if (existing.phone !== phone || existing.doc !== documentId) {
          // Coincide uno de los dos pero no el otro: o hay un tipeo, o son dos
          // personas distintas. Adivinar aquí es cómo se fusionan dos alumnos
          // por error, y separarlos después es una migración a mano.
          throw new ConflictException(
            'Ya existe alguien con ese celular o ese documento, pero los datos no coinciden. ' +
              'Revisa si es la misma persona antes de inscribirla.',
          );
        }
        return { userId: existing.id, reused: true };
      }

      const [created] = await tx
        .insert(schema.users)
        .values({
          name: input.name.trim(),
          documentId,
          phone,
          email: input.email?.trim() ?? null,
        })
        .returning({ id: schema.users.id });

      return { userId: created!.id, reused: false };
    });

    const view = await withTenant(this.db, tenantId, async (tx) => {
      const [tenantRow] = await tx
        .select()
        .from(schema.tenants)
        .where(eq(schema.tenants.id, tenantId))
        .limit(1);
      if (tenantRow === undefined) throw new BadRequestException('Gimnasio no encontrado.');
      const tenant = toTenant(tenantRow);

      const [planRow] = await tx
        .select()
        .from(schema.plans)
        .where(eq(schema.plans.id, input.planId))
        .limit(1);
      if (planRow === undefined) throw new BadRequestException('Ese plan no existe en este gimnasio.');
      const plan = toPlan(planRow);
      if (!plan.active) throw new BadRequestException(`El plan "${plan.name}" no está activo.`);

      const start =
        input.startDate === undefined
          ? this.clock.today(tenant.timezone)
          : parsePlainDate(input.startDate);

      const { period } = firstPeriod(start, tenant.billingDatePolicy);

      const [membership] = await tx
        .insert(schema.memberships)
        .values({
          userId,
          tenantId,
          internalAlias: input.internalAlias ?? null,
          status: 'active',
        })
        .onConflictDoNothing()
        .returning({ id: schema.memberships.id });

      if (membership === undefined) {
        // El índice único la rechazó: ya está en el padrón. Devolver solo "ya
        // existe" es un callejón sin salida — es justo lo que pasa cuando
        // alguien canceló y vuelve, que es el caso normal, no el raro. Se manda
        // el `membershipId` para que el mostrador pueda abrir su ficha y
        // reinscribirla, que es lo que hay que hacer.
        const [existente] = await tx
          .select({ id: schema.memberships.id })
          .from(schema.memberships)
          .where(
            and(
              eq(schema.memberships.userId, userId),
              eq(schema.memberships.tenantId, tenantId),
            ),
          )
          .limit(1);

        throw new ConflictException({
          message:
            'Esa persona ya está en el padrón de este gimnasio. Si canceló, se reinscribe desde su ficha: dar de alta otra vez le partiría el historial en dos.',
          membershipId: existente?.id ?? null,
        });
      }

      await tx.insert(schema.subscriptions).values({
        tenantId,
        membershipId: membership.id,
        planId: plan.id,
        pendingPlanId: null,
        // Arranca al día pero con el primer periodo por cobrar: la mensualidad
        // se paga por adelantado, y recepción la registra en el mismo mostrador
        // donde acaba de inscribirlo.
        status: 'active',
        startDate: dateToColumn(start),
        periodStart: dateToColumn(period.start),
        nextBillingDate: dateToColumn(period.start),
      });

      return this.views.viewInTx(tx, membership.id);
    });

    return { view, reusedIdentity: reused };
  }

  /** Planes activos del gimnasio. Los necesita el alta y el cambio de plan. */
  async plans(tenantId: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(schema.plans)
        .where(eq(schema.plans.active, true))
        .orderBy(schema.plans.priceCents);
      return rows.map(toPlan);
    });
  }

  /**
   * Reactiva una membresía cancelada creando una suscripción nueva.
   *
   * No hay congelamiento en el MVP (MD 4.7): pausar es cancelar y volver. La
   * retención depende de que volver sea trivial, y esto es ese "trivial": no se
   * re-registra a la persona ni se pierde su historial.
   */
  async resubscribe(
    tenantId: string,
    membershipId: string,
    planId: string,
  ): Promise<MembershipView> {
    return withTenant(this.db, tenantId, async (tx) => {
      const [tenantRow] = await tx
        .select()
        .from(schema.tenants)
        .where(eq(schema.tenants.id, tenantId))
        .limit(1);
      if (tenantRow === undefined) throw new BadRequestException('Gimnasio no encontrado.');
      const tenant = toTenant(tenantRow);

      const [planRow] = await tx
        .select()
        .from(schema.plans)
        .where(eq(schema.plans.id, planId))
        .limit(1);
      if (planRow === undefined) throw new BadRequestException('Ese plan no existe en este gimnasio.');

      // Una suscripcion viva ya existente hacia estallar el indice parcial
      // `subscriptions_one_live_per_membership` y salia como 500. No es un fallo
      // del servidor: es que a esa persona no hay que reinscribirla, ya esta
      // dentro. Un doble toque en el mostrador basta para llegar aqui.
      const [viva] = await tx
        .select({ id: schema.subscriptions.id })
        .from(schema.subscriptions)
        .where(
          and(
            eq(schema.subscriptions.membershipId, membershipId),
            sql`${schema.subscriptions.status} <> 'canceled'`,
          ),
        )
        .limit(1);

      if (viva !== undefined) {
        throw new ConflictException(
          'Esa persona ya tiene una suscripción activa. No hace falta reinscribirla.',
        );
      }

      const today = this.clock.today(tenant.timezone);

      await tx.insert(schema.subscriptions).values({
        tenantId,
        membershipId,
        planId,
        status: 'active',
        startDate: dateToColumn(today),
        periodStart: dateToColumn(today),
        nextBillingDate: dateToColumn(today),
      });

      await tx
        .update(schema.memberships)
        .set({ status: 'active' })
        .where(eq(schema.memberships.id, membershipId));

      return this.views.viewInTx(tx, membershipId);
    });
  }
}
