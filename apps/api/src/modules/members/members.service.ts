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
 *
 * Es también donde termina una inscripción reservada desde el directorio: la
 * reserva trae nombre, celular y plan, y recepción pone el documento. La
 * membresía nace ese día —el que la persona llegó— y no el que eligió en la app
 * (migración 0022).
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { firstPeriod, parsePlainDate } from '@sinchi/shared';
import { InjectDb } from '../../db/db.module';
import { schema, withTenant, withoutTenantIsolation, type Database } from '../../db/client';
import { dateToColumn, toPlan, toTenant } from '../../common/mappers';
import { Clock } from '../../common/clock';
import {
  MembershipViewService,
  type MembershipView,
} from '../memberships/membership-view.service';
import { AccountLinkService } from '../../auth/account-link.service';
import { LinkRequestsService } from '../identity/link-requests.service';

export interface EnrollMemberInput {
  /** Solo si la persona es nueva: reutilizando una identidad, ya se sabe. */
  readonly name?: string | undefined;
  readonly documentId: string;
  /** Igual que `name`: obligatorio solo cuando no hay identidad que reutilizar. */
  readonly phone?: string | undefined;
  readonly email?: string | null | undefined;
  readonly planId: string;
  /** `YYYY-MM-DD`. Por defecto, hoy en la zona del gimnasio. */
  readonly startDate?: string | undefined;
  readonly internalAlias?: string | null | undefined;
  /**
   * La inscripción reservada desde el directorio que este alta viene a cerrar.
   *
   * Con ella la reserva sale de «por venir», queda apuntando a la ficha, y la
   * cuenta de Google con la que se reservó pasa a abrir esa ficha.
   */
  readonly bookingId?: string | undefined;
  /**
   * El QR de la cuenta que la persona mostró en el mostrador.
   *
   * Con él la solicitud va a ESA cuenta, y no a quien entre con el celular de la
   * ficha, que es el camino débil. El documento se sigue leyendo del carné: el
   * QR dice quién es la cuenta, no quién es la persona ante el padrón.
   */
  readonly accountToken?: string | undefined;
}

/** Quién inscribe. Sin él —desde un script— la solicitud sale sin firma. */
export interface EnrollActor {
  readonly staffId: string;
  readonly userId: string;
}

export interface EnrollResult {
  readonly view: MembershipView;
  /** `true` si la persona ya existía en la red y solo se le sumó este gimnasio. */
  readonly reusedIdentity: boolean;
  /** `true` si le quedó una solicitud por aceptar en su app. */
  readonly linkRequestSent: boolean;
}

