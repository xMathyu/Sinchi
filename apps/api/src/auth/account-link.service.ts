/**
 * La cuenta de Firebase de quien todavía no abre ninguna ficha del padrón.
 *
 * El problema de fondo no cambió: la ficha existe antes que la cuenta. La
 * recepcionista escribe nombre, DNI y celular en el mostrador, la persona
 * instala la app después, y Firebase devuelve un uid y un correo que no están en
 * esa ficha. Unirlos MAL es darle a alguien el historial de pagos y el QR de otro.
 *
 * Lo que cambió es QUIÉN los une. Hasta la migración 0023 lo confirmaba
 * recepción con un código de 6 dígitos que la persona dictaba; ahora el gimnasio
 * deja una solicitud y la persona la acepta en su app (`LinkRequestsService`).
 * Aquí queda lo que la api sabe de esa cuenta mientras tanto —su nombre, su
 * celular y el QR con el que se deja inscribir— y la única vinculación
 * automática: el dueño en el arranque, justificada abajo.
 */
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { InjectDb } from '../db/db.module';
import { adoptUser, schema, withTenant, withoutTenantIsolation, type Database } from '../db/client';
import { generateAccountQrToken, generateClaimCode } from './secrets';
import type { VerifiedIdentity } from './firebase';

/**
 * Diez minutos: lo que vale el QR de la cuenta.
 *
 * Quien lo muestra en el mostrador lo tiene abierto delante, y la app lo renueva
 * sola al vencer. Uno que valiera horas sería una captura en un chat que
 * cualquier recepción podría canjear por el nombre y el celular de esa persona.
 */
const CLAIM_TTL_MINUTES = 10;

export interface PendingClaim {
  /** 6 dígitos. Solo lo leen las apps anteriores a la 0023: ya no se confirma. */
  readonly code: string;
  /** Lo que va en el QR de la cuenta: `SINCHI1:a:<qrToken>`. */
  readonly qrToken: string;
  readonly expiresAt: Date;
  readonly email: string | null;
  readonly displayName: string | null;
  /** Lo dio al crear la cuenta. Es con lo que reserva y con lo que la encuentran. */
  readonly phone: string | null;
}

/**
 * Lo que la persona escribio al crear su cuenta.
 *
 * Va aparte de `VerifiedIdentity` a proposito: eso es lo que CERTIFICA Google
 * —quien controla ese buzon— y esto es lo que la persona dice de si misma. No
 * autentica nada; solo evita volver a preguntarselo al reservar.
 */
export interface SignUpDetails {
  readonly fullName?: string | undefined;
  readonly phone?: string | undefined;
}

