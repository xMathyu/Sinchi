/**
 * Solicitudes de vínculo: el gimnasio agrega, la persona acepta.
 *
 * Reemplaza al código de 6 dígitos, y la regla que lo ordena es otra: ningún
 * gimnasio aparece en la app de alguien sin que esa persona lo acepte. La ficha
 * del padrón no espera —recepción inscribe, cobra y marca la puerta igual—; lo
 * que espera es la billetera (`notAwaitingPerson` en `MembershipViewService`).
 * Sin esto, cualquier local que conociera un DNI podía meterse en la app de
 * quien quisiera.
 *
 * Tres formas de llegar a la persona, de la más cierta a la más débil:
 *
 *  · el QR de su cuenta, escaneado en el mostrador: la solicitud va a ESA cuenta
 *    y ninguna otra puede contestarla;
 *  · la cuenta que su identidad ya tenía, porque entrena en otro gimnasio;
 *  · el celular o el correo de la ficha, para quien no estaba delante. Es el
 *    camino débil —el celular del registro no se verifica—, y por eso queda qué
 *    cuenta contestó y el dueño puede desvincular (decisiones §14).
 */
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, isNull, or, sql, type SQL } from 'drizzle-orm';
import { InjectDb } from '../../db/db.module';
import {
  schema,
  withTenant,
  withTrialAccount,
  withUser,
  withoutTenantIsolation,
  type Database,
  type Tx,
} from '../../db/client';
import { AccountLinkService } from '../../auth/account-link.service';
import { normalizePhone } from './visitor.service';

export type LinkRequestStatus = 'pending' | 'accepted' | 'rejected' | 'canceled';

/** Lo que ve la persona: qué gimnasio la agregó. */
export interface PersonLinkRequest {
  readonly id: string;
  readonly gymName: string;
  readonly gymSlug: string;
  readonly createdAt: Date;
}

/** Lo que ve el gimnasio en la ficha. */
export interface MembershipLinkState {
  /** La última solicitud de esta ficha, o `null` si nunca mandó ninguna. */
  readonly request: {
    readonly id: string;
    readonly status: LinkRequestStatus;
    readonly createdAt: Date;
    readonly decidedAt: Date | null;
  } | null;
  /** Si la identidad de la ficha ya abre con una cuenta de Sinchi. */
  readonly accountLinked: boolean;
}

/** Quien contesta. La cuenta llega ya verificada contra Firebase. */
export type LinkAnswerer =
  | { readonly kind: 'user'; readonly userId: string }
  | { readonly kind: 'account'; readonly uid: string; readonly email: string | null };

interface PendingRow {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly createdAt: Date;
  readonly gymName: string;
  readonly gymSlug: string;
}

const NOT_PENDING = 'Esa solicitud ya no está pendiente.';

