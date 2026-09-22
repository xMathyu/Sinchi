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
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import {
  boolean,
  customType,
  date,
  doublePrecision,
  foreignKey,
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
/** `free` = hasta 10 alumnos, sin costo. No es prueba: es el precio de un local pequeno. */
export const saasTierEnum = pgEnum('saas_tier', ['free', 'up_to_60', 'up_to_150', 'unlimited']);
/**
 * Estado de la suscripcion del GIMNASIO a Sinchi.
 *
 * `read_only` y no `suspended` a proposito: al alumno suspendido no lo dejan
 * entrenar, al gimnasio impago no se le cierra nada de lo que ya tiene. Llamarlos
 * igual invita a copiar el comportamiento equivocado.
 */
export const saasStatusEnum = pgEnum('saas_status', [
  'free',
  'trialing',
  'active',
  'in_grace',
  'read_only',
  'canceled',
]);
export const billingModeEnum = pgEnum('billing_mode', ['anniversary', 'fixed_day']);
export const quotaOverflowPolicyEnum = pgEnum('quota_overflow_policy', ['block', 'offer_drop_in']);
export const staffRoleEnum = pgEnum('staff_role', ['owner', 'front_desk']);
/**
 * `drop_in` no es un cuarto sabor del mismo helado: es el plan que NO crea
 * ciclo de cobro. No genera deuda, no tiene cupo semanal y su `price_cents` es
 * el de UNA clase, no el del mes. Ver `0012_planes_del_dueno.sql`.
 */
export const planTypeEnum = pgEnum('plan_type', [
  'unlimited',
  'sessions_per_week',
  'fixed_days',
  'drop_in',
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
  /** Plaza en un evento con fecha: un seminario, un taller, la clase del invitado. */
  'event',
]);
export const chargeStatusEnum = pgEnum('charge_status', ['pending', 'succeeded', 'failed']);
export const paymentRailEnum = pgEnum('payment_rail', [
  'card',
  'yape',
  'cash',
  'bank_transfer',
]);
export const checkInMethodEnum = pgEnum('check_in_method', ['qr', 'manual']);
export const gymEventStatusEnum = pgEnum('gym_event_status', ['draft', 'published', 'canceled']);
/**
 * Mismos valores que `class_booking_status` y tipo propio a proposito: son dos
 * ciclos que se parecen hoy y no tienen por que seguir pareciendose. Compartir
 * el enum ata el dia que uno de los dos necesite un estado mas.
 */
export const eventRegistrationStatusEnum = pgEnum('event_registration_status', [
  'booked',
  'attended',
  'no_show',
  'canceled',
]);
/**
 * Quien ve una rutina. La decision va por RUTINA y no por gimnasio: la misma
 * escuela publica unas para atraer y guarda otras para retener.
 */
export const routineVisibilityEnum = pgEnum('routine_visibility', ['public', 'members']);
/**
 * Sin `canceled`, a diferencia de `gym_event_status`: un seminario se CAE y hay
 * gente con plaza a la que avisar; una rutina deja de ofrecerse y ya.
 */
export const routineStatusEnum = pgEnum('routine_status', ['draft', 'published']);
/**
 * La fila del video nace ANTES que el archivo —hace falta para firmar la
 * subida— y por eso `pending` existe: sin el no se distingue un video
 * subiendose de uno cuya subida se cayo a la mitad.
 */
export const routineVideoStatusEnum = pgEnum('routine_video_status', ['pending', 'ready']);
export const routineLevelEnum = pgEnum('routine_level', [
  'beginner',
  'intermediate',
  'advanced',
]);
export const accountDeletionStatusEnum = pgEnum('account_deletion_status', [
  'pending',
  'done',
  'canceled',
]);
export const classBookingStatusEnum = pgEnum('class_booking_status', [
  'booked',
  'attended',
  'no_show',
  'canceled',
]);
/** Por que viene quien reservo. Ver `BookingKind` en `@sinchi/shared` y la 0022. */
export const bookingKindEnum = pgEnum('booking_kind', ['trial', 'drop_in', 'enrollment']);
/**
 * Por donde empezo una conversacion. Se congela: ver `ConversationTopic` en
 * `@sinchi/shared`.
 */
export const conversationTopicEnum = pgEnum('conversation_topic', [
  'general',
  'trial',
  'drop_in',
  'membership',
  'event',
]);
export const conversationStatusEnum = pgEnum('conversation_status', ['open', 'closed']);
/** `person` y no `student`: escribe tambien quien todavia no es alumno de nadie. */
export const messageSenderEnum = pgEnum('message_sender', ['person', 'gym']);
/**
 * Lo que paso con la solicitud de un gimnasio. `canceled` lo pone el gimnasio al
 * retirarla antes de que la persona conteste; los otros dos, la persona.
 */
export const linkRequestStatusEnum = pgEnum('link_request_status', [
  'pending',
  'accepted',
  'rejected',
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
 * Una cuenta de Firebase que todavia no abre ninguna ficha del padron.
 *
 * Nacio como el codigo de 6 digitos que recepcion confirmaba, y hoy es lo que
 * sabe la api de quien acaba de registrarse: su nombre, su celular y el token de
 * su QR de cuenta. La vinculacion ya no la hace el mostrador sino la persona,
 * aceptando la solicitud del gimnasio (`link_requests`, migracion 0023).
 *
 * Sin `tenant_id` a proposito: la cuenta no pertenece a ningun gimnasio.
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
     * encarga `class_bookings_one_trial_per_phone`.
     */
    phone: text('phone'),
    /**
     * 6 digitos. Ya no se muestra ni se confirma: sigue emitiendose porque la
     * columna es NOT NULL y las apps anteriores a la 0023 lo leen al entrar.
     */
    code: text('code').notNull(),
    /**
     * Lo que va dentro del QR de la cuenta: `SINCHI1:a:<qr_token>`.
     *
     * Largo y aleatorio, al reves que `code`: no se dicta, se escanea, y quien lo
     * canjea recibe el nombre, el celular y el correo de la persona. Seis digitos
     * se podrian recorrer desde cualquier sesion de staff.
     */
    qrToken: text('qr_token'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    consumedBy: uuid('consumed_by').references(() => staff.id, { onDelete: 'set null' }),
    linkedUserId: uuid('linked_user_id').references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('account_claims_active_qr_token')
      .on(t.qrToken)
      .where(sql`consumed_at is null and qr_token is not null`),
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
    /**
     * RUC. `null` mientras el gimnasio no tenga uno.
     *
     * Nacio NOT NULL y eso obligo a inventarselo: tres siembras escribian
     * 'PENDIENTE' y una un '20000000000' de relleno. El profesor que arranca
     * saca el RUC cuando empieza a facturar, y exigirselo para registrar su
     * dojo era ponerle un tramite de SUNAT delante de su primer alumno. Ver
     * `0018_el_ruc_puede_esperar`.
     *
     * El que se escribe SI se comprueba de verdad, con digito verificador: lo
     * que entre aqui sale despues en las boletas.
     */
    taxId: text('tax_id'),
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
    /**
     * Cuanto cuesta esa primera clase. 0 = gratis.
     *
     * Columna propia y no `drop_in_price_cents` aunque a veces coincidan: uno es
     * lo que paga el ALUMNO que agota su cupo y otro lo que paga quien VIENE A
     * CONOCER el local. Regalar la primera y cobrar las siguientes es el caso
     * mas comun, y con una sola columna no se puede ni escribir.
     */
    trialClassPriceCents: integer('trial_class_price_cents').notNull().default(0),
    /**
     * Donde queda el local, escrito como se lo dirias a un taxista.
     *
     * El directorio listaba gimnasios sin decir DONDE estan, y esa es la primera
     * pregunta de quien busca dojo: nadie cruza Lima para una clase de prueba.
     *
     * Nullable porque los gimnasios que ya existen no la tienen y no se les
     * puede inventar una. El alta si la exige, igual que la mensualidad.
     */
    address: text('address'),
    /**
     * El punto en el mapa, si el dueno lo puso.
     *
     * Aparte de `address` y no derivado de ella: geocodificar un texto escrito a
     * mano acierta casi siempre y falla justo donde importa —la cuadra sin
     * numero, el pasaje sin nombre en el mapa— y un pin equivocado manda a
     * alguien a otra puerta. Lo pone el dueno, que sabe donde esta parado.
     *
     * Sin pin, «como llegar» abre el mapa buscando la direccion escrita, que es
     * lo que haria cualquiera a mano.
     */
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    /**
     * El logo, si el dueno subio uno. `null` = se ven las iniciales.
     *
     * Aqui va el puntero y la imagen en `gym_logos`: esta fila se lee entera en
     * muchos sitios, y cada lectura arrastraria los bytes. Ver la migracion 0025.
     */
    logoId: uuid('logo_id').references((): AnyPgColumn => gymLogos.id, { onDelete: 'set null' }),
    /**
     * Su web y sus redes, si las dio. Todas opcionales.
     *
     * Direcciones CANÓNICAS armadas por `normalizeGymLink`, nunca lo que pegó el
     * dueño: la ficha dice «Instagram» al lado del enlace, y un CHECK por
     * columna garantiza que abre Instagram. Ver la migración 0026.
     */
    websiteUrl: text('website_url'),
    instagramUrl: text('instagram_url'),
    facebookUrl: text('facebook_url'),
    tiktokUrl: text('tiktok_url'),
    status: tenantStatusEnum('status').notNull().default('active'),
    /**
     * Desde cuando esta fuera de Sinchi, y por que.
     *
     * Las escribe el panel de Sinchi y nadie mas (migracion 0024). Van juntas
     * con `status` por un CHECK: un gimnasio suspendido sin fecha es uno del que
     * nadie sabe desde cuando lo esta, y el motivo es lo unico que queda para
     * explicarselo al dueno por telefono.
     *
     * Suspender no es el corte por impago. Aquello es `saas_subscriptions` y
     * deja la puerta abierta a proposito; esto es una expulsion, y la decide una
     * persona con un motivo escrito.
     */
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    suspendedReason: text('suspended_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('tenants_slug_key').on(t.slug),
    // Un dia fijo de cobro exige el dia, y solo entre 1 y 28.
    index('tenants_billing_mode_idx').on(t.billingMode),
    uniqueIndex('tenants_logo_id_key').on(t.logoId).where(sql`logo_id is not null`),
  ],
);

/** `bytea` de Postgres. `pg` ya lo entrega como `Buffer`. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

/**
 * La imagen del logo. Una por gimnasio, y opcional: sin fila, iniciales.
 *
 * En la base y no en el bucket de los videos: el bucket es opcional y en
 * produccion no existe, un logo es publico y un video no, y a 512 pixeles por
 * lado pesa decenas de KB. El porque entero esta en la migracion 0025.
 *
 * Cambiar el logo es borrar esta fila y crear otra con OTRO id, nunca
 * actualizarla: el id va en la direccion (`gymLogoPath`), y es lo que deja que
 * el telefono la guarde en cache para siempre.
 */
export const gymLogos = pgTable(
  'gym_logos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references((): AnyPgColumn => tenants.id, { onDelete: 'cascade' }),
    contentType: text('content_type').notNull(),
    bytes: bytea('bytes').notNull(),
    /** Leidas de la cabecera por la api, no declaradas por el cliente. */
    width: smallint('width').notNull(),
    height: smallint('height').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('gym_logos_tenant_key').on(t.tenantId)],
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

// ---------------------------------------------------------------------------
// El otro lado: quien administra Sinchi
// ---------------------------------------------------------------------------

/**
 * Quien puede entrar al panel de Sinchi.
 *
 * No es `staff` con un rol mas, y la diferencia es el producto: `staff` trabaja
 * EN un gimnasio y su poder termina en el borde de su tenant; esto trabaja EN
 * Sinchi y suspende, edita y borra gimnasios ajenos. Colgarlo de `staff` habria
 * puesto la llave maestra de la red a una fila de distancia del dueno de un
 * dojo.
 *
 * La llave es el CORREO y no `firebase_uid`, porque se invita a gente que
 * todavia no ha entrado nunca: el uid no existe hasta su primer login, y ahi se
 * rellena. Lo que da acceso no es conocer el correo sino presentarlo verificado
 * por Google (`PlatformAdminService.signIn`).
 *
 * Fuera de `TENANT_SCOPED_TABLES` y sin RLS, como `users`: no pertenece a ningun
 * gimnasio. La politica que la protegeria no existe porque no hay contexto que
 * ponerle — el login ocurre ANTES de que haya sesion.
 */
export const platformAdmins = pgTable(
  'platform_admins',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Normalizado en minusculas. Un CHECK de la base lo exige. */
    email: text('email').notNull(),
    name: text('name'),
    /** Con que cuenta de Google entro. `null` mientras no haya entrado. */
    firebaseUid: text('firebase_uid'),
    invitedBy: uuid('invited_by').references((): AnyPgColumn => platformAdmins.id, {
      onDelete: 'set null',
    }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    /**
     * Cuando se le retiro el acceso. El acceso se RETIRA, no se borra: la fila
     * es el rastro de que esa persona lo tuvo, y `platform_actions` apunta a
     * ella.
     */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Uno por correo CONTANDO a los retirados: volver a invitar a alguien reabre
    // su fila en vez de crear una segunda.
    uniqueIndex('platform_admins_email_key').on(t.email),
    uniqueIndex('platform_admins_firebase_uid_key')
      .on(t.firebaseUid)
      .where(sql`firebase_uid is not null`),
  ],
);

/**
 * Lo que cada administrador de Sinchi hizo.
 *
 * Un registro, no un cache: nada lo lee para decidir nada. Eso es lo que le
 * permite sobrevivir a lo que nombra — `tenantId` va SIN clave foranea porque la
 * accion que mas importa registrar es justo la que borra el gimnasio, y al lado
 * va `subject` con el slug legible, que es lo que se lee cuando ese gimnasio ya
 * no existe.
 */
export const platformActions = pgTable(
  'platform_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adminId: uuid('admin_id')
      .notNull()
      .references(() => platformAdmins.id, { onDelete: 'restrict' }),
    /** Un `PlatformActionKind` de `@sinchi/shared`. */
    action: text('action').notNull(),
    tenantId: uuid('tenant_id'),
    /** El slug del gimnasio o el codigo, legible despues de borrarlo. */
    subject: text('subject'),
    reason: text('reason'),
    detail: jsonb('detail'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('platform_actions_recent_idx').on(t.createdAt),
    index('platform_actions_tenant_idx').on(t.tenantId),
  ],
);

/**
 * Quién no puede usar Sinchi, y por qué.
 *
 * Tabla propia y no una columna en `users`: hay que poder banear a quien no
 * tiene ficha —la cuenta de Google que entró sin estar en ningún padrón—, que es
 * justo la que reserva clases falsas y escribe a los gimnasios desde el
 * directorio. Basta una de las tres llaves; el correo está porque borrar el
 * usuario de Firebase hace que la misma cuenta de Google vuelva con uid nuevo
 * (migración 0027).
 *
 * Global y sin RLS, como `users`: una persona no pertenece a ningún gimnasio.
 */
export const accountBans = pgTable(
  'account_bans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    firebaseUid: text('firebase_uid'),
    /** Normalizado en minúsculas. Lo exige un CHECK. */
    email: text('email'),
    reason: text('reason').notNull(),
    bannedBy: uuid('banned_by')
      .notNull()
      .references(() => platformAdmins.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Se levanta, no se borra: es historia que alguien va a preguntar. */
    liftedAt: timestamp('lifted_at', { withTimezone: true }),
    liftedBy: uuid('lifted_by').references(() => platformAdmins.id, { onDelete: 'restrict' }),
  },
  (t) => [
    uniqueIndex('account_bans_one_live_per_user')
      .on(t.userId)
      .where(sql`lifted_at is null and user_id is not null`),
    uniqueIndex('account_bans_one_live_per_account')
      .on(t.firebaseUid)
      .where(sql`lifted_at is null and firebase_uid is not null`),
    index('account_bans_live_idx').on(t.createdAt).where(sql`lifted_at is null`),
  ],
);

/**
 * Codigos de promocion: meses de Sinchi de regalo.
 *
 * Un codigo mueve `free_until` hacia adelante; no descuenta el precio. Asi el
 * motor de cobro sigue sin saber que existen las promociones.
 *
 * Fuera de `TENANT_SCOPED_TABLES`: los crea y los lista Sinchi, no el gimnasio.
 */
export const saasPromoCodes = pgTable(
  'saas_promo_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Normalizado: mayusculas, sin separadores (`normalizePromoCode`). */
    code: text('code').notNull(),
    freeMonths: smallint('free_months').notNull().default(1),
    /** `null` = sin tope. */
    maxRedemptions: integer('max_redemptions'),
    redeemedCount: integer('redeemed_count').notNull().default(0),
    expiresOn: date('expires_on'),
    active: boolean('active').notNull().default(true),
    /** A quien se le dio y por que. Dentro de seis meses nadie se acuerda. */
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('saas_promo_codes_code_key').on(t.code)],
);

/**
 * Quien canjeo que.
 *
 * El indice unico es la mitad del tope que el `CHECK` de `redeemed_count` no
 * cubre: sin el, un solo gimnasio podria gastar los diez usos de un codigo.
 */
export const saasRedemptions = pgTable(
  'saas_redemptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    promoCodeId: uuid('promo_code_id')
      .notNull()
      .references(() => saasPromoCodes.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    freeMonths: smallint('free_months').notNull(),
    /** Hasta cuando quedo gratis despues de canjear. Rastro, no derivable. */
    freeUntilAfter: date('free_until_after').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('saas_redemptions_once_per_tenant').on(t.promoCodeId, t.tenantId),
    index('saas_redemptions_tenant_idx').on(t.tenantId),
  ],
);

/**
 * La suscripcion del gimnasio a Sinchi: el mes gratis y lo que viene despues.
 *
 * Ojo: `trial` en este esquema es la clase gratis del ALUMNO. El mes gratis del
 * GIMNASIO se llama `free_until` y no reusa esa palabra (`docs/glosario.md`).
 *
 * Fuera de `TENANT_SCOPED_TABLES` a proposito, igual que `tenants`: no es dato
 * del gimnasio sino de Sinchi CON el gimnasio, y el job diario tiene que
 * recorrerlas todas — que es justo lo que RLS por tenant impediria.
 */
export const saasSubscriptions = pgTable(
  'saas_subscriptions',
  {
    /** La PK es el tenant: un gimnasio no puede tener dos suscripciones. */
    tenantId: uuid('tenant_id')
      .primaryKey()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    tier: saasTierEnum('tier').notNull().default('up_to_60'),
    /** CACHE. La verdad la calcula `evaluateSaas`; esto sirve para listar en SQL. */
    status: saasStatusEnum('status').notNull().default('trialing'),
    /** Primer dia en que el gimnasio ya tiene que haber pagado. */
    freeUntil: date('free_until').notNull(),
    periodStart: date('period_start').notNull(),
    nextBillingDate: date('next_billing_date').notNull(),
    /** Propia, NO `tenants.grace_days`: esa es la que el gimnasio da a sus alumnos. */
    graceDays: smallint('grace_days').notNull().default(7),
    canceledAt: timestamp('canceled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('saas_subscriptions_status_idx').on(t.status, t.nextBillingDate)],
);

/**
 * Lo que el gimnasio le paga a Sinchi. Append-only, como `charges`.
 *
 * Tabla propia y no `charges` porque ahi `membership_id` es NOT NULL: un cobro a
 * Sinchi no tiene alumno detras, y el enum `charge_type = 'saas'` que existe
 * desde el primer commit nunca se pudo usar por eso.
 */
export const saasCharges = pgTable(
  'saas_charges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    amountCents: integer('amount_cents').notNull(),
    tier: saasTierEnum('tier').notNull(),
    rail: paymentRailEnum('rail').notNull(),
    status: chargeStatusEnum('status').notNull(),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    /** Numero de operacion de la transferencia. Lo que se busca cuando el dueno llama. */
    reference: text('reference'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('saas_charges_tenant_idx').on(t.tenantId),
    /** Un solo cobro exitoso por periodo, como en el ledger del alumno. */
    uniqueIndex('saas_charges_once_per_period')
      .on(t.tenantId, t.periodStart)
      .where(sql`status = 'succeeded'`),
    /**
     * El numero de operacion es la llave de idempotencia del pago manual, como
     * `client_id` en la cola offline. Hace falta ademas del anterior: registrar
     * un pago adelanta la fecha de cobro, asi que registrar dos veces la misma
     * transferencia no chocaria por periodo, le regalaria un mes de mas.
     */
    uniqueIndex('saas_charges_reference_once')
      .on(t.tenantId, t.reference)
      .where(sql`reference is not null`),
  ],
);

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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('staff_tenant_user_key').on(t.tenantId, t.userId),
    index('staff_tenant_idx').on(t.tenantId),
  ],
);

/**
 * Un gimnasio le pide a una persona que acepte su ficha.
 *
 * Es lo que reemplazo al codigo de 6 digitos, y la regla que lo ordena es otra:
 * ningun gimnasio aparece en la app de alguien sin que esa persona lo acepte. La
 * ficha es del gimnasio y existe igual —recepcion inscribe, cobra y marca la
 * puerta sin esperar a nadie—; lo que espera es que la persona la vea en su
 * billetera. Sin esto, cualquier local que conociera un DNI podia meterse en la
 * app de quien quisiera.
 *
 * A quien va: a `firebase_uid` si se sabe la cuenta —el QR que se escaneo, o la
 * que la identidad ya tenia—, y si no a quien entre con el celular o el correo de
 * la ficha (`users`), que se leen de ahi y no se copian.
 */
export const linkRequests = pgTable(
  'link_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    membershipId: uuid('membership_id')
      .notNull()
      .references(() => memberships.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    firebaseUid: text('firebase_uid'),
    status: linkRequestStatusEnum('status').notNull().default('pending'),
    createdBy: uuid('created_by').references(() => staff.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    /** La cuenta que contesto: es lo que el dueno mira si acepto quien no era. */
    decidedByFirebaseUid: text('decided_by_firebase_uid'),
  },
  (t) => [
    uniqueIndex('link_requests_one_pending')
      .on(t.membershipId)
      .where(sql`status = 'pending'`),
    index('link_requests_user_idx').on(t.userId),
    index('link_requests_account_idx').on(t.firebaseUid),
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
    /** Del periodo; de UNA clase cuando el tipo es `drop_in`. */
    priceCents: integer('price_cents').notNull(),
    /**
     * Archivar en vez de borrar.
     *
     * `subscriptions.plan_id` es ON DELETE restrict: un plan que alguien esta
     * pagando no se puede borrar sin romperle el historial. Subir los precios es
     * escribir uno nuevo y apagar el viejo, que sigue explicando lo que cobraba
     * la suscripcion que lo apunta.
     */
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('plans_tenant_idx').on(t.tenantId),
    // Dos planes activos con el mismo nombre son la misma tarifa leida dos
    // veces, y el mostrador elige una al azar en el alta.
    uniqueIndex('plans_active_name_per_tenant')
      .on(t.tenantId, sql`lower(${t.name})`)
      .where(sql`active`),
  ],
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
    /**
     * `null` SOLO en un cargo de tipo `event` o `drop_in`.
     *
     * Un seminario lo paga tambien quien no entrena aqui, y esa persona no tiene
     * membresia en este local ni debe tenerla: viene a una clase, no se inscribe
     * en el padron. Su plata sigue siendo del gimnasio y sale en "cobrado este
     * mes", asi que va al MISMO ledger — dos sitios donde vive el dinero es como
     * se dejan de cuadrar las cuentas. La clase suelta reservada desde el
     * directorio es el mismo caso (0022).
     *
     * `charges_membership_unless_walk_in` mantiene la columna obligatoria para
     * todos los demas tipos.
     */
    membershipId: uuid('membership_id').references(() => memberships.id, {
      onDelete: 'cascade',
    }),
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
    /**
     * Cuándo se le quitó la ficha porque la persona eliminó su cuenta.
     *
     * El asiento se queda —el gimnasio tiene que cuadrar su caja y responder ante
     * la SUNAT— y lo que se va es de quién era (migración 0027). Es lo único que
     * deja existir una mensualidad sin ficha: en cualquier otro caso sigue siendo
     * un error, y el CHECK lo sigue parando.
     */
    anonymizedAt: timestamp('anonymized_at', { withTimezone: true }),
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
// Eventos con fecha
// ---------------------------------------------------------------------------

/**
 * Una clase con FECHA que se vende aparte: un seminario, un taller, la clase del
 * invitado que viene una sola vez.
 *
 * No es `class_schedules`, que es el horario semanal y se repite, ni `plans`,
 * que es una suscripcion. Los dos precios no son un lujo: un seminario se llena
 * con gente que TODAVIA no entrena aqui, y cobrarle lo mismo que al alumno de
 * casa es regalar el unico dia del ano en que entra gente nueva por la puerta.
 */
export const gymEvents = pgTable(
  'gym_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    /** El invitado, si lo hay. Es lo que vende la plaza. */
    instructor: text('instructor'),
    /** Fecha civil en la zona del gimnasio. */
    localDate: date('local_date').notNull(),
    /** `HH:MM` en hora local del tenant, igual que `class_schedules`. */
    startTime: text('start_time').notNull(),
    endTime: text('end_time').notNull(),
    /** `null` = sin limite de plazas. */
    capacity: smallint('capacity'),
    memberPriceCents: integer('member_price_cents').notNull(),
    guestPriceCents: integer('guest_price_cents').notNull(),
    status: gymEventStatusEnum('status').notNull().default('draft'),
    canceledAt: timestamp('canceled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // "Lo que viene" del directorio y del mostrador barre por aqui.
    index('gym_events_tenant_date_idx').on(t.tenantId, t.localDate),
  ],
);

/**
 * La plaza de una persona en un evento.
 *
 * Lleva su propio estado y NO escribe en `attendance` a proposito: el indice
 * `attendance_once_per_day` deja una asistencia por alumno y dia, asi que quien
 * entreno el sabado por la manana no podria marcar en el seminario de esa tarde.
 *
 * Copia el nombre y el celular como `class_bookings`, y por lo mismo: quien
 * reserva puede no tener ficha en ningun padron todavia.
 */
export const eventRegistrations = pgTable(
  'event_registrations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id')
      .notNull()
      .references(() => gymEvents.id, { onDelete: 'cascade' }),
    /** `null` cuando quien viene no entrena en este local. */
    membershipId: uuid('membership_id').references(() => memberships.id, {
      onDelete: 'set null',
    }),
    /** Identidad Sinchi, cuando ya la tiene. */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Cuenta de Firebase de quien todavia no tiene ficha en ningun padron. */
    firebaseUid: text('firebase_uid'),
    fullName: text('full_name').notNull(),
    phone: text('phone').notNull(),
    email: text('email'),
    /** Congelado al inscribirse: se respeta lo que se le prometio a la persona. */
    priceCents: integer('price_cents').notNull(),
    status: eventRegistrationStatusEnum('status').notNull().default('booked'),
    /**
     * El cargo que pago la plaza. `null` = reservada sin pagar.
     *
     * `set null` y no `cascade`: borrar un cargo no puede borrar a alguien de la
     * lista del seminario — se quedaria sin plaza sin que nadie lo decidiera.
     */
    chargeId: uuid('charge_id').references(() => charges.id, { onDelete: 'set null' }),
    canceledAt: timestamp('canceled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /**
     * UNA plaza por persona y evento, contada por celular.
     *
     * Va en la base y no solo en el servicio: reservar dos veces desde dos
     * pestanas a la vez es justo la carrera que un `select` previo no atrapa, y
     * con cupo de por medio esa carrera vende una plaza que no existe.
     */
    uniqueIndex('event_registrations_one_per_phone')
      .on(t.eventId, t.phone)
      .where(sql`status <> 'canceled'`),
    // Solo por celular no basta: la misma cuenta con otro numero se lleva una
    // segunda plaza, y con cupo eso es una plaza que otro no puede comprar.
    uniqueIndex('event_registrations_one_per_user')
      .on(t.eventId, t.userId)
      .where(sql`user_id is not null and status <> 'canceled'`),
    uniqueIndex('event_registrations_one_per_account')
      .on(t.eventId, t.firebaseUid)
      .where(sql`firebase_uid is not null and status <> 'canceled'`),
    index('event_registrations_event_idx').on(t.eventId),
    index('event_registrations_tenant_idx').on(t.tenantId),
    index('event_registrations_membership_idx')
      .on(t.membershipId)
      .where(sql`membership_id is not null`),
  ],
);


// ---------------------------------------------------------------------------
// Rutinas: lo que el gimnasio ensena
// ---------------------------------------------------------------------------


/**
 * Un archivo de video del gimnasio.
 *
 * EL ARCHIVO NO PASA POR LA API: se firma una URL y el telefono sube directo al
 * bucket. Meter 200 MB por un proceso de Cloud Run con 512 MiB y 30s de timeout
 * es la forma conocida de tumbar la api con una sola subida.
 *
 * `objectPath` se DERIVA del id y nunca del nombre que traia el archivo:
 * "../../otro-gimnasio/kata.mp4" es un nombre de archivo perfectamente valido.
 */
export const routineVideos = pgTable(
  'routine_videos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    objectPath: text('object_path').notNull(),
    contentType: text('content_type').notNull(),
    /**
     * Lo dice el almacenamiento al confirmar, no el cliente: el telefono puede
     * declarar 10 MB y subir 900.
     */
    sizeBytes: integer('size_bytes'),
    /** Solo para que el dueno reconozca cual es. No se usa para nada mas. */
    originalName: text('original_name'),
    status: routineVideoStatusEnum('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    readyAt: timestamp('ready_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('routine_videos_object_path_key').on(t.objectPath),
    index('routine_videos_tenant_idx').on(t.tenantId),
  ],
);

/**
 * Una rutina o una tecnica publicada: "Dia de pecho", "Uchimata".
 *
 * Es lo primero del producto que vale sin que la persona cruce la puerta, y por
 * eso la columna que decide todo es `visibility`. Publica = anuncio: la ve
 * cualquiera desde la ficha del directorio, sin cuenta, y es lo que hace que
 * alguien elija ESTE dojo. De alumnos = media razon para seguir pagando la
 * mensualidad. El mismo gimnasio necesita las dos, y por eso la decision va por
 * rutina y no por local.
 *
 * `members` por defecto: de los dos errores posibles, publicar sin querer hacia
 * todo internet es el que no se deshace.
 *
 * Un dia de entrenamiento son varias filas de `routine_items`; una tecnica de
 * judo es ESTA fila con su video y su explicacion, sin ningun paso. Las dos en
 * la misma tabla evita dos editores y dos respuestas a "donde subo el video".
 */
export const routines = pgTable(
  'routines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    summary: text('summary'),
    /**
     * El video de la rutina entera. En una tecnica suelta, es EL video.
     *
     * Es un ENLACE, no un archivo: la version 1 no aloja video. El porque —y la
     * limitacion que eso trae— esta en la migracion 0014 y en
     * `packages/shared/src/routines/video.ts`.
     */
    videoUrl: text('video_url'),
    /**
     * El video SUBIDO, cuando no es un enlace. Nunca los dos a la vez: lo
     * fuerza `routines_one_video_source`.
     *
     * Es lo que hace que el contenido de alumnos sea exclusivo de verdad. Un
     * video de YouTube oculto lo ve cualquiera con la direccion; un objeto
     * privado del bucket solo se sirve con una URL firmada que caduca, y la api
     * solo la firma para quien pasa `checkRoutineAccess`.
     */
    videoAssetId: uuid('video_asset_id').references((): AnyPgColumn => routineVideos.id, {
      onDelete: 'set null',
    }),
    level: routineLevelEnum('level'),
    visibility: routineVisibilityEnum('visibility').notNull().default('members'),
    status: routineStatusEnum('status').notNull().default('draft'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Se ensena: una biblioteca sin fechas no se distingue de una abandonada. */
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('routines_tenant_status_idx').on(t.tenantId, t.status)],
);

/**
 * Un paso: el ejercicio del dia de pecho, la entrada del uchimata.
 *
 * `tenantId` esta aunque se pueda deducir por `routineId`, y es deliberado: la
 * politica RLS tiene que poder decidir SIN join. Una politica que necesita mirar
 * otra tabla es una politica que alguien desactiva el dia que estorbe.
 */
export const routineItems = pgTable(
  'routine_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    routineId: uuid('routine_id')
      .notNull()
      .references(() => routines.id, { onDelete: 'cascade' }),
    position: smallint('position').notNull(),
    title: text('title').notNull(),
    instructions: text('instructions'),
    videoUrl: text('video_url'),
    /** El video subido de ESTE paso. Nunca junto con `videoUrl`. */
    videoAssetId: uuid('video_asset_id').references((): AnyPgColumn => routineVideos.id, {
      onDelete: 'set null',
    }),
    /** "4 series de 12", "5 minutos de uchikomi". Texto libre: ver 0014. */
    prescription: text('prescription'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('routine_items_routine_idx').on(t.routineId),
    // El orden es un dato: un calentamiento despues del trabajo fuerte es otra
    // rutina. Sin esto, dos pasos empatados salen en el orden que quiera
    // Postgres y la lista cambia sola entre dos aperturas.
    uniqueIndex('routine_items_position_per_routine').on(t.routineId, t.position),
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
 * gateway, no de un gimnasio. Ni `platform_admins` ni `platform_actions`: son de
 * Sinchi, y quien las lee esta por encima de los gimnasios, no dentro de uno.
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
  'tenant_gateway',
  'class_bookings',
  'gym_events',
  'event_registrations',
  'routines',
  'routine_items',
  'routine_videos',
  'gym_logos',
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
 * Clase con fecha reservada desde la app.
 *
 * Es el unico camino de alta que empieza FUERA del gimnasio: quien lo descubre
 * en el directorio reserva una clase, y el local se entera de que existe. Las
 * razones de que `user_id` sea opcional —y de que el nombre de la clase viaje
 * copiado— estan en la migracion 0006; por que dejo de llamarse
 * `trial_bookings`, en la 0021.
 */
export const classBookings = pgTable(
  'class_bookings',
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
    /**
     * Congelado al reservar: se respeta lo que se le prometio a la persona. En
     * una inscripcion es el primer mes del plan elegido.
     */
    priceCents: integer('price_cents').notNull().default(0),
    /** Prueba, clase suelta o inscripcion. Por que son la misma fila: la 0022. */
    kind: bookingKindEnum('kind').notNull().default('trial'),
    /** Solo en una inscripcion. Id y nombre copiado: el plan se archiva antes del dia. */
    planId: uuid('plan_id').references(() => plans.id, { onDelete: 'set null' }),
    planName: text('plan_name'),
    enrollmentFeeCents: integer('enrollment_fee_cents').notNull().default(0),
    /** El cargo que pago la clase en el mostrador. `null` = por cobrar, o gratis. */
    chargeId: uuid('charge_id').references(() => charges.id, { onDelete: 'set null' }),
    /** La ficha que salio de una inscripcion al cerrarla recepcion. */
    membershipId: uuid('membership_id').references(() => memberships.id, {
      onDelete: 'set null',
    }),
    status: classBookingStatusEnum('status').notNull().default('booked'),
    /** Cuando se le aviso al gimnasio. Sin esto no se sabe si el correo salio. */
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
    canceledAt: timestamp('canceled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /**
     * UNA prueba por persona y por gimnasio, contada por celular.
     *
     * Va en la base y no solo en el servicio: reservar dos veces desde dos
     * telefonos a la vez es justo la carrera que un `select` previo no atrapa.
     * Parcial sobre las vigentes —cancelar libera el cupo— y sobre la PRUEBA:
     * quien probo el martes tiene que poder inscribirse el jueves.
     */
    uniqueIndex('class_bookings_one_trial_per_phone')
      .on(t.tenantId, t.phone)
      .where(sql`kind = 'trial' and status <> 'canceled'`),
    uniqueIndex('class_bookings_one_trial_per_user')
      .on(t.tenantId, t.userId)
      .where(sql`kind = 'trial' and user_id is not null and status <> 'canceled'`),
    // Una inscripcion PENDIENTE a la vez: quien no vino puede volver a pedirla.
    uniqueIndex('class_bookings_one_enrollment_per_phone')
      .on(t.tenantId, t.phone)
      .where(sql`kind = 'enrollment' and status = 'booked'`),
    uniqueIndex('class_bookings_one_enrollment_per_user')
      .on(t.tenantId, t.userId)
      .where(sql`kind = 'enrollment' and user_id is not null and status = 'booked'`),
    // La clase suelta se repite; la MISMA clase no.
    uniqueIndex('class_bookings_one_drop_in_per_class')
      .on(t.tenantId, t.phone, t.localDate, t.classScheduleId)
      .where(sql`kind = 'drop_in' and status <> 'canceled'`),
    // "Quien viene esta semana": la consulta del mostrador.
    index('class_bookings_tenant_date_idx').on(t.tenantId, t.localDate),
    index('class_bookings_account_idx')
      .on(t.firebaseUid)
      .where(sql`firebase_uid is not null`),
  ],
);


/**
 * Baja de cuenta pedida por la propia persona.
 *
 * Google Play la exige para cualquier app con registro, y por dos caminos: uno
 * dentro de la app y una URL publica. La URL es sinchi.fit/eliminar-cuenta;
 * esta tabla es el otro lado.
 *
 * Es una SOLICITUD y no un borrado en el acto, y la migracion 0016 explica por
 * que: la ficha vive en el gimnasio, los cobros son sus asientos contables y el
 * historial es de los dos. Un `DELETE` en cascada disparado desde un boton del
 * telefono borra en casa ajena sin que nadie lo mire, y no se deshace.
 *
 * Fuera de `TENANT_SCOPED_TABLES` a proposito: la baja es de la PERSONA, que
 * puede entrenar en varios gimnasios. Se filtra por `userId` contra el `sub` de
 * la sesion, que es lo unico que el cliente no elige.
 */
export const accountDeletionRequests = pgTable(
  'account_deletion_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * `null` cuando la baja ya se ejecutó. Era CASCADE y borrar a la persona se
     * llevaba la prueba de haberla borrado (migración 0027): ahora la fila se
     * queda con sus dos fechas y sin a quién apuntar.
     */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    status: accountDeletionStatusEnum('status').notNull().default('pending'),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    /** Cuando se ejecuto o se cancelo. Sin esto no se puede probar el plazo. */
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    /** Lo que escribio al pedirla. La mitad son "no puedo entrar a mi cuenta". */
    reason: text('reason'),
  },
  (t) => [
    /**
     * UNA pendiente por persona.
     *
     * En la base y no solo en el servicio: dos toques seguidos al boton son dos
     * peticiones, y sin el indice quedan dos filas y dos correos al soporte por
     * la misma baja. Parcial — cancelar deja pedirla de nuevo.
     */
    uniqueIndex('account_deletion_requests_one_pending')
      .on(t.userId)
      .where(sql`status = 'pending'`),
    index('account_deletion_requests_status_idx').on(t.status, t.requestedAt),
  ],
);

// ---------------------------------------------------------------------------
// Hablar con el gimnasio
// ---------------------------------------------------------------------------

/**
 * Un hilo entre una persona y un gimnasio. UNO por persona y por local.
 *
 * Misma forma que `class_bookings` y por las mismas razones —`user_id` opcional,
 * nombre y celular copiados—, porque escribe la misma gente: quien todavia no es
 * nadie en Sinchi. Por que existe y por que reemplaza al enlace de WhatsApp esta
 * en la migracion 0020.
 */
export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** CASCADE a proposito, no SET NULL: ver 0020. */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    firebaseUid: text('firebase_uid'),
    fullName: text('full_name').notNull(),
    phone: text('phone').notNull(),
    email: text('email'),
    topic: conversationTopicEnum('topic').notNull().default('general'),
    status: conversationStatusEnum('status').notNull().default('open'),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),
    /** Hasta donde leyo cada lado. Lo no leido se deriva de aqui, no se cuenta. */
    personReadAt: timestamp('person_read_at', { withTimezone: true }),
    gymReadAt: timestamp('gym_read_at', { withTimezone: true }),
    /** El ultimo correo de aviso a cada lado. Uno por tanda de mensajes sin leer. */
    gymNotifiedAt: timestamp('gym_notified_at', { withTimezone: true }),
    personNotifiedAt: timestamp('person_notified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('conversations_one_per_user')
      .on(t.tenantId, t.userId)
      .where(sql`user_id is not null`),
    uniqueIndex('conversations_one_per_account')
      .on(t.tenantId, t.firebaseUid)
      .where(sql`user_id is null and firebase_uid is not null`),
    index('conversations_tenant_activity_idx').on(t.tenantId, t.lastMessageAt.desc()),
    index('conversations_user_idx')
      .on(t.userId)
      .where(sql`user_id is not null`),
    index('conversations_account_idx')
      .on(t.firebaseUid)
      .where(sql`firebase_uid is not null`),
    uniqueIndex('conversations_id_tenant_key').on(t.id, t.tenantId),
  ],
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    conversationId: uuid('conversation_id').notNull(),
    sender: messageSenderEnum('sender').notNull(),
    /** Quien del mostrador contesto. `null` en los de la persona. */
    staffId: uuid('staff_id').references(() => staff.id, { onDelete: 'set null' }),
    /** Copiado: el hilo sigue diciendo quien respondio aunque ya no trabaje ahi. */
    staffName: text('staff_name'),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /**
     * Compuesta a proposito: un `tenant_id` mal puesto no puede meter el mensaje
     * en la bandeja de otro gimnasio. Ver 0020.
     */
    foreignKey({
      name: 'messages_conversation_tenant',
      columns: [t.conversationId, t.tenantId],
      foreignColumns: [conversations.id, conversations.tenantId],
    }).onDelete('cascade'),
    index('messages_thread_idx').on(t.conversationId, t.createdAt),
  ],
);
