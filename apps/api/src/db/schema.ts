/**
 * Esquema de la base. Espejo del MD 5, con las columnas en ingles snake_case
 * segun `docs/glosario.md`.
 *
 * Dos decisiones estructurales que se ven aqui y no se pueden cambiar despues
 * sin una migracion dolorosa:
 *
 *  1. `users` vive FUERA del tenant. El objetivo del producto es que una
 *     persona tenga en una sola app todas sus suscripciones, de todos los
 *     gimnasios a los que asiste. Si la identidad naciera dentro del tenant, el
 *     mismo alumno quedaria duplicado en cada local. `memberships` es la que lo
 *     vincula a cada gimnasio.
 *
 *  2. `charges` es un ledger append-only. Nada de actualizar montos: se crea un
 *     cargo nuevo. Es la unica fuente de verdad del estado de pago, sin importar
 *     el metodo (MD 4.5).
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const membershipStatusEnum = pgEnum('membership_status', ['active', 'inactive']);
export const tenantStatusEnum = pgEnum('tenant_status', ['active', 'suspended']);
export const saasTierEnum = pgEnum('saas_tier', ['up_to_60', 'up_to_150', 'unlimited']);
export const billingModeEnum = pgEnum('billing_mode', ['anniversary', 'fixed_day']);
export const quotaOverflowPolicyEnum = pgEnum('quota_overflow_policy', ['block', 'offer_drop_in']);
export const staffRoleEnum = pgEnum('staff_role', ['owner', 'front_desk']);
export const planTypeEnum = pgEnum('plan_type', [
  'unlimited',
  'sessions_per_week',
  'fixed_days',
]);
export const subscriptionStatusEnum = pgEnum('subscription_status', [
  'active',
  'in_grace',
  'suspended',
  'canceled',
]);
export const cardBrandEnum = pgEnum('card_brand', [
  'Visa',
  'Mastercard',
  'Amex',
  'Diners',
  'Unknown',
]);
export const chargeTypeEnum = pgEnum('charge_type', [
  'renewal',
  'proration',
  'enrollment',
  'drop_in',
  'saas',
]);
export const chargeStatusEnum = pgEnum('charge_status', ['pending', 'succeeded', 'failed']);
export const paymentRailEnum = pgEnum('payment_rail', [
  'card',
  'yape',
  'cash',
  'bank_transfer',
]);
export const checkInMethodEnum = pgEnum('check_in_method', ['qr', 'manual']);
export const trialBookingStatusEnum = pgEnum('trial_booking_status', [
  'booked',
  'attended',
  'no_show',
  'canceled',
]);

// ---------------------------------------------------------------------------
// Identidad global
// ---------------------------------------------------------------------------

/**
 * Identidad de la persona, unica en toda la red. Sin `tenant_id` a proposito.
 *
 * El secreto TOTP tambien es global: un solo codigo identifica al alumno en
 * cualquier gimnasio y el servidor resuelve contra que membresia validarlo
 * (MD 4.6).
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    /** DNI o carne de extranjeria. */
    documentId: text('document_id').notNull(),
    email: text('email'),
    /** La llave con la que el alumno se reconoce. */
    phone: text('phone').notNull(),
    photoUrl: text('photo_url'),
    /**
     * Secreto TOTP cifrado en reposo. Nunca en texto plano, nunca en logs.
     * El cifrado lo hace la aplicacion; la base solo guarda el sobre.
     */
    totpSecretEncrypted: text('totp_secret_encrypted'),
    /**
     * Cuenta de Google vinculada. `null` mientras la ficha del padron no tiene
     * dueno digital: la recepcionista la creo antes de que el alumno instalara
     * la app, que es el caso normal.
     */
    firebaseUid: text('firebase_uid'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('users_phone_key').on(t.phone),
    uniqueIndex('users_document_key').on(t.documentId),
    uniqueIndex('users_firebase_uid_key')
      .on(t.firebaseUid)
      .where(sql`firebase_uid is not null`),
  ],
);

