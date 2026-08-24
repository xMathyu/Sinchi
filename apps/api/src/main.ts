/**
 * Arranque.
 *
 * La configuracion se valida ANTES de levantar el servidor: es preferible un
 * proceso que no arranca a uno que responde con un secreto de firma vacio.
 */
import 'reflect-metadata';
import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { loadEnv } from './config/env';

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const logger = new Logger('bootstrap');

  const app = await NestFactory.create(
    AppModule,
    // En produccion se calla el nivel `debug`: el log de transiciones de
    // morosidad tiene ids de alumnos y no tiene por que ir a stdout.
    env.NODE_ENV === 'production' ? { logger: ['error', 'warn', 'log'] } : {},
  );

  configureApp(app, env);

  // `0.0.0.0` explicito: en un contenedor, escuchar solo en localhost hace que
  // el balanceador no llegue nunca y el despliegue falle con "no responde".
  await app.listen(env.PORT, '0.0.0.0');
  logger.log(`Sinchi api escuchando en el puerto ${env.PORT}, prefijo /v1`);
  logger.log(`planificador: ${env.SCHEDULER_MODE}`);
  if (env.ALLOW_DEV_LOGIN) {
    logger.warn('ALLOW_DEV_LOGIN activo: /v1/auth/dev-login emite sesiones sin verificar nada.');
  }
}

bootstrap().catch((error: unknown) => {
  console.error('No se pudo arrancar la api:', error instanceof Error ? error.message : error);
  process.exit(1);
});
