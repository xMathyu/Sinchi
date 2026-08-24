/**
 * Alta de la Asociacion Deportiva Club Kaizen.
 *
 * Es un gimnasio real, no datos de demostracion: planes, precios y horarios
 * salen de sus propios flyers. Vive aparte de `seed.ts` porque aquella siembra
 * borra y rehace para las pruebas, y esto **no puede borrar nada** — corre
 * contra la base de produccion.
 *
 * Es idempotente: si el gimnasio ya existe, no lo duplica.
 *
 *   npm run db:seed:kaizen -w @sinchi/api
 */
import 'dotenv/config';
import { and, eq } from 'drizzle-orm';
import { createDatabase, createPool, schema, withTenant, withoutTenantIsolation } from './client';

const SOLES = (amount: number): number => amount * 100;

/** Dias ISO: 1 = lunes .. 7 = domingo. */
const LUN = 1;
const MAR = 2;
const MIE = 3;
const JUE = 4;
const VIE = 5;
const SAB = 6;

interface ClassSpec {
  readonly name: string;
  readonly weekday: number;
  readonly startTime: string;
  readonly endTime: string;
}

const HORARIOS: readonly ClassSpec[] = [
  // Judo Kids 4 a 7
  { name: 'Judo Kids (4 a 7 años)', weekday: MAR, startTime: '17:00', endTime: '18:00' },
  { name: 'Judo Kids (4 a 7 años)', weekday: JUE, startTime: '17:00', endTime: '18:00' },
  { name: 'Judo Kids (4 a 7 años)', weekday: SAB, startTime: '09:00', endTime: '10:00' },

  // Judo Kids 8 a 13
  { name: 'Judo Kids (8 a 13 años)', weekday: MAR, startTime: '18:00', endTime: '19:00' },
  { name: 'Judo Kids (8 a 13 años)', weekday: JUE, startTime: '18:00', endTime: '19:00' },
  { name: 'Judo Kids (8 a 13 años)', weekday: SAB, startTime: '10:00', endTime: '11:00' },

  // Judo adultos
  { name: 'Judo Adultos', weekday: LUN, startTime: '09:00', endTime: '10:00' },
  { name: 'Judo Adultos', weekday: MIE, startTime: '09:00', endTime: '10:00' },
  { name: 'Judo Adultos', weekday: VIE, startTime: '09:00', endTime: '10:00' },
  { name: 'Judo Adultos', weekday: SAB, startTime: '11:00', endTime: '13:00' },
  { name: 'Judo Adultos', weekday: MAR, startTime: '20:00', endTime: '21:00' },
  { name: 'Judo Adultos', weekday: JUE, startTime: '20:00', endTime: '21:00' },

  // Preparacion fisica
  { name: 'Preparación física', weekday: MAR, startTime: '08:00', endTime: '09:00' },
  { name: 'Preparación física', weekday: JUE, startTime: '08:00', endTime: '09:00' },
];

interface PlanSpec {
  readonly name: string;
  readonly type: 'unlimited' | 'sessions_per_week';
  readonly sessionsPerWeek: number | null;
  readonly soles: number;
}

const PLANES: readonly PlanSpec[] = [
  { name: '1 vez por semana', type: 'sessions_per_week', sessionsPerWeek: 1, soles: 120 },
  { name: '2 veces por semana', type: 'sessions_per_week', sessionsPerWeek: 2, soles: 150 },
  { name: '3 veces por semana', type: 'sessions_per_week', sessionsPerWeek: 3, soles: 180 },
  { name: 'Cualquier día', type: 'unlimited', sessionsPerWeek: null, soles: 200 },
];

