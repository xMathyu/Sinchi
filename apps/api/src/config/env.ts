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

let cached: Env | null = null;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached !== null) return cached;

  const parsed = schema.safeParse(source);
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

  cached = parsed.data;
  return cached;
}

/** Solo para tests: olvida la configuración cacheada. */
export function resetEnvCache(): void {
  cached = null;
}
