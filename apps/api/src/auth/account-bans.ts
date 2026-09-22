/**
 * Quién no puede usar Sinchi, consultado en cada puerta.
 *
 * Un baneo tiene que morder en DOS sitios, y los dos son los únicos por los que
 * se entra:
 *
 *   `AuthGuard`          toda petición con sesión de Sinchi (alumno o staff).
 *   `FirebaseVerifier`   todo lo que presenta un token de Google: el login, y las
 *                        rutas públicas del directorio —reservar, escribir a un
 *                        gimnasio, dar de alta un local—. Son dieciocho llamadas
 *                        repartidas por los controladores; comprobarlo en cada
 *                        una serían dieciocho sitios donde olvidarlo.
 *
 * El guard corre en CADA petición de la app, así que no puede costar un viaje a
 * Neon cada vez. Se carga la lista entera de baneos vivos —son pocos: es una
 * medida contra abusos, no un estado normal— y se reusa durante `TTL_MS`. Es
 * una consulta cada medio minuto por instancia, en vez de una por petición.
 *
 * El precio es que un baneo recién puesto tarda hasta `TTL_MS` en llegar a las
 * OTRAS instancias de Cloud Run. La que lo puso se entera al instante
 * (`invalidate`). Medio minuto de gracia para alguien a quien acabamos de
 * banear es un precio que se paga; una consulta extra en cada marca de la
 * puerta, no.
 */
import { ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { isNull, eq, sql } from 'drizzle-orm';
import { InjectDb } from '../db/db.module';
import { schema, withoutTenantIsolation, type Database } from '../db/client';

const TTL_MS = 30_000;

export interface LiveBan {
  readonly id: string;
  readonly reason: string;
}

interface Snapshot {
  readonly byUser: ReadonlyMap<string, LiveBan>;
  readonly byAccount: ReadonlyMap<string, LiveBan>;
  readonly byEmail: ReadonlyMap<string, LiveBan>;
  readonly loadedAt: number;
}

/** Quién pregunta. Cualquiera de las tres llaves basta para reconocerlo. */
export interface BanLookup {
  readonly userId?: string | null;
  readonly firebaseUid?: string | null;
  readonly email?: string | null;
}

@Injectable()
export class AccountBans {
  private readonly logger = new Logger(AccountBans.name);
  private snapshot: Snapshot | null = null;
  /** La carga en curso, para que veinte peticiones a la vez no hagan veinte. */
  private loading: Promise<Snapshot> | null = null;

  constructor(@InjectDb() private readonly db: Database) {}

  /** El baneo vivo de quien pregunta, o `null`. */
  async find(lookup: BanLookup): Promise<LiveBan | null> {
    const snapshot = await this.current();
    return (
      (lookup.userId ? snapshot.byUser.get(lookup.userId) : undefined) ??
      (lookup.firebaseUid ? snapshot.byAccount.get(lookup.firebaseUid) : undefined) ??
      (lookup.email ? snapshot.byEmail.get(lookup.email.toLowerCase()) : undefined) ??
      null
    );
  }

  /**
   * Lanza el 403 si está baneado.
   *
   * Con el motivo, y estructurado como el corte por impago (`saas_read_only`):
   * quien lee esto es una persona delante de una app que no le deja entrar, y
   * «prohibido» a secas no le dice qué pasó ni a quién preguntar.
   */
  async assertNotBanned(lookup: BanLookup): Promise<void> {
    const ban = await this.find(lookup);
    if (ban === null) return;
    throw new ForbiddenException({ code: 'account_banned', message: banMessage(ban) });
  }

  /**
   * Lo mismo para una SESIÓN ya abierta, y con 401 en vez de 403.
   *
   * No es un capricho de códigos: la app suelta la sesión y vuelve al login ante
   * un 401 (`credentials.onUnauthorized`), y ante un 403 no hace nada — la
   * persona baneada se quedaría dentro viendo un error en cada pantalla. Con 401
   * vuelve a la entrada, intenta entrar con Google, y ahí sí recibe el 403 con
   * el motivo. Semánticamente también es lo que pasó: esa credencial dejó de
   * valer.
   */
  async assertSessionNotBanned(userId: string): Promise<void> {
    const ban = await this.find({ userId });
    if (ban === null) return;
    throw new UnauthorizedException({ code: 'account_banned', message: banMessage(ban) });
  }

  /** Lo llama quien banea o levanta un baneo: esta instancia se entera ya. */
  invalidate(): void {
    this.snapshot = null;
  }

  private async current(): Promise<Snapshot> {
    const snapshot = this.snapshot;
    if (snapshot !== null && Date.now() - snapshot.loadedAt < TTL_MS) return snapshot;

    this.loading ??= this.load()
      .then((fresh) => {
        this.snapshot = fresh;
        return fresh;
      })
      .catch((error: unknown) => {
        /**
         * Si la carga falla y había una lista, se sigue usando la vieja.
         *
         * Fallar cerrado aquí —rechazar todo porque no se pudo leer la lista—
         * convertiría un hipo de Neon en que nadie pueda marcar en la puerta de
         * ningún gimnasio. Una lista de hace un minuto es mucho mejor que eso.
         * Sin lista previa sí se propaga: la base no responde, y la petición iba
         * a fallar igual.
         */
        if (snapshot !== null) {
          this.logger.warn(
            `No se pudo refrescar la lista de baneos; se usa la anterior: ${String(error)}`,
          );
          return snapshot;
        }
        throw error;
      })
      .finally(() => {
        this.loading = null;
      });

    return this.loading;
  }

  /**
   * Los baneos vivos, con el uid de Firebase que la ficha tenga HOY.
   *
   * El `join` con `users` es lo que cierra un hueco: a una ficha se la puede
   * banear antes de que su dueño instale la app. Cuando entre por primera vez,
   * su cuenta de Google se vincula a la ficha, y a partir de ahí las rutas que
   * solo miran el token de Google tienen que reconocerla también. El baneo no se
   * reescribe: se resuelve al cargar.
   */
  private async load(): Promise<Snapshot> {
    const rows = await withoutTenantIsolation(this.db, (tx) =>
      tx
        .select({
          id: schema.accountBans.id,
          reason: schema.accountBans.reason,
          userId: schema.accountBans.userId,
          email: schema.accountBans.email,
          // Escrito entero y no con `${schema.accountBans.firebaseUid}`: dentro de
          // una plantilla `sql` Drizzle puede renderizar la columna sin tabla, y
          // con las dos tablas del join teniendo `firebase_uid` eso es ambiguo en
          // el mejor caso — y la columna equivocada en el peor (ver `statsOf`, en
          // el panel de gimnasios, donde se vio devolviendo ceros).
          firebaseUid: sql<string | null>`coalesce(account_bans.firebase_uid, users.firebase_uid)`,
        })
        .from(schema.accountBans)
        .leftJoin(schema.users, eq(schema.users.id, schema.accountBans.userId))
        .where(isNull(schema.accountBans.liftedAt)),
    );

    const byUser = new Map<string, LiveBan>();
    const byAccount = new Map<string, LiveBan>();
    const byEmail = new Map<string, LiveBan>();

    for (const row of rows) {
      const ban = { id: row.id, reason: row.reason };
      if (row.userId !== null) byUser.set(row.userId, ban);
      if (row.firebaseUid !== null) byAccount.set(row.firebaseUid, ban);
      if (row.email !== null) byEmail.set(row.email, ban);
    }

    return { byUser, byAccount, byEmail, loadedAt: Date.now() };
  }
}

function banMessage(ban: LiveBan): string {
  return `Tu cuenta está suspendida en Sinchi: ${ban.reason}. Escríbenos a soporte@sinchi.fit si crees que es un error.`;
}
