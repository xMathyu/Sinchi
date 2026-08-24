/**
 * Vinculación de una cuenta de Google con una ficha del padrón.
 *
 * El problema, otra vez, porque es el corazón de este archivo: la ficha existe
 * antes que la cuenta. La recepcionista escribe nombre, DNI y celular en el
 * mostrador, y el alumno instala la app después. Google devuelve un uid y un
 * email que no están en esa ficha, así que hay que unirlos, y unirlos MAL
 * significa darle a alguien el historial de pagos y el QR de otro.
 *
 * La única forma sin agujeros es que lo confirme quien tiene a la persona
 * enfrente. El alumno entra con Google, su app muestra 6 dígitos, y recepción
 * los escribe junto a su nombre.
 *
 * Hay UNA excepción, para el dueño en el arranque, y está justificada abajo.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import { InjectDb } from '../db/db.module';
import {
  schema,
  withTenant,
  withoutTenantIsolation,
  type Database,
  type Tx,
} from '../db/client';
import { generateClaimCode } from './secrets';
import type { VerifiedIdentity } from './firebase';

/**
 * Diez minutos.
 *
 * Es el tiempo que tarda una persona en mostrar la pantalla al mostrador. Más
 * largo deja códigos vivos por ahí; más corto obliga a repetir el login cuando
 * hay cola.
 */
const CLAIM_TTL_MINUTES = 10;

export interface PendingClaim {
  readonly code: string;
  readonly expiresAt: Date;
  readonly email: string | null;
  readonly displayName: string | null;
}

export interface ClaimSummary {
  readonly id: string;
  readonly code: string;
  readonly email: string | null;
  readonly displayName: string | null;
  readonly expiresAt: Date;
}

@Injectable()
export class AccountLinkService {
  private readonly logger = new Logger(AccountLinkService.name);

  constructor(@InjectDb() private readonly db: Database) {}

