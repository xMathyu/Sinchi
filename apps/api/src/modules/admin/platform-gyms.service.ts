/**
 * Los gimnasios, mirados desde fuera.
 *
 * Es lo que hasta ahora se hacía por la línea de comandos (`saas:status`,
 * `db:purge`) y con la cadena de Neon a mano. Lo mismo, con un motivo escrito y
 * un rastro de quién lo hizo.
 *
 * UNA DECISIÓN DA FORMA A TODO EL ARCHIVO: esto **no abre ninguna puerta en el
 * aislamiento por tenant**. Las políticas RLS de la migración 0001 no saben que
 * existe un administrador de Sinchi y no se van a enterar: para leer los números
 * de un gimnasio se entra con `withTenant`, con el mismo contexto que usaría su
 * mostrador, una transacción por gimnasio.
 *
 * El precio es real y se paga a ojos abiertos: listar N gimnasios son N
 * transacciones. Con los gimnasios que hay es menos que el arranque en frío de
 * Cloud Run, y la alternativa —un `app.platform_admin` con una excepción en cada
 * política— es agregarle una llave maestra al mecanismo que sostiene que los
 * datos de un dojo no se vean desde otro. El día que esto pese, la salida es una
 * vista materializada que refresque el trabajo diario, no la llave maestra.
 *
 * Lo global (`tenants`, `saas_*`, `users`) no lleva RLS y se lee de una vez.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  SAAS_TIER_LABELS,
  checkGymDeletion,
  checkGymSuspension,
  checkRuc,
  formatPlainDate,
  gymDeletionDenialMessage,
  gymSuspensionDenialMessage,
  saasNotice,
  saasPrice,
  type PaymentRail,
  type SaasStatus,
  type SaasTier,
} from '@sinchi/shared';
import { InjectDb } from '../../db/db.module';
import {
  schema,
  withTenant,
  withoutTenantIsolation,
  type Database,
  type Tx,
} from '../../db/client';
import { SaasService } from '../saas/saas.service';
import { slugify } from '../onboarding/onboarding.service';
import { PlatformAdminService } from './platform-admin.service';

/** Cuánto mira atrás la columna de dinero y de asistencia de la lista. */
const VENTANA_DIAS = 30;

/**
 * Los números de un gimnasio. Salen de UNA consulta con contexto de ese
 * gimnasio: cada subconsulta lleva además su `tenant_id` explícito, que es la
 * primera de las dos capas de aislamiento (la segunda es RLS).
 */
export interface GymStats {
  readonly activeMembers: number;
  readonly staffCount: number;
  /** Fichas con la suscripción suspendida por mora, según el trabajo diario. */
  readonly delinquentMembers: number;
  readonly collectedLast30Cents: number;
  readonly checkInsLast30: number;
  readonly plans: number;
  readonly routines: number;
  readonly bookings: number;
  readonly openConversations: number;
}

export interface GymRow {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly status: 'active' | 'suspended';
  readonly suspendedAt: string | null;
  readonly suspendedReason: string | null;
  readonly address: string | null;
  readonly timezone: string;
  readonly createdAt: string;
  readonly saas: {
    readonly status: SaasStatus;
    readonly tier: SaasTier;
    readonly tierLabel: string;
    readonly priceCents: number;
    readonly freeUntil: string;
    readonly nextBillingDate: string;
    readonly canWrite: boolean;
    readonly listed: boolean;
    readonly notice: string;
  };
  readonly stats: GymStats;
}

export interface GymDetail extends GymRow {
  readonly taxId: string | null;
  readonly graceDays: number;
  readonly dropInPriceCents: number | null;
  readonly enrollmentFeeCents: number;
  readonly trialClassEnabled: boolean;
  readonly trialClassPriceCents: number;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly staff: readonly {
    readonly id: string;
    readonly role: string;
    readonly name: string;
    readonly email: string | null;
    readonly phone: string;
  }[];
  readonly planList: readonly {
    readonly id: string;
    readonly name: string;
    readonly type: string;
    readonly priceCents: number;
    readonly active: boolean;
  }[];
  /** Lo que este gimnasio le ha pagado a Sinchi. */
  readonly saasCharges: readonly {
    readonly amountCents: number;
    readonly rail: string;
    readonly reference: string | null;
    readonly periodStart: string;
    readonly periodEnd: string;
    readonly createdAt: string;
  }[];
  readonly redemptions: readonly {
    readonly code: string;
    readonly freeMonths: number;
    readonly createdAt: string;
  }[];
}