/**
 * Codigo con el que una cuenta de Google reclama una ficha del padron.
 *
 * Sin `tenant_id` a proposito: se emite ANTES de saber a que gimnasio pertenece
 * la persona. La proteccion no esta aqui sino del otro lado — confirmar exige
 * una sesion de staff y una membresia, y las membresias si estan aisladas por
 * RLS, asi que un recepcionista solo puede vincular contra su propio padron.
 */
export const accountClaims = pgTable(
  'account_claims',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    firebaseUid: text('firebase_uid').notNull(),
    email: text('email'),
    /**
     * Como se presenta esta persona: el nombre que escribio al crear la cuenta
     * si lo hizo, y el que dijo Google si no.
     */
    displayName: text('display_name'),
    /**
     * Celular, si lo dio al registrarse.
     *
     * Sin unicidad a proposito: `users.phone` es la llave del alumno en el
     * padron, pero esto todavia no es un alumno — es una cuenta a medio camino.
     * Lo unico que tiene que ser unico es la reserva por gimnasio, y de eso se
     * encarga `trial_bookings_one_per_phone`.
     */
    phone: text('phone'),
    /** 6 digitos: se dicta en voz alta en el mostrador. */
    code: text('code').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    consumedBy: uuid('consumed_by').references(() => staff.id, { onDelete: 'set null' }),
    linkedUserId: uuid('linked_user_id').references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('account_claims_active_code')
      .on(t.code)
      .where(sql`consumed_at is null`),
    index('account_claims_firebase_uid_idx').on(t.firebaseUid),
  ],
);

// ---------------------------------------------------------------------------
// Tenant
// ---------------------------------------------------------------------------

export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    /** RUC. */
    taxId: text('tax_id').notNull(),
    slug: text('slug').notNull(),
    timezone: text('timezone').notNull().default('America/Lima'),
    saasTier: saasTierEnum('saas_tier').notNull().default('up_to_60'),
    graceDays: smallint('grace_days').notNull().default(5),
    /**
     * MD 8.1 sigue abierto: no se decidio si se cobra el dia de inscripcion de
     * cada alumno o un dia fijo del mes. Las dos formas estan implementadas y la
     * eleccion es configuracion, no una constante en el codigo.
     */
    billingMode: billingModeEnum('billing_mode').notNull().default('anniversary'),
    /** Solo para `fixed_day`. Tope 28: con 29-31 el cobro se corre en febrero. */
    billingDayOfMonth: smallint('billing_day_of_month'),
    /** MD 8.2 sigue abierto: el motor informa, el gimnasio decide. */
    quotaOverflowPolicy: quotaOverflowPolicyEnum('quota_overflow_policy')
      .notNull()
      .default('block'),
    dropInPriceCents: integer('drop_in_price_cents'),
    /** Matricula: se cobra una vez al inscribirse. 0 = el gimnasio no cobra. */
    enrollmentFeeCents: integer('enrollment_fee_cents').notNull().default(0),
    /**
     * Ofrece la primera clase gratis a quien lo descubre desde la app.
     *
     * Por defecto si: un local que sale en el directorio y no deja probar
     * desperdicia la visita. Es configuracion del gimnasio, no del producto.
     */
    trialClassEnabled: boolean('trial_class_enabled').notNull().default(true),
    status: tenantStatusEnum('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('tenants_slug_key').on(t.slug),
    // Un dia fijo de cobro exige el dia, y solo entre 1 y 28.
    index('tenants_billing_mode_idx').on(t.billingMode),
  ],
);

/**
 * Credenciales de pasarela por gimnasio.
 *
 * Vacia en la version 1: no hay cobro con tarjeta todavia. Existe desde ahora
 * porque el modelo de cuentas (MD 7) apunta a que cada gimnasio tenga su propia
 * cuenta Culqi, y eso condiciona el esquema, no solo el codigo.
 *
 * La clave secreta va CIFRADA en reposo. Nunca en texto plano ni en logs.
 */
