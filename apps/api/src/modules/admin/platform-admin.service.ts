/**
 * Quién administra Sinchi: entrar, invitar, retirar y dejar rastro.
 *
 * Es la puerta del otro lado del producto. Lo que se emite aquí no es una sesión
 * de gimnasio con más permisos: es un token de otra forma (`scope: 'platform'`),
 * que el guard reparte a rutas distintas y que no abre nada del mostrador.
 *
 * Tres reglas sostienen que esto sea seguro, y las tres están aquí:
 *
 *  1. **El correo tiene que venir verificado por Google.** Estar en la tabla no
 *     basta: lo que da acceso es presentar esa dirección con un token que Google
 *     firmó. Sin esto, cualquiera que se registre con `xmathyu@gmail.com` en un
 *     proveedor que no verifica correos entraría al panel.
 *  2. **La fila se relee en CADA petición** (`requireLive`). El token vive doce
 *     horas; retirarle el acceso a alguien tiene que cortar el que ya tiene
 *     abierto, no esperar a que caduque.
 *  3. **Nadie se retira a sí mismo, ni al último.** Las dos reglas viven en
 *     `@sinchi/shared` y las corren el panel y la api: quedarse sin ningún
 *     administrador se arregla escribiendo SQL contra Neon a mano.
 */
import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  ADMIN_NAME_MAX,
  ADMIN_SESSION_HOURS,
  adminInviteDenialMessage,
  adminRevocationDenialMessage,
  checkAdminInvite,
  checkAdminRevocation,
  normalizeAdminEmail,
  type PlatformActionKind,
} from '@sinchi/shared';
import { InjectDb } from '../../db/db.module';
import { schema, withoutTenantIsolation, type Database, type Tx } from '../../db/client';
import { FirebaseVerifier } from '../../auth/firebase';
import type { AdminClaims } from '../../auth/session';

const TOKEN_TTL_SECONDS = ADMIN_SESSION_HOURS * 60 * 60;

export interface AdminSession {
  readonly accessToken: string;
  readonly expiresInSeconds: number;
  readonly adminId: string;
  readonly email: string;
  readonly name: string | null;
}

export interface PlatformAdminView {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
  /** `false` mientras no haya entrado nunca: se invitó y todavía no llegó. */
  readonly hasSignedIn: boolean;
  readonly lastSeenAt: string | null;
  readonly invitedByEmail: string | null;
  readonly revokedAt: string | null;
  readonly createdAt: string;
}

export interface PlatformActionView {
  readonly id: string;
  readonly action: string;
  readonly adminEmail: string;
  readonly tenantId: string | null;
  readonly subject: string | null;
  readonly reason: string | null;
  readonly detail: unknown;
  readonly createdAt: string;
}

/** Lo que se registra. `tx` para que el registro entre en la misma transacción. */
export interface RecordInput {
  readonly adminId: string;
  readonly action: PlatformActionKind;
  readonly tenantId?: string | null;
  readonly subject?: string | null;
  readonly reason?: string | null;
  readonly detail?: unknown;
}

