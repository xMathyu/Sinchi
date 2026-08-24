/**
 * Verificacion de las migraciones contra un Postgres real.
 *
 * Corre sobre PGlite (Postgres compilado a WASM): sin Docker, sin servidor y en
 * un par de segundos, pero es Postgres de verdad, asi que valida lo que un
 * parser de SQL no puede — que los CHECK realmente rechacen, que los indices
 * parciales realmente sean unicos y que las politicas RLS se creen.
 *
 * Existe porque una migracion se aplica una sola vez sobre datos reales. Si el
 * indice de idempotencia del cobro tiene un error de sintaxis, no se descubre
 * revisando el archivo: se descubre cobrandole dos veces a un alumno.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = join(__dirname, '../../drizzle');

let db: PGlite;

/** Aplica los .sql en orden, partiendo por los breakpoints de Drizzle. */
async function applyMigrations(target: PGlite): Promise<string[]> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    const statements = sql
      .split('--> statement-breakpoint')
      .map((chunk) => chunk.trim())
      .filter((chunk) => chunk.length > 0);

    for (const statement of statements) {
      try {
        await target.exec(statement);
      } catch (error) {
        throw new Error(
          `${file} falló en:\n${statement.slice(0, 300)}\n\n${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }
  return files;
}

/** Contexto de tenant, igual que `withContext` en producción. */
async function setContext(tenantId: string | null, userId: string | null): Promise<void> {
  await db.query(`select set_config('app.current_tenant', $1, false)`, [tenantId ?? '']);
  await db.query(`select set_config('app.current_user', $1, false)`, [userId ?? '']);
}

async function expectRejection(run: () => Promise<unknown>, matcher: RegExp): Promise<void> {
  let message = '';
  try {
    await run();
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  expect(message, 'se esperaba que Postgres rechazara la operación').not.toBe('');
  expect(message).toMatch(matcher);
}

const TENANT = '11111111-1111-1111-1111-111111111111';
const OTHER_TENANT = '22222222-2222-2222-2222-222222222222';
const USER = '33333333-3333-3333-3333-333333333333';
let membershipId = '';
let subscriptionId = '';
let planId = '';

beforeAll(async () => {
  db = new PGlite();
  await applyMigrations(db);

  // Datos mínimos. `tenants` y `users` no llevan RLS: la identidad es global.
  await db.query(
    `insert into tenants (id, name, tax_id, slug) values ($1, 'Dojo Test', '20512345678', 'dojo-test')`,
    [TENANT],
  );
  await db.query(
    `insert into tenants (id, name, tax_id, slug) values ($1, 'Otro Dojo', '20599999999', 'otro-dojo')`,
    [OTHER_TENANT],
  );
  await db.query(
    `insert into users (id, name, document_id, phone) values ($1, 'Mathyu Quispe', '71448902', '+51987654321')`,
    [USER],
  );

  await setContext(TENANT, USER);

  const plan = await db.query<{ id: string }>(
    `insert into plans (tenant_id, name, type, sessions_per_week, price_cents)
     values ($1, '2x por semana', 'sessions_per_week', 2, 12000) returning id`,
    [TENANT],
  );
  planId = plan.rows[0]!.id;

  const membership = await db.query<{ id: string }>(
    `insert into memberships (user_id, tenant_id) values ($1, $2) returning id`,
    [USER, TENANT],
  );
  membershipId = membership.rows[0]!.id;

  const subscription = await db.query<{ id: string }>(
    `insert into subscriptions (tenant_id, membership_id, plan_id, start_date, period_start, next_billing_date)
     values ($1, $2, $3, '2026-07-12', '2026-08-12', '2026-09-12') returning id`,
    [TENANT, membershipId, planId],
  );
  subscriptionId = subscription.rows[0]!.id;
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe('migraciones', () => {
  it('se aplican completas', async () => {
    const { rows } = await db.query<{ count: number }>(
      `select count(*)::int as count from information_schema.tables where table_schema = 'public'`,
    );
    // 13 tablas del esquema.
    expect(rows[0]!.count).toBeGreaterThanOrEqual(13);
  });

  it('crea los enums del dominio', async () => {
    const { rows } = await db.query<{ typname: string }>(
      `select typname from pg_type where typtype = 'e' order by typname`,
    );
    const names = rows.map((row) => row.typname);
    expect(names).toContain('subscription_status');
    expect(names).toContain('payment_rail');
    expect(names).toContain('charge_type');
  });
});

describe('idempotencia del cobro', () => {
  it('un solo cargo de renovación exitoso por periodo', async () => {
    // La garantía del MD 4.1: si el cron corre dos veces, no cobra dos veces.
    await db.query(
      `insert into charges (tenant_id, subscription_id, membership_id, type, amount_cents, status, rail, period_start, period_end)
       values ($1, $2, $3, 'renewal', 12000, 'succeeded', 'cash', '2026-09-12', '2026-10-12')`,
      [TENANT, subscriptionId, membershipId],
    );

    await expectRejection(
      () =>
        db.query(
          `insert into charges (tenant_id, subscription_id, membership_id, type, amount_cents, status, rail, period_start, period_end)
           values ($1, $2, $3, 'renewal', 12000, 'succeeded', 'cash', '2026-09-12', '2026-10-12')`,
          [TENANT, subscriptionId, membershipId],
        ),
      /charges_renewal_once_per_period/,
    );
  });

  it('permite cobrar otro periodo', async () => {
    const result = await db.query(
      `insert into charges (tenant_id, subscription_id, membership_id, type, amount_cents, status, rail, period_start, period_end)
       values ($1, $2, $3, 'renewal', 12000, 'succeeded', 'cash', '2026-10-12', '2026-11-12') returning id`,
      [TENANT, subscriptionId, membershipId],
    );
    expect(result.rows).toHaveLength(1);
  });

  it('un cargo de renovación sin periodo no pasa', async () => {
    // Sin esta restricción, una renovación sin periodo se escapa del índice de
    // idempotencia y se puede cobrar dos veces el mismo mes.
    await expectRejection(
      () =>
        db.query(
          `insert into charges (tenant_id, subscription_id, membership_id, type, amount_cents, status, rail)
           values ($1, $2, $3, 'renewal', 12000, 'succeeded', 'cash')`,
          [TENANT, subscriptionId, membershipId],
        ),
      /charges_renewal_has_period/,
    );
  });

  it('el riel de tarjeta está cerrado en la versión 1', async () => {
    await expectRejection(
      () =>
        db.query(
          `insert into charges (tenant_id, subscription_id, membership_id, type, amount_cents, status, rail)
           values ($1, $2, $3, 'drop_in', 2500, 'succeeded', 'card')`,
          [TENANT, subscriptionId, membershipId],
        ),
      /charges_no_card_rail_yet/,
    );
  });

  it('rechaza montos negativos', async () => {
    await expectRejection(
      () =>
        db.query(
          `insert into charges (tenant_id, subscription_id, membership_id, type, amount_cents, status, rail)
           values ($1, $2, $3, 'drop_in', -100, 'succeeded', 'cash')`,
          [TENANT, subscriptionId, membershipId],
        ),
      /charges_amount_non_negative/,
    );
  });
});

describe('asistencia', () => {
  it('un marcado por alumno y día', async () => {
    await db.query(
      `insert into attendance (tenant_id, membership_id, subscription_id, local_date, iso_week, method)
       values ($1, $2, $3, '2026-08-20', '2026-W34', 'qr')`,
      [TENANT, membershipId, subscriptionId],
    );

    // Un doble escaneo en la puerta no puede comerle una sesión del cupo.
    await expectRejection(
      () =>
        db.query(
          `insert into attendance (tenant_id, membership_id, subscription_id, local_date, iso_week, method)
           values ($1, $2, $3, '2026-08-20', '2026-W34', 'qr')`,
          [TENANT, membershipId, subscriptionId],
        ),
      /attendance_once_per_day/,
    );
  });

  it('un marcado manual necesita quedar a nombre de alguien', async () => {
    await expectRejection(
      () =>
        db.query(
          `insert into attendance (tenant_id, membership_id, subscription_id, local_date, iso_week, method)
           values ($1, $2, $3, '2026-08-21', '2026-W34', 'manual')`,
          [TENANT, membershipId, subscriptionId],
        ),
      /attendance_manual_has_staff/,
    );
  });

  it('dejar pasar a un rechazado exige el motivo', async () => {
    await expectRejection(
      () =>
        db.query(
          `insert into attendance (tenant_id, membership_id, subscription_id, local_date, iso_week, method, overrode_denial)
           values ($1, $2, $3, '2026-08-22', '2026-W34', 'qr', true)`,
          [TENANT, membershipId, subscriptionId],
        ),
      /attendance_override_has_reason/,
    );
  });

  it('rechaza una semana ISO con formato inválido', async () => {
    await expectRejection(
      () =>
        db.query(
          `insert into attendance (tenant_id, membership_id, subscription_id, local_date, iso_week, method)
           values ($1, $2, $3, '2026-08-23', 'semana 34', 'qr')`,
          [TENANT, membershipId, subscriptionId],
        ),
      /attendance_iso_week_format/,
    );
  });
});

describe('invariantes del gimnasio', () => {
  it('el día fijo de cobro va del 1 al 28', async () => {
    // Con 29, 30 o 31 el cobro se corre en febrero.
    await expectRejection(
      () =>
        db.query(
          `insert into tenants (name, tax_id, slug, billing_mode, billing_day_of_month)
           values ('X', '20511111111', 'x', 'fixed_day', 31)`,
        ),
      /tenants_billing_day_valid/,
    );

    const ok = await db.query(
      `insert into tenants (name, tax_id, slug, billing_mode, billing_day_of_month)
       values ('Y', '20522222222', 'y', 'fixed_day', 12) returning id`,
    );
    expect(ok.rows).toHaveLength(1);
  });

  it('la política de aniversario no lleva día', async () => {
    await expectRejection(
      () =>
        db.query(
          `insert into tenants (name, tax_id, slug, billing_mode, billing_day_of_month)
           values ('Z', '20533333333', 'z', 'anniversary', 12)`,
        ),
      /tenants_billing_day_valid/,
    );
  });

  it('el día fijo sin día no pasa', async () => {
    // El caso que la lógica trivaluada de SQL dejaba colar: con la restricción
    // escrita como cadena de OR, `fixed_day` con día NULL daba NULL en vez de
    // FALSE y el CHECK lo aceptaba.
    await expectRejection(
      () =>
        db.query(
          `insert into tenants (name, tax_id, slug, billing_mode)
           values ('W', '20544444444', 'w', 'fixed_day')`,
        ),
      /tenants_billing_day_valid/,
    );
  });
});

describe('invariantes del plan', () => {
  it('un plan de sesiones necesita el número de sesiones', async () => {
    await expectRejection(
      () =>
        db.query(
          `insert into plans (tenant_id, name, type, price_cents) values ($1, 'Roto', 'sessions_per_week', 12000)`,
          [TENANT],
        ),
      /plans_type_consistent/,
    );
  });

  it('un plan de días fijos necesita los días', async () => {
    await expectRejection(
      () =>
        db.query(
          `insert into plans (tenant_id, name, type, price_cents) values ($1, 'Roto', 'fixed_days', 11000)`,
          [TENANT],
        ),
      /plans_type_consistent/,
    );
  });

  it('rechaza un plan de días fijos con la lista vacía', async () => {
    // `array_length('{}', 1)` devuelve NULL, no 0: sin el coalesce, este plan
    // pasaba y dejaba al alumno sin ningún día permitido.
    await expectRejection(
      () =>
        db.query(
          `insert into plans (tenant_id, name, type, allowed_days, price_cents)
           values ($1, 'Sin días', 'fixed_days', ARRAY[]::smallint[], 11000)`,
          [TENANT],
        ),
      /plans_allowed_days_valid/,
    );
  });

  it('rechaza días ISO fuera de 1..7', async () => {
    await expectRejection(
      () =>
        db.query(
          `insert into plans (tenant_id, name, type, allowed_days, price_cents)
           values ($1, 'Roto', 'fixed_days', ARRAY[0,8]::smallint[], 11000)`,
          [TENANT],
        ),
      /plans_allowed_days_valid/,
    );
  });
});

describe('suscripciones', () => {
  it('una membresía no puede tener dos suscripciones vivas', async () => {
    await expectRejection(
      () =>
        db.query(
          `insert into subscriptions (tenant_id, membership_id, plan_id, start_date, period_start, next_billing_date)
           values ($1, $2, $3, '2026-07-12', '2026-08-12', '2026-09-12')`,
          [TENANT, membershipId, planId],
        ),
      /subscriptions_one_live_per_membership/,
    );
  });

  it('una suscripción cancelada lleva fecha de cancelación', async () => {
    await expectRejection(
      () =>
        db.query(`update subscriptions set status = 'canceled' where id = $1`, [subscriptionId]),
      /subscriptions_canceled_has_date/,
    );
  });

  it('el periodo no puede terminar antes de empezar', async () => {
    await expectRejection(
      () =>
        db.query(`update subscriptions set next_billing_date = '2026-01-01' where id = $1`, [
          subscriptionId,
        ]),
      /subscriptions_period_ordered/,
    );
  });
});

describe('horarios', () => {
  it('valida el formato de hora y el orden', async () => {
    await expectRejection(
      () =>
        db.query(
          `insert into class_schedules (tenant_id, name, weekday, start_time, end_time)
           values ($1, 'No-Gi', 3, '7pm', '20:30')`,
          [TENANT],
        ),
      /class_schedules_time_format/,
    );

    await expectRejection(
      () =>
        db.query(
          `insert into class_schedules (tenant_id, name, weekday, start_time, end_time)
           values ($1, 'No-Gi', 3, '20:30', '19:00')`,
          [TENANT],
        ),
      /class_schedules_time_format/,
    );

    const ok = await db.query(
      `insert into class_schedules (tenant_id, name, weekday, start_time, end_time)
       values ($1, 'No-Gi', 3, '19:00', '20:30') returning id`,
      [TENANT],
    );
    expect(ok.rows).toHaveLength(1);
  });

  it('rechaza un día de semana fuera de rango', async () => {
    await expectRejection(
      () =>
        db.query(
          `insert into class_schedules (tenant_id, name, weekday, start_time, end_time)
           values ($1, 'Roto', 8, '19:00', '20:30')`,
          [TENANT],
        ),
      /class_schedules_weekday_valid/,
    );
  });
});

describe('aislamiento por tenant', () => {
  it('las políticas quedan creadas y forzadas', async () => {
    const { rows } = await db.query<{
      table_name: string;
      forced: boolean;
      policies: number;
    }>(`
      select c.relname as table_name,
             c.relforcerowsecurity as forced,
             count(p.polname)::int as policies
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        left join pg_policy p on p.polrelid = c.oid
       where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
       group by 1, 2
       order by 1
    `);

    const byTable = new Map(rows.map((row) => [row.table_name, row]));
    for (const table of [
      'memberships',
      'staff',
      'plans',
      'subscriptions',
      'payment_methods',
      'charges',
      'class_schedules',
      'attendance',
      'checkin_devices',
      'tenant_gateway',
    ]) {
      const entry = byTable.get(table);
      expect(entry, `${table} debería tener RLS`).toBeDefined();
      expect(entry!.forced, `${table} debería tener FORCE`).toBe(true);
      expect(entry!.policies, `${table} debería tener una política`).toBeGreaterThanOrEqual(1);
    }
  });

  it('`users` y `tenants` no llevan RLS: la identidad es global', async () => {
    const { rows } = await db.query<{ relname: string }>(
      `select relname from pg_class where relname in ('users', 'tenants') and relrowsecurity`,
    );
    expect(rows).toHaveLength(0);
  });

  it('las funciones de contexto leen la variable de sesión', async () => {
    await setContext(TENANT, USER);
    const { rows } = await db.query<{ tenant: string; user: string }>(
      `select app_current_tenant()::text as tenant, app_current_user()::text as "user"`,
    );
    expect(rows[0]!.tenant).toBe(TENANT);
    expect(rows[0]!.user).toBe(USER);
  });

  it('sin contexto, las funciones devuelven null y la política falla cerrado', async () => {
    await setContext(null, null);
    const { rows } = await db.query<{ tenant: string | null }>(
      `select app_current_tenant()::text as tenant`,
    );
    expect(rows[0]!.tenant).toBeNull();
    await setContext(TENANT, USER);
  });
});
