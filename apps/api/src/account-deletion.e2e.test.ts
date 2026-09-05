/**
 * Baja de cuenta pedida por la propia persona.
 *
 * Es un requisito de Google Play —camino dentro de la app, mas una URL
 * publica— y por eso se prueba de punta a punta y no solo el servicio: lo que
 * Play comprueba es que la RUTA responda, no que la funcion exista.
 *
 * Lo que aqui de verdad se protege son tres cosas que un `it` suelto no ve:
 * que dos toques al boton no abran dos bajas, que la baja de uno no sea la de
 * otro, y que un gimnasio moroso no deje a su recepcionista sin poder irse.
 *
 * Necesita `TEST_DATABASE_URL` con un rol sin BYPASSRLS. Ver `app.e2e.test.ts`.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const suite = DATABASE_URL === undefined ? describe.skip : describe;

let app: INestApplication;
let http: ReturnType<typeof request>;

const auth = (bearer: string) => ({ Authorization: `Bearer ${bearer}` });

const devLogin = async (phone: string): Promise<string> => {
  const response = await http.post('/v1/auth/dev-login').send({ phone }).expect(201);
  return response.body.accessToken as string;
};

/** Alumna de un gimnasio. */
let lucia = '';
/** Otro alumno: sirve para comprobar que una baja no toca la del vecino. */
let diego = '';
/** Recepcionista. Su sesion lleva tenant, que es la que el SaasGuard mira. */
let recepcion = '';

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;

  process.env.DATABASE_URL = DATABASE_URL;
  process.env.JWT_SECRET ??= randomBytes(48).toString('base64url');
  process.env.ENCRYPTION_KEY ??= randomBytes(32).toString('base64');
  process.env.ALLOW_DEV_LOGIN = 'true';
  process.env.NODE_ENV = 'test';

  const { runSeed } = await import('./db/seed');
  await runSeed({ reset: true, quiet: true });

  const { AppModule } = await import('./app.module');
  const { configureApp } = await import('./bootstrap');
  const { loadEnv } = await import('./config/env');

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  configureApp(app, loadEnv());
  await app.init();
  http = request(app.getHttpServer());

  lucia = await devLogin('+51987111222');
  diego = await devLogin('+51987222333');
  recepcion = await devLogin('+51987000111');
}, 90_000);

afterAll(async () => {
  await app?.close();
});

suite('baja de cuenta', () => {
  it('sin sesion no se puede pedir', async () => {
    // La ruta esta cerrada por defecto como el resto, pero conviene fijarlo:
    // una baja que cualquiera pueda pedir por el uuid de otro es un arma.
    await http.post('/v1/me/account/deletion-request').send({}).expect(401);
    await http.get('/v1/me/account/deletion-request').expect(401);
  });

  it('empieza sin ninguna pendiente', async () => {
    const { body } = await http
      .get('/v1/me/account/deletion-request')
      .set(auth(lucia))
      .expect(200);
    expect(body.request).toBeNull();
  });

  it('la pide, y queda pendiente con su fecha', async () => {
    const { body } = await http
      .post('/v1/me/account/deletion-request')
      .set(auth(lucia))
      .send({ reason: 'Me mudo de ciudad' })
      .expect(201);

    expect(body.request.status).toBe('pending');
    expect(body.request.reason).toBe('Me mudo de ciudad');
    // La fecha es lo que hace exigible el plazo de 30 dias de la politica.
    expect(new Date(body.request.requestedAt).getTime()).toBeLessThanOrEqual(Date.now());

    const { body: estado } = await http
      .get('/v1/me/account/deletion-request')
      .set(auth(lucia))
      .expect(200);
    expect(estado.request.id).toBe(body.request.id);
  });

  it('pedirla dos veces devuelve la MISMA, no abre otra', async () => {
    // El caso real: la red tarda, la persona vuelve a tocar el boton. Sin esto
    // quedan dos filas y el soporte recibe dos avisos por la misma baja.
    const { body } = await http
      .post('/v1/me/account/deletion-request')
      .set(auth(lucia))
      .send({ reason: 'otro texto que NO debe pisar al primero' })
      .expect(201);

    const { body: estado } = await http
      .get('/v1/me/account/deletion-request')
      .set(auth(lucia))
      .expect(200);
    expect(body.request.id).toBe(estado.request.id);
    expect(body.request.reason).toBe('Me mudo de ciudad');
  });

  it('dos peticiones A LA VEZ tampoco abren dos', async () => {
    // La carrera que el `select` previo no cubre: las dos lo pasan antes de que
    // ninguna inserte. Lo para el indice unico parcial, no el codigo.
    const [a, b] = await Promise.all([
      http.post('/v1/me/account/deletion-request').set(auth(diego)).send({}),
      http.post('/v1/me/account/deletion-request').set(auth(diego)).send({}),
    ]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.request.id).toBe(b.body.request.id);
  });

  it('la baja de uno no es la del otro', async () => {
    const { body: deDiego } = await http
      .get('/v1/me/account/deletion-request')
      .set(auth(diego))
      .expect(200);
    const { body: deLucia } = await http
      .get('/v1/me/account/deletion-request')
      .set(auth(lucia))
      .expect(200);
    expect(deDiego.request.id).not.toBe(deLucia.request.id);
  });

  it('se puede cancelar, y entonces se puede volver a pedir', async () => {
    // Treinta dias son muchos para no poder desdecirse. Y el indice es PARCIAL
    // justo para esto: cancelar tiene que dejar sitio a una nueva.
    await http
      .delete('/v1/me/account/deletion-request')
      .set(auth(diego))
      .expect(200)
      .expect(({ body }) => expect(body.canceled).toBe(true));

    const { body: tras } = await http
      .get('/v1/me/account/deletion-request')
      .set(auth(diego))
      .expect(200);
    expect(tras.request).toBeNull();

    const { body: otra } = await http
      .post('/v1/me/account/deletion-request')
      .set(auth(diego))
      .send({})
      .expect(201);
    expect(otra.request.status).toBe('pending');
  });

  it('cancelar cuando no hay nada pendiente no revienta', async () => {
    await http.delete('/v1/me/account/deletion-request').set(auth(recepcion)).expect(200);
  });

  it('el staff tambien puede irse, y sin depender de que su gimnasio pague', async () => {
    // El `SaasGuard` solo frena a sesiones de staff con tenant. Si esta ruta no
    // estuviera marcada `@AllowedWhenReadOnly`, el recepcionista de un local
    // moroso seria el unico que no podria borrar su cuenta.
    const { body } = await http
      .post('/v1/me/account/deletion-request')
      .set(auth(recepcion))
      .send({})
      .expect(201);
    expect(body.request.status).toBe('pending');
  });

  it('el motivo es opcional y se puede omitir', async () => {
    await http.delete('/v1/me/account/deletion-request').set(auth(lucia)).expect(200);
    const { body } = await http
      .post('/v1/me/account/deletion-request')
      .set(auth(lucia))
      .send({})
      .expect(201);
    expect(body.request.reason).toBeNull();
  });

  it('un motivo larguisimo se rechaza en vez de guardarse entero', async () => {
    await http.delete('/v1/me/account/deletion-request').set(auth(lucia)).expect(200);
    await http
      .post('/v1/me/account/deletion-request')
      .set(auth(lucia))
      .send({ reason: 'x'.repeat(501) })
      .expect(400);
  });
});
