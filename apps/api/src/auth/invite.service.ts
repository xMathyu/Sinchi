/**
 * Invitaciones por enlace.
 *
 * El codigo de 6 digitos pide que el alumno lo dicte en el mostrador; la
 * invitacion adelanta esa decision al momento de invitar. El staff elige ficha y
 * plan, manda el enlace por WhatsApp, y quien lo abre entra ya inscrito.
 *
 * Lo que cambia —y conviene tenerlo presente— es **quien autoriza**: pasa a ser
 * la posesion del enlace. El razonamiento completo y las cotas estan en la
 * migracion 0004; aqui solo se implementan.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { InjectDb } from '../db/db.module';
import {
  adoptTenant,
  schema,
  withInviteToken,
  withTenant,
  type Database,
  type Tx,
} from '../db/client';
import { hashDeviceToken, issueDeviceToken } from './secrets';

/** Una semana: suficiente para que alguien lo vea el fin de semana. */
const DEFAULT_TTL_DAYS = 7;

/**
 * Un solo mensaje para caducada, consumida, revocada e inexistente.
 *
 * Distinguirlas le diria a quien prueba enlaces al azar si acerto con uno que
 * existio, y no le sirve de nada a quien tiene un enlace legitimo: en los cuatro
 * casos la salida es la misma, pedirle otro al gimnasio.
 */
const NOT_USABLE = 'Esta invitación ya no es válida. Pídele al gimnasio que te mande otra.';

export interface CreatedInvite {
  readonly token: string;
  readonly expiresAt: string;
  readonly fullName: string;
}

export interface InvitePreview {
  readonly gymName: string;
  readonly fullName: string;
  readonly planName: string;
  readonly priceCents: number;
  readonly enrollmentFeeCents: number;
  readonly expiresAt: string;
}

@Injectable()
export class InviteService {
  constructor(@InjectDb() private readonly db: Database) {}

  /**
   * Crea la invitacion y devuelve el token **una sola vez**.
   *
   * No se guarda en claro, asi que si el staff pierde el enlace la unica salida
   * es revocar e invitar de nuevo. Es la misma decision que con el token de
   * equipo: poder releerlo mas tarde convierte la base de datos en una copia de
   * todos los enlaces vivos.
   */
  async create(input: {
    readonly tenantId: string;
    readonly staffId: string;
    readonly planId: string;
    readonly fullName: string;
    readonly documentId: string;
    readonly phone: string;
    readonly membershipId?: string | null | undefined;
    readonly ttlDays?: number | undefined;
  }): Promise<CreatedInvite> {
    const { token, hash } = issueDeviceToken();
    const ttl = input.ttlDays ?? DEFAULT_TTL_DAYS;
    const expiresAt = new Date(Date.now() + ttl * 24 * 60 * 60 * 1000);

    return withTenant(this.db, input.tenantId, async (tx) => {
      const [plan] = await tx
        .select({ id: schema.plans.id, priceCents: schema.plans.priceCents })
        .from(schema.plans)
        .where(and(eq(schema.plans.id, input.planId), eq(schema.plans.active, true)))
        .limit(1);

      if (plan === undefined) {
        throw new NotFoundException('Ese plan no existe en este gimnasio.');
      }

      // La matricula sale del gimnasio, no del plan: se cobra una vez al entrar
      // y no cambia segun cuantas veces por semana venga la persona.
      const [tenant] = await tx
        .select({ enrollmentFeeCents: schema.tenants.enrollmentFeeCents })
        .from(schema.tenants)
        .where(eq(schema.tenants.id, input.tenantId))
        .limit(1);

      await tx.insert(schema.invites).values({
        tenantId: input.tenantId,
        tokenHash: hash,
        fullName: input.fullName.trim(),
        documentId: input.documentId.trim(),
        phone: input.phone.trim(),
        planId: plan.id,
        priceCents: plan.priceCents,
        enrollmentFeeCents: tenant?.enrollmentFeeCents ?? 0,
        membershipId: input.membershipId ?? null,
        createdBy: input.staffId,
        expiresAt,
      });

      return { token, expiresAt: expiresAt.toISOString(), fullName: input.fullName.trim() };
    });
  }

