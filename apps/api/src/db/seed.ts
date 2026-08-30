/**
 * Datos de arranque.
 *
 * Reproduce los tres gimnasios del diseño y el padrón que ve el staff, con las
 * fechas relativas a hoy para que los cuatro estados del semáforo se vean sin
 * tener que esperar un mes: al día, última sesión, cupo agotado y suspendido.
 *
 * Sirve para dos cosas: apuntar la app a la api real desde el primer día, y
 * tener un escenario fijo donde probar el corte de acceso.
 *
 * Es idempotente por gimnasio: si el slug ya existe, lo salta. Para volver a
 * empezar, `npm run db:seed -- --reset` borra los tres y los rehace.
 */
import 'dotenv/config';
import { eq, inArray } from 'drizzle-orm';
import {
  addDays,
  formatPlainDate,
  fromSoles,
  isoWeekOf,
  isoWeekday,
  plainDateInZone,
  startOfIsoWeek,
  TZ_LIMA,
  type IsoWeekday,
  type PlainDate,
} from '@sinchi/shared';
import { createDatabase, createPool, withTenant, withoutTenantIsolation } from './client';
import * as schema from './schema';
import { loadEnv } from '../config/env';
import { SecretBox, generateTotpSecret } from '../common/secret-box';

const SLUGS = ['dojo-shotokan', 'nova-bjj', 'iron-muay-thai'] as const;

/**
 * Celulares de las identidades sembradas.
 *
 * El reset tiene que borrarlas explícitamente: `users` vive FUERA del tenant, así
 * que el borrado en cascada de los gimnasios no las toca y el segundo `--reset`
 * chocaba con el índice único del celular.
 *
 * Se borran por celular y no con un `delete from users` porque la base puede
 * tener gente real: el reset solo debe deshacer lo que el seed hizo.
 */
const SEEDED_PHONES = [
  '+51987654321', // Mathyu Quispe
  '+51987000111', // Ana Ríos
  '+51987000222', // Carlos Vega
  '+51987000333', // Sergio Paz
  '+51987111222', // Lucía Ferrer
  '+51987222333', // Diego Salas
  '+51987333444', // Julio Salcedo
  '+51987444555', // Rosa Salazar
  // Identidades que crea la prueba de punta a punta al ejercitar el alta. Van
  // aqui para que el reset sea completo: `users` vive fuera del tenant, asi que
  // el borrado en cascada del gimnasio no las alcanza y la segunda corrida
  // encontraria a la persona ya creada.
  '+51999888777', // Pedro Nuevo (alta de alumno nuevo)
] as const;

interface PlanSpec {
  readonly key: string;
  readonly name: string;
  readonly soles: number;
  readonly type: 'unlimited' | 'sessions_per_week' | 'fixed_days';
  readonly sessionsPerWeek?: number;
  readonly allowedDays?: readonly IsoWeekday[];
}

const UNLIMITED: PlanSpec = { key: 'unlimited', name: 'Ilimitado', soles: 180, type: 'unlimited' };
const WEEKLY_3: PlanSpec = {
  key: '3x',
  name: '3x por semana',
  soles: 150,
  type: 'sessions_per_week',
  sessionsPerWeek: 3,
};
const WEEKLY_1: PlanSpec = {
  key: '1x',
  name: '1x por semana',
  soles: 90,
  type: 'sessions_per_week',
  sessionsPerWeek: 1,
};
const WEEKLY_2: PlanSpec = {
  key: '2x',
  name: '2x por semana',
  soles: 120,
  type: 'sessions_per_week',
  sessionsPerWeek: 2,
};
const FIXED_MW: PlanSpec = {
  key: 'lm',
  name: 'Lunes y miércoles',
  soles: 110,
  type: 'fixed_days',
  allowedDays: [1, 3],
};

export interface SeedOptions {
  /** Borra lo sembrado antes de rehacerlo. Sin esto, el seed no toca nada. */
  readonly reset?: boolean;
  /** Silencia la salida. Lo usa la prueba de punta a punta. */
  readonly quiet?: boolean;
  /**
   * Salta la proteccion contra bases que no son de pruebas.
   *
   * Existe para poder demostrar el producto contra una base real cuando alguien
   * lo decide a conciencia. Hay que escribirlo a mano: nunca es el valor por
   * defecto y no hay bandera de linea de comandos que lo active por accidente.
   */
  readonly allowAnywhere?: boolean;
}

