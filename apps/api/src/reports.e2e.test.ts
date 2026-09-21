/**
 * Los reportes de ingresos del dueño, de punta a punta.
 *
 * La aritmetica —que un pendiente no es plata, que el cobro de la noche cae en
 * el dia del gimnasio— ya la prueban los tests puros de `revenue.test.ts` sin
 * levantar nada. Lo que se prueba AQUI es lo que aquellos no pueden ver:
 *
 *  · que la ruta es del dueño y recepcion recibe 403;
 *  · que RLS no deja que un dueño lea la caja de OTRO gimnasio, que es el
 *    riesgo real de una ruta de reportes — hasta ahora ninguna devolvia dinero
 *    agregado y un `where` que se olvide del tenant aqui es una fuga de la
 *    facturacion de un competidor;
 *  · que el rango que viaja por la query llega entero al calculo.
 *
 * Necesita `TEST_DATABASE_URL` con un rol SIN BYPASSRLS: con el, la prueba de
 * aislamiento pasaria sin probar nada.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { TZ_LIMA, addDays, formatPlainDate, plainDateInZone } from '@sinchi/shared';

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const suite = DATABASE_URL === undefined ? describe.skip : describe;

let app: INestApplication;
let http: ReturnType<typeof request>;
let membershipId = '';
const token = { owner: '', frontDesk: '', otherOwner: '' };

const auth = (bearer: string) => ({ Authorization: `Bearer ${bearer}` });

/** Hoy en Lima, que es el dia en el que la api va a colocar lo que cobremos. */
const today = () => plainDateInZone(new Date(), TZ_LIMA);
const iso = (offset = 0) => formatPlainDate(addDays(today(), offset));

const revenue = (query: string, bearer = token.owner) =>
  http.get(`/v1/staff/reports/revenue?${query}`).set(auth(bearer));

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

  const issue = async (phone: string): Promise<string> =>
    (await http.post('/v1/auth/dev-login').send({ phone }).expect(201)).body.accessToken as string;

  // Sergio Paz es dueño de Iron Muay Thai; Ana Ríos es recepción en Shotokan.
  token.owner = await issue('+51987000333');
  token.frontDesk = await issue('+51987000111');

  const roster = await http.get('/v1/staff/roster').set(auth(token.owner)).expect(200);
  membershipId = roster.body[0].membership.id as string;
}, 120_000);

afterAll(async () => {
  await app?.close();
});

suite('quién puede ver la caja', () => {
  it('el dueño sí', async () => {
    await revenue(`from=${iso(-30)}&through=${iso()}`).expect(200);
  });

  it('recepción no', async () => {
    // Cobra, y ve lo que cobró ella en la ficha del alumno. El total del local
    // es otra cosa: es la relación comercial del dueño.
    await revenue(`from=${iso(-30)}&through=${iso()}`, token.frontDesk).expect(403);
  });

  it('el ledger sigue la misma regla', async () => {
    await http
      .get(`/v1/staff/reports/charges?from=${iso(-30)}&through=${iso()}`)
      .set(auth(token.frontDesk))
      .expect(403);
  });
});

suite('el rango', () => {
  it('lo exige: no inventa «el mes en curso»', async () => {
    // Una ruta de reportes que decide sola el periodo es la que después
    // devuelve un número del que nadie sabe de cuándo es.
    await revenue('bucket=day').expect(400);
  });

  it('rechaza un final anterior al inicio', async () => {
    // Devolvería cero y parecería un gimnasio parado, no una petición al revés.
    await revenue(`from=${iso()}&through=${iso(-10)}`).expect(400);
  });

  it('rechaza una fecha que no existe', async () => {
    await revenue(`from=2026-02-30&through=${iso()}`).expect(400);
  });

  it('rechaza más de un año por día: son más puntos de los que se leen', async () => {
    await revenue(`from=${iso(-400)}&through=${iso()}`).expect(400);
  });

  it('devuelve un punto por día del rango, huecos incluidos', async () => {
    const { body } = await revenue(`from=${iso(-6)}&through=${iso()}`).expect(200);

    expect(body.report.series).toHaveLength(7);
    expect(body.report.series.at(-1).date).toEqual({
      year: today().year,
      month: today().month,
      day: today().day,
    });
  });
});