/** Lo que recepción recibe al escanear el QR de una cuenta. */
export interface AccountPreview {
  readonly firebaseUid: string;
  readonly displayName: string | null;
  readonly phone: string | null;
  readonly email: string | null;
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
   * Aquí SÍ se empareja por email sin preguntarle a nadie, y es la excepción a
   * la regla de las solicitudes. Las objeciones al email desaparecen en este caso
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
   * Existe porque si no, el arranque es circular: el dueño tendría que aceptar
   * una solicitud de un gimnasio que todavía no tiene a nadie que la mande.
   *
   * Se limita a `owner` a propósito. Recepción acepta su solicitud, como todos.
   */
  async tryLinkOwnerByEmail(identity: VerifiedIdentity): Promise<string | null> {
    if (identity.email === null || !identity.emailVerified) return null;

    return withoutTenantIsolation(this.db, async (tx) => {
      // Dos pasos, y no un JOIN, por RLS. `staff` tiene FORCE ROW LEVEL
      // SECURITY y sin contexto no devuelve NINGUNA fila, asi que la version
      // con JOIN nunca encontraba al dueno: el metodo entero era codigo muerto
      // en produccion —fallaba en silencio devolviendo el codigo de 6 digitos—
      // y solo se veia probandolo con un rol sujeto a RLS.
      //
      // `users` si es global —una identidad no pertenece a ningun gimnasio—,
      // asi que se busca ahi primero y despues se adopta esa identidad. Eso
      // abre su fila de `staff` por la excepcion que la politica ya tiene
      // (`user_id = app_current_user()`), sin inventar una puerta nueva.
      const [candidate] = await tx
        .select({ userId: schema.users.id })
        .from(schema.users)
        .where(
          and(
            eq(sql`lower(${schema.users.email})`, identity.email as string),
            isNull(schema.users.firebaseUid),
          ),
        )
        .limit(1);

      if (candidate === undefined) return null;

      await adoptUser(tx, candidate.userId);

      // El auto-vinculo es SOLO para duenos. Su correo lo pusimos nosotros; el de
      // recepcion lo escribe otra persona, y sin esta restriccion un typo
      // entregaria el mostrador entero.
      const [owner] = await tx
        .select({ id: schema.staff.id })
        .from(schema.staff)
        .where(and(eq(schema.staff.userId, candidate.userId), eq(schema.staff.role, 'owner')))
        .limit(1);

      if (owner === undefined) return null;

      await tx
        .update(schema.users)
        .set({ firebaseUid: identity.uid })
        .where(eq(schema.users.id, candidate.userId));

      this.logger.log(`Dueño vinculado automáticamente por email verificado: ${identity.email}`);
      return candidate.userId;
    });
  }

  /**
   * La fila de la cuenta sin ficha, con su QR vigente.
   *
   * UNA fila por cuenta, que se renueva al vencer en vez de borrarse y nacer
   * otra. Mientras el código de 6 dígitos tuvo índice único, los vencidos se
   * borraban para no chocar, y con ellos se iban el nombre y el celular de quien
   * se registró hace más de diez minutos — que ahora hacen falta para encontrar
   * las solicitudes que le dejaron por su celular.
   *
   * El QR se reutiliza mientras está vivo: quien cierra y abre la app en la cola
   * del mostrador sigue mostrando el mismo.
   */
  async issueClaim(
    identity: VerifiedIdentity,
    details: SignUpDetails = {},
  ): Promise<PendingClaim> {
    const writtenName = details.fullName?.trim();
    const writtenPhone = details.phone?.trim();
    const name = writtenName !== undefined && writtenName.length > 0 ? writtenName : null;
    const phone = writtenPhone !== undefined && writtenPhone.length > 0 ? writtenPhone : null;

    return withoutTenantIsolation(this.db, async (tx) => {
      const [existing] = await tx
        .select()
        .from(schema.accountClaims)
        .where(
          and(
            eq(schema.accountClaims.firebaseUid, identity.uid),
            isNull(schema.accountClaims.consumedAt),
          ),
        )
        .orderBy(desc(schema.accountClaims.createdAt))
        .limit(1);

      const renewedUntil = new Date(Date.now() + CLAIM_TTL_MINUTES * 60_000);

      if (existing === undefined) {
        const fresh = {
          code: generateClaimCode(),
          qrToken: generateAccountQrToken(),
          expiresAt: renewedUntil,
          // El nombre que escribio manda sobre el de Google: es como quiere que lo
          // llamen, y con correo y contrasena Google no da ninguno.
          displayName: name ?? identity.displayName,
          phone,
        };
        await tx
          .insert(schema.accountClaims)
          .values({ firebaseUid: identity.uid, email: identity.email, ...fresh });
        return { ...fresh, email: identity.email };
      }

      // Si esta vez llegan datos y la fila no los tenia, se completan: quien entro
      // con Google y luego escribio su celular no deberia tener que repetirlo.
      const expired = existing.qrToken === null || existing.expiresAt.getTime() <= Date.now();
      const current = {
        code: expired ? generateClaimCode() : existing.code,
        qrToken: expired ? generateAccountQrToken() : (existing.qrToken as string),
        expiresAt: expired ? renewedUntil : existing.expiresAt,
        displayName: name ?? existing.displayName,
        phone: phone ?? existing.phone,
      };

      if (
        expired ||
        current.displayName !== existing.displayName ||
        current.phone !== existing.phone ||
        (identity.email !== null && identity.email !== existing.email)
      ) {
        await tx
          .update(schema.accountClaims)
          .set({ ...current, email: identity.email ?? existing.email })
          .where(eq(schema.accountClaims.id, existing.id));
      }

      return { ...current, email: identity.email ?? existing.email };
    });
  }

