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
 *   npx tsx src/db/saas-cli.ts promo new <CODIGO> <meses> <usos> [nota]
 *   npx tsx src/db/saas-cli.ts promo list
 *   npx tsx src/db/saas-cli.ts promo off <CODIGO>
 */
import 'dotenv/config';
import { eq } from 'drizzle-orm';
import {
  PROMO_MAX_FREE_MONTHS,
  SAAS_TIER_LABELS,
  formatPEN,
  formatPlainDate,
  isWellFormedPromoCode,
  normalizePromoCode,
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

    if (command === 'promo') {
      await promo(db, process.argv.slice(3));
      return;
    }

    console.error('uso: saas-cli status [slug]');
    console.error('     saas-cli pay <slug> <transferencia|yape|efectivo> [operacion]');
    console.error('     saas-cli promo new <CODIGO> <meses> <usos> [nota]');
    console.error('     saas-cli promo list');
    console.error('     saas-cli promo off <CODIGO>');
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

/**
 * Los codigos de promocion.
 *
 * Se crean aqui y no en una pantalla a proposito: los reparte una persona, de
 * uno en uno, y el tope de usos es la parte que importa —una promocion sin tope
 * es un agujero abierto—. `usos` acepta `ilimitado` cuando se quiere de verdad.
 */
async function promo(db: ReturnType<typeof createDatabase>, args: readonly string[]): Promise<void> {
  const [accion, raw, mesesRaw, usosRaw, ...nota] = args;

  if (accion === 'list') {
    const filas = await withoutTenantIsolation(db, (tx) =>
      tx.select().from(schema.saasPromoCodes).orderBy(schema.saasPromoCodes.createdAt),
    );
    console.log('');
    if (filas.length === 0) console.log('  (no hay códigos todavía)');
    for (const fila of filas) {
      const tope = fila.maxRedemptions === null ? 'ilimitado' : String(fila.maxRedemptions);
      const estado = fila.active ? '' : ' [APAGADO]';
      console.log(
        `  ${fila.code.padEnd(16)} ${fila.freeMonths} mes(es)  ` +
          `${fila.redeemedCount}/${tope} usados${estado}` +
          (fila.note === null ? '' : `  — ${fila.note}`),
      );
    }
    console.log('');
    return;
  }

  if (raw === undefined) throw new Error('Falta el código.');
  const code = normalizePromoCode(raw);
  if (!isWellFormedPromoCode(raw)) {
    throw new Error(`"${raw}" no sirve como código: entre 4 y 24 letras o números.`);
  }

  if (accion === 'off') {
    const apagados = await withoutTenantIsolation(db, (tx) =>
      tx
        .update(schema.saasPromoCodes)
        .set({ active: false })
        .where(eq(schema.saasPromoCodes.code, code))
        .returning({ code: schema.saasPromoCodes.code }),
    );
    console.log('');
    console.log(apagados.length === 0 ? `  No existe ${code}.` : `  ${code} apagado.`);
    console.log('');
    return;
  }

  if (accion !== 'new') {
    throw new Error('uso: saas-cli promo <new|list|off> ...');
  }

  const meses = Number(mesesRaw ?? '1');
  if (!Number.isInteger(meses) || meses < 1 || meses > PROMO_MAX_FREE_MONTHS) {
    throw new Error(`Los meses van de 1 a ${PROMO_MAX_FREE_MONTHS}.`);
  }

  // Sin tope hay que escribirlo: que se regale un mes a todo el que pase tiene
  // que ser una decision, no lo que sale por olvidar un argumento.
  const usos =
    usosRaw === undefined || usosRaw === 'ilimitado' ? null : Number(usosRaw);
  if (usos !== null && (!Number.isInteger(usos) || usos < 1)) {
    throw new Error('Los usos son un entero positivo, o "ilimitado".');
  }
  if (usosRaw === undefined) {
    throw new Error('Falta el tope de usos. Escribe un número, o "ilimitado" a propósito.');
  }

  await withoutTenantIsolation(db, (tx) =>
    tx.insert(schema.saasPromoCodes).values({
      code,
      freeMonths: meses,
      maxRedemptions: usos,
      note: nota.length > 0 ? nota.join(' ') : null,
    }),
  );

  console.log('');
  console.log(`  ${code} — ${meses} mes(es) gratis, ${usos ?? 'sin'} tope de usos`);
  console.log('');
}

main().catch((error: unknown) => {
  console.error('[saas]', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