suite('lo que suma', () => {
  it('un cobro de hoy aparece en el total, en el día y en los dos desgloses', async () => {
    const antes = (await revenue(`from=${iso()}&through=${iso()}`).expect(200)).body;

    await http
      .post('/v1/staff/payments')
      .set(auth(token.owner))
      .send({ membershipId, type: 'renewal', rail: 'yape' })
      .expect(201);

    const despues = (await revenue(`from=${iso()}&through=${iso()}`).expect(200)).body;
    const cobrado = despues.report.totalCents - antes.report.totalCents;

    expect(cobrado).toBeGreaterThan(0);
    expect(despues.report.count).toBe(antes.report.count + 1);
    expect(despues.report.series.at(-1).amountCents).toBe(despues.report.totalCents);

    // Los dos desgloses parten el MISMO dinero: si uno se descuadra del total,
    // el panel enseña dos cifras distintas del mismo mes.
    const porTipo = despues.report.byType.reduce(
      (acc: number, slice: { amountCents: number }) => acc + slice.amountCents,
      0,
    );
    const porMedio = despues.report.byRail.reduce(
      (acc: number, slice: { amountCents: number }) => acc + slice.amountCents,
      0,
    );
    expect(porTipo).toBe(despues.report.totalCents);
    expect(porMedio).toBe(despues.report.totalCents);

    const yape = despues.report.byRail.find((slice: { key: string }) => slice.key === 'yape');
    expect(yape.amountCents).toBeGreaterThanOrEqual(cobrado);
  });

  it('el ledger trae ese cobro con quién pagó y quién lo registró', async () => {
    const { body } = await http
      .get(`/v1/staff/reports/charges?from=${iso()}&through=${iso()}`)
      .set(auth(token.owner))
      .expect(200);

    expect(body.total).toBeGreaterThan(0);
    const fila = body.rows[0];
    expect(fila.charge.status).toBe('succeeded');
    expect(fila.memberName).toBeTypeOf('string');
    // Lo registró Sergio desde el mostrador: `recorded_by` es por donde entran
    // los favores, y por eso se enseña.
    expect(fila.recordedByName).toBe('Sergio Paz');
  });

  it('el ledger pagina sin perder el total', async () => {
    const { body } = await http
      .get(`/v1/staff/reports/charges?from=${iso(-60)}&through=${iso()}&limit=1&offset=0`)
      .set(auth(token.owner))
      .expect(200);

    expect(body.rows).toHaveLength(1);
    expect(body.total).toBeGreaterThanOrEqual(1);
  });
});

suite('quién viene y quién se está yendo', () => {
  const ranking = (query: string, bearer = token.owner) =>
    http.get(`/v1/staff/reports/attendance?${query}`).set(auth(bearer));

  it('es del dueño, no del mostrador', async () => {
    await ranking(`from=${iso(-28)}&through=${iso()}`, token.frontDesk).expect(403);
  });

  it('el que acaba de marcar aparece arriba en el top', async () => {
    // Se marca a mano, que es el camino del alumno sin celular y deja rastro
    // igual que el QR.
    await http
      .post('/v1/staff/checkin/manual')
      .set(auth(token.owner))
      .send({ membershipId, overrideDenial: true })
      .expect(201);

    const { body } = await ranking(`from=${iso(-28)}&through=${iso()}`).expect(200);

    expect(body.totalCheckIns).toBeGreaterThanOrEqual(1);
    expect(body.regulars.length).toBeGreaterThanOrEqual(1);
    expect(body.regulars[0].checkIns).toBeGreaterThanOrEqual(1);
    // Vino hoy, así que no puede estar en la lista de riesgo.
    expect(body.fading.map((f: { membershipId: string }) => f.membershipId)).not.toContain(
      membershipId,
    );
  });

  it('nadie del padrón recién sembrado sale como «se está yendo»', async () => {
    // La siembra inscribe hoy, y el margen de alumno nuevo son 14 días: una
    // lista de riesgo llena de recién llegados es la que se deja de mirar.
    const { body } = await ranking(`from=${iso(-28)}&through=${iso()}`).expect(200);

    expect(body.fading).toEqual([]);
  });

  it('el límite recorta las dos listas', async () => {
    const { body } = await ranking(`from=${iso(-28)}&through=${iso()}&limit=1`).expect(200);

    expect(body.regulars.length).toBeLessThanOrEqual(1);
    expect(body.fading.length).toBeLessThanOrEqual(1);
  });

  it('pide el rango y rechaza uno al revés, como los ingresos', async () => {
    await ranking('limit=5').expect(400);
    await ranking(`from=${iso()}&through=${iso(-10)}`).expect(400);
  });
});

suite('el aislamiento por gimnasio', () => {
  it('la caja de un local no se ve desde otro', async () => {
    // Es el riesgo que estrena esta ruta: hasta ahora ninguna devolvía dinero
    // agregado, y un `where` sin tenant aquí filtra la facturación de un vecino.
    const iron = (await revenue(`from=${iso(-60)}&through=${iso()}`).expect(200)).body;

    // Ana ve el padrón de Shotokan; su dueño no está sembrado, así que se
    // comprueba por el otro lado: lo que cobra Shotokan no puede aparecer en el
    // total de Iron. Se cobra en Shotokan y el total de Iron no se mueve.
    const rosterShotokan = await http
      .get('/v1/staff/roster')
      .set(auth(token.frontDesk))
      .expect(200);

    await http
      .post('/v1/staff/payments')
      .set(auth(token.frontDesk))
      .send({
        membershipId: rosterShotokan.body[0].membership.id,
        type: 'renewal',
        rail: 'cash',
      })
      .expect(201);

    const despues = (await revenue(`from=${iso(-60)}&through=${iso()}`).expect(200)).body;
    expect(despues.report.totalCents).toBe(iron.report.totalCents);
  });
});