export async function seedKaizen(): Promise<{ tenantId: string; created: boolean }> {
  const pool = createPool(process.env.DATABASE_URL!);
  const db = createDatabase(pool);

  try {
    const existing = await withoutTenantIsolation(db, (tx) =>
      tx
        .select({ id: schema.tenants.id })
        .from(schema.tenants)
        .where(eq(schema.tenants.slug, 'kaizen'))
        .limit(1),
    );

    if (existing[0] !== undefined) {
      console.log(`[kaizen] ya existe (${existing[0].id}); no se toca nada`);
      return { tenantId: existing[0].id, created: false };
    }

    const tenantId = await withoutTenantIsolation(db, async (tx) => {
      const [tenant] = await tx
        .insert(schema.tenants)
        .values({
          name: 'Asociación Deportiva Club Kaizen',
          // PENDIENTE: el RUC real lo tiene que dar el club. Se marca en vez de
          // inventarlo porque va en los comprobantes.
          taxId: 'PENDIENTE',
          slug: 'kaizen',
          timezone: 'America/Lima',
          saasTier: 'up_to_60',
          billingMode: 'anniversary',
          graceDays: 5,
          quotaOverflowPolicy: 'block',
          enrollmentFeeCents: SOLES(50),
        })
        .returning({ id: schema.tenants.id });
      return tenant!.id;
    });

    await withTenant(db, tenantId, async (tx) => {
      await tx.insert(schema.plans).values(
        PLANES.map((plan) => ({
          tenantId,
          name: plan.name,
          type: plan.type,
          sessionsPerWeek: plan.sessionsPerWeek,
          allowedDays: null,
          priceCents: SOLES(plan.soles),
          active: true,
        })),
      );

      await tx.insert(schema.classSchedules).values(
        HORARIOS.map((clase) => ({
          tenantId,
          name: clase.name,
          weekday: clase.weekday,
          startTime: clase.startTime,
          endTime: clase.endTime,
          active: true,
        })),
      );
    });

    console.log(`[kaizen] creado: ${tenantId}`);
    console.log(`[kaizen] ${PLANES.length} planes, ${HORARIOS.length} bloques de horario`);
    console.log('[kaizen] matrícula S/50 · AVISO: el RUC quedó como "PENDIENTE"');
    return { tenantId, created: true };
  } finally {
    await pool.end();
  }
}

/** Registra al dueño para que pueda invitar. Idempotente. */
export async function seedKaizenOwner(input: {
  readonly tenantId: string;
  readonly name: string;
  readonly documentId: string;
  readonly phone: string;
  readonly email: string;
}): Promise<string> {
  const pool = createPool(process.env.DATABASE_URL!);
  const db = createDatabase(pool);

  try {
    // La identidad va sin contexto —`users` no pertenece a ningun gimnasio— pero
    // la fila de `staff` SI, y su politica exige que el tenant este puesto. Sin
    // separarlos, el insert fallaba con "violates row-level security policy": la
    // api conecta como `sinchi_app`, que no tiene BYPASSRLS, y eso es
    // deliberado.
    const userId = await withoutTenantIsolation(db, async (tx) => {
      const [existingUser] = await tx
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.phone, input.phone))
        .limit(1);

      if (existingUser !== undefined) return existingUser.id;

      const [created] = await tx
        .insert(schema.users)
        .values({
          name: input.name,
          documentId: input.documentId,
          phone: input.phone,
          email: input.email,
        })
        .returning({ id: schema.users.id });
      return created!.id;
    });

    return await withTenant(db, input.tenantId, async (tx) => {
      const [existingStaff] = await tx
        .select({ id: schema.staff.id })
        .from(schema.staff)
        .where(
          and(eq(schema.staff.userId, userId), eq(schema.staff.tenantId, input.tenantId)),
        )
        .limit(1);

      if (existingStaff !== undefined) return existingStaff.id;

      const [staff] = await tx
        .insert(schema.staff)
        .values({
          userId,
          tenantId: input.tenantId,
          role: 'owner',
          displayName: input.name,
        })
        .returning({ id: schema.staff.id });
      return staff!.id;
    });
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.includes('seed-kaizen')) {
  void seedKaizen().then(() => process.exit(0));
}
