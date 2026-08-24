/**
 * Runner de migraciones.
 *
 * Se corre a mano (`npm run db:migrate`), no al arrancar la api: dos instancias
 * levantando a la vez y migrando en paralelo es una forma conocida de corromper
 * un esquema.
 */
import 'dotenv/config';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import { createDatabase, createPool } from './client';
import { loadEnv } from '../config/env';

async function main(): Promise<void> {
  const env = loadEnv();
  // Las migraciones van con el rol dueño del esquema, no con el de la api: la
  // api no tiene permisos de DDL a propósito.
  const url = env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL;
  const pool = createPool(url);
  const db = createDatabase(pool);

  const target = new URL(url);
  console.log(`[migrate] base: ${target.hostname}${target.pathname}`);

  try {
    const [{ version }] = (
      await db.execute<{ version: string }>(sql`select version()`)
    ).rows as [{ version: string }];
    console.log(`[migrate] ${version.split(',')[0]}`);

    const [{ role, bypassrls }] = (
      await db.execute<{ role: string; bypassrls: boolean }>(
        sql`select current_user as role, rolbypassrls as bypassrls
              from pg_roles where rolname = current_user`,
      )
    ).rows as [{ role: string; bypassrls: boolean }];
    console.log(`[migrate] rol: ${role}${bypassrls ? ' (BYPASSRLS)' : ''}`);

    await migrate(db, { migrationsFolder: './drizzle' });
    console.log('[migrate] esquema al día');

    // Verificación: que RLS quedó activo de verdad. Una migración que "pasó"
    // pero dejó las políticas sin FORCE da una falsa sensación de aislamiento.
    const { rows } = await db.execute<{
      table_name: string;
      rls_enabled: boolean;
      rls_forced: boolean;
      policies: number;
    }>(sql`
      select c.relname          as table_name,
             c.relrowsecurity   as rls_enabled,
             c.relforcerowsecurity as rls_forced,
             count(p.polname)::int as policies
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        left join pg_policy p on p.polrelid = c.oid
       where n.nspname = 'public'
         and c.relkind = 'r'
         and c.relrowsecurity
       group by 1, 2, 3
       order by 1
    `);

    if (rows.length === 0) {
      console.warn('[migrate] AVISO: ninguna tabla tiene RLS activo.');
    } else {
      const sinForzar = rows.filter((row) => !row.rls_forced);
      console.log(
        `[migrate] RLS activo y forzado en ${rows.length - sinForzar.length} de ${rows.length} tablas`,
      );
      for (const row of sinForzar) {
        console.warn(`[migrate] AVISO: ${row.table_name} tiene RLS SIN FORZAR.`);
      }

      // El aviso que importa: con un rol BYPASSRLS, todo lo de arriba es
      // decorativo. Vale la pena decirlo cada vez que se migra.
      const appUrl = env.DATABASE_URL;
      if (env.MIGRATION_DATABASE_URL === undefined) {
        console.warn(
          '[migrate] AVISO: la api usa la MISMA cadena que las migraciones. Si ese rol ' +
            'tiene BYPASSRLS (en Neon, `neondb_owner` lo tiene), el aislamiento por tenant ' +
            'no se aplica. Ver scripts/setup-app-role.sql.',
        );
      } else {
        const appRole = new URL(appUrl).username;
        const { rows: appRows } = await db.execute<{ bypassrls: boolean }>(
          sql`select rolbypassrls as bypassrls from pg_roles where rolname = ${appRole}`,
        );
        const flag = appRows[0]?.bypassrls;
        if (flag === undefined) {
          console.warn(`[migrate] AVISO: el rol de la api "${appRole}" no existe todavía.`);
        } else if (flag) {
          console.warn(
            `[migrate] AVISO: el rol de la api "${appRole}" tiene BYPASSRLS: el aislamiento ` +
              'por tenant no se le aplica.',
          );
        } else {
          console.log(`[migrate] rol de la api: ${appRole} (sujeto a RLS)`);
        }
      }
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error('[migrate] falló:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
