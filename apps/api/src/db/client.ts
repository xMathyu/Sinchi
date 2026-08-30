/**
 * Conexión a Postgres (Neon) y contexto de tenant.
 *
 * La regla de oro de este archivo: **ninguna consulta a una tabla del tenant
 * sale de aquí sin contexto**. Las políticas RLS de la migración 0001 fallan
 * cerrado —sin contexto no se ve ninguna fila—, así que olvidarse se nota al
 * instante en vez de convertirse en una fuga entre gimnasios.
 */
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { Pool, type PoolConfig } from 'pg';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;
/** Handle transaccional: es lo que reciben los servicios. */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface PoolOptions {
  /** Conexiones por instancia del proceso. */
  readonly max?: number;
}

export function buildPoolConfig(databaseUrl: string, options: PoolOptions = {}): PoolConfig {
  const url = new URL(databaseUrl);
  const isNeon = url.hostname.endsWith('.neon.tech');

  if (isNeon && !url.hostname.includes('-pooler')) {
    // No es un error: funciona. Pero conviene saberlo antes de que la api
    // agote el límite de conexiones del proyecto en la primera hora de tráfico.
    console.warn(
      `[db] El host "${url.hostname}" no es el pooler de Neon. Para una api que abre ` +
        'conexiones por petición, usa la cadena con "-pooler" en el host.',
    );
  }

  return {
    connectionString: databaseUrl,
    // Neon exige TLS. `sslmode` en la cadena no siempre lo activa en node-postgres,
    // así que se pone explícito y con verificación de certificado.
    ssl: isNeon ? { rejectUnauthorized: true } : undefined,
    // Por INSTANCIA. En Cloud Run el total contra Neon es esto por el numero de
    // instancias vivas, asi que un valor alto aqui agota el limite del proyecto
    // en cuanto la api escala.
    max: options.max ?? 8,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // Neon suspende el compute cuando no hay tráfico; la primera consulta
    // después de una siesta puede tardar. Esto le da margen a la reconexión.
    statement_timeout: 20_000,
  };
}

export function createPool(databaseUrl: string, options: PoolOptions = {}): Pool {
  const pool = new Pool(buildPoolConfig(databaseUrl, options));
  pool.on('error', (error) => {
    // Un cliente ocioso que se cae no debe tumbar el proceso: el pool lo
    // reemplaza. Sin este handler, node lo trata como excepción no capturada.
    console.error('[db] cliente del pool con error:', error.message);
  });
  return pool;
}

export function createDatabase(pool: Pool): Database {
  return drizzle(pool, { schema });
}

// ---------------------------------------------------------------------------
// Contexto
// ---------------------------------------------------------------------------

export interface QueryContext {
  /** Gimnasio de la petición. */
  readonly tenantId?: string;
  /** Identidad global de quien pide. Habilita leer sus propias membresías. */
  readonly userId?: string;
  /**
   * Hash del token que presentó un equipo del mostrador.
   *
   * Habilita una sola cosa: leer la fila de ESE equipo en `checkin_devices`. Al
   * abrir turno todavía no se sabe el gimnasio —se descubre a partir del token—
   * así que hace falta una vía que no exija saberlo antes.
   *
   * Mismo patrón que la excepción de `memberships` y `staff`: puedes leer la fila
   * cuyo secreto tienes en la mano.
   */
  readonly deviceTokenHash?: string;
  readonly inviteTokenHash?: string;
  readonly inviteEmail?: string;
  /**
   * Cuenta de Firebase ya verificada de quien todavia no tiene ficha.
   *
   * Habilita una sola cosa: leer sus propias reservas de clase gratis. Es la
   * misma excepcion que el token de equipo y el de invitacion —puedes leer las
   * filas cuyo secreto presentaste— y aqui hace falta porque quien reserva no
   * tiene gimnasio ni identidad global: si no, no podria volver a ver la clase
   * que reservo.
   */
  readonly trialAccount?: string;
}

/**
 * Corre `run` dentro de una transacción con el contexto fijado.
 *
 * Se usa `set_config(..., true)` en vez de `SET LOCAL` porque acepta parámetros:
 * interpolar un uuid en el texto de un `SET` sería una inyección esperando
 * ocurrir. El `true` final es `is_local`, así que el valor muere con la
 * transacción y no contamina la siguiente petición que reuse la conexión.
 */
export async function withContext<T>(
  db: Database,
  context: QueryContext,
  run: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.current_tenant', ${context.tenantId ?? ''}, true)`,
    );
    await tx.execute(sql`select set_config('app.current_user', ${context.userId ?? ''}, true)`);
    await tx.execute(
      sql`select set_config('app.device_token_hash', ${context.deviceTokenHash ?? ''}, true)`,
    );
    await tx.execute(
      sql`select set_config('app.invite_token_hash', ${context.inviteTokenHash ?? ''}, true)`,
    );
    await tx.execute(
      sql`select set_config('app.invite_email', ${context.inviteEmail ?? ''}, true)`,
    );
    await tx.execute(
      sql`select set_config('app.trial_account', ${context.trialAccount ?? ''}, true)`,
    );
    return run(tx);
  });
}

