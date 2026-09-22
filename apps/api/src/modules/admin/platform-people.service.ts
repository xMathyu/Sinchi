/**
 * Las personas, miradas desde el panel de Sinchi.
 *
 * Una persona tiene dos formas y este archivo las atiende a las dos (glosario):
 *
 *   con ficha  (`identity`)  una fila en `users`: documento, padrón, puede que ni
 *                            haya instalado la app.
 *   sin ficha  (`account`)   una cuenta de Google que entró a la app y no está en
 *                            ningún padrón (`account_claims`). Se identifica por
 *                            su uid de Firebase.
 *
 * Lo mismo que el panel de gimnasios, y por lo mismo: el aislamiento por tenant
 * NO se toca. Lo de la persona que vive dentro de un gimnasio se lee con los
 * contextos que ya existen para ella —el de identidad (`withUser`) y el de
 * cuenta (`withTrialAccount`)— y lo que hay que borrar se borra entrando
 * gimnasio por gimnasio. Ninguna política aprende que existimos.
 *
 * ELIMINAR cumple lo que promete la política publicada (sinchi.fit/eliminar-
 * cuenta), punto por punto: se va todo lo que identifica —ficha, historial,
 * reservas, conversaciones, la cuenta con la que entra— y se QUEDAN los pagos,
 * sin decir de quién, porque el gimnasio tiene que cuadrar su caja. Ver
 * `removeIdentity` y la migración 0027, que es la que lo hizo posible.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import {
  checkPersonBan,
  checkPersonDeletion,
  checkPersonDetails,
  deletionDaysLeft,
  normalizeAdminEmail,
  normalizePhoneNumber,
  personBanDenialMessage,
  personConfirmationKey,
  personDeletionDenialMessage,
  personDetailsDenialMessage,
  type PersonDetailsDraft,
} from '@sinchi/shared';
import { InjectDb } from '../../db/db.module';
import {
  adoptTenant,
  schema,
  withContext,
  withTenant,
  withUser,
  withoutTenantIsolation,
  type Database,
  type Tx,
} from '../../db/client';
import { AccountBans } from '../../auth/account-bans';
import { FirebaseVerifier, type FirebaseDeletion } from '../../auth/firebase';
import { IdentityService } from '../identity/identity.service';
import { PlatformAdminService } from './platform-admin.service';

/** Filas por página de la lista. La red de pruebas ya tiene doce mil. */
const PAGE_SIZE = 50;

export type PersonKind = 'identity' | 'account';

export interface PersonRow {
  readonly kind: PersonKind;
  /** `users.id` con ficha; el uid de Firebase sin ella. */
  readonly id: string;
  readonly name: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly documentId: string | null;
  /** Si instaló la app y entró alguna vez. Una ficha puede no haberlo hecho nunca. */
  readonly hasApp: boolean;
  readonly createdAt: string;
  readonly banned: boolean;
  /** Cuándo pidió la baja, si la tiene pendiente. */
  readonly deletionRequestedAt: string | null;
}

