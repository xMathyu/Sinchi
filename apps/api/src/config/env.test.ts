import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadEnv, resetEnvCache } from './env';

const valid = {
  DATABASE_URL: 'postgresql://user:pass@ep-x-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require',
  JWT_SECRET: randomBytes(48).toString('base64url'),
  ENCRYPTION_KEY: randomBytes(32).toString('base64'),
} as NodeJS.ProcessEnv;

beforeEach(() => resetEnvCache());

describe('loadEnv', () => {
  it('acepta una configuracion completa y aplica los valores por defecto', () => {
    const env = loadEnv({ ...valid });
    expect(env.PORT).toBe(3000);
    expect(env.DEFAULT_TIMEZONE).toBe('America/Lima');
    expect(env.ALLOW_DEV_LOGIN).toBe(false);
    expect(env.NODE_ENV).toBe('development');
  });

  it('exige una cadena de conexion de Postgres', () => {
    expect(() => loadEnv({ ...valid, DATABASE_URL: 'mysql://x' })).toThrow(/postgres/);
    expect(() => loadEnv({ ...valid, DATABASE_URL: '' })).toThrow(/DATABASE_URL/);
  });

  it('una URL de tienda vacia cuenta como ausente, no como invalida', () => {
    // Es lo que queda al copiar .env.example sin rellenar la linea. Tumbar el
    // arranque por un dato opcional seria un fallo absurdo, y ademas ocurriria
    // en el despliegue y no en el portatil de nadie.
    const env = loadEnv({ ...valid, IOS_STORE_URL: '', ANDROID_STORE_URL: '' });
    expect(env.IOS_STORE_URL).toBeUndefined();
    expect(env.ANDROID_STORE_URL).toBeUndefined();
  });

  it('rechaza un secreto de firma corto', () => {
    // Un JWT_SECRET debil es un token falsificable, y con el se entra a
    // cualquier gimnasio de la red.
    expect(() => loadEnv({ ...valid, JWT_SECRET: 'corto' })).toThrow(/32 caracteres/);
  });

  it('rechaza una clave de cifrado que no sea de 32 bytes', () => {
    expect(() =>
      loadEnv({ ...valid, ENCRYPTION_KEY: randomBytes(16).toString('base64') }),
    ).toThrow(/32 bytes/);
  });

  it('se niega a arrancar con el login de desarrollo en produccion', () => {
    // Es la proteccion que impide desplegar una api que emite sesiones sin
    // verificar identidad.
    expect(() =>
      loadEnv({ ...valid, NODE_ENV: 'production', ALLOW_DEV_LOGIN: 'true' }),
    ).toThrow(/producción/);
  });

  it('permite el login de desarrollo fuera de produccion', () => {
    const env = loadEnv({ ...valid, ALLOW_DEV_LOGIN: 'true' });
    expect(env.ALLOW_DEV_LOGIN).toBe(true);
  });

  it('lista todos los problemas de una vez', () => {
    // Arreglar la configuracion de a un error por intento es una perdida de
    // tiempo cuando faltan tres variables.
    let message = '';
    try {
      loadEnv({ DATABASE_URL: '', JWT_SECRET: 'x', ENCRYPTION_KEY: 'y' } as NodeJS.ProcessEnv);
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }
    expect(message).toContain('DATABASE_URL');
    expect(message).toContain('JWT_SECRET');
    expect(message).toContain('ENCRYPTION_KEY');
  });
});
