/**
 * Alta de un gimnasio y codigos de promocion, de punta a punta.
 *
 * Es la primera ruta publica que crea un tenant, asi que lo que importa no es el
 * camino feliz sino sus limites: que un RUC inventado no entre, que una persona
 * no llene la red de gimnasios, y que el tope de usos de un codigo se cumpla de
 * verdad. Y la regla que sostiene el plan gratis: un local de diez alumnos no se
 * corta nunca, por muy vencida que este su fecha.
 *
 * Necesita `TEST_DATABASE_URL`, igual que los demas e2e.
 */
import { randomBytes, randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UnauthorizedException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { eq, inArray, sql } from 'drizzle-orm';
import { FirebaseVerifier, type VerifiedIdentity } from './auth/firebase';

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const suite = DATABASE_URL === undefined ? describe.skip : describe;

let app: INestApplication;
let http: ReturnType<typeof request>;

const identities = new Map<string, VerifiedIdentity>();
const fakeVerifier = {
  verify: async (idToken: string): Promise<VerifiedIdentity> => {
    const identity = identities.get(idToken);
    if (identity === undefined) throw new UnauthorizedException('Sesion invalida.');
    return identity;
  },
};

function declareIdentity(uid: string): string {
  const token = `${uid}.${'x'.repeat(120)}`;
  identities.set(token, {
    uid,
    email: `${uid}@example.com`,
    emailVerified: true,
    displayName: uid,
    provider: 'google.com',
  });
  return token;
}

/** Documentos y celulares distintos por corrida: son unicos en la red. */
const runId = randomInt(10_000_000, 89_000_000);
let contador = 0;
const siguiente = (): string => String(runId + ++contador);

/**
 * RUC reales y validos. El alta comprueba el digito verificador, asi que aqui no
 * sirve inventar numeros.
 */
const RUC = ['20100070970', '20131312955', '20100047218', '20100128056'];

/**
 * Nombre distinto por corrida.
 *
 * El alta crea tenants PERMANENTES: no hay siembra que los borre, asi que dos
 * corridas seguidas contra la misma base chocaban por slug y la segunda recibia
 * «dojo-nuevo-lince-3». El identificador de corrida los separa.
 */
const NOMBRE = `Dojo Nuevo Lince ${runId}`;
const SLUG = `dojo-nuevo-lince-${runId}`;

const auth = (bearer: string) => ({ Authorization: `Bearer ${bearer}` });

/**
 * Los gimnasios que esta prueba crea, para borrarlos al terminar.
 *
 * Hace falta y no es cortesia: el alta crea tenants PERMANENTES —no hay siembra
 * que los recoja— y salen en `GET /gyms`, que es justo lo que otras suites
 * afirman. Sin esto, cada corrida deja gimnasios que rompen las pruebas del
 * directorio de al lado, y el fallo aparece lejos de su causa.
 */
const creados: string[] = [];
const codigos: string[] = [];

interface AltaInput {
  readonly uid: string;
  readonly gymName: string;
  readonly taxId: string;
  readonly saasTier?: string;
  readonly promoCode?: string;
}

const alta = async (input: AltaInput) => {
  const res = await http.post('/v1/gyms/signup').send({
    idToken: declareIdentity(input.uid),
    gymName: input.gymName,
    taxId: input.taxId,
    saasTier: input.saasTier ?? 'up_to_60',
    ownerName: `Dueño ${input.uid}`,
    documentId: siguiente(),
    phone: `+519${siguiente().slice(0, 8)}`,
    ...(input.promoCode === undefined ? {} : { promoCode: input.promoCode }),
  });
  if (typeof res.body?.tenantId === 'string') creados.push(res.body.tenantId as string);
  return res;
};

async function crearCodigo(
  code: string,
  freeMonths: number,
  maxRedemptions: number | null,
): Promise<void> {
  const { schema, withoutTenantIsolation } = await import('./db/client');
  const { DATABASE } = await import('./db/db.module');
  codigos.push(code);
  await withoutTenantIsolation(app.get(DATABASE), (tx) =>
    tx
      .insert(schema.saasPromoCodes)
      .values({ code, freeMonths, maxRedemptions })
      .onConflictDoNothing(),
  );
}

/** Vence la suscripcion de un gimnasio muy por detras de su gracia. */
async function vencer(tenantId: string): Promise<void> {
  const { schema, withoutTenantIsolation } = await import('./db/client');
  const { DATABASE } = await import('./db/db.module');
  await withoutTenantIsolation(app.get(DATABASE), (tx) =>
    tx
      .update(schema.saasSubscriptions)
      .set({
        freeUntil: sql.raw(`(current_date - 90 * interval '1 day')::date`),
        nextBillingDate: sql.raw(`(current_date - 90 * interval '1 day')::date`),
      })
      .where(eq(schema.saasSubscriptions.tenantId, tenantId)),
  );
}

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;

  process.env.DATABASE_URL = DATABASE_URL;
  process.env.JWT_SECRET ??= randomBytes(48).toString('base64url');
  process.env.ENCRYPTION_KEY ??= randomBytes(32).toString('base64');
  process.env.ALLOW_DEV_LOGIN = 'true';
  process.env.NODE_ENV = 'test';

  const { AppModule } = await import('./app.module');
  const { configureApp } = await import('./bootstrap');
  const { loadEnv } = await import('./config/env');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(FirebaseVerifier)
    .useValue(fakeVerifier)
    .compile();

  app = moduleRef.createNestApplication();
  configureApp(app, loadEnv());
  await app.init();
  http = request(app.getHttpServer());
}, 90_000);