export interface PeoplePage {
  readonly rows: readonly PersonRow[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

export interface BanView {
  readonly id: string;
  readonly reason: string;
  readonly bannedByEmail: string;
  readonly createdAt: string;
  readonly liftedAt: string | null;
  readonly liftedByEmail: string | null;
}

/** Lo que la persona dejó en la red, contado con SUS contextos. */
export interface Footprint {
  readonly bookings: number;
  readonly conversations: number;
  readonly eventRegistrations: number;
}

export interface IdentityDetail {
  readonly kind: 'identity';
  readonly id: string;
  readonly name: string;
  readonly email: string | null;
  readonly phone: string;
  readonly documentId: string;
  readonly firebaseUid: string | null;
  readonly createdAt: string;
  readonly memberships: readonly {
    readonly id: string;
    readonly tenantId: string;
    readonly tenantName: string;
    readonly status: string;
    readonly since: string;
    readonly checkIns: number;
    readonly lastCheckInAt: string | null;
  }[];
  /** Los gimnasios donde trabaja: son los que impiden eliminarla. */
  readonly staff: readonly { readonly tenantId: string; readonly tenantName: string; readonly role: string }[];
  readonly footprint: Footprint;
  readonly bans: readonly BanView[];
  readonly deletionRequests: readonly {
    readonly status: string;
    readonly requestedAt: string;
    readonly resolvedAt: string | null;
    readonly reason: string | null;
    readonly daysLeft: number | null;
  }[];
  /** Lo que hay que escribir para eliminarla (`personConfirmationKey`). */
  readonly confirmationKey: string;
}

export interface AccountDetail {
  readonly kind: 'account';
  readonly id: string;
  readonly name: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly createdAt: string;
  readonly footprint: Footprint;
  readonly bans: readonly BanView[];
  readonly confirmationKey: string;
}

export interface PendingDeletion {
  readonly userId: string;
  readonly name: string;
  readonly email: string | null;
  readonly requestedAt: string;
  readonly reason: string | null;
  /** Negativo = la promesa de 30 días ya se rompió. */
  readonly daysLeft: number;
}

export interface DeletionOutcome {
  /** Cuántas fichas de gimnasio se fueron. */
  readonly memberships: number;
  /** Cobros que se QUEDARON, sin decir de quién. */
  readonly chargesAnonymized: number;
  readonly bookings: number;
  readonly conversations: number;
  readonly eventRegistrations: number;
  /** Qué pasó con su usuario de Firebase. `null` si nunca entró a la app. */
  readonly firebase: FirebaseDeletion | null;
}

@Injectable()
export class PlatformPeopleService {
  private readonly logger = new Logger(PlatformPeopleService.name);

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly identity: IdentityService,
    private readonly admins: PlatformAdminService,
    private readonly bans: AccountBans,
    private readonly firebase: FirebaseVerifier,
  ) {}

  // -------------------------------------------------------------------------
  // Mirar
  // -------------------------------------------------------------------------

  /**
   * Una página de personas, con o sin ficha, buscando en lo que se teclea.
   *
   * Todo sale de tablas globales (`users`, `account_claims`, `account_bans`), así
   * que es una consulta y sin contexto de gimnasio. Lo que la persona hace
   * DENTRO de un gimnasio se cuenta en su ficha, no aquí: contarlo para cincuenta
   * filas serían cincuenta transacciones para pintar una tabla.
   */
  async list(input: { readonly kind: PersonKind; readonly q?: string; readonly page?: number }): Promise<PeoplePage> {
    const page = Math.max(1, Math.floor(input.page ?? 1));
    const offset = (page - 1) * PAGE_SIZE;
    const pattern = searchPattern(input.q);

    return withoutTenantIsolation(this.db, async (tx) =>
      input.kind === 'identity'
        ? this.listIdentities(tx, pattern, page, offset)
        : this.listAccounts(tx, pattern, page, offset),
    );
  }

  /**
   * Las bajas pedidas que nadie ha ejecutado, de la más vieja a la más nueva.
   *
   * Es una obligación con plazo: la política publicada promete completarlas en
   * 30 días, y hasta este panel nadie las ejecutaba — la 0016 dejó la solicitud
   * esperando a «quien puede comprobar que corresponde». Somos nosotros.
   */
  async pendingDeletions(): Promise<readonly PendingDeletion[]> {
    const rows = await withoutTenantIsolation(this.db, (tx) =>
      tx
        .select({
          userId: schema.users.id,
          name: schema.users.name,
          email: schema.users.email,
          requestedAt: schema.accountDeletionRequests.requestedAt,
          reason: schema.accountDeletionRequests.reason,
        })
        .from(schema.accountDeletionRequests)
        .innerJoin(schema.users, eq(schema.users.id, schema.accountDeletionRequests.userId))
        .where(eq(schema.accountDeletionRequests.status, 'pending'))
        .orderBy(schema.accountDeletionRequests.requestedAt),
    );

    const now = new Date();
    return rows.map((row) => ({
      ...row,
      requestedAt: row.requestedAt.toISOString(),
      daysLeft: deletionDaysLeft(row.requestedAt, now),
    }));
  }

  async identityDetail(userId: string): Promise<IdentityDetail> {
    const user = await this.userOrFail(userId);
    const now = new Date();

    const [memberships, staff, footprint, bans, requests] = await Promise.all([
      // Con contexto de IDENTIDAD: la política de `memberships` deja leer las
      // propias en toda la red. Es la excepción que sostiene la billetera, y
      // aquí sirve para lo mismo.
      withUser(this.db, userId, (tx) =>
        tx
          .select({
            id: schema.memberships.id,
            tenantId: schema.memberships.tenantId,
            tenantName: schema.tenants.name,
            status: schema.memberships.status,
            since: schema.memberships.createdAt,
          })
          .from(schema.memberships)
          .innerJoin(schema.tenants, eq(schema.tenants.id, schema.memberships.tenantId))
          .where(eq(schema.memberships.userId, userId))
          .orderBy(schema.memberships.createdAt),
      ),
      this.staffOf(userId),
      this.footprintOf({ userId, firebaseUid: user.firebaseUid }),
      this.bansOf({ userId, firebaseUid: user.firebaseUid }),
      withoutTenantIsolation(this.db, (tx) =>
        tx
          .select()
          .from(schema.accountDeletionRequests)
          .where(eq(schema.accountDeletionRequests.userId, userId))
          .orderBy(desc(schema.accountDeletionRequests.requestedAt)),
      ),
    ]);

    /**
     * Si viene a entrenar, gimnasio por gimnasio.
     *
     * `attendance` solo se deja leer con el contexto de SU gimnasio, así que es
     * una transacción por ficha. Una persona tiene una o dos: se paga.
     */
    const withAttendance = [];
    for (const membership of memberships) {
      const [counted] = await withTenant(this.db, membership.tenantId, (tx) =>
        tx
          .select({
            total: sql<number>`count(*)::int`,
            last: sql<Date | null>`max(${schema.attendance.checkedInAt})`,
          })
          .from(schema.attendance)
          .where(eq(schema.attendance.membershipId, membership.id)),
      );
      const last = counted?.last ?? null;
      withAttendance.push({
        ...membership,
        since: membership.since.toISOString(),
        checkIns: counted?.total ?? 0,
        lastCheckInAt: last === null ? null : new Date(last).toISOString(),
      });
    }

    return {
      kind: 'identity',
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      documentId: user.documentId,
      firebaseUid: user.firebaseUid,
      createdAt: user.createdAt.toISOString(),
      memberships: withAttendance,
      staff,
      footprint,
      bans,
      deletionRequests: requests.map((request) => ({
        status: request.status,
        requestedAt: request.requestedAt.toISOString(),
        resolvedAt: request.resolvedAt?.toISOString() ?? null,
        reason: request.reason,
        daysLeft: request.status === 'pending' ? deletionDaysLeft(request.requestedAt, now) : null,
      })),
      confirmationKey: personConfirmationKey({
        documentId: user.documentId,
        email: user.email,
        phone: user.phone,
        firebaseUid: user.firebaseUid,
      }),
    };
  }

  async accountDetail(firebaseUid: string): Promise<AccountDetail> {
    const account = await this.accountOrFail(firebaseUid);

    const [footprint, bans] = await Promise.all([
      this.footprintOf({ userId: null, firebaseUid }),
      this.bansOf({ userId: null, firebaseUid }),
    ]);

    return {
      kind: 'account',
      id: firebaseUid,
      name: account.displayName,
      email: account.email,
      phone: account.phone,
      createdAt: account.createdAt.toISOString(),
      footprint,
      bans,
      confirmationKey: personConfirmationKey({
        documentId: null,
        email: account.email,
        phone: account.phone,
        firebaseUid,
      }),
    };
  }

  // -------------------------------------------------------------------------
  // Corregir
  // -------------------------------------------------------------------------

  /**
   * Corrige nombre, celular, documento y correo de una ficha.
   *
   * Nombre y celular van por `IdentityService.updateDetails`, EL MISMO camino
   * por el que la persona se corrige desde la app: comprueba que el celular no
   * sea de otra persona y actualiza su nombre en cada mostrador donde trabaja
   * (decisiones §15). Reescribir eso aquí sería el segundo sitio donde un día
   * el celular deja de compararse normalizado.
   *
   * El registro guarda QUÉ campos cambiaron, no sus valores. Al revés que con un
   * gimnasio, el antes y el después de una persona son datos personales, y la
   * política promete borrarlos con su cuenta: un registro que los guardara los
   * conservaría para siempre.
   */
  async updateIdentity(
    adminId: string,
    userId: string,
    draft: PersonDetailsDraft,
  ): Promise<IdentityDetail> {
    const user = await this.userOrFail(userId);

    const denial = checkPersonDetails(draft);
    if (denial !== null) throw new BadRequestException(personDetailsDenialMessage(denial));

    const name = draft.name.trim();
    const phone = normalizePhoneNumber(draft.phone);
    const documentId = draft.documentId.trim();
    const email = draft.email.trim().length === 0 ? null : normalizeAdminEmail(draft.email);

    const fields: string[] = [];
    if (name !== user.name) fields.push('name');
    if (phone !== normalizePhoneNumber(user.phone)) fields.push('phone');
    if (documentId !== user.documentId) fields.push('documentId');
    if (email !== (user.email === null ? null : normalizeAdminEmail(user.email))) fields.push('email');

    if (fields.length === 0) return this.identityDetail(userId);

    // El documento se comprueba ANTES de tocar nada: `updateDetails` escribe en
    // su propia transacción, y chocar después dejaría el nombre cambiado y el
    // documento no — media corrección que nadie pidió.
    if (fields.includes('documentId')) {
      const [taken] = await withoutTenantIsolation(this.db, (tx) =>
        tx
          .select({ id: schema.users.id })
          .from(schema.users)
          .where(and(eq(schema.users.documentId, documentId), sql`${schema.users.id} <> ${userId}`))
          .limit(1),
      );
      if (taken !== undefined) {
        throw new ConflictException('Ese documento ya es de otra persona en Sinchi.');
      }
    }

    if (fields.includes('name') || fields.includes('phone')) {
      await this.identity.updateDetails(userId, { name, phone });
    }

    await withoutTenantIsolation(this.db, async (tx) => {
      if (fields.includes('documentId') || fields.includes('email')) {
        try {
          await tx.update(schema.users).set({ documentId, email }).where(eq(schema.users.id, userId));
        } catch (error) {
          // La carrera que la comprobación de arriba no cubre: otra ficha con
          // ese documento entre medias. El índice único es la red.
          if (isUniqueViolation(error)) {
            throw new ConflictException('Ese documento ya es de otra persona en Sinchi.');
          }
          throw error;
        }
      }

      await this.admins.record(tx, {
        adminId,
        action: 'person.update',
        subject: userId,
        detail: { kind: 'identity', fields },
      });
    });

    return this.identityDetail(userId);
  }

  // -------------------------------------------------------------------------
  // Banear
  // -------------------------------------------------------------------------

  /**
   * Banea a una persona: pierde la app, conserva sus datos.
   *
   * El baneo guarda TODAS las llaves con las que se la puede reconocer si vuelve
   * —la ficha, su uid de Firebase y el correo verificado de su cuenta de
   * Google—. El correo sale de `account_claims`, que lo copió del token de
   * Google, y NO de `users.email`: ese lo teclea el mostrador, y un correo mal
   * escrito ahí banearía a otra persona.
   */
  async ban(
    adminId: string,
    target: { readonly userId: string } | { readonly firebaseUid: string },
    reason: string,
  ): Promise<void> {
    const keys =
      'userId' in target
        ? await this.keysOfIdentity(target.userId)
        : await this.keysOfAccount(target.firebaseUid);

    const live = await this.bans.find(keys);
    const denial = checkPersonBan({ reason, banned: live !== null });
    if (denial !== null) throw new ForbiddenException(personBanDenialMessage(denial));

    await withoutTenantIsolation(this.db, async (tx) => {
      await tx.insert(schema.accountBans).values({
        userId: keys.userId,
        firebaseUid: keys.firebaseUid,
        email: keys.email,
        reason: reason.trim(),
        bannedBy: adminId,
      });

      await this.admins.record(tx, {
        adminId,
        action: 'person.ban',
        subject: keys.userId ?? keys.firebaseUid,
        reason: reason.trim(),
        detail: { kind: keys.userId === null ? 'account' : 'identity' },
      });
    });

    // Esta instancia se entera ya; las demás, en cuanto refresquen su lista.
    this.bans.invalidate();
    this.logger.warn(`Persona baneada desde el panel: ${keys.userId ?? keys.firebaseUid}`);
  }

  async lift(adminId: string, banId: string): Promise<void> {
    await withoutTenantIsolation(this.db, async (tx) => {
      const [ban] = await tx
        .update(schema.accountBans)
        .set({ liftedAt: new Date(), liftedBy: adminId })
        .where(and(eq(schema.accountBans.id, banId), isNull(schema.accountBans.liftedAt)))
        .returning();

      if (ban === undefined) throw new NotFoundException('Ese baneo ya no está vivo.');

      await this.admins.record(tx, {
        adminId,
        action: 'person.unban',
        subject: ban.userId ?? ban.firebaseUid,
        reason: ban.reason,
      });
    });

    this.bans.invalidate();
  }

  // -------------------------------------------------------------------------
  // Eliminar
  // -------------------------------------------------------------------------

  /**
   * Elimina la cuenta de una persona con ficha, como promete la política.
   *
   * TODO EN UNA TRANSACCIÓN, entrando gimnasio por gimnasio con `adoptTenant`.
   * Lo que la persona dejó dentro de un gimnasio solo se toca con el contexto de
   * ese gimnasio —es la regla que el panel no rompe—, y una transacción por
   * gimnasio dejaría una baja a medias si la tercera falla: la ficha borrada en
   * un local y viva en otro.
   *
   * El orden dentro de cada gimnasio NO es negociable:
   *
   *  1. **se sueltan los cobros** (`membership_id = null`, `anonymized_at`). Van
   *     primero porque `charges.membership_id` es CASCADE: borrar la ficha antes
   *     se llevaría la caja del gimnasio entera, que es lo único que la política
   *     promete conservar;
   *  2. se borran reservas, inscripciones a eventos y conversaciones — llevan su
   *     nombre y su celular COPIADOS, así que un `set null` de la ficha no basta;
   *  3. se borran sus invitaciones —la que usó y las que siguen esperándola—,
   *     que llevan copiados su nombre, su documento y su correo;
   *  4. se borra la ficha, y la cascada se lleva suscripciones, asistencias y
   *     solicitudes de vínculo.
   *
   * Después, lo global: su cuenta sin ficha, la baja pendiente (marcada como
   * hecha, y conservada como prueba) y su identidad. Y por último, fuera de la
   * transacción, su usuario de Firebase — que puede fallar sin deshacer nada.
   */
  async removeIdentity(adminId: string, userId: string, typed: string): Promise<DeletionOutcome> {
    const user = await this.userOrFail(userId);
    const staff = await this.staffOf(userId);

    const denial = checkPersonDeletion({
      staffOf: staff.map((post) => post.tenantName),
      key: personConfirmationKey({
        documentId: user.documentId,
        email: user.email,
        phone: user.phone,
        firebaseUid: user.firebaseUid,
      }),
      typed,
    });
    if (denial !== null) {
      throw new ForbiddenException(
        personDeletionDenialMessage(
          denial,
          staff.map((post) => post.tenantName),
        ),
      );
    }

    const keys = await this.keysOfIdentity(userId);
    const uid = user.firebaseUid;

    const counts = await withoutTenantIsolation(this.db, async (tx) => {
      const tenants = await tx.select({ id: schema.tenants.id }).from(schema.tenants);
      const total = { memberships: 0, chargesAnonymized: 0, bookings: 0, conversations: 0, eventRegistrations: 0 };

      for (const tenant of tenants) {
        await adoptTenant(tx, tenant.id);

        const memberships = await tx
          .select({ id: schema.memberships.id })
          .from(schema.memberships)
          .where(and(eq(schema.memberships.tenantId, tenant.id), eq(schema.memberships.userId, userId)));
        const ids = memberships.map((row) => row.id);

        if (ids.length > 0) {
          const anonymized = await tx
            .update(schema.charges)
            .set({ membershipId: null, anonymizedAt: new Date() })
            .where(and(eq(schema.charges.tenantId, tenant.id), inArray(schema.charges.membershipId, ids)))
            .returning({ id: schema.charges.id });
          total.chargesAnonymized += anonymized.length;
        }

        const traces = await this.deleteTraces(tx, tenant.id, { userId, firebaseUid: uid, membershipIds: ids });
        total.bookings += traces.bookings;
        total.conversations += traces.conversations;
        total.eventRegistrations += traces.eventRegistrations;

        /**
         * Las invitaciones con sus datos, usadas o no.
         *
         * Una invitación copia el nombre, el documento, el celular y el correo de
         * quien se invita, así que es dato que la identifica y se va con ella —
         * también la que ya usó. Esa, además, no podría quedarse: su
         * `consumed_by` pasaría a null con la persona, y `invites_consumed_has_user`
         * exige que una invitación usada diga quién la usó. Se vio así, con el
         * borrado entero cayéndose en la última línea.
         */
        await tx
          .delete(schema.invites)
          .where(
            and(
              eq(schema.invites.tenantId, tenant.id),
              or(
                eq(schema.invites.consumedBy, userId),
                eq(schema.invites.documentId, user.documentId),
                user.email === null
                  ? sql`false`
                  : sql`lower(invites.email) = ${normalizeAdminEmail(user.email)}`,
              ),
            ),
          );

        if (ids.length > 0) {
          const gone = await tx
            .delete(schema.memberships)
            .where(inArray(schema.memberships.id, ids))
            .returning({ id: schema.memberships.id });
          total.memberships += gone.length;
        }
      }

      // Fuera ya de todo gimnasio: lo que sigue es global.
      await adoptTenant(tx, '');

      await tx
        .delete(schema.accountClaims)
        .where(
          uid === null
            ? eq(schema.accountClaims.linkedUserId, userId)
            : or(eq(schema.accountClaims.linkedUserId, userId), eq(schema.accountClaims.firebaseUid, uid)),
        );

      /**
       * La baja pendiente se da por HECHA y se conserva.
       *
       * Es la prueba de que se cumplió el plazo si alguien reclama, y por eso la
       * 0027 le cambió la clave foránea a `set null`: antes, borrar a la persona
       * se llevaba la prueba de haberla borrado. Lo que escribió al pedirla se
       * borra — puede decir cualquier cosa, incluido su nombre.
       */
      await tx
        .update(schema.accountDeletionRequests)
        .set({ reason: null })
        .where(eq(schema.accountDeletionRequests.userId, userId));
      await tx
        .update(schema.accountDeletionRequests)
        .set({ status: 'done', resolvedAt: new Date() })
        .where(
          and(
            eq(schema.accountDeletionRequests.userId, userId),
            eq(schema.accountDeletionRequests.status, 'pending'),
          ),
        );

      /**
       * Un baneo sobrevive a la baja, y hay que dejarlo reconocible.
       *
       * Si no, eliminar su cuenta sería la forma de quitarse el baneo. Antes de
       * que la ficha desaparezca, el baneo se queda con su uid y su correo de
       * Google (la clave foránea a `users` pasa a null sola). El que no tenga
       * nada con qué reconocerla —ficha sin app, baneada sin haber entrado
       * nunca— se borra: no hay a quién seguir reconociendo.
       */
      await tx
        .update(schema.accountBans)
        .set({
          firebaseUid: sql`coalesce(account_bans.firebase_uid, ${uid})`,
          email: sql`coalesce(account_bans.email, ${keys.email})`,
        })
        .where(eq(schema.accountBans.userId, userId));
      await tx
        .delete(schema.accountBans)
        .where(
          and(
            eq(schema.accountBans.userId, userId),
            isNull(schema.accountBans.firebaseUid),
            isNull(schema.accountBans.email),
          ),
        );

      try {
        await tx.delete(schema.users).where(eq(schema.users.id, userId));
      } catch (error) {
        // La carrera: la sumaron a un equipo entre la comprobación y aquí.
        // `staff.user_id` es RESTRICT y es la red.
        if (isForeignKeyViolation(error)) {
          throw new ConflictException(
            'Esta persona empezó a trabajar en un gimnasio mientras la eliminabas. Vuelve a cargar su ficha.',
          );
        }
        throw error;
      }

      await this.admins.record(tx, {
        adminId,
        action: 'person.delete',
        subject: userId,
        // Números y nada más: el registro no puede conservar lo que la baja
        // promete borrar.
        detail: { kind: 'identity', ...total, firebase: uid === null ? null : 'pending' },
      });

      return total;
    });

    const firebase = uid === null ? null : await this.deleteFirebaseAccount(adminId, userId, uid);
    this.logger.warn(`Cuenta eliminada desde el panel: ${userId}`);
    return { ...counts, firebase };
  }

  /**
   * Elimina una cuenta SIN ficha.
   *
   * Es mucho menos —no hay padrón ni caja— pero no es nada: sus reservas desde
   * el directorio y sus conversaciones con los gimnasios llevan su nombre y su
   * celular copiados, y viven dentro de cada gimnasio.
   *
   * Si la cuenta ya tiene ficha, se niega: eliminarla desde aquí dejaría la
   * ficha viva con su uid dentro, que es media baja.
   */
  async removeAccount(adminId: string, firebaseUid: string, typed: string): Promise<DeletionOutcome> {
    const account = await this.accountOrFail(firebaseUid);

    const denial = checkPersonDeletion({
      staffOf: [],
      key: personConfirmationKey({
        documentId: null,
        email: account.email,
        phone: account.phone,
        firebaseUid,
      }),
      typed,
    });
    if (denial !== null) throw new ForbiddenException(personDeletionDenialMessage(denial));

    const counts = await withoutTenantIsolation(this.db, async (tx) => {
      const tenants = await tx.select({ id: schema.tenants.id }).from(schema.tenants);
      const total = { memberships: 0, chargesAnonymized: 0, bookings: 0, conversations: 0, eventRegistrations: 0 };

      for (const tenant of tenants) {
        await adoptTenant(tx, tenant.id);
        const traces = await this.deleteTraces(tx, tenant.id, {
          userId: null,
          firebaseUid,
          membershipIds: [],
        });
        total.bookings += traces.bookings;
        total.conversations += traces.conversations;
        total.eventRegistrations += traces.eventRegistrations;

        // La solicitud de vínculo es del GIMNASIO —cuelga de su ficha— y se
        // queda. Lo que se va es a qué cuenta iba dirigida.
        await tx
          .update(schema.linkRequests)
          .set({ firebaseUid: null })
          .where(
            and(eq(schema.linkRequests.tenantId, tenant.id), eq(schema.linkRequests.firebaseUid, firebaseUid)),
          );
      }

      await adoptTenant(tx, '');
      await tx.delete(schema.accountClaims).where(eq(schema.accountClaims.firebaseUid, firebaseUid));

      await this.admins.record(tx, {
        adminId,
        action: 'person.delete',
        subject: firebaseUid,
        detail: { kind: 'account', ...total, firebase: 'pending' },
      });

      return total;
    });

    const firebase = await this.deleteFirebaseAccount(adminId, firebaseUid, firebaseUid);
    return { ...counts, firebase };
  }

  // -------------------------------------------------------------------------
  // Interno
  // -------------------------------------------------------------------------

  private async listIdentities(
    tx: Tx,
    pattern: string | null,
    page: number,
    offset: number,
  ): Promise<PeoplePage> {
    const where: SQL | undefined =
      pattern === null
        ? undefined
        : sql`(users.name ilike ${pattern} or users.email ilike ${pattern}
               or users.document_id ilike ${pattern}
               or regexp_replace(users.phone, '[^0-9+]', '', 'g') ilike ${pattern})`;

    const [counted] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.users)
      .where(where);

    const rows = await tx
      .select({
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        phone: schema.users.phone,
        documentId: schema.users.documentId,
        firebaseUid: schema.users.firebaseUid,
        createdAt: schema.users.createdAt,
        // Las columnas de `users` van escritas enteras: dentro de una plantilla
        // `sql`, Drizzle las renderiza sin tabla, y en una subconsulta eso
        // resuelve a la columna de la tabla de DENTRO (ver `PlatformGymsService.statsOf`,
        // donde se vio devolviendo ceros).
        banned: sql<boolean>`exists (
          select 1 from account_bans b
           where b.lifted_at is null
             and (b.user_id = users.id
                  or (users.firebase_uid is not null and b.firebase_uid = users.firebase_uid)))`,
        deletionRequestedAt: sql<Date | null>`(
          select r.requested_at from account_deletion_requests r
           where r.user_id = users.id and r.status = 'pending')`,
      })
      .from(schema.users)
      .where(where)
      .orderBy(desc(schema.users.createdAt))
      .limit(PAGE_SIZE)
      .offset(offset);

    return {
      rows: rows.map((row) => ({
        kind: 'identity',
        id: row.id,
        name: row.name,
        email: row.email,
        phone: row.phone,
        documentId: row.documentId,
        hasApp: row.firebaseUid !== null,
        createdAt: row.createdAt.toISOString(),
        banned: row.banned,
        deletionRequestedAt:
          row.deletionRequestedAt === null ? null : new Date(row.deletionRequestedAt).toISOString(),
      })),
      total: counted?.total ?? 0,
      page,
      pageSize: PAGE_SIZE,
    };
  }

