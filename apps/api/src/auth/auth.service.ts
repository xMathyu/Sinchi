/**
 * Emisión de sesiones.
 *
 * La autenticación real es Google vía Firebase (`signInWithGoogle`) para alumnos
 * y dueños, y token de equipo más PIN (`openShift`) para el staff del mostrador.
 *
 * Queda además `devLogin`, que:
 *  - solo funciona con `ALLOW_DEV_LOGIN=true`;
 *  - se niega a arrancar con esa bandera en producción (ver `config/env.ts`);
 *  - no verifica NADA: si conoces el celular, entras.
 *
 * Está aislada en un método con ese nombre para que nadie la confunda con
 * autenticación real al leer el código.
 */
import {
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { and, eq } from 'drizzle-orm';
import type { AppRole } from '@sinchi/shared';
import { InjectDb } from '../db/db.module';
import {
  withDeviceToken,
  withTenant,
  withUser,
  withoutTenantIsolation,
  type Database,
} from '../db/client';
import { schema } from '../db/client';
import { loadEnv } from '../config/env';
import type { SessionClaims } from './session';
import { FirebaseVerifier } from './firebase';
import { AccountLinkService, type PendingClaim } from './account-link.service';
import { hashDeviceToken, hashPin, issueDeviceToken, verifyPin } from './secrets';

/**
 * La cuenta de Google es valida pero no esta vinculada a ninguna ficha del
 * padron. No se emite sesion: se devuelve el codigo que la recepcionista
 * confirma en el mostrador.
 */
export interface UnlinkedAccount {
  readonly linked: false;
  readonly claim: PendingClaim;
}

export interface IssuedSession {
  readonly linked: true;
  readonly accessToken: string;
  readonly expiresInSeconds: number;
  readonly role: AppRole;
  readonly userId: string;
  readonly tenantId: string | null;
}

/**
 * Una semana.
 *
 * El alumno abre la app en la puerta del gimnasio, muchas veces sin datos: una
 * sesión corta lo dejaría fuera justo cuando la necesita. El QR es de vida
 * corta y firmado, así que la sesión larga no relaja el control de acceso.
 */
const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Doce horas para la sesion de turno.
 *
 * Cubre el turno mas largo y se muere antes del siguiente, asi que quien entra a
 * las seis de la tarde no hereda la sesion de quien salio a mediodia.
 */
const SHIFT_TTL_SECONDS = 12 * 60 * 60;

/** Intentos antes de bloquear el PIN, y por cuanto tiempo. */
const MAX_PIN_ATTEMPTS = 5;
const PIN_LOCK_MINUTES = 15;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly jwt: JwtService,
    private readonly firebase: FirebaseVerifier,
    private readonly accountLink: AccountLinkService,
  ) {}

  // -------------------------------------------------------------------------
  // Entrar con Google
  // -------------------------------------------------------------------------

  /**
   * Cambia un ID token de Firebase por una sesion de Sinchi.
   *
   * Son dos preguntas distintas y se responden por separado: Firebase certifica
   * QUIEN es el humano, y el token de Sinchi dice QUE puede hacer y en que
   * gimnasio. Por eso el token de Firebase no se usa en el resto de la api —
   * cambiar de proveedor de identidad no deberia tocar la autorizacion.
   *
   * Si la cuenta no esta vinculada a una ficha del padron no se emite sesion: se
   * devuelve un codigo para que la recepcionista lo confirme.
   */
  async signInWithGoogle(idToken: string): Promise<IssuedSession | UnlinkedAccount> {
    const identity = await this.firebase.verify(idToken);

    let userId = await this.accountLink.findLinkedUser(identity.uid);

    // Arranque del dueno: la unica vinculacion automatica, y solo por email
    // verificado que nosotros registramos al dar de alta el gimnasio.
    userId ??= await this.accountLink.tryLinkOwnerByEmail(identity);

    if (userId === null) {
      return { linked: false, claim: await this.accountLink.issueClaim(identity) };
    }

    return this.issueForUser(userId);
  }

  // -------------------------------------------------------------------------
  // Abrir turno en el equipo del mostrador
  // -------------------------------------------------------------------------

  /**
   * Cambia el token del equipo mas un PIN por una sesion de staff.
   *
   * El equipo es compartido y los turnos rotan. Cerrar y abrir sesion de Google
   * en cada cambio termina en "dejemos la de Ana abierta", que es justo el
   * agujero que la auditoria intenta cerrar: `recorded_by` dejaria de decir la
   * verdad sobre quien marco y quien cobro.
   */
  async openShift(input: {
    readonly deviceToken: string;
    readonly staffId: string;
    readonly pin: string;
  }): Promise<IssuedSession> {
    const device = await this.resolveDevice(input.deviceToken);

    // Se lee en una transaccion y se decide fuera. El registro del intento
    // fallido va en OTRA transaccion, y eso no es un detalle de estilo:
    //
    // Antes, incrementar el contador y lanzar la excepcion ocurrian dentro de la
    // misma transaccion, asi que el rollback que provoca la excepcion tambien
    // deshacia el incremento. El contador nunca subia y el bloqueo no existia:
    // se podian probar las diez mil combinaciones de un PIN de cuatro digitos
    // sin que nada lo notara. Y no se veia en el codigo — se veia en el test.
    const member = await withTenant(this.db, device.tenantId, async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.staff)
        .where(eq(schema.staff.id, input.staffId))
        .limit(1);
      return row ?? null;
    });

    if (member === null) {
      throw new UnauthorizedException('Esa persona no trabaja en este gimnasio.');
    }
    if (member.pinHash === null) {
      throw new ForbiddenException(
        `${member.displayName} todavia no tiene PIN. El dueno puede asignarle uno.`,
      );
    }
    if (member.pinLockedUntil !== null && member.pinLockedUntil.getTime() > Date.now()) {
      const minutes = Math.ceil((member.pinLockedUntil.getTime() - Date.now()) / 60_000);
      throw new ForbiddenException(
        `Demasiados intentos. Vuelve a probar en ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}.`,
      );
    }

    if (!verifyPin(input.pin, member.pinHash)) {
      await this.recordFailedPin(device.tenantId, member.id, member.pinFailedAttempts);
      throw new UnauthorizedException('PIN incorrecto.');
    }

    return withTenant(this.db, device.tenantId, async (tx) => {
      await tx
        .update(schema.staff)
        .set({ pinFailedAttempts: 0, pinLockedUntil: null })
        .where(eq(schema.staff.id, member.id));

      await tx
        .update(schema.checkinDevices)
        .set({ lastSeenAt: new Date() })
        .where(eq(schema.checkinDevices.id, device.deviceId));

      const claims: SessionClaims = {
        sub: member.userId,
        role: member.role === 'owner' ? 'owner' : 'front_desk',
        tenantId: member.tenantId,
        staffId: member.id,
      };

      this.logger.log(`${member.displayName} abrio turno en el equipo ${device.deviceId}`);

      return {
        linked: true as const,
        accessToken: await this.jwt.signAsync(claims, { expiresIn: SHIFT_TTL_SECONDS }),
        expiresInSeconds: SHIFT_TTL_SECONDS,
        role: claims.role,
        userId: claims.sub,
        tenantId: member.tenantId,
      };
    });
  }

  /**
   * Registra un intento fallido de PIN, en su propia transaccion.
   *
   * Tiene que confirmarse SI o SI, incluso cuando la peticion termina en error:
   * es el contador que hace que un PIN de cuatro digitos sea aceptable.
   */
  private async recordFailedPin(
    tenantId: string,
    staffId: string,
    previousAttempts: number,
  ): Promise<void> {
    const attempts = previousAttempts + 1;
    const locked = attempts >= MAX_PIN_ATTEMPTS;

    await withTenant(this.db, tenantId, (tx) =>
      tx
        .update(schema.staff)
        .set({
          // Al bloquear se reinicia el contador: la barrera pasa a ser la fecha.
          pinFailedAttempts: locked ? 0 : attempts,
          pinLockedUntil: locked ? new Date(Date.now() + PIN_LOCK_MINUTES * 60_000) : null,
        })
        .where(eq(schema.staff.id, staffId)),
    );

    if (locked) {
      this.logger.warn(
        `PIN bloqueado ${PIN_LOCK_MINUTES} min para el staff ${staffId} tras ` +
          `${MAX_PIN_ATTEMPTS} intentos fallidos.`,
      );
    }
  }

  /** Quienes pueden abrir turno aqui. Alimenta el selector del mostrador. */
  async staffForDevice(deviceToken: string): Promise<
    readonly { readonly id: string; readonly displayName: string; readonly hasPin: boolean }[]
  > {
    const device = await this.resolveDevice(deviceToken);

    return withTenant(this.db, device.tenantId, async (tx) => {
      const rows = await tx
        .select({
          id: schema.staff.id,
          displayName: schema.staff.displayName,
          pinHash: schema.staff.pinHash,
        })
        .from(schema.staff)
        .orderBy(schema.staff.displayName);
      return rows.map((row) => ({
        id: row.id,
        displayName: row.displayName,
        hasPin: row.pinHash !== null,
      }));
    });
  }

  /**
   * Resuelve el equipo a partir de su token.
   *
   * El gimnasio se descubre aqui: al abrir turno todavia no se sabe cual es. Y
   * `checkin_devices` tiene RLS forzado, asi que una consulta sin contexto no ve
   * nada.
   *
   * Se resuelve con la excepcion de la politica (migracion 0003): el contexto
   * lleva el hash del token, y eso habilita leer exactamente esa fila. Es el
   * mismo patron que `memberships` y `staff` — puedes leer la fila cuyo secreto
   * tienes en la mano — y se comporta igual con cualquier rol, a diferencia del
   * `SECURITY DEFINER` que habia antes.
   */
  private async resolveDevice(
    deviceToken: string,
  ): Promise<{ readonly deviceId: string; readonly tenantId: string }> {
    const hash = hashDeviceToken(deviceToken);

    const row = await withDeviceToken(this.db, hash, async (tx) => {
      const [found] = await tx
        .select({
          id: schema.checkinDevices.id,
          tenantId: schema.checkinDevices.tenantId,
        })
        .from(schema.checkinDevices)
        .where(
          and(eq(schema.checkinDevices.tokenHash, hash), eq(schema.checkinDevices.active, true)),
        )
        .limit(1);
      return found ?? null;
    });

    if (row === null) {
      throw new UnauthorizedException('Este equipo no esta registrado o fue revocado.');
    }
    return { deviceId: row.id, tenantId: row.tenantId };
  }

  // -------------------------------------------------------------------------
  // PIN y equipos
  // -------------------------------------------------------------------------

  /** Cada persona fija su propio PIN; el dueno puede fijar el de cualquiera. */
  async setPin(input: {
    readonly tenantId: string;
    readonly targetStaffId: string;
    readonly pin: string;
  }): Promise<void> {
    let hash: string;
    try {
      hash = hashPin(input.pin);
    } catch (error) {
      throw new ForbiddenException(error instanceof Error ? error.message : 'PIN invalido.');
    }

    await withTenant(this.db, input.tenantId, async (tx) => {
      const updated = await tx
        .update(schema.staff)
        .set({
          pinHash: hash,
          pinUpdatedAt: new Date(),
          pinFailedAttempts: 0,
          pinLockedUntil: null,
        })
        .where(eq(schema.staff.id, input.targetStaffId))
        .returning({ id: schema.staff.id });

      if (updated.length === 0) {
        throw new UnauthorizedException('Esa persona no trabaja en este gimnasio.');
      }
    });
  }

  /**
   * Registra un equipo del mostrador y devuelve su token.
   *
   * Se muestra UNA vez: la base guarda solo el hash. Si se pierde, se registra
   * otro y se revoca este — es mas seguro que poder recuperarlo.
   */
  async registerDevice(
    tenantId: string,
    name: string,
  ): Promise<{ readonly deviceId: string; readonly deviceToken: string }> {
    const issued = issueDeviceToken();

    return withTenant(this.db, tenantId, async (tx) => {
      const [device] = await tx
        .insert(schema.checkinDevices)
        .values({
          tenantId,
          name,
          tokenHash: issued.hash,
          tokenIssuedAt: new Date(),
          active: true,
        })
        .returning({ id: schema.checkinDevices.id });

      return { deviceId: device!.id, deviceToken: issued.token };
    });
  }

  /** Revoca un equipo. Borrar el hash corta el acceso al instante. */
  async revokeDevice(tenantId: string, deviceId: string): Promise<void> {
    await withTenant(this.db, tenantId, (tx) =>
      tx
        .update(schema.checkinDevices)
        .set({ active: false, tokenHash: null })
        .where(eq(schema.checkinDevices.id, deviceId)),
    );
  }

  async listDevices(tenantId: string) {
    return withTenant(this.db, tenantId, (tx) =>
      tx
        .select({
          id: schema.checkinDevices.id,
          name: schema.checkinDevices.name,
          active: schema.checkinDevices.active,
          lastSeenAt: schema.checkinDevices.lastSeenAt,
          tokenIssuedAt: schema.checkinDevices.tokenIssuedAt,
        })
        .from(schema.checkinDevices)
        .orderBy(schema.checkinDevices.name),
    );
  }

  // -------------------------------------------------------------------------
  // Emision
  // -------------------------------------------------------------------------

  /** Sesion para una ficha del padron ya vinculada. */
  /**
   * Emite sesion para un usuario ya vinculado.
   *
   * Publica porque la invitacion tambien termina en una sesion: vincula por otro
   * camino, pero lo que emite despues tiene que ser identico — mismo rol, mismo
   * gimnasio, misma caducidad. Duplicar esa logica seria la forma segura de que
   * un dia diverjan.
   */
  issueForLinkedUser(userId: string): Promise<IssuedSession> {
    return this.issueForUser(userId);
  }

  private async issueForUser(userId: string): Promise<IssuedSession> {
    const [staffRow] = await withUser(this.db, userId, (tx) =>
      tx
        .select({
          id: schema.staff.id,
          tenantId: schema.staff.tenantId,
          role: schema.staff.role,
        })
        .from(schema.staff)
        .where(eq(schema.staff.userId, userId))
        .limit(1),
    );

    const claims: SessionClaims =
      staffRow === undefined
        ? { sub: userId, role: 'student' }
        : {
            sub: userId,
            role: staffRow.role === 'owner' ? 'owner' : 'front_desk',
            tenantId: staffRow.tenantId,
            staffId: staffRow.id,
          };

    return {
      linked: true,
      accessToken: await this.jwt.signAsync(claims, { expiresIn: TOKEN_TTL_SECONDS }),
      expiresInSeconds: TOKEN_TTL_SECONDS,
      role: claims.role,
      userId: claims.sub,
      tenantId: claims.tenantId ?? null,
    };
  }

  async devLogin(phone: string): Promise<IssuedSession> {
    if (!loadEnv().ALLOW_DEV_LOGIN) {
      throw new ServiceUnavailableException(
        'El login de desarrollo está desactivado en este servidor. Entra con Google, ' +
          'o apunta la app a una api local con ALLOW_DEV_LOGIN=true.',
      );
    }

    const normalized = phone.trim();

    // Paso 1: la identidad. `users` vive fuera del tenant y no lleva RLS.
    const [user] = await withoutTenantIsolation(this.db, (tx) =>
      tx
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.phone, normalized))
        .limit(1),
    );

    if (user === undefined) {
      throw new UnauthorizedException(`No hay ningún usuario con el celular ${normalized}.`);
    }

    // Paso 2: el rol. Va en una transacción aparte y con contexto de IDENTIDAD,
    // no de gimnasio: el gimnasio es justamente lo que se está averiguando. La
    // política de `staff` permite leer la propia fila (ver migración 0001).
    //
    // Dos llamadas seguidas y no una anidada: anidar `withUser` dentro de otra
    // transacción tomaría una segunda conexión del pool sin necesidad.
    const [staffRow] = await withUser(this.db, user.id, (tx) =>
      tx
        .select({
          id: schema.staff.id,
          tenantId: schema.staff.tenantId,
          role: schema.staff.role,
        })
        .from(schema.staff)
        .where(eq(schema.staff.userId, user.id))
        .limit(1),
    );

    // El mismo binario sirve a los tres roles (MD 4.6) y el rol lo define la
    // sesión, no una preferencia de la persona.
    const claims: SessionClaims =
      staffRow === undefined
        ? { sub: user.id, role: 'student' }
        : {
            sub: user.id,
            role: staffRow.role === 'owner' ? 'owner' : 'front_desk',
            tenantId: staffRow.tenantId,
            staffId: staffRow.id,
          };

    return {
      linked: true,
      accessToken: await this.jwt.signAsync(claims, { expiresIn: TOKEN_TTL_SECONDS }),
      expiresInSeconds: TOKEN_TTL_SECONDS,
      role: claims.role,
      userId: claims.sub,
      tenantId: claims.tenantId ?? null,
    };
  }

  /**
   * Sesión de alumno para una persona que es staff.
   *
   * El dueño de un dojo también entrena en él. Sin esto tendría que cerrar
   * sesión para ver su propia billetera.
   */
  async switchToStudent(userId: string): Promise<IssuedSession> {
    const claims: SessionClaims = { sub: userId, role: 'student' };
    return {
      linked: true,
      accessToken: await this.jwt.signAsync(claims, { expiresIn: TOKEN_TTL_SECONDS }),
      expiresInSeconds: TOKEN_TTL_SECONDS,
      role: 'student',
      userId,
      tenantId: null,
    };
  }
}
