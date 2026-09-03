/**
 * El mes gratis del gimnasio y el corte por impago, de punta a punta.
 *
 * Lo que se prueba aqui no es la aritmetica de fechas —eso son los tests puros
 * de `@sinchi/shared`— sino la promesa que sostiene la oferta: cuando el
 * gimnasio no paga, **la puerta sigue funcionando**. Si esta prueba se rompe y
 * alguien la "arregla" bloqueando el check-in, el producto cambio de contrato:
 * pasa a castigar al alumno que si le pago a su gimnasio.
 *
 * Todo va contra Iron Muay Thai, que es el gimnasio del unico `owner` sembrado.
 * El corte es cosa del dueno y el estado de su suscripcion tambien.
 *
 * Necesita `TEST_DATABASE_URL`, igual que los demas e2e.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import {
  SAAS_FREE_TIER_LIMIT,
  TZ_LIMA,
  addDays,
  formatPlainDate,
  plainDateInZone,
} from '@sinchi/shared';

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const suite = DATABASE_URL === undefined ? describe.skip : describe;

/** El local de Sergio Paz, el unico dueño del padrón sembrado. */
const SLUG = 'iron-muay-thai';

let app: INestApplication;
let http: ReturnType<typeof request>;
let tenantId = '';
let membershipId = '';
let planId = '';
const token = { owner: '', frontDesk: '' };

const auth = (bearer: string) => ({ Authorization: `Bearer ${bearer}` });

let nuevoDocumento = 90_000_000;
/** Un alta distinta por intento: el documento es único en la red. */
const otroAlumno = () => ({
  name: 'Alta De Prueba',
  documentId: String(++nuevoDocumento),
  phone: `+519${String(nuevoDocumento).slice(0, 8)}`,
  planId,
});

/**
 * Mueve el vencimiento al pasado, como si el mes gratis hubiera terminado.
 *
 * La fecha se calcula en JS y en hora de LIMA, con los mismos helpers que usa la
 * api. Con `current_date` de Postgres no coincidían: el contenedor va en UTC y
 * desde las 19:00 de Lima ya es el día siguiente, así que «vencido hace 8 días»
 * llegaba al motor como 7 y el gimnasio salía `in_grace` en vez de `read_only`.
 *
 * Comprueba que tocó una fila, y no es paranoia: la primera versión hacía el
 * `UPDATE` antes de que el gimnasio tuviera fila —la crea el trabajo diario, no
 * la lectura— así que afectaba a cero filas, el gimnasio se quedaba en su mes
 * gratis y las pruebas de «la puerta sigue» pasaban en vacío, sin corte que
 * probar. Un helper de test que no verifica su efecto es una prueba verde que no
 * prueba nada.
 */
async function vencerHace(dias: number): Promise<void> {
  const { schema, withoutTenantIsolation } = await import('./db/client');
  const { DATABASE } = await import('./db/db.module');
  const db = app.get(DATABASE);
  const fecha = formatPlainDate(addDays(plainDateInZone(new Date(), TZ_LIMA), -dias));

  const tocadas = await withoutTenantIsolation(db, (tx) =>
    tx
      .update(schema.saasSubscriptions)
      .set({ freeUntil: fecha, nextBillingDate: fecha })
      .where(eq(schema.saasSubscriptions.tenantId, tenantId))
      .returning({ tenantId: schema.saasSubscriptions.tenantId }),
  );
  expect(tocadas, 'el gimnasio no tenía fila de suscripción que vencer').toHaveLength(1);
}

const suscripcion = async () =>
  (await http.get('/v1/staff/subscription').set(auth(token.owner)).expect(200)).body;

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

  // Sergio Paz es `owner` en Iron; Ana Ríos es recepción en Shotokan.
  token.owner = await issue('+51987000333');
  token.frontDesk = await issue('+51987000111');

  const roster = await http.get('/v1/staff/roster').set(auth(token.owner)).expect(200);
  tenantId = roster.body[0].tenant.id as string;
  membershipId = roster.body[0].membership.id as string;

  const plans = await http.get('/v1/staff/plans').set(auth(token.owner)).expect(200);
  planId = plans.body[0].id as string;

  /**
   * El gimnasio tiene que PAGAR para que haya corte que probar.
   *
   * Hasta 10 alumnos el escalón es gratis y la cuenta no se puede cortar —no
   * debe nada—, así que un local de cuatro alumnos como el sembrado dejaría
   * estas pruebas verdes sin ejercitar nada. Se le llena el padrón por encima
   * del límite, que es la condición real del cliente que paga.
   *
   * Con MARGEN y no justo en 11: parado en el límite exacto, cualquier alumno
   * que se cuente distinto —una baja, un alta de otra prueba— devolvía el
   * gimnasio al plan gratis y las pruebas del corte fallaban una vez de cada
   * tantas. Un test que falla a veces es peor que uno que falla siempre.
   */
  const MARGEN = SAAS_FREE_TIER_LIMIT + 4;
  while ((await http.get('/v1/staff/roster').set(auth(token.owner))).body.length < MARGEN) {
    await http.post('/v1/staff/members').set(auth(token.owner)).send(otroAlumno()).expect(201);
  }
}, 120_000);

