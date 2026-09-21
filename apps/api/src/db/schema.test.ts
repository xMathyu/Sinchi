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
let promoId = '';
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

describe('suscripcion del gimnasio a Sinchi', () => {
  it('un gimnasio no puede tener dos suscripciones a Sinchi', async () => {
    await db.query(
      `insert into saas_subscriptions (tenant_id, free_until, period_start, next_billing_date)
       values ($1, '2026-10-02', '2026-09-02', '2026-10-02')`,
      [TENANT],
    );

    // La PK es el tenant a proposito: con un `id` propio, un gimnasio podria
    // acabar con dos meses gratis corriendo a la vez.
    await expectRejection(
      () =>
        db.query(
          `insert into saas_subscriptions (tenant_id, free_until, period_start, next_billing_date)
           values ($1, '2027-01-01', '2026-12-01', '2027-01-01')`,
          [TENANT],
        ),
      /saas_subscriptions_pkey/,
    );
  });

  it('la gracia de Sinchi no puede ser cualquier numero', async () => {
    await expectRejection(
      () => db.query(`update saas_subscriptions set grace_days = 400 where tenant_id = $1`, [TENANT]),
      /saas_subscriptions_grace_days_sane/,
    );
  });

  /**
   * La misma garantia que `charges_renewal_once_per_period` le da al alumno.
   * Es lo que evita regalarle un mes al gimnasio cuando dos personas atienden el
   * mismo correo del banco y las dos registran la transferencia.
   */
  it('un solo cobro exitoso por periodo', async () => {
    await db.query(
      `insert into saas_charges (tenant_id, amount_cents, tier, rail, status, period_start, period_end)
       values ($1, 14900, 'up_to_60', 'bank_transfer', 'succeeded', '2026-10-02', '2026-11-02')`,
      [TENANT],
    );

    await expectRejection(
      () =>
        db.query(
          `insert into saas_charges (tenant_id, amount_cents, tier, rail, status, period_start, period_end)
           values ($1, 14900, 'up_to_60', 'yape', 'succeeded', '2026-10-02', '2026-11-02')`,
          [TENANT],
        ),
      /saas_charges_once_per_period/,
    );
  });

  it('un intento fallido no ocupa el periodo', async () => {
    // El indice es parcial sobre `succeeded`: un cobro que fallo no puede
    // impedir que despues entre el bueno.
    const ok = await db.query(
      `insert into saas_charges (tenant_id, amount_cents, tier, rail, status, period_start, period_end)
       values ($1, 14900, 'up_to_60', 'bank_transfer', 'failed', '2026-11-02', '2026-12-02')
       returning id`,
      [TENANT],
    );
    expect(ok.rows).toHaveLength(1);

    const bueno = await db.query(
      `insert into saas_charges (tenant_id, amount_cents, tier, rail, status, period_start, period_end)
       values ($1, 14900, 'up_to_60', 'yape', 'succeeded', '2026-11-02', '2026-12-02')
       returning id`,
      [TENANT],
    );
    expect(bueno.rows).toHaveLength(1);
  });

  /**
   * El numero de operacion es la llave de idempotencia del pago manual. Hace
   * falta ADEMAS del indice por periodo: registrar un pago adelanta la fecha de
   * cobro, asi que registrar dos veces la misma transferencia no chocaria por
   * periodo — le cobraria al gimnasio dos meses por un solo deposito.
   */
  it('el mismo numero de operacion no entra dos veces', async () => {
    await db.query(
      `insert into saas_charges (tenant_id, amount_cents, tier, rail, status, period_start, period_end, reference)
       values ($1, 14900, 'up_to_60', 'bank_transfer', 'succeeded', '2026-12-02', '2027-01-02', 'OP-9911')`,
      [TENANT],
    );

    await expectRejection(
      () =>
        db.query(
          `insert into saas_charges (tenant_id, amount_cents, tier, rail, status, period_start, period_end, reference)
           values ($1, 14900, 'up_to_60', 'yape', 'succeeded', '2027-01-02', '2027-02-02', 'OP-9911')`,
          [TENANT],
        ),
      /saas_charges_reference_once/,
    );
  });

  it('sin numero de operacion no hay choque: el indice es parcial', async () => {
    // Un pago en efectivo no siempre trae comprobante. Que dos filas sin
    // referencia choquen entre si bloquearia el caso normal.
    for (const periodo of ['2027-03-02', '2027-04-02']) {
      const found = await db.query(
        `insert into saas_charges (tenant_id, amount_cents, tier, rail, status, period_start, period_end)
         values ($1, 14900, 'up_to_60', 'cash', 'succeeded', $2, '2027-12-02') returning id`,
        [TENANT, periodo],
      );
      expect(found.rows).toHaveLength(1);
    }
  });

  it('rechaza montos negativos y periodos al reves', async () => {
    await expectRejection(
      () =>
        db.query(
          `insert into saas_charges (tenant_id, amount_cents, tier, rail, status, period_start, period_end)
           values ($1, -1, 'up_to_60', 'yape', 'succeeded', '2027-01-02', '2027-02-02')`,
          [TENANT],
        ),
      /saas_charges_amount_non_negative/,
    );

    await expectRejection(
      () =>
        db.query(
          `insert into saas_charges (tenant_id, amount_cents, tier, rail, status, period_start, period_end)
           values ($1, 14900, 'up_to_60', 'yape', 'succeeded', '2027-02-02', '2027-01-02')`,
          [TENANT],
        ),
      /saas_charges_period_ordered/,
    );
  });
});

