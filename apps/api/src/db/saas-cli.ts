/**
 * La suscripcion de los gimnasios a Sinchi, desde la linea de comandos.
 *
 * No hay pantalla para esto a proposito. Con un punado de gimnasios, quien cobra
 * es una persona mirando el correo del banco una vez al mes: construirle un
 * panel es trabajo que se tira cuando entre Culqi y el cobro sea automatico.
 *
 * Usa `SaasService` en vez de escribir en las tablas: si duplicara los inserts,
 * el dia que cambie el ciclo esta ruta quedaria produciendo cobros sutilmente
 * distintos a los de la api — y son los cobros de la empresa.
 *
 *   npx tsx src/db/saas-cli.ts status            # todos los gimnasios
 *   npx tsx src/db/saas-cli.ts pay <slug> <transferencia|yape> [operacion]
 */
import 'dotenv/config';
import { eq } from 'drizzle-orm';
import {
  SAAS_TIER_LABELS,
  formatPEN,
  formatPlainDate,
  saasNotice,
  type Cents,
  type PaymentRail,
} from '@sinchi/shared';
import { createDatabase, createPool, schema, withoutTenantIsolation } from './client';
import { SaasService } from '../modules/saas/saas.service';
import { Clock } from '../common/clock';

/** Como paga el gimnasio. En castellano porque quien escribe el comando es una persona. */
const RIELES: Readonly<Record<string, PaymentRail>> = {
  transferencia: 'bank_transfer',
  yape: 'yape',
  efectivo: 'cash',
};

async function main(): Promise<void> {
  const [command, slug, rail, reference] = process.argv.slice(2);
  const pool = createPool(process.env.DATABASE_URL!);
  const db = createDatabase(pool);
  const saas = new SaasService(db, new Clock());

  try {
    if (command === 'status') {
      await status(db, saas, slug);
      return;
    }

    if (command === 'pay') {
      await pay(db, saas, slug, rail, reference);
      return;
    }

    console.error('uso: saas-cli status [slug]');
    console.error('     saas-cli pay <slug> <transferencia|yape|efectivo> [operacion]');
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

async function status(
  db: ReturnType<typeof createDatabase>,
  saas: SaasService,
  slug: string | undefined,
): Promise<void> {
  const gyms = await withoutTenantIsolation(db, (tx) =>
    tx
      .select({ id: schema.tenants.id, slug: schema.tenants.slug, name: schema.tenants.name })
      .from(schema.tenants)
      .orderBy(schema.tenants.name),
  );

  const elegidos = slug === undefined ? gyms : gyms.filter((gym) => gym.slug === slug);
  if (elegidos.length === 0) throw new Error(`No existe el gimnasio "${slug ?? ''}".`);

  console.log('');
  for (const gym of elegidos) {
    const resumen = await saas.summaryFor(gym.id);
    const aviso = saasNotice(resumen.state, resumen.priceCents);

    console.log(`  ${gym.name} (${gym.slug})`);
    console.log(`    estado   : ${resumen.state.status} — ${aviso.title}`);
    console.log(`    escalon  : ${SAAS_TIER_LABELS[resumen.tier]} · ${formatPEN(resumen.priceCents)}/mes`);
    console.log(`    gratis   : hasta ${formatPlainDate(resumen.freeUntil)}`);
    console.log(`    proximo  : ${formatPlainDate(resumen.nextBillingDate)}`);
    console.log(`    escribe  : ${resumen.state.canWrite ? 'si' : 'NO (solo lectura)'}`);
    console.log('');
  }
}

async function pay(
  db: ReturnType<typeof createDatabase>,
  saas: SaasService,
  slug: string | undefined,
  rail: string | undefined,
  reference: string | undefined,
): Promise<void> {
  if (slug === undefined || rail === undefined) {
    throw new Error('uso: saas-cli pay <slug> <transferencia|yape|efectivo> [operacion]');
  }

  const riel = RIELES[rail];
  if (riel === undefined) {
    throw new Error(`Riel de pago desconocido: "${rail}". Usa transferencia, yape o efectivo.`);
  }

  const [gym] = await withoutTenantIsolation(db, (tx) =>
    tx
      .select({ id: schema.tenants.id, name: schema.tenants.name })
      .from(schema.tenants)
      .where(eq(schema.tenants.slug, slug))
      .limit(1),
  );
  if (gym === undefined) throw new Error(`No existe el gimnasio "${slug}".`);

  const resultado = await saas.recordPayment({
    tenantId: gym.id,
    rail: riel,
    reference: reference ?? null,
  });

  console.log('');
  if (reference === undefined) {
    // Sin numero de operacion no hay forma de detectar un duplicado: la
    // idempotencia del pago manual ES esa referencia. Se avisa en vez de
    // exigirla porque un pago en efectivo no siempre trae comprobante.
    console.log('  AVISO: sin numero de operacion. Registrarlo dos veces cobrara dos meses.');
    console.log('');
  }
  if (resultado.alreadyRecorded) {
    // El indice unico lo paro. Es la red que evita regalarle un mes al gimnasio
    // cuando dos personas atienden el mismo correo del banco.
    console.log(`  ${gym.name}: ese periodo YA estaba pagado. No se registro nada.`);
  } else {
    console.log(`  ${gym.name}: cobrado ${formatPEN(resultado.amountCents as Cents)}`);
    console.log(`  periodo : ${formatPlainDate(resultado.periodStart)} → ${formatPlainDate(resultado.periodEnd)}`);
    console.log(`  escalon : ${SAAS_TIER_LABELS[resultado.tier]}`);
  }
  console.log('');
}

main().catch((error: unknown) => {
  console.error('[saas]', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