@Injectable()
export class PlatformAdminService {
  private readonly logger = new Logger(PlatformAdminService.name);

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly jwt: JwtService,
    private readonly firebase: FirebaseVerifier,
  ) {}

  // -------------------------------------------------------------------------
  // Entrar
  // -------------------------------------------------------------------------

  /**
   * Cambia un ID token de Firebase por una sesión del panel de Sinchi.
   *
   * El mensaje de rechazo es el MISMO para «este correo no administra Sinchi» y
   * para «no viene verificado», y es deliberado: distinguirlos le confirma a
   * quien prueba direcciones cuál de ellas está en la tabla.
   *
   * Se exige además que la cuenta sea de Google. Es más estricto que el vínculo
   * automático del dueño (`tryLinkOwnerByEmail`), que se conforma con el correo
   * verificado, y la diferencia es lo que hay detrás: allí se abre el panel de
   * un local; aquí se abre el que puede eliminarlos todos. Con una cuenta de
   * correo y contraseña, la segunda llave de ese poder sería una contraseña.
   */
  async signIn(idToken: string): Promise<AdminSession> {
    const identity = await this.firebase.verify(idToken);

    const negado = new UnauthorizedException(
      'Esta cuenta no administra Sinchi. Entra con la cuenta de Google que tiene acceso.',
    );

    if (identity.email === null || !identity.emailVerified) throw negado;
    if (identity.provider !== 'google.com') {
      throw new UnauthorizedException(
        'Al panel de Sinchi se entra con Google, no con correo y contraseña.',
      );
    }

    const email = normalizeAdminEmail(identity.email);

    const admin = await withoutTenantIsolation(this.db, async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.platformAdmins)
        .where(and(eq(schema.platformAdmins.email, email), isNull(schema.platformAdmins.revokedAt)))
        .limit(1);

      if (row === undefined) return undefined;

      /**
       * El uid se aprende al entrar, no al invitar: cuando se invita a alguien
       * todavía no existe. Y si otra cuenta de Google reclama el mismo correo
       * —no debería poder, pero el índice único está por si acaso— el UPDATE
       * choca en vez de mover el acceso en silencio.
       */
      await tx
        .update(schema.platformAdmins)
        .set({
          firebaseUid: identity.uid,
          lastSeenAt: new Date(),
          // El nombre de Google solo rellena el hueco: si alguien lo escribió al
          // invitar, ese manda. El de Google cambia cuando su dueño lo cambia.
          ...(row.name === null && identity.displayName !== null
            ? { name: identity.displayName.slice(0, ADMIN_NAME_MAX) }
            : {}),
        })
        .where(eq(schema.platformAdmins.id, row.id));

      return row;
    });

    if (admin === undefined) {
      this.logger.warn(`Intento de entrar al panel de Sinchi con ${email}`);
      throw negado;
    }

    const claims: AdminClaims = { sub: admin.id, email, scope: 'platform' };
    this.logger.log(`Panel de Sinchi: entró ${email}`);

    return {
      accessToken: await this.jwt.signAsync(claims, { expiresIn: TOKEN_TTL_SECONDS }),
      expiresInSeconds: TOKEN_TTL_SECONDS,
      adminId: admin.id,
      email,
      name: admin.name,
    };
  }

  /**
   * El administrador de esta petición, releído de la base.
   *
   * Lo llama `PlatformAdminGuard` en cada ruta del panel. Es una consulta por
   * petición y es el precio de que retirar un acceso surta efecto AHORA: un
   * token de doce horas en manos de quien ya no debería tenerlo es medio día de
   * poder sobre la red entera.
   */
  async requireLive(adminId: string): Promise<{ readonly id: string; readonly email: string }> {
    const [row] = await withoutTenantIsolation(this.db, (tx) =>
      tx
        .select({ id: schema.platformAdmins.id, email: schema.platformAdmins.email })
        .from(schema.platformAdmins)
        .where(
          and(eq(schema.platformAdmins.id, adminId), isNull(schema.platformAdmins.revokedAt)),
        )
        .limit(1),
    );

    if (row === undefined) {
      throw new UnauthorizedException('Tu acceso al panel de Sinchi ya no está vigente.');
    }
    return row;
  }

  // -------------------------------------------------------------------------
  // El equipo
  // -------------------------------------------------------------------------

  /** Todos, incluidos los retirados: el panel los enseña apagados. */
  async list(): Promise<readonly PlatformAdminView[]> {
    const rows = await withoutTenantIsolation(this.db, (tx) =>
      tx
        .select({
          id: schema.platformAdmins.id,
          email: schema.platformAdmins.email,
          name: schema.platformAdmins.name,
          firebaseUid: schema.platformAdmins.firebaseUid,
          lastSeenAt: schema.platformAdmins.lastSeenAt,
          revokedAt: schema.platformAdmins.revokedAt,
          createdAt: schema.platformAdmins.createdAt,
          /**
           * Quién lo invitó, por correo.
           *
           * Subconsulta y no un `leftJoin` sobre la misma tabla: unirla consigo
           * misma obliga a un alias, y con alias Drizzle deja de poder escribir
           * `schema.platformAdmins.x` en el resto del select.
           *
           * La columna correlacionada va escrita ENTERA (`platform_admins.invited_by`)
           * y no como `${schema.platformAdmins.invitedBy}`: dentro de una plantilla
           * `sql`, Drizzle la renderiza como `"invited_by"` sin calificar, y ahí
           * dentro eso resuelve al `invited_by` del alias interno. No falla:
           * devuelve null siempre.
           */
          invitedByEmail: sql<string | null>`
            (select inviter.email from platform_admins inviter
              where inviter.id = platform_admins.invited_by)
          `.as('invited_by_email'),
        })
        .from(schema.platformAdmins)
        .orderBy(schema.platformAdmins.createdAt),
    );

    return rows.map((row) => ({
      id: row.id,
      email: row.email,
      name: row.name,
      hasSignedIn: row.firebaseUid !== null,
      lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
      invitedByEmail: row.invitedByEmail,
      revokedAt: row.revokedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  /**
   * Da acceso a un correo.
   *
   * No crea ninguna cuenta: crea el PERMISO. Quien lo recibe entra con su Google
   * de siempre, y hasta que entre, la fila está ahí con `firebaseUid` en `null`
   * — que es lo que el panel enseña como «invitado, todavía no entró».
   *
   * Invitar a alguien a quien se le retiró el acceso REABRE su fila. Así se
   * conserva quién lo invitó la primera vez y el registro no queda apuntando a
   * una fila muerta mientras otra viva tiene el mismo correo.
   */
  async invite(
    actingAdminId: string,
    input: { readonly email: string; readonly name?: string | null },
  ): Promise<PlatformAdminView> {
    const email = normalizeAdminEmail(input.email);

    const id = await withoutTenantIsolation(this.db, async (tx) => {
      const current = await tx
        .select({ email: schema.platformAdmins.email })
        .from(schema.platformAdmins)
        .where(isNull(schema.platformAdmins.revokedAt));

      const denial = checkAdminInvite({ email, current: current.map((row) => row.email) });
      if (denial !== null) throw new ForbiddenException(adminInviteDenialMessage(denial));

      const name = input.name?.trim().slice(0, ADMIN_NAME_MAX);

      const [row] = await tx
        .insert(schema.platformAdmins)
        .values({
          email,
          name: name !== undefined && name.length > 0 ? name : null,
          invitedBy: actingAdminId,
        })
        .onConflictDoUpdate({
          target: schema.platformAdmins.email,
          set: {
            revokedAt: null,
            invitedBy: actingAdminId,
            ...(name !== undefined && name.length > 0 ? { name } : {}),
          },
        })
        .returning({ id: schema.platformAdmins.id });

      await this.record(tx, {
        adminId: actingAdminId,
        action: 'admin.invite',
        subject: email,
      });

      return row!.id;
    });

    this.logger.log(`Panel de Sinchi: acceso dado a ${email}`);
    return (await this.list()).find((admin) => admin.id === id)!;
  }

  /** Retira el acceso. No borra la fila: es el rastro de que lo tuvo. */
  async revoke(actingAdminId: string, adminId: string): Promise<void> {
    await withoutTenantIsolation(this.db, async (tx) => {
      const live = await tx
        .select({ id: schema.platformAdmins.id, email: schema.platformAdmins.email })
        .from(schema.platformAdmins)
        .where(isNull(schema.platformAdmins.revokedAt));

      const target = live.find((row) => row.id === adminId);
      if (target === undefined) throw new NotFoundException('Ese administrador ya no tiene acceso.');

      const denial = checkAdminRevocation({
        adminId,
        actingAdminId,
        liveCount: live.length,
      });
      if (denial !== null) throw new ForbiddenException(adminRevocationDenialMessage(denial));

      await tx
        .update(schema.platformAdmins)
        .set({ revokedAt: new Date() })
        .where(eq(schema.platformAdmins.id, adminId));

      await this.record(tx, {
        adminId: actingAdminId,
        action: 'admin.revoke',
        subject: target.email,
      });

      this.logger.log(`Panel de Sinchi: acceso retirado a ${target.email}`);
    });
  }

  // -------------------------------------------------------------------------
  // El registro
  // -------------------------------------------------------------------------

  /**
   * Anota lo que se hizo.
   *
   * Recibe el `tx` a propósito: va en la MISMA transacción que el cambio que
   * describe. Con una transacción aparte, un fallo entre las dos deja un
   * gimnasio suspendido sin nadie que lo haya suspendido, o al revés — y el
   * registro deja de valer justo cuando hace falta.
   */
  async record(tx: Tx, input: RecordInput): Promise<void> {
    await tx.insert(schema.platformActions).values({
      adminId: input.adminId,
      action: input.action,
      tenantId: input.tenantId ?? null,
      subject: input.subject ?? null,
      reason: input.reason ?? null,
      detail: input.detail ?? null,
    });
  }

  /** Lo último que se hizo en el panel, de lo más nuevo a lo más viejo. */
  async actions(limit = 50, tenantId?: string): Promise<readonly PlatformActionView[]> {
    const rows = await withoutTenantIsolation(this.db, (tx) =>
      tx
        .select({
          id: schema.platformActions.id,
          action: schema.platformActions.action,
          adminEmail: schema.platformAdmins.email,
          tenantId: schema.platformActions.tenantId,
          subject: schema.platformActions.subject,
          reason: schema.platformActions.reason,
          detail: schema.platformActions.detail,
          createdAt: schema.platformActions.createdAt,
        })
        .from(schema.platformActions)
        .innerJoin(
          schema.platformAdmins,
          eq(schema.platformAdmins.id, schema.platformActions.adminId),
        )
        .where(
          tenantId === undefined ? undefined : eq(schema.platformActions.tenantId, tenantId),
        )
        .orderBy(desc(schema.platformActions.createdAt))
        .limit(Math.min(Math.max(limit, 1), 200)),
    );

    return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
  }
}