  /**
   * Las cuentas sin ficha: una fila por uid de Firebase.
   *
   * `account_claims` tiene una fila por cuenta que se renueva, pero pueden quedar
   * varias —las de antes de la 0023—, así que se toma la más nueva. Y se excluye
   * toda cuenta cuyo uid ya abre una ficha: esa persona es de la otra pestaña.
   */
  private async listAccounts(
    tx: Tx,
    pattern: string | null,
    page: number,
    offset: number,
  ): Promise<PeoplePage> {
    const filter = pattern === null
      ? sql`true`
      : sql`(c.display_name ilike ${pattern} or c.email ilike ${pattern}
             or regexp_replace(coalesce(c.phone, ''), '[^0-9+]', '', 'g') ilike ${pattern})`;

    const base = sql`
      select distinct on (c.firebase_uid)
             c.firebase_uid, c.display_name, c.email, c.phone, c.created_at
        from account_claims c
       where c.linked_user_id is null
         and not exists (select 1 from users u where u.firebase_uid = c.firebase_uid)
         and ${filter}
       order by c.firebase_uid, c.created_at desc`;

    const counted = rowsOf<{ total: number }>(
      await tx.execute(sql`select count(*)::int as total from (${base}) as cuentas`),
    );

    const rows = rowsOf<{
      firebase_uid: string;
      display_name: string | null;
      email: string | null;
      phone: string | null;
      created_at: Date | string;
      banned: boolean;
    }>(
      await tx.execute(sql`
        select cuentas.*,
               exists (select 1 from account_bans b
                        where b.lifted_at is null
                          and (b.firebase_uid = cuentas.firebase_uid
                               or (cuentas.email is not null and b.email = lower(cuentas.email)))) as banned
          from (${base}) as cuentas
         order by cuentas.created_at desc
         limit ${PAGE_SIZE} offset ${offset}`),
    );

    return {
      rows: rows.map((row) => ({
        kind: 'account',
        id: row.firebase_uid,
        name: row.display_name,
        email: row.email,
        phone: row.phone,
        documentId: null,
        hasApp: true,
        createdAt: new Date(row.created_at).toISOString(),
        banned: row.banned,
        deletionRequestedAt: null,
      })),
      total: counted[0]?.total ?? 0,
      page,
      pageSize: PAGE_SIZE,
    };
  }

