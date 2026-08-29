/**
 * Variables de entorno, validadas al arrancar.
 *
 * Se valida al inicio y no al usarse: un secreto de firma vacío tiene que
 * tumbar el proceso en el arranque, no producir tokens inválidos a las tres
 * horas de estar en producción.
 */
import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL es obligatoria: es la cadena de conexión de Neon.')
    .refine((value) => value.startsWith('postgres://') || value.startsWith('postgresql://'), {
      message: 'DATABASE_URL debe empezar con postgres:// o postgresql://',
    }),

  /**
   * Cadena con la que se aplican las migraciones, si es distinta.
   *
   * En Neon hacen falta dos roles y no es una formalidad: el rol por defecto
   * (`neondb_owner`) tiene BYPASSRLS, así que si la api se conecta con él, las
   * políticas RLS no se le aplican y el aislamiento por tenant queda inerte.
   *
   *   MIGRATION_DATABASE_URL  neondb_owner — dueño del esquema, corre migraciones
   *   DATABASE_URL            sinchi_app   — la api, sujeta a RLS
   *
   * Ver `scripts/setup-app-role.sql`.
   */
  MIGRATION_DATABASE_URL: z.string().optional(),

  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET debe tener al menos 32 caracteres. Genera uno con crypto.randomBytes(48).'),

  /**
   * Clave de cifrado en reposo: 32 bytes en base64. Cifra el secreto TOTP del
   * alumno y las credenciales de pasarela del gimnasio.
   *
   * Perderla equivale a invalidar todos los QR emitidos: los alumnos tendrían
   * que volver a vincular su dispositivo. Va en el gestor de secretos, no en el
   * repositorio.
   */
  ENCRYPTION_KEY: z
    .string()
    .refine((value) => Buffer.from(value, 'base64').length === 32, {
      message:
        'ENCRYPTION_KEY debe ser de 32 bytes en base64. Genera una con crypto.randomBytes(32).',
    }),

  PORT: z.coerce.number().int().positive().default(3000),

  /**
   * Proyecto de Firebase contra el que se verifican los ID token.
   *
   * En Cloud Run se toma de `GOOGLE_CLOUD_PROJECT`, que la plataforma inyecta
   * sola. Local hay que ponerlo a mano.
   *
   * Verificar un ID token solo necesita esto: las claves publicas de Google se
   * descargan por HTTP. No hacen falta credenciales de servicio.
   */
  FIREBASE_PROJECT_ID: z.string().min(4).optional(),

  /**
   * Credenciales de servicio, como JSON.
   *
   * Opcional y normalmente ausente: solo hace falta si algun dia se usan APIs de
   * Firebase que escriben (crear usuarios, revocar sesiones). Para verificar
   * tokens, no.
   */
  FIREBASE_SERVICE_ACCOUNT_JSON: z.string().optional(),

  /**
   * Resend: envio de invitaciones por correo.
   *
   * Opcional a proposito. Sin ella la invitacion se crea igual y se comparte por
   * enlace —WhatsApp, que en Peru se lee mas que el correo—: el correo es un
   * canal de ENTREGA, no la fuente del vinculo. Que falte no puede impedir dar
   * de alta a nadie.
   */
  RESEND_API_KEY: z.string().min(10).optional(),

  /**
   * Remitente. `onboarding@resend.dev` es el dominio compartido de Resend y solo
   * entrega al correo del duenno de la cuenta: sirve para probar, no para
   * invitar alumnos. Para eso hace falta un dominio propio verificado con SPF y
   * DKIM, y cambiar esta variable.
   */
  MAIL_FROM: z.string().default('Sinchi <onboarding@resend.dev>'),

  /**
   * De donde cuelgan las URLs que salen de aqui hacia fuera.
   *
   * El enlace de la invitacion y el logo del correo tienen que ser direcciones
   * PUBLICAS: un cliente de correo no abre `sinchi://` —no linkifica esquemas
   * propios, y aunque lo hiciera no sabria que hacer sin la app— ni pinta una
   * imagen de `localhost`.
   *
   * Por defecto apunta al servicio desplegado incluso corriendo en local, y eso
   * es correcto: la api local y Cloud Run comparten la misma base, asi que un
   * token emitido aqui vale alli. Un correo enviado desde el portatil lleva
   * enlaces que funcionan.
   */
  PUBLIC_BASE_URL: z.string().url().default('https://sinchi-api-961173851857.us-east4.run.app'),

  /**
   * Quien dispara los trabajos programados.
   *
   *   in_process  el cron vive dentro de la api (`@nestjs/schedule`). Para
   *               desarrollo y para un servidor que siempre esta encendido.
   *   external    los dispara alguien de afuera por HTTP (Cloud Scheduler).
   *
   * En Cloud Run con `min-instances=0` el contenedor se apaga cuando no hay
   * trafico. A las 06:00, que es cuando toca refrescar la morosidad, no hay
   * nadie usando la app: no hay contenedor, y el cron interno NO CORRE. El
   * fallo es silencioso —nadie recibe un error— y solo se nota semanas despues,
   * cuando el panel muestra morosos que ya pagaron.
   */
  SCHEDULER_MODE: z.enum(['in_process', 'external']).default('in_process'),

  /**
   * Secreto compartido con el planificador externo.
   *
   * Sin el, las rutas de `/jobs` quedan apagadas. Falla cerrado: es preferible
   * un trabajo que no corre a un endpoint que cualquiera puede disparar.
   */
  JOBS_TOKEN: z.string().min(24).optional(),

  /**
   * Conexiones por instancia. Cloud Run escala horizontalmente, asi que el
   * total contra Neon es este numero por el numero de instancias vivas.
   */
  DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(8),

  DEFAULT_TIMEZONE: z.string().default('America/Lima'),

  /**
   * Puerta de desarrollo: emite un token de sesión sin verificar nada. Solo
   * existe mientras no hay autenticación por SMS.
   */
  ALLOW_DEV_LOGIN: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),

  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type Env = z.infer<typeof schema>;

/**
 * Cloud Run inyecta `GOOGLE_CLOUD_PROJECT`; Firebase Auth vive en ese mismo
 * proyecto. Derivarlo evita duplicar el dato y que las dos copias se separen.
 */
function withDerivedDefaults(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (source.FIREBASE_PROJECT_ID !== undefined) return source;
  const fromPlatform = source.GOOGLE_CLOUD_PROJECT ?? source.GCLOUD_PROJECT;
  if (fromPlatform === undefined) return source;
  return { ...source, FIREBASE_PROJECT_ID: fromPlatform };
}

let cached: Env | null = null;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached !== null) return cached;

  const parsed = schema.safeParse(withDerivedDefaults(source));
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Configuración inválida:\n${detail}\n\nRevisa apps/api/.env (ver .env.example).`);
  }

  if (parsed.data.NODE_ENV === 'production' && parsed.data.ALLOW_DEV_LOGIN) {
    throw new Error(
      'ALLOW_DEV_LOGIN no puede estar activo en producción: emite sesiones sin verificar identidad.',
    );
  }

  if (parsed.data.SCHEDULER_MODE === 'external' && parsed.data.JOBS_TOKEN === undefined) {
    throw new Error(
      'SCHEDULER_MODE=external necesita JOBS_TOKEN: sin él las rutas de /jobs quedan ' +
        'apagadas y el refresco de morosidad no correría nunca, sin avisar.',
    );
  }

  cached = parsed.data;
  return cached;
}

/** Solo para tests: olvida la configuración cacheada. */
export function resetEnvCache(): void {
  cached = null;
}