  /**
   * Lo que la app muestra ANTES de pedir que la persona entre.
   *
   * Se separa del consumo a proposito: quien abre el enlace tiene que poder ver
   * a que gimnasio y a que plan lo estan invitando antes de decidir. Si mirar
   * consumiera la invitacion, abrirla por curiosidad la quemaria.
   */
  async preview(token: string): Promise<InvitePreview> {
    const hash = hashDeviceToken(token);

    // Dos pasos, no un JOIN: el token abre la fila de `invites`, pero `tenants` y
    // `plans` tienen su propio aislamiento por gimnasio y sin contexto no
    // devuelven nada — un JOIN aqui saldria siempre vacio. Primero se pregunta a
    // que gimnasio apunta la invitacion, y solo entonces se adopta.
    return withInviteToken(this.db, hash, async (tx) => {
      const [invite] = await tx
        .select({
          tenantId: schema.invites.tenantId,
          planId: schema.invites.planId,
          fullName: schema.invites.fullName,
          priceCents: schema.invites.priceCents,
          enrollmentFeeCents: schema.invites.enrollmentFeeCents,
          expiresAt: schema.invites.expiresAt,
        })
        .from(schema.invites)
        .where(
          and(
            eq(schema.invites.tokenHash, hash),
            isNull(schema.invites.consumedAt),
            isNull(schema.invites.revokedAt),
          ),
        )
        .limit(1);

      if (invite === undefined || invite.expiresAt.getTime() < Date.now()) {
        throw new NotFoundException(NOT_USABLE);
      }

      await adoptTenant(tx, invite.tenantId);

      const [gym] = await tx
        .select({ name: schema.tenants.name })
        .from(schema.tenants)
        .where(eq(schema.tenants.id, invite.tenantId))
        .limit(1);
      const [plan] = await tx
        .select({ name: schema.plans.name })
        .from(schema.plans)
        .where(eq(schema.plans.id, invite.planId))
        .limit(1);

      return {
        gymName: gym?.name ?? '',
        fullName: invite.fullName,
        planName: plan?.name ?? '',
        priceCents: invite.priceCents,
        enrollmentFeeCents: invite.enrollmentFeeCents,
        expiresAt: invite.expiresAt.toISOString(),
      };
    });
  }