/**
 * Se niega a sembrar donde no toca.
 *
 * Esta siembra **borra y rehace**, y sus datos son inventados: tres gimnasios
 * que no existen y ocho personas que tampoco. Correrla contra la base buena deja
 * a un gimnasio real conviviendo con datos falsos, y quien abre la app no tiene
 * forma de distinguirlos — que es exactamente lo que paso.
 *
 * Se reconoce por el host: `localhost` y `127.0.0.1` son de pruebas; cualquier
 * cosa remota, no. Es una heuristica tosca a proposito — errar hacia negarse
 * cuesta escribir una bandera; errar hacia permitir cuesta la base.
 */
function assertNotProduction(url: string, allowAnywhere: boolean): void {
  if (allowAnywhere) return;

  const host = new URL(url).hostname;
  const esLocal = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local');
  if (esLocal) return;

  throw new Error(
    `El seed de demostración borra y rehace, y "${host}" no parece una base de pruebas.
` +
      'Si de verdad quieres sembrar datos falsos ahí, pasa { allowAnywhere: true }.',
  );
}

export async function runSeed(options: SeedOptions = {}): Promise<void> {
  const reset = options.reset ?? false;
  const log = options.quiet === true ? () => {} : console.log;
  const env = loadEnv();

  assertNotProduction(env.DATABASE_URL, options.allowAnywhere ?? false);
  const pool = createPool(env.DATABASE_URL);
  const db = createDatabase(pool);
  const secrets = new SecretBox(env.ENCRYPTION_KEY);
  const today = plainDateInZone(new Date(), TZ_LIMA);

  const date = (offset: number): string => formatPlainDate(addDays(today, offset));

  /**
   * Días de la semana ISO en curso en los que se puede sembrar asistencia.
   *
   * Cuenta hacia atrás desde hoy sin salir de la semana: el lunes solo hay un día
   * disponible, el domingo hay siete. Con offsets fijos (`hoy - 1`, `hoy - 3`) las
   * asistencias "de esta semana" caían en la semana anterior cada vez que el seed
   * corría un lunes o un martes, y el cupo salía en cero.
   *
   * Como el cupo es semanal y solo se admite un marcado por día, la cantidad de
   * asistencias posibles esta semana es exactamente el día de la semana de hoy.
   */
  const daysAvailableThisWeek = isoWeekday(today);
  const thisWeekDays = (count: number): readonly PlainDate[] => {
    const take = Math.min(count, daysAvailableThisWeek);
    return Array.from({ length: take }, (_, index) => addDays(today, -index));
  };
  const lastWeekDays = (count: number): readonly PlainDate[] => {
    const monday = addDays(startOfIsoWeek(today), -7);
    return Array.from({ length: Math.min(count, 7) }, (_, index) => addDays(monday, index));
  };

  // Los planes se eligen para que el estado buscado sea alcanzable HOY, sea
  // lunes o domingo: al que le debe quedar una sesión se le da un plan de
  // (usadas + 1), y al que debe tener el cupo agotado, uno de (usadas).
  const lastSessionUsed = Math.min(2, daysAvailableThisWeek);
  const exhaustedUsed = Math.min(3, daysAvailableThisWeek);

  try {
    if (reset) {
      // El orden importa: `memberships.user_id` y `staff.user_id` son
      // `on delete restrict`, así que las identidades solo se pueden borrar
      // después de que la cascada del gimnasio se llevó sus membresías.
      const removedTenants = await withoutTenantIsolation(db, (tx) =>
        tx
          .delete(schema.tenants)
          .where(inArray(schema.tenants.slug, [...SLUGS]))
          .returning({ slug: schema.tenants.slug }),
      );

      const removedUsers = await withoutTenantIsolation(db, (tx) =>
        tx
          .delete(schema.users)
          .where(inArray(schema.users.phone, [...SEEDED_PHONES]))
          .returning({ phone: schema.users.phone }),
      );

      log(
        `[seed] borrados ${removedTenants.length} gimnasios (cascada incluida) ` +
          `y ${removedUsers.length} identidades sembradas`,
      );
    }

    const existing = await withoutTenantIsolation(db, (tx) =>
      tx
        .select({ slug: schema.tenants.slug })
        .from(schema.tenants)
        .where(inArray(schema.tenants.slug, [...SLUGS])),
    );
    const strayUsers = await withoutTenantIsolation(db, (tx) =>
      tx
        .select({ phone: schema.users.phone })
        .from(schema.users)
        .where(inArray(schema.users.phone, [...SEEDED_PHONES])),
    );

    if (existing.length > 0 || strayUsers.length > 0) {
      const what =
        existing.length > 0
          ? `gimnasios: ${existing.map((t) => t.slug).join(', ')}`
          : `${strayUsers.length} identidades de una corrida anterior`;
      log(`[seed] ya existen ${what}. Usa "npm run db:seed -- --reset" para rehacer.`);
      return;
    }

    // --- Identidades globales ---------------------------------------------
    // Se crean UNA vez y se reutilizan en los tres gimnasios: eso es el
    // producto. Mathyu tiene tres membresías con una sola identidad (MD 5).
    const people = await withoutTenantIsolation(db, (tx) =>
      tx
        .insert(schema.users)
        .values([
          {
            name: 'Mathyu Quispe',
            documentId: '71448902',
            phone: '+51987654321',
            email: 'mathyu@example.pe',
            // Con secreto sembrado: su QR funciona desde el primer arranque.
            totpSecretEncrypted: secrets.encrypt(generateTotpSecret()),
          },
          { name: 'Ana Ríos', documentId: '40218877', phone: '+51987000111' },
          { name: 'Carlos Vega', documentId: '41339988', phone: '+51987000222' },
          { name: 'Sergio Paz', documentId: '42447799', phone: '+51987000333' },
          { name: 'Lucía Ferrer', documentId: '46551203', phone: '+51987111222' },
          { name: 'Diego Salas', documentId: '70112334', phone: '+51987222333' },
          { name: 'Julio Salcedo', documentId: '09887210', phone: '+51987333444' },
          { name: 'Rosa Salazar', documentId: '45908771', phone: '+51987444555' },
        ])
        .returning({ id: schema.users.id, name: schema.users.name }),
    );

    const userId = (name: string): string => {
      const found = people.find((person) => person.name === name);
      if (found === undefined) throw new Error(`Falta la persona ${name}.`);
      return found.id;
    };

    // --- Gimnasios ---------------------------------------------------------
    const tenantRows = await withoutTenantIsolation(db, (tx) =>
      tx
        .insert(schema.tenants)
        .values([
          {
            name: 'Dojo Shotokan Miraflores',
            taxId: '20512345678',
            slug: 'dojo-shotokan',
            graceDays: 5,
            quotaOverflowPolicy: 'block',
            dropInPriceCents: fromSoles(25),
            // El unico que NO ofrece clase gratis: opera con horario libre y no
            // tiene clases a las que invitar. Sirve para ver el directorio con
            // los dos casos.
            trialClassEnabled: false,
          },
          {
            name: 'Nova BJJ Surco',
            taxId: '20587654321',
            slug: 'nova-bjj',
            graceDays: 5,
            quotaOverflowPolicy: 'offer_drop_in',
            dropInPriceCents: fromSoles(25),
          },
          {
            name: 'Iron Muay Thai Lince',
            taxId: '20599887766',
            slug: 'iron-muay-thai',
            graceDays: 5,
            quotaOverflowPolicy: 'block',
            dropInPriceCents: fromSoles(30),
          },
        ])
        .returning({ id: schema.tenants.id, slug: schema.tenants.slug }),
    );

    const tenantId = (slug: string): string => {
      const found = tenantRows.find((row) => row.slug === slug);
      if (found === undefined) throw new Error(`Falta el gimnasio ${slug}.`);
      return found.id;
    };

    const shotokan = tenantId('dojo-shotokan');
    const nova = tenantId('nova-bjj');
    const iron = tenantId('iron-muay-thai');

    // --- Dojo Shotokan -----------------------------------------------------
    await withTenant(db, shotokan, async (tx) => {
      const plans = await insertPlans(tx, shotokan, [
        UNLIMITED,
        WEEKLY_3,
        WEEKLY_2,
        WEEKLY_1,
        FIXED_MW,
      ]);

      await tx.insert(schema.staff).values({
        tenantId: shotokan,
        userId: userId('Ana Ríos'),
        role: 'front_desk',
        displayName: 'Ana Ríos',
      });

      // Al día: cobra en 11 días.
      await enroll(tx, shotokan, userId('Mathyu Quispe'), plans('unlimited'), date(-20), date(11));
      await enroll(tx, shotokan, userId('Lucía Ferrer'), plans('unlimited'), date(-20), date(11));
      // Suspendido: 12 días de mora contra 5 de gracia.
      await enroll(tx, shotokan, userId('Diego Salas'), plans('2x'), date(-43), date(-12));
      // Al día pero con el cupo agotado. El plan se elige según los días que la
      // semana en curso permite marcar (las asistencias van más abajo).
      await enroll(
        tx,
        shotokan,
        userId('Julio Salcedo'),
        plans(`${exhaustedUsed}x`),
        date(-25),
        date(6),
      );
      // En gracia: debe, pero todavía entrena.
      await enroll(tx, shotokan, userId('Rosa Salazar'), plans('unlimited'), date(-33), date(-2));
    });

    // --- Nova BJJ ----------------------------------------------------------
    await withTenant(db, nova, async (tx) => {
      const plans = await insertPlans(tx, nova, [UNLIMITED, WEEKLY_3, WEEKLY_2, WEEKLY_1]);

      // Cada gimnasio tiene su propia recepción: el staff es del tenant, no de
      // la red. Y sin alguien a quien atribuirlo, un marcado manual no se puede
      // registrar — lo impide `attendance_manual_has_staff`.
      await tx.insert(schema.staff).values({
        tenantId: nova,
        userId: userId('Carlos Vega'),
        role: 'front_desk',
        displayName: 'Carlos Vega',
      });

      // Nova sí controla horarios; Shotokan opera con horario libre, así que el
      // check-in allí no valida clase (MD 4.3).
      await tx.insert(schema.classSchedules).values([
        {
          tenantId: nova,
          name: 'Fundamentos',
          weekday: 1,
          startTime: '19:00',
          endTime: '20:30',
          capacity: 24,
          instructor: 'Prof. Ramos',
        },
        {
          tenantId: nova,
          name: 'No-Gi',
          weekday: 3,
          startTime: '19:00',
          endTime: '20:30',
          capacity: 24,
          instructor: 'Prof. Ramos',
        },
        {
          tenantId: nova,
          name: 'Sparring',
          weekday: 5,
          startTime: '19:00',
          endTime: '20:30',
          capacity: 20,
          instructor: 'Prof. Ramos',
        },
      ]);

      await enroll(
        tx,
        nova,
        userId('Mathyu Quispe'),
        plans(`${lastSessionUsed + 1}x`),
        date(-11),
        date(20),
      );
    });

    // --- Iron Muay Thai ----------------------------------------------------
    await withTenant(db, iron, async (tx) => {
      const plans = await insertPlans(tx, iron, [WEEKLY_3, WEEKLY_2]);

      // Sergio entra como `owner`: es el único rol que ve los reportes del local.
      await tx.insert(schema.staff).values({
        tenantId: iron,
        userId: userId('Sergio Paz'),
        role: 'owner',
        displayName: 'Sergio Paz',
      });

      // Horarios de mañana y de noche: con dos gimnasios que publican clases, el
      // directorio y la reserva de la clase gratis se pueden recorrer enteros.
      await tx.insert(schema.classSchedules).values([
        {
          tenantId: iron,
          name: 'Muay Thai principiantes',
          weekday: 2,
          startTime: '07:00',
          endTime: '08:00',
          capacity: 18,
          instructor: 'Kru Salas',
        },
        {
          tenantId: iron,
          name: 'Muay Thai principiantes',
          weekday: 4,
          startTime: '07:00',
          endTime: '08:00',
          capacity: 18,
          instructor: 'Kru Salas',
        },
        {
          tenantId: iron,
          name: 'Clinch y rodillas',
          weekday: 6,
          startTime: '10:00',
          endTime: '11:30',
          capacity: 14,
          instructor: 'Kru Salas',
        },
      ]);
      await enroll(tx, iron, userId('Mathyu Quispe'), plans('2x'), date(-43), date(-12));
    });

    // --- Asistencia --------------------------------------------------------
    // Mathyu en Nova: le queda exactamente una sesión de la semana.
    await markAttendance(
      db,
      nova,
      userId('Mathyu Quispe'),
      thisWeekDays(lastSessionUsed).map((day, index) => ({
        day,
        hour: '19:00',
        // Uno de ellos manual, para que el historial muestre los dos métodos.
        method: index === 1 ? ('manual' as const) : ('qr' as const),
      })),
    );
    // Y la semana pasada completa, para que el historial tenga dos semanas.
    await markAttendance(
      db,
      nova,
      userId('Mathyu Quispe'),
      lastWeekDays(3).map((day) => ({ day, hour: '19:00' })),
    );
    // Julio con el cupo agotado.
    await markAttendance(
      db,
      shotokan,
      userId('Julio Salcedo'),
      thisWeekDays(exhaustedUsed).map((day) => ({ day, hour: '19:00' })),
    );

    // --- Pagos ya cobrados -------------------------------------------------
    // Todos manuales: en la versión 1 no hay otro camino.
    await recordPastPayment(db, shotokan, userId('Mathyu Quispe'), 180, 'cash', date(-20), date(11));
    await recordPastPayment(db, nova, userId('Mathyu Quispe'), 150, 'yape', date(-11), date(20));
    await recordPastPayment(db, iron, userId('Mathyu Quispe'), 120, 'cash', date(-43), date(-12));

    log('[seed] listo');
    log('');
    log('  Sesiones de prueba (ALLOW_DEV_LOGIN=true):');
    log('    alumno    POST /v1/auth/dev-login  { "phone": "+51987654321" }  Mathyu, 3 gimnasios');
    log('    recepción POST /v1/auth/dev-login  { "phone": "+51987000111" }  Ana, Dojo Shotokan');
    log('    recepción POST /v1/auth/dev-login  { "phone": "+51987000222" }  Carlos, Nova BJJ');
    log('    dueño     POST /v1/auth/dev-login  { "phone": "+51987000333" }  Sergio, Iron Muay Thai');
    log('');
    log('  Estados sembrados en Dojo Shotokan:');
    log('    Lucía   al día');
    log(`    Mathyu  en Nova BJJ: le queda 1 sesión (${lastSessionUsed}/${lastSessionUsed + 1})`);
    log(`    Julio   al día, cupo semanal agotado (${exhaustedUsed}/${exhaustedUsed})`);
    log('    Rosa    en gracia, debe una mensualidad');
    log('    Diego   suspendido, 12 días de mora');
  } finally {
    await pool.end();
  }
}