afterAll(async () => {
  if (app !== undefined && creados.length > 0) {
    const { schema, withoutTenantIsolation } = await import('./db/client');
    const { DATABASE } = await import('./db/db.module');
    const db = app.get(DATABASE);
    // Las filas de `saas_subscriptions`, `staff` y `saas_redemptions` se van en
    // cascada con el tenant; los codigos hay que borrarlos aparte.
    await withoutTenantIsolation(db, async (tx) => {
      await tx.delete(schema.tenants).where(inArray(schema.tenants.id, creados));
      if (codigos.length > 0) {
        await tx.delete(schema.saasPromoCodes).where(inArray(schema.saasPromoCodes.code, codigos));
      }
    });
  }
  await app?.close();
});

suite('dar de alta un gimnasio desde la app', () => {
  it('crea el gimnasio, deja al dueño dentro y arranca su mes gratis', async () => {
    const { body, status } = await alta({
      uid: `dueno-${runId}-1`,
      gymName: NOMBRE,
      taxId: RUC[0]!,
    });

    expect(status).toBe(201);
    expect(body.slug).toBe(SLUG);
    // Sesión de dueño en el acto: quien acaba de crear su local no debería
    // tener que volver a autenticarse para verlo.
    expect(body.session.role).toBe('owner');
    expect(body.session.tenantId).toBe(body.tenantId);

    const suscripcion = await http
      .get('/v1/staff/subscription')
      .set(auth(body.session.accessToken))
      .expect(200);
    expect(suscripcion.body.state.status).toBe('trialing');
    expect(suscripcion.body.state.freeDaysLeft).toBeGreaterThanOrEqual(27);
  });

  it('sale en el directorio público en el acto', async () => {
    const { body } = await http.get('/v1/gyms').expect(200);
    expect(body.map((gym: { slug: string }) => gym.slug)).toContain(SLUG);
  });

  it('un RUC inventado no entra', async () => {
    // Once dígitos y prefijo válido, pero el verificador no cuadra: es el caso
    // que una comprobación de longitud deja pasar y ensucia la tabla para siempre.
    const { body, status } = await alta({
      uid: `dueno-${runId}-malo`,
      gymName: `Dojo Del RUC Falso ${runId}`,
      taxId: '20100070971',
    });

    expect(status).toBe(400);
    expect(body.message).toContain('RUC');
  });

  it('dos gimnasios con el mismo nombre no comparten dirección', async () => {
    const { body, status } = await alta({
      uid: `dueno-${runId}-2`,
      gymName: NOMBRE,
      taxId: RUC[1]!,
    });

    expect(status).toBe(201);
    expect(body.slug).toBe(`${SLUG}-2`);
  });

  it('una persona no puede llenar la red de gimnasios', async () => {
    // Multi-sede es el escalón de S/499 y una conversación, no un botón.
    const token = declareIdentity(`dueno-${runId}-1`);
    const { status } = await http.post('/v1/gyms/signup').send({
      idToken: token,
      gymName: `Su Segundo Local ${runId}`,
      taxId: RUC[2]!,
      saasTier: 'up_to_60',
      documentId: siguiente(),
      phone: `+519${siguiente().slice(0, 8)}`,
    });

    expect(status).toBe(409);
  });
});

