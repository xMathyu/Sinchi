/**
 * Borra los gimnasios de demostracion de una base real.
 *
 * Existe porque la siembra de demostracion se corrio contra Neon: quedaron tres
 * gimnasios que no existen conviviendo con uno que si. Ahora `runSeed` se niega
 * a correr fuera de local, pero eso no deshace lo ya sembrado.
 *
 * Borra por slug y solo esos tres. Nunca toca `kaizen` ni nada que no este en la
 * lista: un script de limpieza que acepta comodines es un script que un dia
 * borra lo que no debia.
 */
import 'dotenv/config';
import { inArray, sql } from 'drizzle-orm';
import { createDatabase, createPool, schema } from './client';

const DEMO = ['dojo-shotokan', 'nova-bjj', 'iron-muay-thai'] as const;

async function main(): Promise<void> {
  // Hace falta el rol administrativo: borrar un tenant cruza el aislamiento por
  // gimnasio, que es justo lo que el rol de la api no puede hacer — y esta bien
  // que no pueda.
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL!;
  const pool = createPool(url);
  const db = createDatabase(pool);

  try {
    const antes = (await db.execute(
      sql`select slug, name from tenants where slug = any(${sql.raw(`ARRAY['${DEMO.join("','")}']`)})`,
    )) as unknown as { rows?: { slug: string; name: string }[] };
    const filas = antes.rows ?? (antes as unknown as { slug: string; name: string }[]);
    for (const f of filas) console.log(`  borrando: ${f.name}`);

    // La cascada de `tenants` se lleva fichas, planes, suscripciones, cargos,
    // asistencias, horarios y staff.
    const borrados = await db
      .delete(schema.tenants)
      .where(inArray(schema.tenants.slug, [...DEMO]))
      .returning({ slug: schema.tenants.slug });

    // Las identidades no cuelgan de ningun gimnasio, asi que la cascada no las
    // toca: se limpian las que quedaron sin ninguna ficha y sin cuenta de
    // Firebase. La condicion de "sin firebase_uid" protege a cualquiera que si
    // haya entrado de verdad.
    const huerfanos = (await db.execute(sql`
      delete from users u
      where u.firebase_uid is null
        and not exists (select 1 from memberships m where m.user_id = u.id)
        and not exists (select 1 from staff s where s.user_id = u.id)
      returning u.name
    `)) as unknown as { rows?: { name: string }[] };
    const nombres = huerfanos.rows ?? (huerfanos as unknown as { name: string }[]);

    console.log(`  gimnasios borrados: ${borrados.length}`);
    console.log(`  personas sin ficha borradas: ${nombres.length}`);
    for (const n of nombres) console.log(`    - ${n.name}`);
  } finally {
    await pool.end();
  }
}

void main().then(
  () => process.exit(0),
  (e: unknown) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  },
);