describe('codigos de promocion', () => {
  it('el codigo se guarda canonico', async () => {
    // Minusculas o con guiones no entran: si entraran, el indice unico dejaria
    // convivir "SINCHI2026" y "sinchi-2026" como dos codigos distintos.
    await expectRejection(
      () =>
        db.query(
          `insert into saas_promo_codes (code, free_months, max_redemptions)
           values ('sinchi-2026', 1, 10)`,
        ),
      /saas_promo_codes_code_canonical/,
    );

    const ok = await db.query<{ id: string }>(
      `insert into saas_promo_codes (code, free_months, max_redemptions)
       values ('SINCHI2026', 1, 10) returning id`,
    );
    expect(ok.rows).toHaveLength(1);
    promoId = ok.rows[0]!.id;
  });

  it('el mismo codigo no existe dos veces', async () => {
    await expectRejection(
      () =>
        db.query(`insert into saas_promo_codes (code, free_months) values ('SINCHI2026', 1)`),
      /saas_promo_codes_code_key/,
    );
  });

  /**
   * EL tope. No es una comprobacion redundante del codigo: es la unica que
   * sobrevive a dos gimnasios canjeando el ultimo uso en el mismo segundo, donde
   * los dos leen "9 de 10" y los dos escriben 10.
   */
  it('el contador no puede pasarse del tope', async () => {
    await db.query(`update saas_promo_codes set redeemed_count = 10 where id = $1`, [promoId]);

    await expectRejection(
      () => db.query(`update saas_promo_codes set redeemed_count = 11 where id = $1`, [promoId]),
      /saas_promo_codes_within_cap/,
    );

    await db.query(`update saas_promo_codes set redeemed_count = 0 where id = $1`, [promoId]);
  });

  it('sin tope, el contador sube sin limite', async () => {
    const opened = await db.query<{ id: string }>(
      `insert into saas_promo_codes (code, free_months) values ('ABIERTO', 1) returning id`,
    );
    const id = opened.rows[0]!.id;
    const subido = await db.query(
      `update saas_promo_codes set redeemed_count = 99999 where id = $1 returning id`,
      [id],
    );
    expect(subido.rows).toHaveLength(1);
  });

  it('los meses de regalo tienen tope', async () => {
    await expectRejection(
      () => db.query(`insert into saas_promo_codes (code, free_months) values ('MUCHOS', 13)`),
      /saas_promo_codes_months_sane/,
    );
  });

  /** La otra mitad del tope: sin esto, un solo gimnasio gasta los diez usos. */
  it('un gimnasio no canjea el mismo codigo dos veces', async () => {
    await db.query(
      `insert into saas_redemptions (promo_code_id, tenant_id, free_months, free_until_after)
       values ($1, $2, 1, '2026-11-02')`,
      [promoId, TENANT],
    );

    await expectRejection(
      () =>
        db.query(
          `insert into saas_redemptions (promo_code_id, tenant_id, free_months, free_until_after)
           values ($1, $2, 1, '2026-12-02')`,
          [promoId, TENANT],
        ),
      /saas_redemptions_once_per_tenant/,
    );
  });

  it('otro gimnasio si puede canjearlo', async () => {
    const other = await db.query(
      `insert into saas_redemptions (promo_code_id, tenant_id, free_months, free_until_after)
       values ($1, $2, 1, '2026-11-02') returning id`,
      [promoId, OTHER_TENANT],
    );
    expect(other.rows).toHaveLength(1);
  });
});