  /**
   * Lo que se lleva recepción al escanear el QR de una cuenta.
   *
   * Nombre, celular y correo, para no teclearlos. Entregarlos no es una fuga: la
   * persona los está mostrando en su teléfono, delante del mostrador, justo
   * para eso. Lo que no pasa por aquí es el documento — ese se lee del carné.
   */
  async previewByQrToken(qrToken: string): Promise<AccountPreview> {
    const [row] = await withoutTenantIsolation(this.db, (tx) =>
      tx
        .select({
          firebaseUid: schema.accountClaims.firebaseUid,
          displayName: schema.accountClaims.displayName,
          phone: schema.accountClaims.phone,
          email: schema.accountClaims.email,
          expiresAt: schema.accountClaims.expiresAt,
        })
        .from(schema.accountClaims)
        .where(
          and(
            eq(schema.accountClaims.qrToken, qrToken),
            isNull(schema.accountClaims.consumedAt),
          ),
        )
        .limit(1),
    );

    if (row === undefined || row.expiresAt.getTime() <= Date.now()) {
      throw new NotFoundException('Ese QR ya venció. Pídele que lo vuelva a abrir en su app.');
    }

    return {
      firebaseUid: row.firebaseUid,
      displayName: row.displayName,
      phone: row.phone,
      email: row.email,
    };
  }

  /**
   * Lo que la persona dijo de si misma al registrarse.
   *
   * Lo usan la reserva y el chat para no volver a preguntarle el nombre y el
   * celular a quien acaba de escribirlos, y las solicitudes para encontrar las
   * que le dejaron por su celular. `account_claims` no lleva RLS —una cuenta sin
   * ficha no pertenece a ningun gimnasio— y la busqueda es por el uid que
   * Firebase ya verifico.
   */
  async signUpDetails(
    firebaseUid: string,
  ): Promise<{ readonly fullName: string | null; readonly phone: string | null } | null> {
    return withoutTenantIsolation(this.db, async (tx) => {
      const [row] = await tx
        .select({
          fullName: schema.accountClaims.displayName,
          phone: schema.accountClaims.phone,
        })
        .from(schema.accountClaims)
        .where(
          and(
            eq(schema.accountClaims.firebaseUid, firebaseUid),
            isNull(schema.accountClaims.consumedAt),
          ),
        )
        .orderBy(desc(schema.accountClaims.createdAt))
        .limit(1);
      return row ?? null;
    });
  }

  /**
   * La cuenta ya abre una ficha: su fila queda cerrada, con a cuál llegó.
   *
   * Se conserva, no se borra. Es el rastro de qué cuenta terminó en qué ficha, que
   * es lo que el dueño necesita el día que alguien diga «esa no soy yo».
   */
  async consume(firebaseUid: string, userId: string): Promise<void> {
    await withoutTenantIsolation(this.db, (tx) =>
      tx
        .update(schema.accountClaims)
        .set({ consumedAt: new Date(), linkedUserId: userId })
        .where(
          and(
            eq(schema.accountClaims.firebaseUid, firebaseUid),
            isNull(schema.accountClaims.consumedAt),
          ),
        ),
    );
  }

  /**
   * Desvincula. Solo el dueño.
   *
   * Existe porque el vínculo lo acepta una persona sobre datos que no se
   * verifican: si alguien se registró con el celular de otra y aceptó su
   * solicitud, tiene que haber forma de deshacerlo sin tocar la base a mano.
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
}