export const tenantGateway = pgTable('tenant_gateway', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  culqiPublicKey: text('culqi_public_key'),
  culqiSecretKeyEncrypted: text('culqi_secret_key_encrypted'),
  active: boolean('active').notNull().default(false),
});

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Como lo llama el gimnasio en su padron. */
    internalAlias: text('internal_alias'),
    status: membershipStatusEnum('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Una persona tiene como maximo una membresia por gimnasio.
    uniqueIndex('memberships_user_tenant_key').on(t.userId, t.tenantId),
    index('memberships_tenant_idx').on(t.tenantId),
  ],
);

export const staff = pgTable(
  'staff',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    role: staffRoleEnum('role').notNull(),
    displayName: text('display_name').notNull(),
    /**
     * Hash scrypt del PIN con el que abre turno en el equipo compartido.
     *
     * Nunca el PIN. Son 4-6 digitos: un hash rapido se rompe por fuerza bruta en
     * segundos, y los intentos se limitan con las dos columnas de abajo.
     */
    pinHash: text('pin_hash'),
    pinUpdatedAt: timestamp('pin_updated_at', { withTimezone: true }),
    pinFailedAttempts: smallint('pin_failed_attempts').notNull().default(0),
    pinLockedUntil: timestamp('pin_locked_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('staff_tenant_user_key').on(t.tenantId, t.userId),
    index('staff_tenant_idx').on(t.tenantId),
  ],
);

// ---------------------------------------------------------------------------
// Planes y suscripciones
// ---------------------------------------------------------------------------

export const plans = pgTable(
  'plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    type: planTypeEnum('type').notNull(),
    /** Solo para `sessions_per_week`. */
    sessionsPerWeek: smallint('sessions_per_week'),
    /**
     * Dias ISO permitidos (1 = lunes .. 7 = domingo). `null` = cualquier dia.
     * Se combina con `sessions_per_week`: 2 sesiones restringidas a
     * lunes-viernes es `sessions_per_week` con los dias recortados (MD 4.3).
     */
    allowedDays: smallint('allowed_days').array(),
    priceCents: integer('price_cents').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('plans_tenant_idx').on(t.tenantId)],
);

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    membershipId: uuid('membership_id')
      .notNull()
      .references(() => memberships.id, { onDelete: 'cascade' }),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'restrict' }),
    /** Downgrade aceptado que entra en vigor en la proxima renovacion (MD 4.2). */
    pendingPlanId: uuid('pending_plan_id').references(() => plans.id, { onDelete: 'set null' }),
    /**
     * Cache del estado. La verdad la calcula `evaluateDelinquency` en
     * `@sinchi/shared`; esta columna existe para poder filtrar y ordenar en SQL,
     * y el cron la refresca. Si las dos discrepan, manda la funcion.
     */
    status: subscriptionStatusEnum('status').notNull().default('active'),
    startDate: date('start_date').notNull(),
    /** Inicio del periodo vigente. Con `next_billing_date` define el periodo. */
    periodStart: date('period_start').notNull(),
    /**
     * Inicio del primer periodo NO pagado.
     *
     * En la version 1 no avanza con el calendario: avanza cuando entra un pago
     * (ver `computeReceivable` en `@sinchi/shared`). Cuando llegue el cobro con
     * tarjeta, el cron intentara el cargo en esta fecha.
     */
    nextBillingDate: date('next_billing_date').notNull(),
    canceledAt: timestamp('canceled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('subscriptions_tenant_idx').on(t.tenantId),
    index('subscriptions_membership_idx').on(t.membershipId),
    // Una membresia no puede tener dos suscripciones vivas a la vez.
    uniqueIndex('subscriptions_one_live_per_membership')
      .on(t.membershipId)
      .where(sql`status <> 'canceled'`),
    // El cron de morosidad barre por esta columna todos los dias.
    index('subscriptions_next_billing_idx').on(t.nextBillingDate),
  ],
);