type Tx = Parameters<Parameters<ReturnType<typeof createDatabase>['transaction']>[0]>[0];

/** Devuelve un buscador y no un mapa: un plan que falta debe fallar aqui. */
type PlanLookup = (key: string) => string;

async function insertPlans(
  tx: Tx,
  tenantId: string,
  specs: readonly PlanSpec[],
): Promise<PlanLookup> {
  const rows = await tx
    .insert(schema.plans)
    .values(
      specs.map((spec) => ({
        tenantId,
        name: spec.name,
        type: spec.type,
        sessionsPerWeek: spec.sessionsPerWeek ?? null,
        allowedDays: spec.allowedDays === undefined ? null : [...spec.allowedDays],
        priceCents: fromSoles(spec.soles),
      })),
    )
    .returning({ id: schema.plans.id, name: schema.plans.name });

  const byKey = new Map<string, string>();
  for (const spec of specs) {
    const found = rows.find((row) => row.name === spec.name);
    if (found === undefined) throw new Error(`No se insertó el plan ${spec.name}.`);
    byKey.set(spec.key, found.id);
  }

  return (key: string): string => {
    const id = byKey.get(key);
    if (id === undefined) throw new Error(`El gimnasio no tiene el plan "${key}".`);
    return id;
  };
}

async function enroll(
  tx: Tx,
  tenantId: string,
  userId: string,
  planId: string,
  startDate: string,
  nextBillingDate: string,
): Promise<void> {
  const [membership] = await tx
    .insert(schema.memberships)
    .values({ userId, tenantId, status: 'active' })
    .returning({ id: schema.memberships.id });

  await tx.insert(schema.subscriptions).values({
    tenantId,
    membershipId: membership!.id,
    planId,
    // El estado real lo calcula `evaluateDelinquency` al leer; esta columna es
    // un caché que el cron refresca. Se siembra en `active` a propósito, para
    // comprobar que el cálculo en vivo la corrige sin esperar al cron.
    status: 'active',
    startDate,
    periodStart: startDate,
    nextBillingDate,
  });
}