afterAll(async () => {
  await app?.close();
});

suite('el mes gratis del gimnasio', () => {
  it('un gimnasio que ya pasó del plan gratis está en su mes gratis', async () => {
    const body = await suscripcion();

    expect(body.state.status).toBe('trialing');
    expect(body.state.canWrite).toBe(true);
    // Un mes desde el alta: 28 el más corto de todos.
    expect(body.state.freeDaysLeft).toBeGreaterThanOrEqual(27);
    expect(body.priceCents).toBe(14_900);
    expect(body.notice.title).toContain('mes gratis');
  });

  it('es del dueño, no del mostrador', async () => {
    // Es la relación comercial del local, no la operación de recepción.
    await http.get('/v1/staff/subscription').set(auth(token.frontDesk)).expect(403);
  });

  it('durante el mes gratis se puede operar con normalidad', async () => {
    await http.post('/v1/staff/members').set(auth(token.owner)).send(otroAlumno()).expect(201);
  });

  it('el trabajo diario le materializa la fila, y no la cambia de estado', async () => {
    // Leer nunca escribe: hasta aquí el gimnasio no tenía fila y su mes gratis
    // salía calculado de `tenants.created_at`. Quien la crea es el trabajo de
    // las 06:00, y tiene que hacerlo sin mover a nadie de estado.
    const { SaasService } = await import('./modules/saas/saas.service');
    const reporte = await app.get(SaasService).refreshAll();

    expect(reporte.started).toBeGreaterThanOrEqual(1);
    // Sigue en su mes gratis: pasó de 10 alumnos, así que su escalón es de pago
    // y el mes gratis del alta le corre igual.
    const despues = await suscripcion();
    expect(despues.state.status).toBe('trialing');
    expect(despues.tier).toBe('up_to_60');
  });
});

suite('cuando el mes gratis vence y no se paga', () => {
  it('entra en gracia y todavía deja escribir', async () => {
    await vencerHace(2);

    const body = await suscripcion();
    expect(body.state.status).toBe('in_grace');
    expect(body.state.canWrite).toBe(true);

    await http.post('/v1/staff/members').set(auth(token.owner)).send(otroAlumno()).expect(201);
  });

  it('pasada la gracia, la cuenta queda en solo lectura', async () => {
    // Ocho días: uno más que los siete de gracia de Sinchi.
    await vencerHace(8);

    const body = await suscripcion();
    // Se afirma el escalón antes que el estado: si el gimnasio hubiera caído al
    // plan gratis, todo lo que sigue pasaría por el motivo equivocado y el
    // fallo aparecería tres pruebas más abajo, disfrazado de otra cosa.
    expect(body.tier).not.toBe('free');
    expect(body.state.status).toBe('read_only');
    expect(body.state.canWrite).toBe(false);
  });

  it('LA PUERTA SIGUE: el check-in manual no se bloquea', async () => {
    // Si esta prueba se rompe, no se arregla bloqueando el check-in. El corte de
    // Sinchi al gimnasio nunca puede caer sobre el alumno que sí pagó.
    const response = await http
      .post('/v1/staff/checkin/manual')
      .set(auth(token.owner))
      .send({ membershipId });

    expect(response.status).not.toBe(403);
  });

  it('leer nunca se corta: sus datos siguen siendo suyos', async () => {
    await http.get('/v1/staff/roster').set(auth(token.owner)).expect(200);
    await http.get('/v1/staff/summary').set(auth(token.owner)).expect(200);
  });

  it('la cola offline sigue subiendo: repite lo que ya pasó en el mostrador', async () => {
    const response = await http
      .post('/v1/staff/sync')
      .set(auth(token.owner))
      .send({ attendances: [], payments: [] });

    expect(response.status).not.toBe(403);
  });

  it('el PIN de turno sigue abierto: sin PIN no hay puerta', async () => {
    const response = await http.post('/v1/staff/pin').set(auth(token.owner)).send({ pin: '4417' });
    expect(response.status).not.toBe(403);
  });

  it('no se dan de alta alumnos nuevos', async () => {
    const { body, status } = await http
      .post('/v1/staff/members')
      .set(auth(token.owner))
      .send(otroAlumno());

    expect(status).toBe(403);
    expect(body.code).toBe('saas_read_only');
    // El motivo va en texto para quien lo lee, que es una persona con un alumno
    // delante. "Prohibido" a secas no le dice qué hacer.
    expect(body.message).toContain('La puerta sigue funcionando');
  });

  it('no se registran pagos nuevos', async () => {
    const { status } = await http
      .post('/v1/staff/payments')
      .set(auth(token.owner))
      .send({ membershipId, type: 'renewal', rail: 'cash' });

    expect(status).toBe(403);
  });

  it('sale del directorio público: deja de recibir interesados', async () => {
    const { body } = await http.get('/v1/gyms').expect(200);
    expect(body.map((gym: { slug: string }) => gym.slug)).not.toContain(SLUG);
  });

  it('su ficha pública tampoco abre', async () => {
    // Si no, el enlace que alguien guardó seguiría dando de alta interesados.
    await http.get(`/v1/gyms/${SLUG}`).expect(404);
  });
});