@Injectable()
export class LinkRequestsService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly accountLink: AccountLinkService,
  ) {}

  // -------------------------------------------------------------------------
  // El gimnasio
  // -------------------------------------------------------------------------

  /**
   * Deja la solicitud de una ficha recién inscrita.
   *
   * `onConflictDoNothing` por el índice de una pendiente por ficha: si ya hay una
   * esperando, la persona no recibe un segundo aviso del mismo gimnasio.
   */
  async create(input: {
    readonly tenantId: string;
    readonly membershipId: string;
    readonly userId: string;
    readonly firebaseUid: string | null;
    readonly staffId: string | null;
  }): Promise<void> {
    await withTenant(this.db, input.tenantId, (tx) =>
      tx
        .insert(schema.linkRequests)
        .values({
          tenantId: input.tenantId,
          membershipId: input.membershipId,
          userId: input.userId,
          firebaseUid: input.firebaseUid,
          createdBy: input.staffId,
        })
        .onConflictDoNothing(),
    );
  }

  /** Cómo está la ficha frente a la app de la persona. */
  async forMembership(tenantId: string, membershipId: string): Promise<MembershipLinkState> {
    const { userId, latest } = await this.latestFor(tenantId, membershipId);
    return {
      request:
        latest === null
          ? null
          : {
              id: latest.id,
              status: latest.status,
              createdAt: latest.createdAt,
              decidedAt: latest.decidedAt,
            },
      accountLinked: (await this.accountOf(userId)) !== null,
    };
  }

  /**
   * Vuelve a mandar la solicitud.
   *
   * Existe para quien rechazó sin querer o para la que el gimnasio retiró. No se
   * reenvía lo que ya espera —sería el segundo aviso que el índice evita— ni lo
   * aceptado, y la cuenta a la que iba se conserva: si llegó por el QR de una
   * cuenta concreta, reenviarla por celular abriría el camino débil sin motivo.
   */
  async resend(
    tenantId: string,
    membershipId: string,
    staffId: string | null,
  ): Promise<MembershipLinkState> {
    const { userId, latest } = await this.latestFor(tenantId, membershipId);

    if (latest?.status === 'accepted') {
      throw new ConflictException('Ya aceptó: este gimnasio está en su app.');
    }
    if (latest?.status !== 'pending') {
      await this.create({
        tenantId,
        membershipId,
        userId,
        firebaseUid: latest?.firebaseUid ?? (await this.accountOf(userId)),
        staffId,
      });
    }
    return this.forMembership(tenantId, membershipId);
  }

  /** Retira una solicitud que la persona todavía no contestó. */
  async cancel(tenantId: string, requestId: string): Promise<void> {
    const updated = await withTenant(this.db, tenantId, (tx) =>
      tx
        .update(schema.linkRequests)
        .set({ status: 'canceled', decidedAt: new Date() })
        .where(and(eq(schema.linkRequests.id, requestId), eq(schema.linkRequests.status, 'pending')))
        .returning({ id: schema.linkRequests.id }),
    );
    if (updated.length === 0) throw new NotFoundException(NOT_PENDING);
  }

  // -------------------------------------------------------------------------
  // La persona
  // -------------------------------------------------------------------------

  /** Lo que espera su respuesta, el más reciente arriba. */
  async pendingFor(answerer: LinkAnswerer): Promise<readonly PersonLinkRequest[]> {
    const rows = await this.pendingRows(answerer);
    return rows.map(({ id, gymName, gymSlug, createdAt }) => ({ id, gymName, gymSlug, createdAt }));
  }

  /**
   * Acepta: el gimnasio pasa a su billetera.
   *
   * Con cuenta sin ficha es además el vínculo —lo que antes hacía recepción con
   * el código—, y por eso se comprueba ANTES de marcar nada que ni la cuenta abra
   * ya otra ficha ni la ficha abra con otra cuenta. Desplazar la cuenta de alguien
   * sería quedarse con su historial.
   *
   * Devuelve la identidad, para que quien entró sin ficha reciba su sesión en la
   * misma respuesta en vez de volver a autenticarse.
   */
  async accept(answerer: LinkAnswerer, requestId: string): Promise<{ readonly userId: string }> {
    const request = await this.visibleTo(answerer, requestId);

    if (answerer.kind === 'account') {
      const [mine, ficha] = await Promise.all([
        this.accountLink.findLinkedUser(answerer.uid),
        this.accountOf(request.userId),
      ]);
      if (mine !== null && mine !== request.userId) {
        throw new ConflictException(
          'Tu cuenta ya abre otra ficha de Sinchi. Pídele al gimnasio que te inscriba con el documento de esa ficha.',
        );
      }
      if (ficha !== null && ficha !== answerer.uid) {
        throw new ConflictException('Esa ficha ya abre con otra cuenta. Habla con el gimnasio.');
      }
    }

    await this.decide(request, 'accepted', answerer);

    if (answerer.kind === 'account') {
      await withoutTenantIsolation(this.db, (tx) =>
        tx
          .update(schema.users)
          .set({ firebaseUid: answerer.uid })
          .where(and(eq(schema.users.id, request.userId), isNull(schema.users.firebaseUid))),
      );
      await this.accountLink.consume(answerer.uid, request.userId);
    }

    return { userId: request.userId };
  }

  /** Rechaza: la ficha sigue en el padrón del gimnasio, pero no en su app. */
  async reject(answerer: LinkAnswerer, requestId: string): Promise<void> {
    await this.decide(await this.visibleTo(answerer, requestId), 'rejected', answerer);
  }

  // -------------------------------------------------------------------------
  // Internos
  // -------------------------------------------------------------------------

  private async latestFor(tenantId: string, membershipId: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const [membership] = await tx
        .select({ userId: schema.memberships.userId })
        .from(schema.memberships)
        .where(eq(schema.memberships.id, membershipId))
        .limit(1);
      if (membership === undefined) {
        throw new NotFoundException('Esa membresía no existe en este gimnasio.');
      }

      const [latest] = await tx
        .select({
          id: schema.linkRequests.id,
          status: schema.linkRequests.status,
          firebaseUid: schema.linkRequests.firebaseUid,
          createdAt: schema.linkRequests.createdAt,
          decidedAt: schema.linkRequests.decidedAt,
        })
        .from(schema.linkRequests)
        .where(eq(schema.linkRequests.membershipId, membershipId))
        .orderBy(desc(schema.linkRequests.createdAt))
        .limit(1);

      return { userId: membership.userId, latest: latest ?? null };
    });
  }

  /** La cuenta con la que abre una identidad, o `null`. `users` es global. */
  private async accountOf(userId: string): Promise<string | null> {
    const [row] = await withoutTenantIsolation(this.db, (tx) =>
      tx
        .select({ firebaseUid: schema.users.firebaseUid })
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .limit(1),
    );
    return row?.firebaseUid ?? null;
  }

  private async pendingRows(answerer: LinkAnswerer): Promise<readonly PendingRow[]> {
    if (answerer.kind === 'user') {
      return withUser(this.db, answerer.userId, (tx) =>
        this.pendingWhere(tx, eq(schema.linkRequests.userId, answerer.userId)),
      );
    }

    // Las que van a esta cuenta por nombre propio: el QR que se escaneó.
    const direct = await withTrialAccount(this.db, answerer.uid, (tx) =>
      this.pendingWhere(tx, eq(schema.linkRequests.firebaseUid, answerer.uid)),
    );

    // Y las de fichas sin cuenta cuyo celular o correo es el suyo. Solo las que
    // no apuntan a una cuenta concreta: una solicitud dirigida al QR de otra
    // persona no se abre por compartir el celular.
    const byContact = await Promise.all(
      (await this.fichasMatching(answerer)).map((userId) =>
        withUser(this.db, userId, (tx) =>
          this.pendingWhere(
            tx,
            and(eq(schema.linkRequests.userId, userId), isNull(schema.linkRequests.firebaseUid))!,
          ),
        ),
      ),
    );

    const seen = new Set<string>();
    return [...direct, ...byContact.flat()]
      .filter((row) => (seen.has(row.id) ? false : (seen.add(row.id), true)))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Fichas sin cuenta con el celular o el correo de esta cuenta.
   *
   * El celular es el que la persona dio al registrarse (`account_claims`), y se
   * comparan los dos normalizados: recepción lo teclea con espacios y el
   * formulario de la app no. Tope de cinco por lo mismo que en `identityExists`:
   * varias fichas con el mismo correo no identifican a nadie en particular.
   */
  private async fichasMatching(
    account: Extract<LinkAnswerer, { kind: 'account' }>,
  ): Promise<readonly string[]> {
    const details = await this.accountLink.signUpDetails(account.uid);
    const phone = details?.phone == null ? '' : normalizePhone(details.phone);
    const email = (account.email ?? '').trim().toLowerCase();
    if (phone.length < 6 && email.length === 0) return [];

    const rows = await withoutTenantIsolation(this.db, (tx) =>
      tx
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(
          and(
            isNull(schema.users.firebaseUid),
            or(
              phone.length >= 6
                ? sql`regexp_replace(${schema.users.phone}, '[^0-9+]', '', 'g') = ${phone}`
                : undefined,
              email.length > 0 ? sql`lower(${schema.users.email}) = ${email}` : undefined,
            ),
          ),
        )
        .limit(5),
    );
    return rows.map((row) => row.id);
  }

  private pendingWhere(tx: Tx, condition: SQL): Promise<PendingRow[]> {
    // `tenants` no tiene RLS: es la tabla que dice qué gimnasios existen, y por
    // eso el nombre se lee aquí sin contexto de ningún gimnasio.
    return tx
      .select({
        id: schema.linkRequests.id,
        tenantId: schema.linkRequests.tenantId,
        userId: schema.linkRequests.userId,
        createdAt: schema.linkRequests.createdAt,
        gymName: schema.tenants.name,
        gymSlug: schema.tenants.slug,
      })
      .from(schema.linkRequests)
      .innerJoin(schema.tenants, eq(schema.tenants.id, schema.linkRequests.tenantId))
      .where(and(condition, eq(schema.linkRequests.status, 'pending')))
      .orderBy(desc(schema.linkRequests.createdAt));
  }

  /**
   * La solicitud, si es de quien pregunta y sigue pendiente.
   *
   * Mismo mensaje para «no existe», «no es tuya» y «ya se contestó»: distinguirlos
   * le diría a quien prueba ids si acertó con la solicitud de otra persona.
   */
  private async visibleTo(answerer: LinkAnswerer, requestId: string): Promise<PendingRow> {
    const row = (await this.pendingRows(answerer)).find((candidate) => candidate.id === requestId);
    if (row === undefined) throw new NotFoundException(NOT_PENDING);
    return row;
  }

  private async decide(
    request: PendingRow,
    status: 'accepted' | 'rejected',
    answerer: LinkAnswerer,
  ): Promise<void> {
    const decidedBy =
      answerer.kind === 'account' ? answerer.uid : await this.accountOf(answerer.userId);

    // Con el contexto de la identidad de la ficha: es la puerta de la política
    // que sirve igual a quien ya tiene cuenta y a quien la está estrenando.
    const updated = await withUser(this.db, request.userId, (tx) =>
      tx
        .update(schema.linkRequests)
        .set({ status, decidedAt: new Date(), decidedByFirebaseUid: decidedBy })
        .where(
          and(eq(schema.linkRequests.id, request.id), eq(schema.linkRequests.status, 'pending')),
        )
        .returning({ id: schema.linkRequests.id }),
    );
    if (updated.length === 0) throw new NotFoundException(NOT_PENDING);
  }
}