  /**
   * Lo que la persona dejó dentro de UN gimnasio y lleva sus datos copiados.
   *
   * Se llama con ese gimnasio adoptado. Reservas, inscripciones a eventos y
   * conversaciones copian el nombre y el celular al crearse —para no depender de
   * una ficha que quizá no existe—, así que no basta con soltar la ficha: hay que
   * borrarlas. Los mensajes se van en cascada con su conversación.
   */
  private async deleteTraces(
    tx: Tx,
    tenantId: string,
    who: { readonly userId: string | null; readonly firebaseUid: string | null; readonly membershipIds: readonly string[] },
  ): Promise<Footprint> {
    const byPerson = (table: {
      readonly userId: AnyPgColumn;
      readonly firebaseUid: AnyPgColumn;
    }): SQL => {
      const keys: SQL[] = [];
      if (who.userId !== null) keys.push(eq(table.userId, who.userId));
      if (who.firebaseUid !== null) keys.push(eq(table.firebaseUid, who.firebaseUid));
      return keys.length === 0 ? sql`false` : or(...keys)!;
    };

    const membershipIds = [...who.membershipIds];

    const bookings = await tx
      .delete(schema.classBookings)
      .where(
        and(
          eq(schema.classBookings.tenantId, tenantId),
          membershipIds.length === 0
            ? byPerson(schema.classBookings)
            : or(byPerson(schema.classBookings), inArray(schema.classBookings.membershipId, membershipIds)),
        ),
      )
      .returning({ id: schema.classBookings.id });

    const registrations = await tx
      .delete(schema.eventRegistrations)
      .where(
        and(
          eq(schema.eventRegistrations.tenantId, tenantId),
          membershipIds.length === 0
            ? byPerson(schema.eventRegistrations)
            : or(
                byPerson(schema.eventRegistrations),
                inArray(schema.eventRegistrations.membershipId, membershipIds),
              ),
        ),
      )
      .returning({ id: schema.eventRegistrations.id });

    const conversations = await tx
      .delete(schema.conversations)
      .where(and(eq(schema.conversations.tenantId, tenantId), byPerson(schema.conversations)))
      .returning({ id: schema.conversations.id });

    return {
      bookings: bookings.length,
      eventRegistrations: registrations.length,
      conversations: conversations.length,
    };
  }