suite('cuando el gimnasio paga', () => {
  it('registrar la transferencia levanta el corte en el acto', async () => {
    const { SaasService } = await import('./modules/saas/saas.service');
    const saas = app.get(SaasService);

    const cobro = await saas.recordPayment({ tenantId, rail: 'bank_transfer', reference: 'OP-1' });
    expect(cobro.alreadyRecorded).toBe(false);
    expect(cobro.amountCents).toBe(14_900);

    const body = await suscripcion();
    expect(body.state.status).toBe('active');
    expect(body.state.canWrite).toBe(true);

    await http.post('/v1/staff/members').set(auth(token.owner)).send(otroAlumno()).expect(201);
  });

  it('vuelve al directorio', async () => {
    const { body } = await http.get('/v1/gyms').expect(200);
    expect(body.map((gym: { slug: string }) => gym.slug)).toContain(SLUG);
  });

  it('registrar dos veces la misma transferencia no regala un mes', async () => {
    // Pasa cuando dos personas atienden el mismo correo del banco. Lo para el
    // índice único por número de operación, no una comprobación en el código.
    //
    // El índice por periodo NO cubre este caso: el primer cobro ya adelantó la
    // fecha, así que el segundo apuntaría al mes siguiente y pasaría —cobrándole
    // dos meses al gimnasio por un solo depósito.
    const { SaasService } = await import('./modules/saas/saas.service');
    const saas = app.get(SaasService);

    const repetido = await saas.recordPayment({ tenantId, rail: 'yape', reference: 'OP-1' });
    expect(repetido.alreadyRecorded).toBe(true);
  });

  it('un depósito distinto sí compra el mes siguiente', async () => {
    const { SaasService } = await import('./modules/saas/saas.service');
    const saas = app.get(SaasService);

    const siguiente = await saas.recordPayment({ tenantId, rail: 'yape', reference: 'OP-2' });
    expect(siguiente.alreadyRecorded).toBe(false);
  });
});

/**
 * Va AL FINAL: deja al gimnasio con un mes gratis por delante, así que cualquier
 * prueba del corte que corriera después pasaría en vacío.
 */
suite('crecer y salir del plan gratis', () => {
  /**
   * El caso que decide si el plan gratis es una puerta o una trampa.
   *
   * Un gimnasio que lleva meses gratis tiene su fecha de cobro muy atrás. Si al
   * pasar de 10 alumnos el motor lo mirara tal cual, lo vería como un moroso de
   * meses y lo cortaría EL MISMO DÍA que creció — la peor forma posible de
   * cobrarle a alguien por primera vez.
   */
  it('cruzar los 10 alumnos da un mes por delante, no un corte', async () => {
    const { schema, withoutTenantIsolation } = await import('./db/client');
    const { DATABASE } = await import('./db/db.module');
    const { SaasService } = await import('./modules/saas/saas.service');

    // Como si llevara medio año en el plan gratis: escalón gratis y fecha
    // vencida hace mucho. El padrón ya está por encima de 10 desde `beforeAll`.
    await vencerHace(180);
    await withoutTenantIsolation(app.get(DATABASE), (tx) =>
      tx
        .update(schema.saasSubscriptions)
        .set({ tier: 'free', status: 'free' })
        .where(eq(schema.saasSubscriptions.tenantId, tenantId)),
    );

    const reporte = await app.get(SaasService).refreshAll();
    expect(reporte.leftFreeTier).toBeGreaterThanOrEqual(1);

    const { body } = await http.get('/v1/staff/subscription').set(auth(token.owner)).expect(200);
    expect(body.tier).toBe('up_to_60');
    // Lo que importa: NO quedó cortado, y tiene un mes por delante.
    expect(body.state.canWrite).toBe(true);
    expect(body.state.freeDaysLeft).toBeGreaterThanOrEqual(27);
  });
});