/** Atajo para lo más común: una operación dentro de un gimnasio. */
export function withTenant<T>(
  db: Database,
  tenantId: string,
  run: (tx: Tx) => Promise<T>,
): Promise<T> {
  return withContext(db, { tenantId }, run);
}

/**
 * Contexto de un equipo del mostrador que se identifica con su token.
 *
 * Solo para el arranque del turno: descubrir a qué gimnasio pertenece el equipo.
 * Todo lo que venga después va con contexto de gimnasio normal.
 */
export function withDeviceToken<T>(
  db: Database,
  tokenHash: string,
  run: (tx: Tx) => Promise<T>,
): Promise<T> {
  return withContext(db, { deviceTokenHash: tokenHash }, run);
}

/**
 * Adopta un gimnasio a mitad de transaccion.
 *
 * Existe para el unico caso donde el tenant no se sabe al abrirla: quien
 * presenta una invitacion. Se entra con el token, se lee a que gimnasio apunta,
 * y a partir de ahi hace falta contexto normal — sin el, las tablas vecinas
 * (`tenants`, `plans`) no devuelven nada y los INSERT fallan su WITH CHECK.
 *
 * `set_config(..., true)` es local a la transaccion, asi que esto no se escapa
 * de aqui: al terminar, el contexto vuelve a estar vacio.
 */
export async function adoptTenant(tx: Tx, tenantId: string): Promise<void> {
  await tx.execute(sql`select set_config('app.current_tenant', ${tenantId}, true)`);
}

/**
 * Contexto de quien presenta una invitacion.
 *
 * Igual que el token de equipo, y por la misma razon: quien abre un enlace de
 * invitacion todavia no tiene gimnasio —es justo lo que el enlace va a decidir—,
 * asi que sin este contexto la consulta que busca la invitacion no veria
 * ninguna fila. Presentar el token abre exactamente esa.
 */
/**
 * Adopta una identidad a mitad de transaccion.
 *
 * Hermano de `adoptTenant`, y para el mismo tipo de caso: al entrar no se sabe
 * quien es la persona hasta haberla buscado, y las tablas con aislamiento no
 * devuelven nada hasta que el contexto esta puesto. Se busca en `users` —que es
 * global— y a partir de ahi se adopta.
 */
export async function adoptUser(tx: Tx, userId: string): Promise<void> {
  await tx.execute(sql`select set_config('app.current_user', ${userId}, true)`);
}

/**
 * Contexto de quien presenta un correo verificado.
 *
 * Mismo caso que el token: al entrar todavia no se sabe a que gimnasio pertenece
 * —puede que a ninguno— asi que la busqueda de invitaciones dirigidas a ese
 * correo necesita su propia puerta en la politica.
 */
export function withInviteEmail<T>(
  db: Database,
  email: string,
  run: (tx: Tx) => Promise<T>,
): Promise<T> {
  return withContext(db, { inviteEmail: email.toLowerCase() }, run);
}

/**
 * Contexto de quien reservo una clase gratis sin tener ficha todavia.
 *
 * Mismo patron que `withInviteEmail`: presentar la cuenta —ya verificada contra
 * Firebase— abre exactamente sus reservas y nada mas.
 */
export function withTrialAccount<T>(
  db: Database,
  firebaseUid: string,
  run: (tx: Tx) => Promise<T>,
): Promise<T> {
  return withContext(db, { trialAccount: firebaseUid }, run);
}

export function withInviteToken<T>(
  db: Database,
  tokenHash: string,
  run: (tx: Tx) => Promise<T>,
): Promise<T> {
  return withContext(db, { inviteTokenHash: tokenHash }, run);
}

/**
 * Contexto de identidad global, sin gimnasio.
 *
 * Sirve para una sola cosa: listar las membresías del alumno en toda la red,
 * que es lo que sostiene la billetera (MD 5). Cualquier otra tabla sigue
 * necesitando contexto de gimnasio.
 */
export function withUser<T>(
  db: Database,
  userId: string,
  run: (tx: Tx) => Promise<T>,
): Promise<T> {
  return withContext(db, { userId }, run);
}

/**
 * Sin contexto de tenant, para las tablas globales (`users`, `webhook_events`)
 * y para el arranque.
 *
 * El nombre es feo a propósito: cada uso debería costar un segundo de duda.
 */
export function withoutTenantIsolation<T>(
  db: Database,
  run: (tx: Tx) => Promise<T>,
): Promise<T> {
  return withContext(db, {}, run);
}

export { schema };
