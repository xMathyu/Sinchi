/**
 * Alta de un gimnasio real.
 *
 * Sale de `seed-kaizen.ts`, que hizo esto mismo para el primer cliente. Con el
 * segundo, copiar el archivo entero habria dejado dos copias de la misma
 * decision delicada —cuando crear y cuando no— y esa es justo la que no puede
 * divergir: **esto corre contra la base de produccion y no puede borrar nada**.
 *
 * Es idempotente por slug: si el gimnasio ya existe, no toca nada y lo dice.
 * Volver a correrlo despues de anadirle un plan NO se lo anade — para eso esta
 * el panel, o una migracion, no un script de alta.
 */
import { and, eq } from 'drizzle-orm';
import { TZ_LIMA, formatPlainDate, freeUntilFrom, plainDateInZone } from '@sinchi/shared';
import { createDatabase, createPool, schema, withTenant, withoutTenantIsolation } from './client';

const SOLES = (amount: number): number => amount * 100;

/** Dias ISO: 1 = lunes .. 7 = domingo. */
export const LUN = 1;
export const MAR = 2;
export const MIE = 3;
export const JUE = 4;
export const VIE = 5;
export const SAB = 6;
export const DOM = 7;

export interface ClaseSpec {
  readonly name: string;
  readonly weekday: number;
  readonly startTime: string;
  readonly endTime: string;
}

export interface PlanSpec {
  readonly name: string;
  readonly type: 'unlimited' | 'sessions_per_week';
  readonly sessionsPerWeek: number | null;
  readonly soles: number;
}

export interface GimnasioSpec {
  readonly slug: string;
  readonly name: string;
  /** RUC. `PENDIENTE` mientras el club no lo da: va en los comprobantes. */
  readonly taxId: string;
  readonly graceDays?: number;
  /**
   * Precio de la clase suelta, para el gimnasio que vende por sesion. `null` si
   * solo vende mensualidades.
   */
  readonly dropInSoles?: number | null;
  /** Matricula. 0 = no cobra. */
  readonly enrollmentSoles?: number;
  /**
   * Si ofrece la primera clase GRATIS por la app.
   *
   * No es lo mismo que vender clases sueltas: un local cuya prueba es de pago
   * regala su propio producto si esto queda encendido. Se decide al dar de alta
   * y el dueno lo cambia cuando quiera desde la app.
   */
  readonly trialClassEnabled?: boolean;
  /**
   * Lo que cuesta esa primera clase. 0 o ausente = gratis.
   *
   * No es lo mismo que `dropInSoles`: uno lo paga el alumno que agota su cupo y
   * otro quien viene a conocer el local. Un gimnasio puede regalar la primera y
   * cobrar las siguientes.
   */
  readonly trialSoles?: number;
  readonly planes: readonly PlanSpec[];
  readonly horarios: readonly ClaseSpec[];
}

export async function seedGym(spec: GimnasioSpec): Promise<{ tenantId: string; created: boolean }> {
  const pool = createPool(process.env.DATABASE_URL!);
  const db = createDatabase(pool);
  const etiqueta = `[${spec.slug}]`;

  try {
    const existing = await withoutTenantIsolation(db, (tx) =>
      tx
        .select({ id: schema.tenants.id })
        .from(schema.tenants)
        .where(eq(schema.tenants.slug, spec.slug))
        .limit(1),
    );

    if (existing[0] !== undefined) {
      console.log(`${etiqueta} ya existe (${existing[0].id}); no se toca nada`);
      return { tenantId: existing[0].id, created: false };
    }

    const dropIn = spec.dropInSoles ?? null;

    const tenantId = await withoutTenantIsolation(db, async (tx) => {
      const [tenant] = await tx
        .insert(schema.tenants)
        .values({
          name: spec.name,
          taxId: spec.taxId,
          slug: spec.slug,
          timezone: 'America/Lima',
          saasTier: 'up_to_60',
          billingMode: 'anniversary',
          graceDays: spec.graceDays ?? 5,
          // Quien vende clase suelta puede ofrecerla al que agota su cupo; quien
          // no, bloquea. El motor informa y el gimnasio decide (MD 8.2).
          quotaOverflowPolicy: dropIn === null ? 'block' : 'offer_drop_in',
          dropInPriceCents: dropIn === null ? null : SOLES(dropIn),
          enrollmentFeeCents: SOLES(spec.enrollmentSoles ?? 0),
          trialClassEnabled: spec.trialClassEnabled ?? true,
          trialClassPriceCents: SOLES(spec.trialSoles ?? 0),
        })
        .returning({ id: schema.tenants.id });

      /**
       * Su mes gratis, desde hoy.
       *
       * Explicito y no por la creacion perezosa del servicio: un gimnasio
       * sembrado tiene que quedar con su fecha de vencimiento puesta aunque
       * nadie abra la app, porque el job diario recorre esta tabla y lo que no
       * esta aqui no vence nunca.
       */
      const alta = plainDateInZone(new Date(), TZ_LIMA);
      await tx.insert(schema.saasSubscriptions).values({
        tenantId: tenant!.id,
        freeUntil: formatPlainDate(freeUntilFrom(alta)),
        periodStart: formatPlainDate(alta),
        nextBillingDate: formatPlainDate(freeUntilFrom(alta)),
      });

      return tenant!.id;
    });

    await withTenant(db, tenantId, async (tx) => {
      await tx.insert(schema.plans).values(
        spec.planes.map((plan) => ({
          tenantId,
          name: plan.name,
          type: plan.type,
          sessionsPerWeek: plan.sessionsPerWeek,
          allowedDays: null,
          priceCents: SOLES(plan.soles),
          active: true,
        })),
      );

      if (spec.horarios.length > 0) {
        await tx.insert(schema.classSchedules).values(
          spec.horarios.map((clase) => ({
            tenantId,
            name: clase.name,
            weekday: clase.weekday,
            startTime: clase.startTime,
            endTime: clase.endTime,
            active: true,
          })),
        );
      }
    });

    console.log(`${etiqueta} creado: ${tenantId}`);
    console.log(
      `${etiqueta} ${spec.planes.length} planes, ${spec.horarios.length} bloques de horario` +
        (dropIn === null ? '' : `, clase suelta S/${dropIn}`),
    );
    if (spec.trialClassEnabled === false) {
      console.log(`${etiqueta} SIN clase de prueba por la app`);
    } else if ((spec.trialSoles ?? 0) > 0) {
      console.log(`${etiqueta} clase de prueba reservable, S/${spec.trialSoles} al llegar`);
    }
    if (spec.taxId === 'PENDIENTE') {
      console.log(`${etiqueta} AVISO: el RUC quedó como "PENDIENTE"`);
    }
    return { tenantId, created: true };
  } finally {
    await pool.end();
  }
}

/**
 * Registra al dueno para que pueda entrar y administrar. Idempotente.
 *
 * Sin esto, el gimnasio existe pero no hay nadie que pueda abrir su padron ni
 * ver quien viene a probar.
 */
export async function seedOwner(input: {
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
    // separarlos, el insert falla con "violates row-level security policy": la
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
        .where(and(eq(schema.staff.userId, userId), eq(schema.staff.tenantId, input.tenantId)))
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