  /**
   * Cuánto dejó la persona en la red, contado con SU contexto.
   *
   * Las políticas de reservas, eventos y conversaciones ya dejan ver las filas
   * propias a quien presenta su identidad o su cuenta —es lo que le deja a ella
   * ver sus reservas en la app—, así que una sola transacción con esos dos
   * contextos cuenta todo sin entrar a ningún gimnasio.
   */
  private async footprintOf(who: {
    readonly userId: string | null;
    readonly firebaseUid: string | null;
  }): Promise<Footprint> {
    return withContext(
      this.db,
      {
        ...(who.userId === null ? {} : { userId: who.userId }),
        ...(who.firebaseUid === null ? {} : { trialAccount: who.firebaseUid }),
      },
      async (tx) => {
        const count = async (table: typeof schema.classBookings | typeof schema.conversations | typeof schema.eventRegistrations) => {
          const keys: SQL[] = [];
          if (who.userId !== null) keys.push(eq(table.userId, who.userId));
          if (who.firebaseUid !== null) keys.push(eq(table.firebaseUid, who.firebaseUid));
          if (keys.length === 0) return 0;
          const [row] = await tx
            .select({ total: sql<number>`count(*)::int` })
            .from(table)
            .where(or(...keys));
          return row?.total ?? 0;
        };

        return {
          bookings: await count(schema.classBookings),
          conversations: await count(schema.conversations),
          eventRegistrations: await count(schema.eventRegistrations),
        };
      },
    );
  }