/**
 * Tarjeta guardada.
 *
 * Vacia en la version 1. Se deja desde ahora porque el objeto `card` de Culqi
 * sobrevive a la cancelacion de la suscripcion, y de eso depende que volver sea
 * un tap (MD 4.7).
 */
export const paymentMethods = pgTable(
  'payment_methods',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    membershipId: uuid('membership_id')
      .notNull()
      .references(() => memberships.id, { onDelete: 'cascade' }),
    culqiCustomerId: text('culqi_customer_id').notNull(),
    culqiCardId: text('culqi_card_id').notNull(),
    brand: cardBrandEnum('brand').notNull().default('Unknown'),
    last4: text('last4').notNull(),
    expMonth: smallint('exp_month').notNull(),
    expYear: smallint('exp_year').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('payment_methods_membership_idx').on(t.membershipId)],
);

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

export const charges = pgTable(
  'charges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    subscriptionId: uuid('subscription_id').references(() => subscriptions.id, {
      onDelete: 'set null',
    }),
    membershipId: uuid('membership_id')
      .notNull()
      .references(() => memberships.id, { onDelete: 'cascade' }),
    type: chargeTypeEnum('type').notNull(),
    amountCents: integer('amount_cents').notNull(),
    status: chargeStatusEnum('status').notNull(),
    rail: paymentRailEnum('rail').notNull(),
    culqiChargeId: text('culqi_charge_id'),
    /** Codigo de error del gateway. De el depende la politica de reintentos. */
    errorCode: text('error_code'),
    attempt: smallint('attempt').notNull().default(1),
    periodStart: date('period_start'),
    periodEnd: date('period_end'),
    /** Staff que registro el cobro manual. Es por donde entran los favores. */
    recordedBy: uuid('recorded_by').references(() => staff.id, { onDelete: 'set null' }),
    /** Idempotencia de la cola offline del dispositivo de mostrador. */
    clientId: uuid('client_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('charges_tenant_idx').on(t.tenantId),
    index('charges_membership_idx').on(t.membershipId),
    index('charges_subscription_idx').on(t.subscriptionId),
    /**
     * LA garantia de idempotencia del MD 4.1: un solo cargo de renovacion
     * exitoso por periodo. Si el cron corre dos veces, el segundo insert choca
     * y no cobra dos veces.
     */
    uniqueIndex('charges_renewal_once_per_period')
      .on(t.subscriptionId, t.periodStart)
      .where(sql`type = 'renewal' and status = 'succeeded'`),
    // Un reintento de la cola offline no crea un cargo duplicado.
    uniqueIndex('charges_client_id_key')
      .on(t.tenantId, t.clientId)
      .where(sql`client_id is not null`),
  ],
);

// ---------------------------------------------------------------------------
// Horarios y asistencia
// ---------------------------------------------------------------------------

export const classSchedules = pgTable(
  'class_schedules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Dia ISO: 1 = lunes .. 7 = domingo. */
    weekday: smallint('weekday').notNull(),
    /** `HH:MM` en hora local del tenant. */
    startTime: text('start_time').notNull(),
    endTime: text('end_time').notNull(),
    capacity: smallint('capacity'),
    instructor: text('instructor'),
    active: boolean('active').notNull().default(true),
  },
  (t) => [index('class_schedules_tenant_weekday_idx').on(t.tenantId, t.weekday)],
);