interface AttendanceSpec {
  readonly day: PlainDate;
  readonly hour: string;
  readonly method?: 'qr' | 'manual';
}

async function markAttendance(
  db: ReturnType<typeof createDatabase>,
  tenantId: string,
  userId: string,
  specs: readonly AttendanceSpec[],
): Promise<void> {
  await withTenant(db, tenantId, async (tx) => {
    const [row] = await tx
      .select({
        membershipId: schema.memberships.id,
        subscriptionId: schema.subscriptions.id,
      })
      .from(schema.memberships)
      .innerJoin(
        schema.subscriptions,
        eq(schema.subscriptions.membershipId, schema.memberships.id),
      )
      .where(eq(schema.memberships.userId, userId))
      .limit(1);

    if (row === undefined) return;

    const [staffRow] = await tx
      .select({ id: schema.staff.id })
      .from(schema.staff)
      .limit(1);

    if (specs.length === 0) return;

    await tx
      .insert(schema.attendance)
      .values(
        specs.map((spec) => {
          const day = spec.day;
          const method = spec.method ?? 'qr';
          return {
            tenantId,
            membershipId: row.membershipId,
            subscriptionId: row.subscriptionId,
            checkedInAt: new Date(`${formatPlainDate(day)}T${spec.hour}:00-05:00`),
            localDate: formatPlainDate(day),
            isoWeek: isoWeekOf(day).key,
            method,
            // Un marcado manual siempre queda a nombre de alguien: lo exige la
            // restricción `attendance_manual_has_staff`.
            recordedBy: method === 'manual' ? (staffRow?.id ?? null) : null,
            syncedAt: new Date(),
          };
        }),
      )
      .onConflictDoNothing();
  });
}