  private async bansOf(who: {
    readonly userId: string | null;
    readonly firebaseUid: string | null;
  }): Promise<readonly BanView[]> {
    const keys: SQL[] = [];
    if (who.userId !== null) keys.push(eq(schema.accountBans.userId, who.userId));
    if (who.firebaseUid !== null) keys.push(eq(schema.accountBans.firebaseUid, who.firebaseUid));
    if (keys.length === 0) return [];

    const rows = await withoutTenantIsolation(this.db, (tx) =>
      tx
        .select({
          id: schema.accountBans.id,
          reason: schema.accountBans.reason,
          createdAt: schema.accountBans.createdAt,
          liftedAt: schema.accountBans.liftedAt,
          bannedByEmail: sql<string>`(select a.email from platform_admins a where a.id = account_bans.banned_by)`,
          liftedByEmail: sql<string | null>`(select a.email from platform_admins a where a.id = account_bans.lifted_by)`,
        })
        .from(schema.accountBans)
        .where(or(...keys))
        .orderBy(desc(schema.accountBans.createdAt)),
    );

    return rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      liftedAt: row.liftedAt?.toISOString() ?? null,
    }));
  }

  /** Los gimnasios donde trabaja, leídos con su identidad (la política lo deja). */
  private async staffOf(userId: string) {
    return withUser(this.db, userId, (tx) =>
      tx
        .select({
          tenantId: schema.staff.tenantId,
          tenantName: schema.tenants.name,
          role: schema.staff.role,
        })
        .from(schema.staff)
        .innerJoin(schema.tenants, eq(schema.tenants.id, schema.staff.tenantId))
        .where(eq(schema.staff.userId, userId)),
    );
  }

  /**
   * Las llaves con las que se reconoce a una ficha si vuelve.
   *
   * El correo es el de su CUENTA DE GOOGLE —el que copió `account_claims` del
   * token— y no `users.email`, que lo teclea el mostrador: un correo mal escrito
   * ahí banearía a otra persona.
   */
  private async keysOfIdentity(userId: string): Promise<{
    readonly userId: string | null;
    readonly firebaseUid: string | null;
    readonly email: string | null;
  }> {
    const user = await this.userOrFail(userId);
    const googleEmail =
      user.firebaseUid === null ? null : (await this.latestClaim(user.firebaseUid))?.email ?? null;
    return {
      userId,
      firebaseUid: user.firebaseUid,
      email: googleEmail === null ? null : normalizeAdminEmail(googleEmail),
    };
  }

  private async keysOfAccount(firebaseUid: string) {
    const account = await this.accountOrFail(firebaseUid);
    return {
      userId: null,
      firebaseUid,
      email: account.email === null ? null : normalizeAdminEmail(account.email),
    };
  }

  private async userOrFail(userId: string): Promise<typeof schema.users.$inferSelect> {
    const [user] = await withoutTenantIsolation(this.db, (tx) =>
      tx.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1),
    );
    if (user === undefined) throw new NotFoundException('Esa persona no existe (o ya se eliminó).');
    return user;
  }

  /**
   * La cuenta sin ficha, por su uid.
   *
   * Si ese uid ya abre una ficha, la persona es de la otra forma y se dice con
   * un 409: todo lo que se haga desde aquí dejaría su ficha intacta.
   */
  private async accountOrFail(firebaseUid: string): Promise<typeof schema.accountClaims.$inferSelect> {
    const [linked] = await withoutTenantIsolation(this.db, (tx) =>
      tx
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.firebaseUid, firebaseUid))
        .limit(1),
    );
    if (linked !== undefined) {
      throw new ConflictException({
        code: 'account_has_identity',
        message: 'Esta cuenta ya tiene ficha: se administra desde su ficha.',
        userId: linked.id,
      });
    }

    const claim = await this.latestClaim(firebaseUid);
    if (claim === undefined) throw new NotFoundException('Esa cuenta no existe (o ya se eliminó).');
    return claim;
  }

  private async latestClaim(firebaseUid: string) {
    const [claim] = await withoutTenantIsolation(this.db, (tx) =>
      tx
        .select()
        .from(schema.accountClaims)
        .where(eq(schema.accountClaims.firebaseUid, firebaseUid))
        .orderBy(desc(schema.accountClaims.createdAt))
        .limit(1),
    );
    return claim;
  }

  /** Intenta borrar su usuario de Firebase y deja escrito qué pasó. */
  private async deleteFirebaseAccount(
    adminId: string,
    subject: string,
    firebaseUid: string,
  ): Promise<FirebaseDeletion> {
    const { outcome } = await this.firebase.deleteAccount(firebaseUid);

    // Se completa el registro que la transacción dejó en `pending`. Si esto
    // fallara, la baja ya está hecha y el registro dice «pending»: es la señal
    // de ir a mirar la consola de Firebase, que es exactamente lo correcto.
    await withoutTenantIsolation(this.db, (tx) =>
      tx
        .update(schema.platformActions)
        .set({
          detail: sql`jsonb_set(coalesce(platform_actions.detail, '{}'::jsonb), '{firebase}', to_jsonb(${outcome}::text))`,
        })
        .where(
          and(
            eq(schema.platformActions.adminId, adminId),
            eq(schema.platformActions.action, 'person.delete'),
            eq(schema.platformActions.subject, subject),
          ),
        ),
    ).catch((error: unknown) => {
      this.logger.warn(`No se pudo anotar el resultado de Firebase para ${subject}: ${String(error)}`);
    });

    return outcome;
  }
}

/**
 * Lo que se busca, como patrón de `ilike`.
 *
 * Se escapan `%` y `_`: son comodines de SQL, y buscar «50%» no puede
 * devolver a todo el mundo. Un celular se busca sin espacios porque así se
 * compara la columna (`regexp_replace`).
 */
function searchPattern(raw: string | undefined): string | null {
  const q = (raw ?? '').trim();
  if (q.length === 0) return null;
  const compact = /^[+\d\s-]+$/.test(q) ? q.replace(/[\s-]/g, '') : q;
  return `%${compact.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

function rowsOf<T>(result: unknown): T[] {
  const withRows = result as { rows?: T[] };
  return withRows.rows ?? (result as T[]);
}

function pgCode(error: unknown): string | undefined {
  const code = (value: unknown): string | undefined =>
    typeof value === 'object' && value !== null ? (value as { code?: string }).code : undefined;
  const cause =
    typeof error === 'object' && error !== null ? (error as { cause?: unknown }).cause : undefined;
  return code(error) ?? code(cause);
}

const isUniqueViolation = (error: unknown): boolean => pgCode(error) === '23505';
const isForeignKeyViolation = (error: unknown): boolean => pgCode(error) === '23503';