suite('el plan gratis', () => {
  it('un gimnasio de hasta 10 alumnos no paga nada', async () => {
    const { body } = await alta({
      uid: `pequeno-${runId}`,
      gymName: `Dojo Pequeño ${runId}`,
      taxId: RUC[3]!,
      saasTier: 'free',
    });

    const { body: suscripcion } = await http
      .get('/v1/staff/subscription')
      .set(auth(body.session.accessToken))
      .expect(200);

    expect(suscripcion.state.status).toBe('free');
    expect(suscripcion.priceCents).toBe(0);
    expect(suscripcion.notice.title).toBe('Plan gratis');
  });

  /**
   * La regla que sostiene el escalón. Si esta prueba se rompe, un dojo de seis
   * alumnos amanece en solo lectura por una deuda de cero soles.
   */
  it('NO SE CORTA aunque su fecha esté vencida hace tres meses', async () => {
    const { body } = await alta({
      uid: `pequeno-vencido-${runId}`,
      gymName: `Dojo Pequeño Vencido ${runId}`,
      taxId: RUC[0]!,
      saasTier: 'free',
    }).then(async (res) => {
      await vencer(res.body.tenantId);
      return res;
    });

    const { body: suscripcion } = await http
      .get('/v1/staff/subscription')
      .set(auth(body.session.accessToken))
      .expect(200);

    expect(suscripcion.state.status).toBe('free');
    expect(suscripcion.state.canWrite).toBe(true);
  });
});

suite('códigos de promoción', () => {
  let tokenDueno = '';
  let tenantId = '';

  it('un código suma un mes al mes gratis', async () => {
    await crearCodigo(`LANZA${runId}`, 1, 2);

    const { body } = await alta({
      uid: `promo-${runId}`,
      gymName: `Dojo Con Código ${runId}`,
      taxId: RUC[1]!,
    });
    tokenDueno = body.session.accessToken;
    tenantId = body.tenantId;

    const antes = await http.get('/v1/staff/subscription').set(auth(tokenDueno)).expect(200);
    const canje = await http
      .post('/v1/staff/promo')
      .set(auth(tokenDueno))
      .send({ code: `lanza-${runId}` }) // escrito distinto a propósito
      .expect(201);

    expect(canje.body.redeemed).toBe(true);
    expect(canje.body.freeMonths).toBe(1);

    const despues = await http.get('/v1/staff/subscription').set(auth(tokenDueno)).expect(200);
    expect(despues.body.state.freeDaysLeft).toBeGreaterThan(antes.body.state.freeDaysLeft);
  });

  it('el mismo gimnasio no lo canjea dos veces', async () => {
    const { body } = await http
      .post('/v1/staff/promo')
      .set(auth(tokenDueno))
      .send({ code: `LANZA${runId}` })
      .expect(201);

    expect(body.redeemed).toBe(false);
    expect(body.reason).toBe('already_used');
  });

  it('un código que no existe se rechaza con motivo, no con error', async () => {
    // Escribirlo mal no es un fallo de la petición: es un resultado que la
    // persona necesita entender para saber si insistir sirve de algo.
    const { body } = await http
      .post('/v1/staff/promo')
      .set(auth(tokenDueno))
      .send({ code: 'NOEXISTE9999' })
      .expect(201);

    expect(body.redeemed).toBe(false);
    expect(body.reason).toBe('not_found');
  });

  it('el tope de usos se cumple', async () => {
    await crearCodigo(`UNICO${runId}`, 1, 1);

    const primero = await alta({
      uid: `promo-tope-a-${runId}`,
      gymName: `Dojo Tope Uno ${runId}`,
      taxId: RUC[2]!,
      promoCode: `UNICO${runId}`,
    });
    expect(primero.body.promo).toEqual({ applied: true, freeMonths: 1 });

    const segundo = await alta({
      uid: `promo-tope-b-${runId}`,
      gymName: `Dojo Tope Dos ${runId}`,
      taxId: RUC[3]!,
      promoCode: `UNICO${runId}`,
    });

    // El segundo gimnasio SE CREA igual: perder un alta por un código agotado
    // sería cambiar un cliente por una promoción.
    expect(segundo.status).toBe(201);
    expect(segundo.body.promo).toEqual({ applied: false, reason: 'exhausted' });
  });

  it('canjear levanta el corte de un gimnasio ya cortado', async () => {
    // Es el caso que justifica que la ruta siga abierta en solo lectura: si el
    // corte bloqueara la forma de levantarlo, sería una trampa.
    await vencer(tenantId);
    const cortado = await http.get('/v1/staff/subscription').set(auth(tokenDueno)).expect(200);
    expect(cortado.body.state.canWrite).toBe(false);

    await crearCodigo(`RESCATE${runId}`, 1, 5);
    const canje = await http
      .post('/v1/staff/promo')
      .set(auth(tokenDueno))
      .send({ code: `RESCATE${runId}` })
      .expect(201);

    expect(canje.body.redeemed).toBe(true);
    const vivo = await http.get('/v1/staff/subscription').set(auth(tokenDueno)).expect(200);
    expect(vivo.body.state.canWrite).toBe(true);
    // Y el mes cuenta desde HOY, no desde la fecha que ya pasó.
    expect(vivo.body.state.freeDaysLeft).toBeGreaterThanOrEqual(27);
  });
});