export const attendance = pgTable(
  'attendance',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    membershipId: uuid('membership_id')
      .notNull()
      .references(() => memberships.id, { onDelete: 'cascade' }),
    subscriptionId: uuid('subscription_id')
      .notNull()
      .references(() => subscriptions.id, { onDelete: 'cascade' }),
    classScheduleId: uuid('class_schedule_id').references(() => classSchedules.id, {
      onDelete: 'set null',
    }),
    checkedInAt: timestamp('checked_in_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * Fecha civil del marcado en hora local del tenant.
     *
     * Se guarda calculada porque `checked_in_at` en UTC cae en el dia anterior
     * visto desde Lima entre las 19:00 y la medianoche, que es justo la franja
     * de mayor asistencia de un dojo.
     */
    localDate: date('local_date').notNull(),
    /** Clave `YYYY-Www`. Desnormalizada para contar el cupo sin recalcular. */
    isoWeek: text('iso_week').notNull(),
    method: checkInMethodEnum('method').notNull(),
    deviceId: uuid('device_id'),
    recordedBy: uuid('recorded_by').references(() => staff.id, { onDelete: 'set null' }),
    /** `true` cuando el staff dejo pasar a pesar de un rechazo. Queda auditado. */
    overrodeDenial: boolean('overrode_denial').notNull().default(false),
    denialReason: jsonb('denial_reason'),
    syncedAt: timestamp('synced_at', { withTimezone: true }),
    /** Idempotencia de la cola offline: lo genera el dispositivo. */
    clientId: uuid('client_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('attendance_tenant_idx').on(t.tenantId),
    // El cupo semanal se cuenta por aqui, es la consulta mas caliente.
    index('attendance_membership_week_idx').on(t.membershipId, t.isoWeek),
    /**
     * Un marcado por alumno y por dia local.
     *
     * Decision deliberada, no una limitacion: el cupo se mide en sesiones
     * semanales, y un alumno que marca dos veces el mismo dia casi siempre es un
     * doble escaneo en la puerta. Sin esta restriccion, ese doble escaneo le come
     * una sesion del cupo y el recepcionista no tiene forma de devolversela.
     *
     * De paso hace idempotente el reintento de la cola offline aunque el
     * dispositivo pierda su `client_id`.
     *
     * A revisar si aparece un gimnasio que venda dos sesiones el mismo dia.
     */
    uniqueIndex('attendance_once_per_day').on(t.membershipId, t.localDate),
    uniqueIndex('attendance_client_id_key')
      .on(t.tenantId, t.clientId)
      .where(sql`client_id is not null`),
  ],
);

/**
 * Dispositivo de la puerta.
 *
 * Modo B del MD 4.6: tablet fija mostrando el QR del local, que el alumno
 * escanea. Tiene su propio secreto TOTP porque ese QR tambien es de vida corta.
 */
export const checkinDevices = pgTable(
  'checkin_devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    totpSecretEncrypted: text('totp_secret_encrypted'),
    /**
     * Hash del token de portador del equipo.
     *
     * Secreto de portador y no JWT porque revocar tiene que ser inmediato: una
     * tablet que se pierde en el gimnasio. Borrar una fila es inmediato; un JWT
     * vive hasta que expira.
     */
    tokenHash: text('token_hash'),
    tokenIssuedAt: timestamp('token_issued_at', { withTimezone: true }),
    active: boolean('active').notNull().default(true),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  },
  (t) => [
    index('checkin_devices_tenant_idx').on(t.tenantId),
    uniqueIndex('checkin_devices_token_hash_key')
      .on(t.tokenHash)
      .where(sql`token_hash is not null`),
  ],
);

/**
 * Webhooks del gateway. Vacia en la version 1.
 *
 * `culqi_event_id` unico: los webhooks se procesan de forma idempotente porque
 * el gateway reintenta y no garantiza entrega unica.
 */
export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    culqiEventId: text('culqi_event_id').notNull(),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('webhook_events_culqi_event_key').on(t.culqiEventId)],
);

// ---------------------------------------------------------------------------
// Tablas con aislamiento por tenant
// ---------------------------------------------------------------------------

/**
 * Las tablas que llevan `tenant_id` y por tanto necesitan RLS.
 *
 * `users` no esta: la identidad es global. `webhook_events` tampoco: es del
 * gateway, no de un gimnasio.
 */
export const TENANT_SCOPED_TABLES = [
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
  'trial_bookings',
] as const;