export interface PlatformOverview {
  readonly gyms: {
    readonly total: number;
    readonly active: number;
    readonly suspended: number;
    readonly newLast30: number;
  };
  readonly saas: {
    /** Hasta 10 alumnos: no paga, y por eso no se le puede cortar. */
    readonly free: number;
    readonly trialing: number;
    readonly active: number;
    readonly inGrace: number;
    readonly readOnly: number;
    readonly canceled: number;
    /** Lo que la red facturaría al mes si todos pagaran su escalón hoy. */
    readonly monthlyRunRateCents: number;
    /** Lo que los gimnasios le han pagado a Sinchi en los últimos 30 días. */
    readonly collectedLast30Cents: number;
  };
  readonly people: {
    readonly users: number;
    readonly unlinkedAccounts: number;
    readonly admins: number;
  };
  readonly network: {
    readonly activeMembers: number;
    readonly checkInsLast30: number;
    readonly collectedLast30Cents: number;
  };
}

/** Lo que el panel puede cambiarle a un gimnasio. Todo opcional: es un parche. */
export interface GymPatch {
  readonly name?: string | undefined;
  readonly slug?: string | undefined;
  readonly taxId?: string | null | undefined;
  readonly timezone?: string | undefined;
  readonly graceDays?: number | undefined;
  readonly saasTier?: SaasTier | undefined;
  readonly address?: string | null | undefined;
  readonly dropInPriceCents?: number | null | undefined;
  readonly enrollmentFeeCents?: number | undefined;
  readonly trialClassEnabled?: boolean | undefined;
  readonly trialClassPriceCents?: number | undefined;
}