describe('plan gratis', () => {
  it('los enums aceptan el escalon y el estado nuevos', async () => {
    // Se agregaron con ALTER TYPE ADD VALUE sobre los enums existentes, no
    // recreandolos: recrear obliga a soltar y rehacer cada columna que los usa.
    const foundRows = await db.query<{ tier: string; status: string }>(
      `insert into saas_subscriptions (tenant_id, tier, status, free_until, period_start, next_billing_date)
       values ($1, 'free', 'free', '2026-10-02', '2026-09-02', '2026-10-02')
       on conflict (tenant_id) do update set tier = 'free', status = 'free'
       returning tier, status`,
      [OTHER_TENANT],
    );
    expect(foundRows.rows[0]).toEqual({ tier: 'free', status: 'free' });
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

describe('clase gratis', () => {
  /** Contexto de quien reservó sin tener ficha: lo abre su cuenta de Firebase. */
  const setTrialAccount = async (uid: string | null): Promise<void> => {
    await db.query(`select set_config('app.trial_account', $1, false)`, [uid ?? '']);
  };

  const reservar = async (
    tenant: string,
    phone: string,
    overrides: { readonly userId?: string; readonly uid?: string; readonly date?: string } = {},
  ) =>
    db.query<{ id: string }>(
      `insert into class_bookings
         (tenant_id, user_id, firebase_uid, full_name, phone, class_name, local_date, start_time, end_time)
       values ($1, $2, $3, 'Interesado', $4, 'Fundamentos', $5, '19:00', '20:30') returning id`,
      [
        tenant,
        overrides.userId ?? null,
        overrides.uid ?? 'firebase-uid-1',
        phone,
        overrides.date ?? '2026-09-01',
      ],
    );

  it('una clase gratis por persona y por gimnasio', async () => {
    await setContext(TENANT, null);
    await reservar(TENANT, '+51900000001');

    // La regla del producto, garantizada por la base: dos peticiones a la vez
    // pasan el `select` previo del servicio y solo el índice las separa.
    await expectRejection(
      () => reservar(TENANT, '+51900000001'),
      /class_bookings_one_trial_per_phone/,
    );
  });

  /**
   * «Una por gimnasio» es la regla de la PRUEBA (0022). Sin el filtro por tipo,
   * quien probó el martes no podría reservar su inscripción el jueves: el índice
   * la confundiría con una segunda clase gratis.
   */
  it('quien ya probó puede reservar su inscripción', async () => {
    await setContext(TENANT, null);
    const result = await db.query(
      `insert into class_bookings
         (tenant_id, firebase_uid, full_name, phone, class_name, local_date, start_time, end_time, kind, plan_name)
       values ($1, 'firebase-uid-1', 'Interesado', '+51900000001', 'Fundamentos', '2026-09-03', '19:00', '20:30', 'enrollment', 'Ilimitado')
       returning id`,
      [TENANT],
    );
    expect(result.rows).toHaveLength(1);
  });

  it('una inscripción sin plan no se puede guardar', async () => {
    // El plan es lo que el mostrador necesita para hacer la ficha: sin él, la
    // reserva dice «quiere inscribirse» y no dice en qué.
    await setContext(TENANT, null);
    await expectRejection(
      () =>
        db.query(
          `insert into class_bookings
             (tenant_id, firebase_uid, full_name, phone, class_name, local_date, start_time, end_time, kind)
           values ($1, 'uid-y', 'Sin Plan', '+51900000011', 'Fundamentos', '2026-09-01', '19:00', '20:30', 'enrollment')`,
          [TENANT],
        ),
      /class_bookings_enrollment_has_plan/,
    );
  });

  it('la clase suelta la paga también quien no tiene ficha', async () => {
    await setContext(TENANT, null);
    const paid = await db.query(
      `insert into charges (tenant_id, membership_id, type, amount_cents, status, rail)
       values ($1, null, 'drop_in', 2500, 'succeeded', 'cash') returning id`,
      [TENANT],
    );
    expect(paid.rows).toHaveLength(1);

    // La matrícula no: se cobra al inscribir, y sin ficha no hay a quién.
    await expectRejection(
      () =>
        db.query(
          `insert into charges (tenant_id, membership_id, type, amount_cents, status, rail)
           values ($1, null, 'enrollment', 5000, 'succeeded', 'cash')`,
          [TENANT],
        ),
      /charges_membership_unless_walk_in/,
    );
  });

  it('cancelar libera el cupo', async () => {
    await setContext(TENANT, null);
    await db.query(
      `update class_bookings set status = 'canceled', canceled_at = now() where phone = $1`,
      ['+51900000001'],
    );

    // Quien avisa que no puede el martes tiene que poder venir el jueves.
    const other = await reservar(TENANT, '+51900000001', { date: '2026-09-08' });
    expect(other.rows).toHaveLength(1);
  });

  it('el mismo celular sí puede probar OTRO gimnasio', async () => {
    await setContext(OTHER_TENANT, null);
    const result = await reservar(OTHER_TENANT, '+51900000001');
    expect(result.rows).toHaveLength(1);
  });

  it('una reserva sin cuenta detrás no se puede guardar', async () => {
    // Sin identidad ni cuenta, la reserva no pertenece a nadie: el gimnasio no
    // puede reconocer a quien viene y la persona no puede volver a verla.
    await setContext(TENANT, null);
    await expectRejection(
      () =>
        db.query(
          `insert into class_bookings
             (tenant_id, full_name, phone, class_name, local_date, start_time, end_time)
           values ($1, 'Fantasma', '+51900000009', 'Fundamentos', '2026-09-01', '19:00', '20:30')`,
          [TENANT],
        ),
      /class_bookings_has_account/,
    );
  });

  it('cancelada implica fecha de cancelación', async () => {
    await setContext(TENANT, null);
    await expectRejection(
      () =>
        db.query(
          `insert into class_bookings
             (tenant_id, firebase_uid, full_name, phone, class_name, local_date, start_time, end_time, status)
           values ($1, 'uid-x', 'Sin Fecha', '+51900000010', 'Fundamentos', '2026-09-01', '19:00', '20:30', 'canceled')`,
          [TENANT],
        ),
      /class_bookings_canceled_has_date/,
    );
  });

  /**
   * Aquí se comprueba la POLÍTICA, no el filtrado.
   *
   * PGlite corre como superusuario y un superusuario se salta RLS aunque la
   * tabla la tenga forzada, así que un test de "el otro gimnasio no ve nada"
   * pasaría en verde sin probar nada. El filtrado de verdad se prueba en
   * `trials.e2e.test.ts`, contra Postgres y con un rol sin BYPASSRLS.
   *
   * Lo que sí se puede comprobar aquí es que existan las tres puertas, que es lo
   * que se rompería al editar la política sin darse cuenta.
   */
  it('la política deja pasar al gimnasio, al dueño de la reserva y a su cuenta', async () => {
    const { rows } = await db.query<{ qual: string; withcheck: string | null }>(
      `select pg_get_expr(polqual, polrelid) as qual,
              pg_get_expr(polwithcheck, polrelid) as withcheck
         from pg_policy where polrelid = 'class_bookings'::regclass`,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]!.qual).toContain('app_current_tenant()');
    expect(rows[0]!.qual).toContain('app_current_user()');
    expect(rows[0]!.qual).toContain('app_trial_account()');
    // Escribir sigue exigiendo gimnasio: la reserva nace dentro de uno.
    expect(rows[0]!.withcheck).toContain('app_current_tenant()');
    expect(rows[0]!.withcheck).not.toContain('app_trial_account()');
  });

  it('la cuenta de Firebase se lee de la variable de sesión', async () => {
    await setTrialAccount('firebase-uid-1');
    const { rows } = await db.query<{ account: string | null }>(
      `select app_trial_account() as account`,
    );
    expect(rows[0]!.account).toBe('firebase-uid-1');

    await setTrialAccount(null);
    const blank = await db.query<{ account: string | null }>(
      `select app_trial_account() as account`,
    );
    // Falla cerrado: sin cuenta, la comparación da NULL y no abre ninguna fila.
    expect(blank.rows[0]!.account).toBeNull();
    await setContext(TENANT, USER);
  });
});

describe('rutinas', () => {
  async function newRoutine(): Promise<string> {
    const { rows } = await db.query<{ id: string }>(
      `insert into routines (tenant_id, title) values ($1, 'Día de pecho') returning id`,
      [TENANT],
    );
    return rows[0]!.id;
  }

  /**
   * De los dos errores posibles, publicar sin querer hacia todo internet es el
   * que no se deshace: el enlace ya salió.
   */
  it('nace de alumnos y sin publicar', async () => {
    const id = await newRoutine();
    const { rows } = await db.query<{ visibility: string; status: string }>(
      `select visibility, status from routines where id = $1`,
      [id],
    );
    expect(rows[0]).toEqual({ visibility: 'members', status: 'draft' });
  });

  it('un título en blanco no es un título', async () => {
    await expectRejection(
      () => db.query(`insert into routines (tenant_id, title) values ($1, '   ')`, [TENANT]),
      /routines_title_not_blank/,
    );
  });

  /**
   * El CHECK va con `IS NULL OR` a propósito: una comparación con NULL da NULL,
   * y NULL en un CHECK PASA. En esta misma base ya se colaron dos así.
   */
  it('el video puede faltar, pero no puede ser una cadena vacía', async () => {
    await db.query(
      `insert into routines (tenant_id, title, video_url) values ($1, 'Sin video', null)`,
      [TENANT],
    );
    await expectRejection(
      () =>
        db.query(`insert into routines (tenant_id, title, video_url) values ($1, 'Vacío', '  ')`, [
          TENANT,
        ]),
      /routines_video_url_not_blank/,
    );
  });

  /**
   * El orden es un dato, no una sugerencia: un calentamiento después del trabajo
   * fuerte es otra rutina. Sin el índice, dos pasos empatados salen en el orden
   * que quiera Postgres y la lista cambia sola entre dos aperturas.
   */
  it('dos pasos no pueden ocupar la misma posición', async () => {
    const routine = await newRoutine();
    await db.query(
      `insert into routine_items (tenant_id, routine_id, position, title) values ($1, $2, 0, 'Press banca')`,
      [TENANT, routine],
    );
    await expectRejection(
      () =>
        db.query(
          `insert into routine_items (tenant_id, routine_id, position, title) values ($1, $2, 0, 'Fondos')`,
          [TENANT, routine],
        ),
      /routine_items_position_per_routine/,
    );
  });

  it('la misma posición en otra rutina sí: el índice es por rutina', async () => {
    const other = await newRoutine();
    await db.query(
      `insert into routine_items (tenant_id, routine_id, position, title) values ($1, $2, 0, 'Uchimata')`,
      [TENANT, other],
    );
    const { rows } = await db.query<{ total: number }>(
      `select count(*)::int as total from routine_items where routine_id = $1`,
      [other],
    );
    expect(rows[0]!.total).toBe(1);
  });

  /**
   * O enlace, o archivo, o nada: nunca los dos. Con los dos puestos hay dos
   * videos para un mismo paso y quien lee decide cuál gana; el día que la app y
   * el panel decidan distinto, el alumno y el dueño miran cosas distintas.
   */
  it('una rutina no puede tener enlace y archivo a la vez', async () => {
    const { rows } = await db.query<{ id: string }>(
      `insert into routine_videos (tenant_id, object_path, content_type, status)
       values ($1, 'kaizen/' || gen_random_uuid() || '.mp4', 'video/mp4', 'pending') returning id`,
      [TENANT],
    );
    const asset = rows[0]!.id;

    // Cada uno por su lado, sí.
    await db.query(
      `insert into routines (tenant_id, title, video_asset_id) values ($1, 'Subido', $2)`,
      [TENANT, asset],
    );
    await db.query(
      `insert into routines (tenant_id, title, video_url) values ($1, 'Enlazado', 'https://youtu.be/x')`,
      [TENANT],
    );

    await expectRejection(
      () =>
        db.query(
          `insert into routines (tenant_id, title, video_url, video_asset_id)
           values ($1, 'Los dos', 'https://youtu.be/x', $2)`,
          [TENANT, asset],
        ),
      /routines_one_video_source/,
    );
  });

  it('un video listo lleva fecha de listo, y uno pendiente no', async () => {
    await expectRejection(
      () =>
        db.query(
          `insert into routine_videos (tenant_id, object_path, content_type, status)
           values ($1, 'kaizen/sin-fecha.mp4', 'video/mp4', 'ready')`,
          [TENANT],
        ),
      /routine_videos_ready_has_date/,
    );
  });

  /**
   * Dos filas apuntando al mismo objeto es una de las dos sirviendo el video de
   * la otra, y borrar una deja a la otra apuntando a un objeto que ya no está.
   */
  it('dos videos no pueden apuntar al mismo objeto', async () => {
    await db.query(
      `insert into routine_videos (tenant_id, object_path, content_type)
       values ($1, 'kaizen/mismo.mp4', 'video/mp4')`,
      [TENANT],
    );
    await expectRejection(
      () =>
        db.query(
          `insert into routine_videos (tenant_id, object_path, content_type)
           values ($1, 'kaizen/mismo.mp4', 'video/mp4')`,
          [TENANT],
        ),
      /routine_videos_object_path_key/,
    );
  });

  it('borrar la rutina se lleva sus pasos', async () => {
    const routine = await newRoutine();
    await db.query(
      `insert into routine_items (tenant_id, routine_id, position, title) values ($1, $2, 0, 'Uchimata')`,
      [TENANT, routine],
    );
    await db.query(`delete from routines where id = $1`, [routine]);
    const { rows } = await db.query<{ total: number }>(
      `select count(*)::int as total from routine_items where routine_id = $1`,
      [routine],
    );
    expect(rows[0]!.total).toBe(0);
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
      'tenant_gateway',
      'class_bookings',
      'gym_events',
      'event_registrations',
      'routines',
      'routine_items',
      'routine_videos',
      'conversations',
      'messages',
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

describe('conversaciones', () => {
  let uidCounter = 0;
  const nextUid = (): string => `uid-chat-${++uidCounter}`;

  const abrir = (
    tenant: string,
    keys: { readonly userId?: string | null; readonly uid?: string | null },
  ) =>
    db.query<{ id: string }>(
      `insert into conversations (tenant_id, user_id, firebase_uid, full_name, phone)
       values ($1, $2, $3, 'Rosa Curiosa', '+51900000099') returning id`,
      [tenant, keys.userId ?? null, keys.uid === undefined ? nextUid() : keys.uid],
    );

  const escribir = (
    tenant: string,
    conversationId: string,
    body: string,
    firma: { readonly sender?: 'person' | 'gym'; readonly staffName?: string | null } = {},
  ) =>
    db.query(
      `insert into messages (tenant_id, conversation_id, sender, staff_name, body)
       values ($1, $2, $3, $4, $5)`,
      [tenant, conversationId, firma.sender ?? 'person', firma.staffName ?? null, body],
    );

  it('un hilo sin identidad ni cuenta no es de nadie', async () => {
    await expectRejection(() => abrir(TENANT, { uid: null }), /conversations_has_account/);
  });

  it('uno por persona y por gimnasio, no uno por pregunta', async () => {
    await abrir(TENANT, { userId: USER, uid: null });
    await expectRejection(
      () => abrir(TENANT, { userId: USER, uid: null }),
      /conversations_one_per_user/,
    );
    // En otro gimnasio es otro hilo.
    const otro = await abrir(OTHER_TENANT, { userId: USER, uid: null });
    expect(otro.rows).toHaveLength(1);
  });

  it('la misma cuenta sin ficha tampoco abre dos', async () => {
    const uid = nextUid();
    await abrir(TENANT, { uid });
    await expectRejection(() => abrir(TENANT, { uid }), /conversations_one_per_account/);
  });

  /**
   * La clave foranea compuesta. Con una simple sobre `conversation_id`, un
   * `tenant_id` mal puesto dejaria el mensaje en la bandeja de otro gimnasio y la
   * politica —que solo mira esa columna— lo serviria alli.
   */
  it('un mensaje no puede caer en la bandeja de otro gimnasio', async () => {
    const { rows } = await abrir(TENANT, {});
    await expectRejection(
      () => escribir(OTHER_TENANT, rows[0]!.id, 'Hola'),
      /messages_conversation_tenant/,
    );
    await escribir(TENANT, rows[0]!.id, 'Hola');
  });

  it('el mensaje vacio o larguisimo se rechaza, con el mismo tope que la regla', async () => {
    const { rows } = await abrir(TENANT, {});
    await expectRejection(() => escribir(TENANT, rows[0]!.id, '   '), /messages_body_length/);
    await expectRejection(
      () => escribir(TENANT, rows[0]!.id, 'a'.repeat(1001)),
      /messages_body_length/,
    );
    await escribir(TENANT, rows[0]!.id, 'a'.repeat(1000));
  });

  it('un mensaje de la persona no va firmado por el mostrador', async () => {
    const { rows } = await abrir(TENANT, {});
    await expectRejection(
      () => escribir(TENANT, rows[0]!.id, 'Hola', { sender: 'person', staffName: 'Carlos' }),
      /messages_staff_only_from_gym/,
    );
    await escribir(TENANT, rows[0]!.id, 'Hola', { sender: 'gym', staffName: 'Carlos' });
  });

  /**
   * CASCADE y no SET NULL. Con SET NULL, borrar a quien escribio con sesion y sin
   * cuenta de Firebase violaba `conversations_has_account` y el borrado entero
   * fallaba — que es lo que le pasa a `class_bookings` al resetear la siembra.
   */
  it('borrar a la persona se lleva sus hilos y sus mensajes', async () => {
    const persona = '44444444-4444-4444-4444-444444444444';
    await db.query(
      `insert into users (id, name, document_id, phone)
       values ($1, 'Se Va', '70000001', '+51900000777')`,
      [persona],
    );
    const { rows } = await abrir(TENANT, { userId: persona, uid: null });
    await escribir(TENANT, rows[0]!.id, 'Me voy');

    await db.query(`delete from users where id = $1`, [persona]);

    const quedan = await db.query<{ count: number }>(
      `select count(*)::int as count from messages where conversation_id = $1`,
      [rows[0]!.id],
    );
    expect(quedan.rows[0]!.count).toBe(0);
  });

  /** Como en `class_bookings`: PGlite es superusuario, asi que se comprueban las puertas. */
  it('el hilo abre tres puertas y el mensaje se ve con su hilo', async () => {
    const { rows } = await db.query<{ table: string; qual: string; withcheck: string }>(
      `select polrelid::regclass::text as table,
              pg_get_expr(polqual, polrelid) as qual,
              pg_get_expr(polwithcheck, polrelid) as withcheck
         from pg_policy where polrelid in ('conversations'::regclass, 'messages'::regclass)`,
    );
    const hilo = rows.find((row) => row.table === 'conversations')!;
    const mensaje = rows.find((row) => row.table === 'messages')!;

    expect(hilo.qual).toContain('app_current_tenant()');
    expect(hilo.qual).toContain('app_current_user()');
    expect(hilo.qual).toContain('app_trial_account()');
    // Escribir exige gimnasio en los dos.
    expect(hilo.withcheck).not.toContain('app_trial_account()');
    expect(mensaje.qual).toContain('conversations');
    expect(mensaje.withcheck).toContain('app_current_tenant()');
  });
});

/**
 * El panel de Sinchi (migracion 0024).
 *
 * Lo que se comprueba aqui son las dos cosas que el codigo no puede sostener
 * solo: que el correo del administrador no pueda entrar en dos formas, y que un
 * gimnasio suspendido no pueda quedarse sin fecha. Las dos se rompen con un
 * UPDATE desde la consola de Neon, que es justo donde el TypeScript no llega.
 */
describe('quien administra Sinchi', () => {
  it('el primer administrador nace con la migracion', async () => {
    const { rows } = await db.query<{ email: string; revoked_at: string | null }>(
      `select email, revoked_at from platform_admins`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.email).toBe('xmathyu@gmail.com');
    // Nace con acceso vivo: si naciera retirado, nadie podria entrar nunca.
    expect(rows[0]!.revoked_at).toBeNull();
  });

  it('el correo va en minusculas o no entra', async () => {
    await expectRejection(
      () => db.query(`insert into platform_admins (email) values ('Otro@Gmail.com')`),
      /platform_admins_email_normalized/,
    );
    await expectRejection(
      () => db.query(`insert into platform_admins (email) values ('')`),
      /platform_admins_email_normalized/,
    );
  });

  /**
   * Uno por correo CONTANDO a los retirados: volver a invitar a alguien reabre
   * su fila. Con dos filas para el mismo correo, retirarle el acceso a una
   * dejaria la otra viva.
   */
  it('un correo, una fila, aunque se le haya retirado el acceso', async () => {
    await db.query(
      `insert into platform_admins (email, revoked_at) values ('exdev@sinchi.fit', now())`,
    );
    await expectRejection(
      () => db.query(`insert into platform_admins (email) values ('exdev@sinchi.fit')`),
      /platform_admins_email_key/,
    );
  });

  /** El registro tiene que sobrevivir al gimnasio que nombra. */
  it('borrar el gimnasio no borra lo que se hizo con el', async () => {
    const admin = await db.query<{ id: string }>(
      `select id from platform_admins where email = 'xmathyu@gmail.com'`,
    );
    const gym = '55555555-5555-5555-5555-555555555555';
    await db.query(
      `insert into tenants (id, name, tax_id, slug) values ($1, 'Se Va', '20100070970', 'se-va')`,
      [gym],
    );
    await db.query(
      `insert into platform_actions (admin_id, action, tenant_id, subject)
       values ($1, 'gym.delete', $2, 'se-va')`,
      [admin.rows[0]!.id, gym],
    );

    await db.query(`delete from tenants where id = $1`, [gym]);

    const quedan = await db.query<{ subject: string; tenant_id: string }>(
      `select subject, tenant_id from platform_actions where action = 'gym.delete'`,
    );
    expect(quedan.rows).toHaveLength(1);
    // El uuid queda huerfano a proposito, y al lado el slug legible: es lo que
    // se lee cuando ese gimnasio ya no existe.
    expect(quedan.rows[0]!.subject).toBe('se-va');
    expect(quedan.rows[0]!.tenant_id).toBe(gym);
  });

  it('no se puede borrar a un administrador que dejo rastro', async () => {
    const admin = await db.query<{ id: string }>(
      `select id from platform_admins where email = 'xmathyu@gmail.com'`,
    );
    await expectRejection(
      () => db.query(`delete from platform_admins where id = $1`, [admin.rows[0]!.id]),
      /violates RESTRICT setting/,
    );
  });

  it('un gimnasio suspendido lleva su fecha, y uno activo no', async () => {
    const gym = '66666666-6666-6666-6666-666666666666';
    await db.query(
      `insert into tenants (id, name, tax_id, slug) values ($1, 'Con Motivo', '20131312955', 'con-motivo')`,
      [gym],
    );

    await expectRejection(
      () => db.query(`update tenants set status = 'suspended' where id = $1`, [gym]),
      /tenants_suspended_has_date/,
    );
    await expectRejection(
      () => db.query(`update tenants set suspended_at = now() where id = $1`, [gym]),
      /tenants_suspended_has_date/,
    );

    await db.query(
      `update tenants set status = 'suspended', suspended_at = now(), suspended_reason = 'cobra por fuera'
        where id = $1`,
      [gym],
    );
    const { rows } = await db.query<{ status: string }>(
      `select status from tenants where id = $1`,
      [gym],
    );
    expect(rows[0]!.status).toBe('suspended');
  });
});
