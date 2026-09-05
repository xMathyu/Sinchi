/**
 * Borra gimnasios de una base real, por slug y a mano.
 *
 * Nacio para deshacer una siembra de demostracion que se corrio contra Neon, y
 * sigue haciendo falta por una razon peor: las pruebas de punta a punta crean
 * gimnasios con nombres generados —`Dojo Planes 34306427 1`— y **no los borran**.
 * Basta apuntar `TEST_DATABASE_URL` a Neon una vez para que trece de esos queden
 * en el directorio publico, que es lo primero que ve quien instala la app.
 *
 * Dos reglas, y las dos son deliberadas:
 *
 *  - **Los slugs se escriben.** No hay comodines ni prefijos. Un script de
 *    limpieza que acepta `dojo-*` es un script que un dia se lleva el dojo de un
 *    cliente que se llamaba parecido.
 *  - **Enseña antes de borrar.** Sin `--yes` no toca nada: lista lo que cada
 *    gimnasio arrastra —fichas, staff, cargos, asistencias— y para ahi. Borrar
 *    un tenant es en cascada y no tiene vuelta.
 *
 *   npm run db:purge -w @sinchi/api -- dojo-planes-34306427-1 dojo-rutinas-...
 *   npm run db:purge -w @sinchi/api -- <los mismos> --yes
 *
 * Sin argumentos lista lo que hay, que es como se averigua que sobra.
 */
import 'dotenv/config';
import { inArray, sql } from 'drizzle-orm';
import { createDatabase, createPool, schema } from './client';

interface Fila {
  readonly slug: string;
  readonly name: string;
  readonly fichas: number;
  readonly staff: number;
  readonly cargos: number;
  readonly asistencias: number;
}

/** Lo que cada gimnasio se lleva por delante. Se pregunta ANTES de borrar. */
async function inventario(
  db: ReturnType<typeof createDatabase>,
  slugs: readonly string[],
): Promise<readonly Fila[]> {
  const r = (await db.execute(sql`
    select t.slug,
           t.name,
           (select count(*) from memberships m where m.tenant_id = t.id)  as fichas,
           (select count(*) from staff s        where s.tenant_id = t.id) as staff,
           (select count(*) from charges c      where c.tenant_id = t.id) as cargos,
           (select count(*) from attendance a   where a.tenant_id = t.id) as asistencias
    from tenants t
    ${slugs.length === 0 ? sql`` : sql`where t.slug in ${slugs}`}
    order by t.created_at
  `)) as unknown as { rows?: Fila[] };

  return (r.rows ?? (r as unknown as Fila[])).map((f) => ({
    ...f,
    fichas: Number(f.fichas),
    staff: Number(f.staff),
    cargos: Number(f.cargos),
    asistencias: Number(f.asistencias),
  }));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const confirmado = args.includes('--yes');
  const slugs = args.filter((a) => !a.startsWith('--'));

  // Hace falta el rol administrativo: borrar un tenant cruza el aislamiento por
  // gimnasio, que es justo lo que el rol de la api no puede hacer — y esta bien
  // que no pueda.
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL!;
  const pool = createPool(url);
  const db = createDatabase(pool);

  try {
    console.log(`base: ${new URL(url).host}\n`);

    if (slugs.length === 0) {
      console.log('Gimnasios en esta base (ninguno se borra sin nombrarlo):\n');
      for (const f of await inventario(db, [])) {
        console.log(
          `  ${f.slug.padEnd(28)} ${String(f.fichas).padStart(3)} fichas  ` +
            `${String(f.staff).padStart(2)} staff  ${f.name}`,
        );
      }
      console.log('\n  npm run db:purge -w @sinchi/api -- <slug> [<slug>...] [--yes]');
      return;
    }

    const filas = await inventario(db, slugs);
    const encontrados = new Set(filas.map((f) => f.slug));
    for (const s of slugs) if (!encontrados.has(s)) console.log(`  no existe: ${s}`);

    if (filas.length === 0) return;

    console.log(confirmado ? 'Borrando:\n' : 'Se borraria (falta --yes):\n');
    for (const f of filas) {
      console.log(`  ${f.slug} — ${f.name}`);
      console.log(
        `      ${f.fichas} fichas · ${f.staff} staff · ${f.cargos} cargos · ${f.asistencias} asistencias`,
      );
    }

    if (!confirmado) {
      console.log('\nNada borrado. Repite con --yes si es lo que quieres.');
      return;
    }

    // La cascada de `tenants` se lleva fichas, planes, suscripciones, cargos,
    // asistencias, horarios y staff.
    const borrados = await db
      .delete(schema.tenants)
      .where(inArray(schema.tenants.slug, [...encontrados]))
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

    console.log(`\n  gimnasios borrados: ${borrados.length}`);
    console.log(`  personas sin ficha borradas: ${nombres.length}`);
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
