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