  /**
   * Busca la ficha del padrón que ya tiene esta cuenta vinculada.
   *
   * `users` no lleva RLS: la identidad es global (MD 5).
   */
  async findLinkedUser(firebaseUid: string): Promise<string | null> {
    const [row] = await withoutTenantIsolation(this.db, (tx) =>
      tx
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.firebaseUid, firebaseUid))
        .limit(1),
    );
    return row?.id ?? null;
  }

  /**
   * Vinculación automática del dueño en el arranque.
   *
   * Aquí SÍ se empareja por email, y eso parece contradecir el rechazo de arriba.
   * No lo es, porque las dos objeciones al email desaparecen en este caso
   * concreto:
   *
   *  · **"la recepcionista lo escribe con prisa y se equivoca"** — el email del
   *    dueño lo registramos nosotros al dar de alta el gimnasio, en la reunión de
   *    venta, no una persona apurada en un mostrador.
   *
   *  · **"el alumno no tiene email"** — el dueño sí, y es con el que va a
   *    administrar su negocio.
   *
   * Y el vínculo es fuerte de verdad: Google certifica que quien entra controla
   * ese buzón (`email_verified`), y el buzón lo pusimos nosotros. Nadie puede
   * reclamarlo sin acceso a esa cuenta.
   *
   * Existe porque si no, el arranque es circular: el dueño necesitaría que
   * alguien con autoridad confirme su código, y todavía no hay nadie.
   *
   * Se limita a `owner` a propósito. Recepción se vincula con código, como todos.
   */
  async tryLinkOwnerByEmail(identity: VerifiedIdentity): Promise<string | null> {
    if (identity.email === null || !identity.emailVerified) return null;

    return withoutTenantIsolation(this.db, async (tx) => {
      const [candidate] = await tx
        .select({ userId: schema.users.id, staffId: schema.staff.id })
        .from(schema.users)
        .innerJoin(schema.staff, eq(schema.staff.userId, schema.users.id))
        .where(
          and(
            eq(sql`lower(${schema.users.email})`, identity.email as string),
            isNull(schema.users.firebaseUid),
            eq(schema.staff.role, 'owner'),
          ),
        )
        .limit(1);

      if (candidate === undefined) return null;

      await tx
        .update(schema.users)
        .set({ firebaseUid: identity.uid })
        .where(eq(schema.users.id, candidate.userId));

      this.logger.log(
        `Dueño vinculado automáticamente por email verificado: ${identity.email}`,
      );
      return candidate.userId;
    });
  }

  /**
   * Emite (o reutiliza) el código que el alumno le muestra al mostrador.
   *
   * Reutilizar el vigente en vez de emitir uno nuevo en cada login es
   * deliberado: si el alumno cierra y abre la app mientras espera en la cola, el
   * número que tiene en la mano tiene que seguir sirviendo.
   */
  async issueClaim(identity: VerifiedIdentity): Promise<PendingClaim> {
    return withoutTenantIsolation(this.db, async (tx) => {
      await this.purgeExpired(tx);

      const [existing] = await tx
        .select({
          code: schema.accountClaims.code,
          expiresAt: schema.accountClaims.expiresAt,
        })
        .from(schema.accountClaims)
        .where(
          and(
            eq(schema.accountClaims.firebaseUid, identity.uid),
            isNull(schema.accountClaims.consumedAt),
          ),
        )
        .limit(1);

      if (existing !== undefined) {
        return {
          code: existing.code,
          expiresAt: existing.expiresAt,
          email: identity.email,
          displayName: identity.displayName,
        };
      }

      const expiresAt = new Date(Date.now() + CLAIM_TTL_MINUTES * 60_000);

      // Reintenta por si el código sorteado choca con uno vivo. Con un millón de
      // combinaciones y un puñado de códigos activos, la colisión es rarísima,
      // pero el índice único la haría fallar y no vale la pena que el alumno vea
      // un error por eso.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const code = generateClaimCode();
        const [inserted] = await tx
          .insert(schema.accountClaims)
          .values({
            firebaseUid: identity.uid,
            email: identity.email,
            displayName: identity.displayName,
            code,
            expiresAt,
          })
          .onConflictDoNothing()
          .returning({ code: schema.accountClaims.code });

        if (inserted !== undefined) {
          return {
            code: inserted.code,
            expiresAt,
            email: identity.email,
            displayName: identity.displayName,
          };
        }
      }

      throw new ConflictException(
        'No se pudo generar un código de vinculación. Intenta de nuevo.',
      );
    });
  }

  /** Códigos vigentes, para que recepción los vea sin que se los dicten. */
  async listPending(): Promise<readonly ClaimSummary[]> {
    return withoutTenantIsolation(this.db, async (tx) => {
      await this.purgeExpired(tx);
      const rows = await tx
        .select({
          id: schema.accountClaims.id,
          code: schema.accountClaims.code,
          email: schema.accountClaims.email,
          displayName: schema.accountClaims.displayName,
          expiresAt: schema.accountClaims.expiresAt,
        })
        .from(schema.accountClaims)
        .where(isNull(schema.accountClaims.consumedAt))
        .orderBy(schema.accountClaims.createdAt)
        .limit(20);
      return rows;
    });
  }

  /**
   * Confirma el código contra una membresía del gimnasio del staff.
   *
   * Dos comprobaciones importan:
   *
   *  · la membresía se busca CON contexto de tenant, así que RLS garantiza que
   *    un recepcionista solo pueda vincular contra su propio padrón, por más que
   *    el código sea de alguien de otro local;
   *
   *  · si esa ficha ya tiene otra cuenta vinculada, se rechaza. Sin eso, alguien
   *    podría desplazar la cuenta de un alumno y quedarse con su historial.
   */
  async confirmClaim(input: {
    readonly tenantId: string;
    readonly staffId: string;
    readonly code: string;
    readonly membershipId: string;
  }): Promise<{ readonly userId: string; readonly displayName: string | null }> {
    // La membresía primero, con aislamiento: es la comprobación de autoridad.
    const target = await withTenant(this.db, input.tenantId, async (tx) => {
      const [row] = await tx
        .select({
          userId: schema.memberships.userId,
          userName: schema.users.name,
          firebaseUid: schema.users.firebaseUid,
        })
        .from(schema.memberships)
        .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
        .where(eq(schema.memberships.id, input.membershipId))
        .limit(1);
      return row ?? null;
    });

    if (target === null) {
      throw new NotFoundException('Esa membresía no existe en este gimnasio.');
    }

    return withoutTenantIsolation(this.db, async (tx) => {
      const [claim] = await tx
        .select()
        .from(schema.accountClaims)
        .where(
          and(
            eq(schema.accountClaims.code, input.code),
            isNull(schema.accountClaims.consumedAt),
          ),
        )
        .limit(1);

      if (claim === undefined) {
        throw new NotFoundException(
          'Ese código no existe o ya se usó. Pídele al alumno que vuelva a entrar en la app.',
        );
      }
      if (claim.expiresAt.getTime() < Date.now()) {
        throw new BadRequestException(
          'Ese código ya venció. Pídele al alumno que vuelva a entrar en la app.',
        );
      }

      if (target.firebaseUid !== null && target.firebaseUid !== claim.firebaseUid) {
        throw new ConflictException(
          `${target.userName} ya tiene una cuenta vinculada. Un dueño puede desvincularla ` +
            'antes de asociar otra.',
        );
      }

      await tx
        .update(schema.users)
        .set({ firebaseUid: claim.firebaseUid })
        .where(eq(schema.users.id, target.userId));

      await tx
        .update(schema.accountClaims)
        .set({
          consumedAt: new Date(),
          consumedBy: input.staffId,
          linkedUserId: target.userId,
        })
        .where(eq(schema.accountClaims.id, claim.id));

      this.logger.log(
        `Cuenta ${claim.email ?? claim.firebaseUid} vinculada a ${target.userName} ` +
          `por el staff ${input.staffId}`,
      );

      return { userId: target.userId, displayName: claim.displayName };
    });
  }

  /**
   * Desvincula. Solo el dueño.
   *
   * Existe porque el vínculo lo hace una persona y las personas se equivocan: si
   * recepción asocia la cuenta de Diego a la ficha de Julio, tiene que haber
   * forma de deshacerlo sin tocar la base a mano.
   */
  async unlink(tenantId: string, membershipId: string): Promise<void> {
    const userId = await withTenant(this.db, tenantId, async (tx) => {
      const [row] = await tx
        .select({ userId: schema.memberships.userId })
        .from(schema.memberships)
        .where(eq(schema.memberships.id, membershipId))
        .limit(1);
      return row?.userId ?? null;
    });

    if (userId === null) {
      throw new NotFoundException('Esa membresía no existe en este gimnasio.');
    }

    await withoutTenantIsolation(this.db, (tx) =>
      tx.update(schema.users).set({ firebaseUid: null }).where(eq(schema.users.id, userId)),
    );
  }

  /**
   * Borra los códigos vencidos sin consumir.
   *
   * No es solo higiene: el espacio es de un millón de combinaciones y el índice
   * único solo aplica a los vivos, así que dejar basura ahí sube la probabilidad
   * de colisión al emitir. Los consumidos se conservan — son el rastro de quién
   * vinculó qué cuenta y cuándo.
   */
  private async purgeExpired(tx: Tx): Promise<void> {
    await tx
      .delete(schema.accountClaims)
      .where(
        and(
          isNull(schema.accountClaims.consumedAt),
          lt(schema.accountClaims.expiresAt, new Date()),
        ),
      );
  }
}
