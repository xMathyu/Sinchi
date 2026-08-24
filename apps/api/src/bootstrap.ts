/**
 * Configuracion de la aplicacion, compartida por el arranque real y las
 * pruebas de punta a punta.
 *
 * Existe por una razon concreta: la prueba montaba la app con el harness de Nest
 * y se saltaba lo que hacia `main.ts`. Asi paso un `ValidationPipe` global que
 * exige `class-validator` —paquete que este proyecto no usa, porque valida con
 * Zod— y el proceso reventaba al arrancar con los 37 tests en verde. Con esto,
 * lo que prueban las pruebas es lo que corre en produccion.
 */
import type { INestApplication } from '@nestjs/common';
import type { Env } from './config/env';

export function configureApp(app: INestApplication, env: Env): void {
  app.setGlobalPrefix('v1');
  app.enableShutdownHooks();

  // Sin `ValidationPipe` global: la validacion de entrada la hace `ZodPipe` en
  // cada ruta, y con eso los campos que el esquema no declara se descartan (Zod
  // los quita por defecto). Un `ValidationPipe` aqui solo agregaria una
  // dependencia y una segunda fuente de verdad.

  app.enableCors({
    // El panel web y la app son los unicos clientes; en produccion se recorta a
    // los dominios reales.
    origin: env.NODE_ENV === 'production' ? [/\.sinchi\.pe$/] : true,
    credentials: false,
  });
}