/**
 * Invitaciones por enlace.
 *
 * El codigo de 6 digitos lo confirma la recepcionista con el alumno delante;
 * la invitacion adelanta esa decision al momento de invitar, y quien autoriza
 * pasa a ser la posesion del enlace. Los detalles del compromiso —y por que
 * `membershipId` es opcional— estan en la migracion 0004.
 */
export const invites = pgTable(
  'invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** sha256 del token de 32 bytes. Hay que buscar por el, asi que no lleva sal. */
    tokenHash: text('token_hash').notNull(),
    fullName: text('full_name').notNull(),
    /**
     * Correo al que va dirigida. Con valor, la cuenta se activa sola al entrar
     * con un correo verificado que coincida — sin codigo y sin enlace.
     */
    email: text('email'),
    /** `users.document_id` es NOT NULL: el staff lo aporta al invitar. */
    documentId: text('document_id').notNull(),
    phone: text('phone').notNull(),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'cascade' }),
    /** Congelado al invitar: se respeta el precio que el staff prometio. */
    priceCents: integer('price_cents').notNull(),
    enrollmentFeeCents: integer('enrollment_fee_cents').notNull().default(0),
    /** `null` = crear ficha nueva al reclamar. */
    membershipId: uuid('membership_id').references(() => memberships.id, {
      onDelete: 'cascade',
    }),
    createdBy: uuid('created_by').references(() => staff.id, { onDelete: 'set null' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    consumedBy: uuid('consumed_by').references(() => users.id, { onDelete: 'set null' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('invites_active_token')
      .on(t.tokenHash)
      .where(sql`consumed_at is null and revoked_at is null`),
    index('invites_tenant_idx').on(t.tenantId),
  ],
);

/**
 * Clase gratis reservada desde la app.
 *
 * Es el unico camino de alta que empieza FUERA del gimnasio: quien lo descubre
 * en el directorio reserva una clase, y el local se entera de que existe. Las
 * razones de que `user_id` sea opcional —y de que el nombre de la clase viaje
 * copiado— estan en la migracion 0006.
 */
export const trialBookings = pgTable(
  'trial_bookings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Se conserva la reserva aunque el gimnasio borre el bloque de horario. */
    classScheduleId: uuid('class_schedule_id').references(() => classSchedules.id, {
      onDelete: 'set null',
    }),
    /** Identidad Sinchi, cuando ya la tiene. `null` mientras solo es una cuenta. */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Cuenta de Firebase de quien todavia no tiene ficha en ningun padron. */
    firebaseUid: text('firebase_uid'),
    fullName: text('full_name').notNull(),
    phone: text('phone').notNull(),
    email: text('email'),
    /** Copiados del horario: el gimnasio puede reordenarlo antes del dia. */
    className: text('class_name').notNull(),
    localDate: date('local_date').notNull(),
    startTime: text('start_time').notNull(),
    endTime: text('end_time').notNull(),
    status: trialBookingStatusEnum('status').notNull().default('booked'),
    /** Cuando se le aviso al gimnasio. Sin esto no se sabe si el correo salio. */
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
    canceledAt: timestamp('canceled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /**
     * UNA por persona y por gimnasio, contada por celular.
     *
     * Va en la base y no solo en el servicio: reservar dos veces desde dos
     * telefonos a la vez es justo la carrera que un `select` previo no atrapa.
     * Parcial sobre las vigentes — cancelar libera el cupo.
     */
    uniqueIndex('trial_bookings_one_per_phone')
      .on(t.tenantId, t.phone)
      .where(sql`status <> 'canceled'`),
    uniqueIndex('trial_bookings_one_per_user')
      .on(t.tenantId, t.userId)
      .where(sql`user_id is not null and status <> 'canceled'`),
    // "Quien viene esta semana": la consulta del mostrador.
    index('trial_bookings_tenant_date_idx').on(t.tenantId, t.localDate),
    index('trial_bookings_account_idx')
      .on(t.firebaseUid)
      .where(sql`firebase_uid is not null`),
  ],
);