  /**
   * Consume la invitacion y deja a la persona inscrita.
   *
   * Todo en una transaccion: crear la cuenta, la ficha, la suscripcion, los
   * cargos y marcar la invitacion. Si algo falla no puede quedar un usuario sin
   * ficha ni —peor— una invitacion consumida sin nada al otro lado, que dejaria
   * a la persona fuera y sin forma de reintentar.
   */
  async claim(input: {
    readonly token: string;
    readonly firebaseUid: string;
    readonly email: string | null;
  }): Promise<{ readonly userId: string; readonly tenantId: string }> {
    const hash = hashDeviceToken(input.token);

    return withInviteToken(this.db, hash, async (tx) => {
      const [invite] = await tx
        .select()
        .from(schema.invites)
        .where(
          and(
            eq(schema.invites.tokenHash, hash),
            isNull(schema.invites.consumedAt),
            isNull(schema.invites.revokedAt),
          ),
        )
        .limit(1);

      if (invite === undefined || invite.expiresAt.getTime() < Date.now()) {
        throw new NotFoundException(NOT_USABLE);
      }

      // Ya se sabe a que gimnasio pertenece: de aqui en adelante hace falta
      // contexto normal, o los INSERT de abajo fallan su WITH CHECK.
      await adoptTenant(tx, invite.tenantId);

      // Si esta cuenta de Firebase ya existe, se reutiliza: la tesis del producto
      // es una identidad para todos los gimnasios. Lo que no puede es acabar con
      // dos fichas en el MISMO gimnasio — seria la misma persona dos veces, con
      // dos cupos y dos deudas.
      const [already] = await tx
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.firebaseUid, input.firebaseUid))
        .limit(1);

      let userId: string;
      if (already === undefined) {
        const [created] = await tx
          .insert(schema.users)
          .values({
            name: invite.fullName,
            documentId: invite.documentId,
            phone: invite.phone,
            email: input.email,
            firebaseUid: input.firebaseUid,
          })
          .returning({ id: schema.users.id });
        userId = created!.id;
      } else {
        userId = already.id;
        await this.assertNotAlreadyInGym(tx, userId, invite.tenantId);
      }

      if (invite.membershipId === null) {
        const [membership] = await tx
          .insert(schema.memberships)
          .values({ userId, tenantId: invite.tenantId, status: 'active' })
          .returning({ id: schema.memberships.id });
        await this.startSubscription(tx, invite, membership!.id);
      } else {
        // Invitacion a una ficha que ya existia: no se crea suscripcion ni
        // cargos, porque los suyos ya estan. Solo se le ata la cuenta.
        await tx
          .update(schema.memberships)
          .set({ userId })
          .where(eq(schema.memberships.id, invite.membershipId));
      }

      await tx
        .update(schema.invites)
        .set({ consumedAt: new Date(), consumedBy: userId })
        .where(eq(schema.invites.id, invite.id));

      return { userId, tenantId: invite.tenantId };
    });
  }

  /**
   * Las invitaciones vivas del gimnasio.
   *
   * Sin el token, que no se guarda en claro: sirve para saber a quien se invito
   * y decidir cual revocar, no para recuperar un enlace perdido. Si se pierde,
   * se revoca y se manda otro.
   */
  async listPending(tenantId: string): Promise<
    readonly {
      readonly id: string;
      readonly fullName: string;
      readonly phone: string;
      readonly expiresAt: string;
    }[]
  > {
    const rows = await withTenant(this.db, tenantId, (tx) =>
      tx
        .select({
          id: schema.invites.id,
          fullName: schema.invites.fullName,
          phone: schema.invites.phone,
          expiresAt: schema.invites.expiresAt,
        })
        .from(schema.invites)
        .where(and(isNull(schema.invites.consumedAt), isNull(schema.invites.revokedAt))),
    );

    return rows
      .filter((row) => row.expiresAt.getTime() > Date.now())
      .map((row) => ({ ...row, expiresAt: row.expiresAt.toISOString() }));
  }

  /**
   * Revoca una invitacion.
   *
   * Marca en vez de borrar: una invitacion revocada sigue diciendo a quien se
   * invito y quien lo hizo, y esa es justamente la traza que hace falta cuando
   * alguien revoca porque el enlace se filtro.
   */
  async revoke(tenantId: string, inviteId: string): Promise<void> {
    const revoked = await withTenant(this.db, tenantId, (tx) =>
      tx
        .update(schema.invites)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(schema.invites.id, inviteId),
            isNull(schema.invites.consumedAt),
            isNull(schema.invites.revokedAt),
          ),
        )
        .returning({ id: schema.invites.id }),
    );

    // Una ya consumida no se puede "desconsumir": para eso esta desvincular la
    // cuenta, que es otra operacion y con otras consecuencias.
    if (revoked.length === 0) {
      throw new NotFoundException('Esa invitación no existe o ya no está vigente.');
    }
  }

  private async assertNotAlreadyInGym(tx: Tx, userId: string, tenantId: string): Promise<void> {
    const [existing] = await tx
      .select({ id: schema.memberships.id })
      .from(schema.memberships)
      .where(and(eq(schema.memberships.userId, userId), eq(schema.memberships.tenantId, tenantId)))
      .limit(1);

    if (existing !== undefined) {
      throw new BadRequestException('Esta cuenta ya tiene una ficha en este gimnasio.');
    }
  }

  /** Suscripcion, matricula y primer mes. */
  private async startSubscription(
    tx: Tx,
    invite: typeof schema.invites.$inferSelect,
    membershipId: string,
  ): Promise<void> {
    const today = new Date();
    const startDate = today.toISOString().slice(0, 10);
    const nextBilling = new Date(today);
    nextBilling.setMonth(nextBilling.getMonth() + 1);
    // El periodo cubierto termina el dia ANTES del siguiente cobro: si terminara
    // el mismo dia, dos cargos consecutivos se solaparian un dia y la conciliacion
    // contaria esa fecha dos veces. Lo exige `charges_renewal_has_period`.
    const periodEnd = new Date(nextBilling);
    periodEnd.setDate(periodEnd.getDate() - 1);

    const [subscription] = await tx
      .insert(schema.subscriptions)
      .values({
        tenantId: invite.tenantId,
        membershipId,
        planId: invite.planId,
        status: 'active',
        startDate,
        periodStart: startDate,
        nextBillingDate: nextBilling.toISOString().slice(0, 10),
      })
      .returning({ id: schema.subscriptions.id });

    // Ambos quedan **pendientes**: el enlace inscribe, no cobra. Quien cobra es
    // el mostrador, y marcarlos pagados aqui inventaria un ingreso que nadie
    // recibio — justo lo que la version manual de pagos existe para no hacer.
    // `rail: 'cash'` sigue la convencion que ya usa la proration en billing: un
    // cargo pendiente declara el medio esperado, y el mostrador lo corrige al
    // cobrar si la persona termina pagando por Yape.
    const charges: (typeof schema.charges.$inferInsert)[] = [
      {
        tenantId: invite.tenantId,
        subscriptionId: subscription!.id,
        membershipId,
        type: 'renewal',
        amountCents: invite.priceCents,
        status: 'pending',
        rail: 'cash',
        periodStart: startDate,
        periodEnd: periodEnd.toISOString().slice(0, 10),
        recordedBy: null,
      },
    ];
    if (invite.enrollmentFeeCents > 0) {
      charges.push({
        tenantId: invite.tenantId,
        membershipId,
        type: 'enrollment',
        amountCents: invite.enrollmentFeeCents,
        status: 'pending',
        rail: 'cash',
        periodStart: startDate,
        recordedBy: null,
      });
    }
    await tx.insert(schema.charges).values(charges);
  }
}