async function recordPastPayment(
  db: ReturnType<typeof createDatabase>,
  tenantId: string,
  userId: string,
  soles: number,
  rail: 'cash' | 'yape' | 'bank_transfer',
  periodStart: string,
  periodEnd: string,
): Promise<void> {
  await withTenant(db, tenantId, async (tx) => {
    const [row] = await tx
      .select({
        membershipId: schema.memberships.id,
        subscriptionId: schema.subscriptions.id,
      })
      .from(schema.memberships)
      .innerJoin(
        schema.subscriptions,
        eq(schema.subscriptions.membershipId, schema.memberships.id),
      )
      .where(eq(schema.memberships.userId, userId))
      .limit(1);

    if (row === undefined) return;

    const [staffRow] = await tx.select({ id: schema.staff.id }).from(schema.staff).limit(1);

    await tx
      .insert(schema.charges)
      .values({
        tenantId,
        subscriptionId: row.subscriptionId,
        membershipId: row.membershipId,
        type: 'renewal',
        amountCents: fromSoles(soles),
        status: 'succeeded',
        rail,
        attempt: 1,
        periodStart,
        periodEnd,
        recordedBy: staffRow?.id ?? null,
      })
      .onConflictDoNothing();
  });
}

// Solo cuando se invoca como script. La prueba de punta a punta importa
// `runSeed` para dejar la base en un estado conocido antes de empezar.
if (require.main === module) {
  runSeed({ reset: process.argv.includes('--reset') }).catch((error: unknown) => {
    console.error('[seed] falló:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