@Injectable()
export class PlatformGymsService {
  private readonly logger = new Logger(PlatformGymsService.name);

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly saas: SaasService,
    private readonly admins: PlatformAdminService,
  ) {}

  // -------------------------------------------------------------------------
  // Mirar
  // -------------------------------------------------------------------------

  /**
   * La red entera en una pantalla.
   *
   * Los totales de la red (`network`) se suman gimnasio por gimnasio, por lo
   * mismo que todo lo demás en este archivo: sin contexto de tenant, `charges` y
   * `attendance` no devuelven ni una fila. Es la parte que primero se va a notar
   * si esto crece, y es la que primero debería volverse una vista materializada.
   */
  async overview(): Promise<PlatformOverview> {
    const [globals] = await withoutTenantIsolation(this.db, (tx) =>
      tx
        .select({
          gyms: sql<number>`(select count(*) from tenants)::int`,
          active: sql<number>`(select count(*) from tenants where status = 'active')::int`,
          suspended: sql<number>`(select count(*) from tenants where status = 'suspended')::int`,
          newLast30: sql<number>`
            (select count(*) from tenants
              where created_at > now() - interval '30 days')::int`,
          users: sql<number>`(select count(*) from users)::int`,
          unlinked: sql<number>`
            (select count(*) from account_claims where linked_user_id is null)::int`,
          admins: sql<number>`
            (select count(*) from platform_admins where revoked_at is null)::int`,
          saasCollected: sql<number>`
            (select coalesce(sum(amount_cents), 0) from saas_charges
              where status = 'succeeded' and created_at > now() - interval '30 days')::int`,
        })
        .from(sql`(select 1) as one`),
    );

    const gyms = await this.list();

    const saasCounts: Record<SaasStatus, number> = {
      free: 0,
      trialing: 0,
      active: 0,
      in_grace: 0,
      read_only: 0,
      canceled: 0,
    };
    let runRate = 0;
    const network = { activeMembers: 0, checkInsLast30: 0, collectedLast30Cents: 0 };

    for (const gym of gyms) {
      saasCounts[gym.saas.status] += 1;
      // Lo que costaría si pagaran hoy. El escalón gratis aporta cero, que es
      // justo lo que se quiere ver: cuántos locales están sostenidos sin cobrar.
      runRate += gym.saas.priceCents;
      network.activeMembers += gym.stats.activeMembers;
      network.checkInsLast30 += gym.stats.checkInsLast30;
      network.collectedLast30Cents += gym.stats.collectedLast30Cents;
    }

    return {
      gyms: {
        total: globals?.gyms ?? 0,
        active: globals?.active ?? 0,
        suspended: globals?.suspended ?? 0,
        newLast30: globals?.newLast30 ?? 0,
      },
      saas: {
        free: saasCounts.free,
        trialing: saasCounts.trialing,
        active: saasCounts.active,
        inGrace: saasCounts.in_grace,
        readOnly: saasCounts.read_only,
        canceled: saasCounts.canceled,
        monthlyRunRateCents: runRate,
        collectedLast30Cents: globals?.saasCollected ?? 0,
      },
      people: {
        users: globals?.users ?? 0,
        unlinkedAccounts: globals?.unlinked ?? 0,
        admins: globals?.admins ?? 0,
      },
      network,
    };
  }

  /** Todos los gimnasios, los suspendidos incluidos. Ordenados por alta. */
  async list(): Promise<readonly GymRow[]> {
    const tenants = await withoutTenantIsolation(this.db, (tx) =>
      tx.select().from(schema.tenants).orderBy(desc(schema.tenants.createdAt)),
    );

    const rows: GymRow[] = [];
    for (const tenant of tenants) {
      rows.push({
        ...this.toRow(tenant),
        saas: await this.saasOf(tenant.id),
        stats: await this.statsOf(tenant.id),
      });
    }
    return rows;
  }

  async detail(tenantId: string): Promise<GymDetail> {
    const tenant = await this.tenantOrFail(tenantId);

    const [saas, stats, inside, saasCharges, redemptions] = await Promise.all([
      this.saasOf(tenantId),
      this.statsOf(tenantId),
      // Staff y planes SÍ salen de una sola transacción con contexto: las dos
      // tablas llevan RLS y el contexto vale para las dos.
      withTenant(this.db, tenantId, async (tx) => {
        const staff = await tx
          .select({
            id: schema.staff.id,
            role: schema.staff.role,
            name: schema.users.name,
            email: schema.users.email,
            phone: schema.users.phone,
          })
          .from(schema.staff)
          .innerJoin(schema.users, eq(schema.users.id, schema.staff.userId))
          .where(eq(schema.staff.tenantId, tenantId))
          .orderBy(schema.staff.createdAt);

        const planList = await tx
          .select({
            id: schema.plans.id,
            name: schema.plans.name,
            type: schema.plans.type,
            priceCents: schema.plans.priceCents,
            active: schema.plans.active,
          })
          .from(schema.plans)
          .where(eq(schema.plans.tenantId, tenantId))
          .orderBy(schema.plans.priceCents);

        return { staff, planList };
      }),
      withoutTenantIsolation(this.db, (tx) =>
        tx
          .select({
            amountCents: schema.saasCharges.amountCents,
            rail: schema.saasCharges.rail,
            reference: schema.saasCharges.reference,
            periodStart: schema.saasCharges.periodStart,
            periodEnd: schema.saasCharges.periodEnd,
            createdAt: schema.saasCharges.createdAt,
          })
          .from(schema.saasCharges)
          .where(eq(schema.saasCharges.tenantId, tenantId))
          .orderBy(desc(schema.saasCharges.createdAt))
          .limit(12),
      ),
      withoutTenantIsolation(this.db, (tx) =>
        tx
          .select({
            code: schema.saasPromoCodes.code,
            freeMonths: schema.saasRedemptions.freeMonths,
            createdAt: schema.saasRedemptions.createdAt,
          })
          .from(schema.saasRedemptions)
          .innerJoin(
            schema.saasPromoCodes,
            eq(schema.saasPromoCodes.id, schema.saasRedemptions.promoCodeId),
          )
          .where(eq(schema.saasRedemptions.tenantId, tenantId))
          .orderBy(desc(schema.saasRedemptions.createdAt)),
      ),
    ]);

    return {
      ...this.toRow(tenant),
      saas,
      stats,
      taxId: tenant.taxId,
      graceDays: tenant.graceDays,
      dropInPriceCents: tenant.dropInPriceCents,
      enrollmentFeeCents: tenant.enrollmentFeeCents,
      trialClassEnabled: tenant.trialClassEnabled,
      trialClassPriceCents: tenant.trialClassPriceCents,
      latitude: tenant.latitude,
      longitude: tenant.longitude,
      staff: inside.staff,
      planList: inside.planList,
      saasCharges: saasCharges.map((charge) => ({
        ...charge,
        createdAt: charge.createdAt.toISOString(),
      })),
      redemptions: redemptions.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  // -------------------------------------------------------------------------
  // Tocar
  // -------------------------------------------------------------------------

  /**
   * Edita el gimnasio.
   *
   * Es el mismo formulario que el dueño tiene para lo suyo más lo que solo
   * nosotros podemos tocar: el escalón, los días de gracia y el slug. Se guarda
   * el ANTES y el DESPUÉS de cada campo tocado en el registro — «le cambiaron el
   * precio de la clase suelta» sin decir de cuánto a cuánto no sirve de nada
   * cuando el dueño llama preguntando.
   */
  async update(adminId: string, tenantId: string, patch: GymPatch): Promise<GymDetail> {
    const before = await this.tenantOrFail(tenantId);
    const changes: Record<string, { readonly from: unknown; readonly to: unknown }> = {};
    const values: Record<string, unknown> = {};

    const set = <T>(field: string, from: T, to: T | undefined): void => {
      if (to === undefined || to === from) return;
      values[field] = to;
      changes[field] = { from, to };
    };

    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (name.length < 2) throw new BadRequestException('El nombre del gimnasio es muy corto.');
      set('name', before.name, name);
    }

    if (patch.slug !== undefined) {
      /**
       * El slug se normaliza con la MISMA función del alta.
       *
       * Aceptarlo tal cual dejaría entrar un `Dojo Kaizen` con espacios y
       * mayúsculas en una URL pública. Y se avisa si cambió: el slug viejo es el
       * que está pegado en los enlaces que el gimnasio ya repartió.
       */
      const slug = slugify(patch.slug);
      if (slug.length < 3) throw new BadRequestException('El identificador es muy corto.');
      set('slug', before.slug, slug);
    }

    if (patch.taxId !== undefined) {
      const taxId = patch.taxId === null ? null : patch.taxId.trim();
      // El mismo dígito verificador que exige el alta: lo que entre aquí sale
      // después en las boletas.
      if (taxId !== null && taxId.length > 0 && checkRuc(taxId) !== null) {
        throw new BadRequestException('Ese RUC no es válido.');
      }
      set('taxId', before.taxId, taxId === null || taxId.length === 0 ? null : taxId);
    }

    if (patch.graceDays !== undefined) {
      if (!Number.isInteger(patch.graceDays) || patch.graceDays < 0 || patch.graceDays > 60) {
        throw new BadRequestException('Los días de gracia van de 0 a 60.');
      }
      set('graceDays', before.graceDays, patch.graceDays);
    }

    set('timezone', before.timezone, patch.timezone);
    set('saasTier', before.saasTier, patch.saasTier);
    set('address', before.address, patch.address);
    set('dropInPriceCents', before.dropInPriceCents, patch.dropInPriceCents);
    set('enrollmentFeeCents', before.enrollmentFeeCents, patch.enrollmentFeeCents);
    set('trialClassEnabled', before.trialClassEnabled, patch.trialClassEnabled);
    set('trialClassPriceCents', before.trialClassPriceCents, patch.trialClassPriceCents);

    if (Object.keys(values).length === 0) return this.detail(tenantId);

    await withoutTenantIsolation(this.db, async (tx) => {
      try {
        await tx.update(schema.tenants).set(values).where(eq(schema.tenants.id, tenantId));
      } catch (error) {
        // El slug es único en toda la red. El choque es el caso normal —dos
        // dojos con el mismo nombre— y merece una frase, no un 500.
        if (isUniqueViolation(error)) {
          throw new ConflictException('Ya hay un gimnasio con ese identificador.');
        }
        throw error;
      }

      await this.admins.record(tx, {
        adminId,
        action: 'gym.update',
        tenantId,
        subject: before.slug,
        detail: changes,
      });
    });

    this.logger.log(`[${before.slug}] editado desde el panel: ${Object.keys(changes).join(', ')}`);
    return this.detail(tenantId);
  }

  /**
   * Suspende un gimnasio: lo saca de Sinchi.
   *
   * No confundir con el corte por impago. Aquello (`SaasGuard`) deja la puerta
   * abierta a propósito —el alumno que sí pagó sigue marcando— porque es una
   * palanca de cobro. Esto es una expulsión: se usa cuando el local abusa, y
   * corta la sesión de su staff (`AuthService.issueForUser`) y lo saca del
   * directorio.
   *
   * Lo que NO toca son los datos del alumno. Su billetera, su historial y sus
   * pagos siguen donde estaban: no entrena en un gimnasio que expulsamos, pero
   * la culpa de eso no es suya.
   */
  async suspend(adminId: string, tenantId: string, reason: string): Promise<GymDetail> {
    const tenant = await this.tenantOrFail(tenantId);

    const denial = checkGymSuspension({ reason, status: tenant.status });
    if (denial !== null) throw new ForbiddenException(gymSuspensionDenialMessage(denial));

    await withoutTenantIsolation(this.db, async (tx) => {
      await tx
        .update(schema.tenants)
        .set({ status: 'suspended', suspendedAt: new Date(), suspendedReason: reason.trim() })
        .where(eq(schema.tenants.id, tenantId));

      await this.admins.record(tx, {
        adminId,
        action: 'gym.suspend',
        tenantId,
        subject: tenant.slug,
        reason: reason.trim(),
      });
    });

    this.logger.warn(`[${tenant.slug}] SUSPENDIDO desde el panel de Sinchi: ${reason.trim()}`);
    return this.detail(tenantId);
  }

  /** Lo devuelve a la red. La fecha y el motivo se borran: ya no está fuera. */
  async restore(adminId: string, tenantId: string): Promise<GymDetail> {
    const tenant = await this.tenantOrFail(tenantId);
    if (tenant.status !== 'suspended') {
      throw new ConflictException('Ese gimnasio no está suspendido.');
    }

    await withoutTenantIsolation(this.db, async (tx) => {
      await tx
        .update(schema.tenants)
        .set({ status: 'active', suspendedAt: null, suspendedReason: null })
        .where(eq(schema.tenants.id, tenantId));

      await this.admins.record(tx, {
        adminId,
        action: 'gym.restore',
        tenantId,
        subject: tenant.slug,
        // El motivo por el que estuvo fuera se conserva en el registro aunque la
        // columna se limpie: es la mitad de la historia.
        reason: tenant.suspendedReason,
      });
    });

    this.logger.log(`[${tenant.slug}] reactivado desde el panel de Sinchi`);
    return this.detail(tenantId);
  }

  /**
   * Borra el gimnasio. En cascada y sin vuelta.
   *
   * Las dos cerraduras las pone `checkGymDeletion` en `@sinchi/shared`, así que
   * el panel puede apagar el botón por el mismo motivo por el que esto
   * respondería 403: antes hay que suspenderlo, y hay que escribir su
   * identificador.
   *
   * El registro se escribe ANTES del borrado, y en la misma transacción. Al
   * revés no hay a qué apuntar: `platform_actions.tenant_id` no tiene clave
   * foránea justo para poder sobrevivir a esta línea, pero el `subject` con el
   * slug y el inventario tienen que quedar escritos sí o sí.
   */
  async remove(
    adminId: string,
    tenantId: string,
    typedSlug: string,
  ): Promise<{ readonly slug: string; readonly deleted: GymStats }> {
    const tenant = await this.tenantOrFail(tenantId);

    const denial = checkGymDeletion({
      slug: tenant.slug,
      typed: typedSlug,
      status: tenant.status,
    });
    if (denial !== null) throw new ForbiddenException(gymDeletionDenialMessage(denial));

    // El inventario de lo que se lleva por delante, leído ANTES de borrarlo:
    // después ya no hay a quién preguntárselo.
    const stats = await this.statsOf(tenantId);

    await withoutTenantIsolation(this.db, async (tx) => {
      await this.admins.record(tx, {
        adminId,
        action: 'gym.delete',
        tenantId,
        subject: tenant.slug,
        reason: tenant.suspendedReason,
        detail: { name: tenant.name, ...stats },
      });

      // La cascada de `tenants` se lleva fichas, planes, suscripciones, cargos,
      // asistencias, horarios, staff, reservas, rutinas y conversaciones. Las
      // identidades (`users`) no cuelgan de ningún gimnasio y no se tocan: la
      // misma persona puede entrenar en otro.
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    });

    this.logger.warn(`[${tenant.slug}] ELIMINADO desde el panel de Sinchi`);
    return { slug: tenant.slug, deleted: stats };
  }

  /**
   * Registra lo que el gimnasio le pagó a Sinchi.
   *
   * Es exactamente `npm run saas:pay`, y llama al MISMO `SaasService`: si esto
   * duplicara el insert, el día que cambie el ciclo habría dos sitios
   * produciendo cobros sutilmente distintos — y son los cobros de la empresa.
   */
  async recordPayment(
    adminId: string,
    tenantId: string,
    input: {
      readonly rail: PaymentRail;
      readonly reference?: string | null;
      readonly amountCents?: number | undefined;
    },
  ): Promise<{ readonly alreadyRecorded: boolean; readonly amountCents: number }> {
    const tenant = await this.tenantOrFail(tenantId);

    const outcome = await this.saas.recordPayment({
      tenantId,
      rail: input.rail,
      reference: input.reference ?? null,
      amountCents: input.amountCents,
    });

    await withoutTenantIsolation(this.db, (tx) =>
      this.admins.record(tx, {
        adminId,
        action: 'gym.payment',
        tenantId,
        subject: tenant.slug,
        detail: {
          amountCents: outcome.amountCents,
          rail: input.rail,
          // El número de operación es la llave de idempotencia del pago manual:
          // sin él, dos personas mirando el mismo correo del banco le cobran dos
          // meses por un solo depósito. Queda escrito aquí para poder rastrearlo.
          reference: input.reference ?? null,
          periodStart: formatPlainDate(outcome.periodStart),
          periodEnd: formatPlainDate(outcome.periodEnd),
          alreadyRecorded: outcome.alreadyRecorded,
        },
      }),
    );

    return { alreadyRecorded: outcome.alreadyRecorded, amountCents: outcome.amountCents };
  }

  // -------------------------------------------------------------------------
  // Interno
  // -------------------------------------------------------------------------

  private async tenantOrFail(tenantId: string): Promise<typeof schema.tenants.$inferSelect> {
    const [tenant] = await withoutTenantIsolation(this.db, (tx) =>
      tx.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1),
    );
    if (tenant === undefined) throw new NotFoundException('Ese gimnasio no existe.');
    return tenant;
  }

  private toRow(
    tenant: typeof schema.tenants.$inferSelect,
  ): Omit<GymRow, 'saas' | 'stats'> {
    return {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      status: tenant.status,
      suspendedAt: tenant.suspendedAt?.toISOString() ?? null,
      suspendedReason: tenant.suspendedReason,
      address: tenant.address,
      timezone: tenant.timezone,
      createdAt: tenant.createdAt.toISOString(),
    };
  }

  private async saasOf(tenantId: string): Promise<GymRow['saas']> {
    const summary = await this.saas.summaryFor(tenantId);
    const notice = saasNotice(summary.state, summary.priceCents);

    return {
      status: summary.state.status,
      tier: summary.tier,
      tierLabel: SAAS_TIER_LABELS[summary.tier],
      priceCents: saasPrice(summary.tier),
      freeUntil: formatPlainDate(summary.freeUntil),
      nextBillingDate: formatPlainDate(summary.nextBillingDate),
      canWrite: summary.state.canWrite,
      listed: summary.state.listed,
      notice: notice.title,
    };
  }

  /**
   * Los números de un gimnasio, en una consulta con SU contexto.
   *
   * Se entra por `tenants` —que no lleva RLS— y el resto son subconsultas
   * escalares: así es un solo viaje. Cada una repite `tenant_id = ...` aunque el
   * contexto ya lo garantice, que es la primera de las dos capas de aislamiento
   * que pide el CLAUDE.md.
   *
   * La ventana de 30 días no es «este mes» a propósito: el panel del dueño dice
   * «cobrado este mes» contando desde el 1, y dos pantallas que dicen cosas
   * parecidas con números distintos es justo lo que este producto evita. Son
   * preguntas distintas y se llaman distinto.
   */
  private async statsOf(tenantId: string): Promise<GymStats> {
    /**
     * El gimnasio va como PARÁMETRO y no como columna correlacionada, y eso no
     * es estilo: `${schema.tenants.id}` dentro de una plantilla `sql` se
     * renderiza como `"id"` a secas, sin calificar. Dentro de
     * `select count(*) from staff s where s.tenant_id = "id"`, ese `"id"`
     * resuelve a `s.id` — la subconsulta se compara consigo misma, no falla, y
     * devuelve CERO. Salió aquí: el panel listaba gimnasios con cero alumnos y
     * cero staff mientras el detalle, que no usa subconsultas, los enseñaba.
     */
    const [row] = await withTenant(this.db, tenantId, (tx) =>
      tx
        .select({
          activeMembers: sql<number>`
            (select count(*) from memberships m
              where m.tenant_id = ${tenantId} and m.status = 'active')::int`,
          staffCount: sql<number>`
            (select count(*) from staff s where s.tenant_id = ${tenantId})::int`,
          delinquentMembers: sql<number>`
            (select count(*) from subscriptions s
              where s.tenant_id = ${tenantId} and s.status = 'suspended')::int`,
          collectedLast30Cents: sql<number>`
            (select coalesce(sum(c.amount_cents), 0) from charges c
              where c.tenant_id = ${tenantId}
                and c.status = 'succeeded'
                and c.created_at > now() - interval '${sql.raw(String(VENTANA_DIAS))} days')::int`,
          checkInsLast30: sql<number>`
            (select count(*) from attendance a
              where a.tenant_id = ${tenantId}
                and a.checked_in_at > now() - interval '${sql.raw(String(VENTANA_DIAS))} days')::int`,
          plans: sql<number>`
            (select count(*) from plans p where p.tenant_id = ${tenantId})::int`,
          routines: sql<number>`
            (select count(*) from routines r where r.tenant_id = ${tenantId})::int`,
          bookings: sql<number>`
            (select count(*) from class_bookings b where b.tenant_id = ${tenantId})::int`,
          openConversations: sql<number>`
            (select count(*) from conversations v
              where v.tenant_id = ${tenantId} and v.status = 'open')::int`,
        })
        .from(schema.tenants)
        .where(eq(schema.tenants.id, tenantId))
        .limit(1),
    );

    return (
      row ?? {
        activeMembers: 0,
        staffCount: 0,
        delinquentMembers: 0,
        collectedLast30Cents: 0,
        checkInsLast30: 0,
        plans: 0,
        routines: 0,
        bookings: 0,
        openConversations: 0,
      }
    );
  }
}

/** El choque de un índice único de Postgres. Igual que en el alta. */
function isUniqueViolation(error: unknown): boolean {
  const code = (value: unknown): string | undefined =>
    typeof value === 'object' && value !== null ? (value as { code?: string }).code : undefined;
  const cause =
    typeof error === 'object' && error !== null
      ? (error as { cause?: unknown }).cause
      : undefined;
  return code(error) === '23505' || code(cause) === '23505';
}