@Injectable()
export class MembersService {
  private readonly logger = new Logger(MembersService.name);

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly clock: Clock,
    private readonly views: MembershipViewService,
    private readonly accountLink: AccountLinkService,
    private readonly linkRequests: LinkRequestsService,
  ) {}

  /**
   * ¿Hay exactamente una identidad con ese correo?
   *
   * Un booleano y nada mas: ver `identityByEmail` en el controlador para por que
   * no devuelve los datos. Se consulta FUERA del contexto del tenant porque la
   * identidad es global — la persona puede entrenar en otro local.
   */
  async identityExists(email: string): Promise<{ readonly existe: boolean }> {
    if (email.length === 0) return { existe: false };

    const found = await withoutTenantIsolation(this.db, (tx) =>
      tx
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.email, email))
        .limit(2),
    );

    // Dos coincidencias no identifican a nadie: `email` no es unico en `users`.
    return { existe: found.length === 1 };
  }

  async enroll(
    tenantId: string,
    input: EnrollMemberInput,
    actor: EnrollActor | null = null,
  ): Promise<EnrollResult> {
    const phone = input.phone === undefined ? null : input.phone.trim();
    const documentId = input.documentId.trim();
    const booking =
      input.bookingId === undefined
        ? null
        : await this.enrollmentBooking(tenantId, input.bookingId);
    // El QR se canjea antes de tocar nada: si venció, no queda un alta a medias.
    const account =
      input.accountToken === undefined
        ? null
        : await this.accountLink.previewByQrToken(input.accountToken);

    // La identidad se resuelve FUERA del contexto del tenant: es global.
    const { userId, reused, identityAccount } = await withoutTenantIsolation(this.db, async (tx) => {
      // El ancla es el DOCUMENTO, no el correo. El correo no es unico en esta
      // tabla —dos personas pueden compartirlo— y ademas un tipeo en un correo
      // ajeno inscribiria a un desconocido. El documento es lo que recepcion
      // esta leyendo del carne que tiene delante.
      const [existing] = await tx
        .select({
          id: schema.users.id,
          phone: schema.users.phone,
          doc: schema.users.documentId,
          email: schema.users.email,
          firebaseUid: schema.users.firebaseUid,
        })
        .from(schema.users)
        .where(
          phone === null
            ? eq(schema.users.documentId, documentId)
            : or(eq(schema.users.phone, phone), eq(schema.users.documentId, documentId)),
        )
        .limit(1);

      /**
       * Quien reservó con su identidad tiene que ser quien trae el carné.
       *
       * Si el documento que teclea recepción es de OTRA persona, cerrar la
       * reserva con él ataría la inscripción —y con ella el QR y la billetera—
       * a una ficha que no es de quien reservó. Se para aquí, antes de crear
       * nada, con la salida escrita: mirar el carné otra vez.
       */
      if (booking !== null && booking.userId !== null && existing?.id !== booking.userId) {
        throw new ConflictException(
          'Ese documento no es de quien reservó. Revisa su carné antes de inscribirla.',
        );
      }

      /**
       * La cuenta del QR tiene que poder abrir ESTA ficha.
       *
       * Si la ficha del documento ya abre con otra cuenta, o la del QR ya abre
       * otra ficha, aceptar la solicitud chocaría después, con la persona ya en
       * su casa. Se dice aquí, con ella delante y el carné en la mano.
       */
      const [accountHolder] =
        account === null
          ? []
          : await tx
              .select({ id: schema.users.id })
              .from(schema.users)
              .where(eq(schema.users.firebaseUid, account.firebaseUid))
              .limit(1);
      const accountMismatch =
        account !== null &&
        (existing === undefined
          ? accountHolder !== undefined
          : (existing.firebaseUid !== null && existing.firebaseUid !== account.firebaseUid) ||
            (accountHolder !== undefined && accountHolder.id !== existing.id));
      if (accountMismatch) {
        throw new ConflictException(
          'La cuenta de ese QR no corresponde a la ficha de este documento. Revisa el carné antes de inscribirla.',
        );
      }

      if (existing !== undefined) {
        // Reutilizando por documento, el celular no hace falta: ya se sabe.
        if (phone !== null && (existing.phone !== phone || existing.doc !== documentId)) {
          // Coincide uno de los dos pero no el otro: o hay un tipeo, o son dos
          // personas distintas. Adivinar aquí es cómo se fusionan dos alumnos
          // por error, y separarlos después es una migración a mano.
          throw new ConflictException(
            'Ya existe alguien con ese celular o ese documento, pero los datos no coinciden. ' +
              'Revisa si es la misma persona antes de inscribirla.',
          );
        }
        // Rellenar un correo que faltaba ayuda —es lo que activa la cuenta al
        // entrar con Google— y no pisa nada. Reemplazar uno que ya esta seria
        // otra cosa: un gimnasio cambiandole el correo a alguien que entrena en
        // otro, sin que se entere.
        const correo = input.email?.trim();
        if (existing.email === null && correo !== undefined && correo.length > 0) {
          await tx
            .update(schema.users)
            .set({ email: correo })
            .where(eq(schema.users.id, existing.id));
        }

        return { userId: existing.id, reused: true, identityAccount: existing.firebaseUid };
      }

      // Persona nueva: aqui SI hacen falta el nombre y el celular. Solo se
      // pueden omitir cuando se reutiliza una identidad que ya los tiene.
      const givenName = input.name?.trim();
      if (givenName === undefined || givenName.length < 2 || phone === null) {
        throw new BadRequestException(
          'No hay ninguna identidad con ese documento: hacen falta el nombre y el celular.',
        );
      }

      const [created] = await tx
        .insert(schema.users)
        .values({
          name: givenName,
          documentId,
          phone,
          email: input.email?.trim() ?? null,
        })
        .returning({ id: schema.users.id });

      return { userId: created!.id, reused: false, identityAccount: null };
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

      // Sin fecha, HOY: con una reserva detrás es justo lo que se quiere. Quien
      // reservó el martes y llegó el jueves empieza a deber desde el jueves.
      const start =
        input.startDate === undefined
          ? this.clock.today(tenant.timezone)
          : parsePlainDate(input.startDate);

      const { period } = firstPeriod(start, tenant.billingDatePolicy);

      const [created] = await tx
        .insert(schema.memberships)
        .values({
          userId,
          tenantId,
          internalAlias: input.internalAlias ?? null,
          status: 'active',
        })
        .onConflictDoNothing()
        .returning({ id: schema.memberships.id });

      let membershipId: string;
      if (created !== undefined) {
        membershipId = created.id;
      } else {
        // El índice único la rechazó: ya está en el padrón.
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

        /**
         * Quien vuelve, desde el directorio.
         *
         * Se dio de baja en marzo y en junio reserva su inscripción en la app:
         * es el caso que la reserva deja pasar a propósito. Mandar al mostrador a
         * otra pantalla a reinscribirla, con la persona delante, es la escalera
         * que esta ruta existe para ahorrar. Sin reserva detrás se sigue
         * respondiendo como siempre, porque ahí nadie pidió volver.
         */
        const viva =
          existente === undefined
            ? []
            : await tx
                .select({ id: schema.subscriptions.id })
                .from(schema.subscriptions)
                .where(
                  and(
                    eq(schema.subscriptions.membershipId, existente.id),
                    sql`${schema.subscriptions.status} <> 'canceled'`,
                  ),
                )
                .limit(1);

        if (existente === undefined || booking === null || viva.length > 0) {
          // Devolver solo "ya existe" es un callejón sin salida — es justo lo que
          // pasa cuando alguien canceló y vuelve, que es el caso normal, no el
          // raro. Se manda el `membershipId` para que el mostrador pueda abrir su
          // ficha y reinscribirla, que es lo que hay que hacer.
          throw new ConflictException({
            message:
              'Esa persona ya está en el padrón de este gimnasio. Si canceló, se reinscribe desde su ficha: dar de alta otra vez le partiría el historial en dos.',
            membershipId: existente?.id ?? null,
          });
        }

        await tx
          .update(schema.memberships)
          .set({ status: 'active' })
          .where(eq(schema.memberships.id, existente.id));
        membershipId = existente.id;
      }

      await tx.insert(schema.subscriptions).values({
        tenantId,
        membershipId,
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

      if (booking !== null) {
        // La reserva sale de «por venir» y queda apuntando a la ficha que produjo:
        // es el rastro de por dónde llegó, y lo que evita cerrarla dos veces.
        await tx
          .update(schema.classBookings)
          .set({ status: 'attended', membershipId, canceledAt: null })
          .where(eq(schema.classBookings.id, booking.id));
      }

      return this.views.viewInTx(tx, membershipId);
    });

    if (booking?.firebaseUid != null) await this.linkBookingAccount(userId, booking.firebaseUid);

    /**
     * La solicitud: sin ella, este gimnasio no aparece en la app de la persona.
     *
     * Dos altas no la necesitan, porque ya las pidió la persona: la que cierra
     * una reserva suya —reservó su inscripción desde el directorio— y la del staff
     * que se inscribe a sí mismo en su propio local.
     */
    const linkRequestSent = booking === null && actor?.userId !== userId;
    if (linkRequestSent) {
      await this.linkRequests.create({
        tenantId,
        membershipId: view.membership.id,
        userId,
        firebaseUid: account?.firebaseUid ?? identityAccount,
        staffId: actor?.staffId ?? null,
      });
    }

    return { view, reusedIdentity: reused, linkRequestSent };
  }

  /**
   * La reserva de inscripción que se viene a cerrar.
   *
   * Tiene que ser una inscripción —una prueba no trae plan— y seguir abierta. Se
   * acepta la marcada «no vino»: quien reservó el martes y llega el jueves es el
   * caso normal, y el mostrador pudo haberla marcado el martes. Lo que no se
   * acepta es cerrarla dos veces: daría dos altas de la misma reserva.
   */
  private async enrollmentBooking(tenantId: string, bookingId: string) {
    const [row] = await withTenant(this.db, tenantId, (tx) =>
      tx
        .select({
          id: schema.classBookings.id,
          kind: schema.classBookings.kind,
          status: schema.classBookings.status,
          userId: schema.classBookings.userId,
          firebaseUid: schema.classBookings.firebaseUid,
          membershipId: schema.classBookings.membershipId,
        })
        .from(schema.classBookings)
        .where(eq(schema.classBookings.id, bookingId))
        .limit(1),
    );

    if (row === undefined) throw new NotFoundException('Esa reserva no existe.');
    if (row.kind !== 'enrollment') {
      throw new BadRequestException('Esa reserva no es una inscripción.');
    }
    if (row.status === 'canceled' || row.membershipId !== null) {
      throw new ConflictException('Esa reserva ya se cerró: la persona la canceló o ya tiene su ficha.');
    }
    return row;
  }

  /**
   * La cuenta de Google con la que se reservó pasa a abrir la ficha.
   *
   * Sin esto la persona salía del mostrador inscrita y abría la app en la misma
   * pantalla de antes —el directorio, sin billetera ni QR— hasta dictar un código
   * de seis dígitos que nadie le había pedido. Es la misma confianza que ese
   * código, alcanzada por otro camino: la cuenta la verificó Firebase al
   * reservar, y recepción tiene delante a la persona y su documento. Y la ficha
   * solo llega aquí si su celular o su correo coincidían con los de la reserva.
   *
   * Solo si la ficha no tiene cuenta y la cuenta no abre otra ficha. Pisar una
   * vinculación que ya existe le quitaría su billetera a alguien.
   */
  private async linkBookingAccount(userId: string, firebaseUid: string): Promise<void> {
    try {
      await withoutTenantIsolation(this.db, (tx) =>
        tx
          .update(schema.users)
          .set({ firebaseUid })
          .where(and(eq(schema.users.id, userId), isNull(schema.users.firebaseUid))),
      );
    } catch (error) {
      // `users_firebase_uid_key`: esa cuenta ya abre otra ficha. La inscripción
      // ya está hecha y no se deshace por esto: el gimnasio puede mandarle la
      // solicitud desde su ficha.
      this.logger.warn(
        `No se vinculó la cuenta de la reserva: ${error instanceof Error ? error.message : error}`,
      );
    }
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
