/**
 * Crea una invitacion desde la linea de comandos.
 *
 * Existe para el arranque de un gimnasio, cuando todavia no hay nadie del staff
 * con cuenta que pueda usar la app: alguien tiene que mandar la primera
 * invitacion, y esa persona no puede estar dentro del sistema todavia.
 *
 * Usa `InviteService` en vez de escribir en las tablas a mano — si replicara los
 * inserts, el dia que cambie el flujo (otro cargo, otra caducidad) esta ruta
 * quedaria produciendo invitaciones sutilmente distintas a las de la app.
 *
 *   npx tsx src/db/invite-cli.ts <slug> <plan> <nombre> <dni> <telefono>
 */
import 'dotenv/config';
import { and, eq } from 'drizzle-orm';
import { createDatabase, createPool, schema, withTenant, withoutTenantIsolation } from './client';
import { InviteService } from '../auth/invite.service';

async function main(): Promise<void> {
  const [slug, planName, fullName, documentId, phone] = process.argv.slice(2);

  if (
    slug === undefined ||
    planName === undefined ||
    fullName === undefined ||
    documentId === undefined ||
    phone === undefined
  ) {
    console.error('uso: invite-cli <slug> <plan> <nombre> <dni> <telefono>');
    process.exit(1);
  }

  const pool = createPool(process.env.DATABASE_URL!);
  const db = createDatabase(pool);

  try {
    const [tenant] = await withoutTenantIsolation(db, (tx) =>
      tx
        .select({ id: schema.tenants.id, name: schema.tenants.name })
        .from(schema.tenants)
        .where(eq(schema.tenants.slug, slug))
        .limit(1),
    );
    if (tenant === undefined) throw new Error(`No existe el gimnasio "${slug}".`);

    const [plan] = await withTenant(db, tenant.id, (tx) =>
      tx
        .select({ id: schema.plans.id, priceCents: schema.plans.priceCents })
        .from(schema.plans)
        .where(and(eq(schema.plans.tenantId, tenant.id), eq(schema.plans.name, planName)))
        .limit(1),
    );
    if (plan === undefined) throw new Error(`No existe el plan "${planName}" en ${tenant.name}.`);

    // El staff que invita: cualquiera con rol de dueño en ese gimnasio. Queda
    // registrado en `created_by`, asi que la invitacion sigue siendo auditable
    // aunque la haya lanzado esta herramienta.
    const [owner] = await withTenant(db, tenant.id, (tx) =>
      tx
        .select({ id: schema.staff.id })
        .from(schema.staff)
        .where(and(eq(schema.staff.tenantId, tenant.id), eq(schema.staff.role, 'owner')))
        .limit(1),
    );
    if (owner === undefined) throw new Error(`${tenant.name} no tiene dueño registrado todavía.`);

    const service = new InviteService(db);
    const invite = await service.create({
      tenantId: tenant.id,
      staffId: owner.id,
      planId: plan.id,
      fullName,
      documentId,
      phone,
    });

    console.log('');
    console.log(`  gimnasio : ${tenant.name}`);
    console.log(`  plan     : ${planName} (${plan.priceCents / 100} soles)`);
    console.log(`  para     : ${fullName}`);
    console.log(`  caduca   : ${new Date(invite.expiresAt).toLocaleString('es-PE')}`);
    console.log('');
    console.log(`  ENLACE   : sinchi://invite/${invite.token}`);
    console.log('');
  } finally {
    await pool.end();
  }
}

void main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);
