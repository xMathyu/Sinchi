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
const nextValue = (): string => String(runId + ++contador);

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
const NAME = `Dojo Nuevo Lince ${runId}`;
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
const created: string[] = [];
const codes: string[] = [];

interface SignUpInput {
  readonly uid: string;
  readonly gymName: string;
  readonly taxId: string;
  readonly saasTier?: string;
  readonly promoCode?: string;
  /** Lo que el dueño escribe como mensualidad. `null` lo omite del cuerpo. */
  readonly monthlyPriceCents?: number | null;
  /** Dónde queda. `null` lo omite del cuerpo. */
  readonly address?: string | null;
  /** El pin del mapa del alta, si se marca. */
  readonly latitude?: number;
  readonly longitude?: number;
}

const signUp = async (input: SignUpInput) => {
  const res = await http.post('/v1/gyms/signup').send({
    idToken: declareIdentity(input.uid),
    gymName: input.gymName,
    taxId: input.taxId,
    saasTier: input.saasTier ?? 'up_to_60',
    ...(input.monthlyPriceCents === null
      ? {}
      : { monthlyPriceCents: input.monthlyPriceCents ?? 12_000 }),
    ...(input.address === null
      ? {}
      : { address: input.address ?? 'Av. Primavera 120, Surco' }),
    ...(input.latitude === undefined ? {} : { latitude: input.latitude }),
    ...(input.longitude === undefined ? {} : { longitude: input.longitude }),
    ownerName: `Dueño ${input.uid}`,
    documentId: nextValue(),
    phone: `+519${nextValue().slice(0, 8)}`,
    ...(input.promoCode === undefined ? {} : { promoCode: input.promoCode }),
  });
  if (typeof res.body?.tenantId === 'string') created.push(res.body.tenantId as string);
  return res;
};

async function createCode(
  code: string,
  freeMonths: number,
  maxRedemptions: number | null,
): Promise<void> {
  const { schema, withoutTenantIsolation } = await import('./db/client');
  const { DATABASE } = await import('./db/db.module');
  codes.push(code);
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
  if (app !== undefined && created.length > 0) {
    const { schema, withoutTenantIsolation } = await import('./db/client');
    const { DATABASE } = await import('./db/db.module');
    const db = app.get(DATABASE);
    // Las filas de `saas_subscriptions`, `staff` y `saas_redemptions` se van en
    // cascada con el tenant; los codigos hay que borrarlos aparte.
    await withoutTenantIsolation(db, async (tx) => {
      await tx.delete(schema.tenants).where(inArray(schema.tenants.id, created));
      if (codes.length > 0) {
        await tx.delete(schema.saasPromoCodes).where(inArray(schema.saasPromoCodes.code, codes));
      }
    });
  }
  await app?.close();
});

suite('dar de alta un gimnasio desde la app', () => {
  it('crea el gimnasio, deja al dueño dentro y arranca su mes gratis', async () => {
    const { body, status } = await signUp({
      uid: `dueno-${runId}-1`,
      gymName: NAME,
      taxId: RUC[0]!,
    });

    expect(status).toBe(201);
    expect(body.slug).toBe(SLUG);
    // Sesión de dueño en el acto: quien acaba de crear su local no debería
    // tener que volver a autenticarse para verlo.
    expect(body.session.role).toBe('owner');
    expect(body.session.tenantId).toBe(body.tenantId);

    const subscription = await http
      .get('/v1/staff/subscription')
      .set(auth(body.session.accessToken))
      .expect(200);
    expect(subscription.body.state.status).toBe('trialing');
    expect(subscription.body.state.freeDaysLeft).toBeGreaterThanOrEqual(27);
  });

  it('sale en el directorio público en el acto', async () => {
    const { body } = await http.get('/v1/gyms').expect(200);
    expect(body.map((gym: { slug: string }) => gym.slug)).toContain(SLUG);
  });

  it('un RUC inventado no entra', async () => {
    // Once dígitos y prefijo válido, pero el verificador no cuadra: es el caso
    // que una comprobación de longitud deja pasar y ensucia la tabla para siempre.
    const { body, status } = await signUp({
      uid: `dueno-${runId}-malo`,
      gymName: `Dojo Del RUC Falso ${runId}`,
      taxId: '20100070971',
    });

    expect(status).toBe(400);
    expect(body.message).toContain('RUC');
  });

  it('dos gimnasios con el mismo nombre no comparten dirección', async () => {
    const { body, status } = await signUp({
      uid: `dueno-${runId}-2`,
      gymName: NAME,
      taxId: RUC[1]!,
    });

    expect(status).toBe(201);
    expect(body.slug).toBe(`${SLUG}-2`);
  });

  /**
   * El segundo local SÍ entra, y el sexto no.
   *
   * Antes el segundo daba 409: «para abrir un segundo local, escríbenos». Se
   * abrió porque el caso que bloqueaba es corriente —el profesor con la escuela
   * de una universidad y sus clases aparte— y porque no se pierde plata: el
   * escalón lo calcula `tierFor` por local contra su padrón real. Lo único que
   * cada local nuevo regala es su mes gratis, y para eso está el tope.
   *
   * Van por `signUp` y no por `http.post` a pelo para que el `afterAll` los
   * borre: un tenant de prueba que sobrevive deja una fila de `staff` que la
   * semilla de la siguiente corrida no sabe quitar.
   */
  it('la misma persona abre su segundo local', async () => {
    const { status, body } = await signUp({
      uid: `dueno-${runId}-1`,
      gymName: `Su Segundo Local ${runId}`,
      taxId: RUC[2]!,
    });

    expect(status).toBe(201);

    // Local NUEVO, no el de antes con otro nombre: cada uno lleva su padrón.
    const { body: modes } = await http
      .get('/v1/auth/modes')
      .set(auth(body.session.accessToken))
      .expect(200);
    expect(modes.staff).toHaveLength(2);
    expect(new Set((modes.staff as { tenantId: string }[]).map((p) => p.tenantId)).size).toBe(2);
  });

  it('pero no puede llenar la red de gimnasios', async () => {
    // Cinco es el tope. Ya lleva dos, así que los tres siguientes entran y el
    // sexto choca — que es lo que cierra la puerta a granjear meses gratis.
    for (const n of [3, 4, 5]) {
      const { status } = await signUp({
        uid: `dueno-${runId}-1`,
        gymName: `Local ${n} de ${runId}`,
        taxId: RUC[0]!,
      });
      expect(status, `el local ${n} debería entrar`).toBe(201);
    }

    const { status, body } = await signUp({
      uid: `dueno-${runId}-1`,
      gymName: `Local 6 de ${runId}`,
      taxId: RUC[0]!,
    });
    expect(status).toBe(409);
    expect(JSON.stringify(body)).toMatch(/máximo por cuenta/i);
  });
});

/**
 * Lo que el directorio dice que cuesta un local es lo que su dueño escribió.
 *
 * Antes el alta sembraba cuatro tarifas de ejemplo —S/ 120, 150, 180 y una
 * clase suelta de 25— para que el local pudiera inscribir desde el primer día.
 * El efecto fue peor que el problema: un gimnasio que se registraba SIN tocar
 * un precio aparecía en el directorio como «desde S/ 120 al mes», y esa cifra
 * no la había decidido nadie de ese gimnasio. Lo reportó el primer dueño real
 * que lo vio en la lista.
 */
suite('el precio del directorio es el que escribió el dueño', () => {
  it('la tarjeta dice exactamente la mensualidad del alta, y es la única tarifa', async () => {
    const { body, status } = await signUp({
      uid: `dueno-${runId}-precio`,
      gymName: `Dojo Del Precio Suyo ${runId}`,
      taxId: RUC[2]!,
      monthlyPriceCents: 8_000,
    });
    expect(status).toBe(201);

    const { body: plans } = await http
      .get('/v1/staff/plans')
      .set(auth(body.session.accessToken))
      .expect(200);
    expect(plans).toHaveLength(1);
    expect(plans[0].priceCents).toBe(8_000);
    expect(plans[0].type).toBe('unlimited');

    const { body: directorio } = await http.get('/v1/gyms').expect(200);
    const card = directorio.find((gym: { slug: string }) => gym.slug === body.slug);
    expect(card.fromPriceCents).toBe(8_000);
  });

  it('sin mensualidad no hay alta', async () => {
    // Que no se pueda omitir es el punto: `plans` vacía deja el local sin poder
    // inscribir a nadie, y rellenarla por él es lo que causó el fallo.
    const { status } = await signUp({
      uid: `dueno-${runId}-sin-precio`,
      gymName: `Dojo Sin Precio ${runId}`,
      taxId: RUC[3]!,
      monthlyPriceCents: null,
    });

    expect(status).toBe(400);
  });
});

/**
 * El directorio decia el precio, el horario y las disciplinas de cada dojo y
 * callaba donde queda. Es la primera pregunta de quien busca donde entrenar:
 * nadie cruza Lima para una clase de prueba.
 */
suite('el gimnasio dice dónde queda', () => {
  it('la dirección sale en el directorio y en la ficha', async () => {
    const streetAddress = 'Jr. Los Cedros 455, Lince';
    const { body, status } = await signUp({
      uid: `dueno-${runId}-direccion`,
      gymName: `Dojo Con Dirección ${runId}`,
      taxId: RUC[0]!,
      address: streetAddress,
    });
    expect(status).toBe(201);

    const { body: directorio } = await http.get('/v1/gyms').expect(200);
    const card = directorio.find((gym: { slug: string }) => gym.slug === body.slug);
    expect(card.address).toBe(streetAddress);

    const { body: record } = await http.get(`/v1/gyms/${body.slug}`).expect(200);
    expect(record.address).toBe(streetAddress);
    // El pin es aparte y opcional: el alta no lo pide, lo pone el dueño después.
    expect(record.latitude).toBeNull();
    expect(record.longitude).toBeNull();
  });

  it('sin dirección no hay alta', async () => {
    const { status } = await signUp({
      uid: `dueno-${runId}-sin-direccion`,
      gymName: `Dojo Sin Dirección ${runId}`,
      taxId: RUC[1]!,
      address: null,
    });
    expect(status).toBe(400);
  });

  it('«Lima» a secas no es una dirección', async () => {
    // No se comprueba que exista —eso no se puede saber desde aquí— sino que
    // alguien escribió algo que lleva a una puerta.
    const { body, status } = await signUp({
      uid: `dueno-${runId}-direccion-corta`,
      gymName: `Dojo Vago ${runId}`,
      taxId: RUC[2]!,
      address: 'Lima',
    });
    expect(status).toBe(400);
    expect(body.message).toContain('dónde queda');
  });

  /**
   * El alta ya trae el mapa, así que el pin puede llegar desde el registro y no
   * solo después desde Padrón.
   *
   * Esta prueba existe por un fallo concreto: la app mandaba `latitude` y
   * `longitude` con un spread condicional, y un spread NO comprueba las claves
   * contra el tipo. Compilaba, viajaba, y la api las descartaba en silencio — el
   * dueño marcaba su puerta en el mapa y el pin no llegaba a ninguna parte. Sin
   * una prueba que lo fije, vuelve a pasar en el siguiente campo que se añada.
   */
  it('el pin marcado en el alta se guarda y sale en la ficha', async () => {
    const { body, status } = await signUp({
      uid: `dueno-${runId}-pin-en-el-alta`,
      gymName: `Dojo Con Pin ${runId}`,
      taxId: RUC[2]!,
      address: 'Av. Arequipa 3150, Lince',
      latitude: -12.0889,
      longitude: -77.0356,
    });
    expect(status).toBe(201);

    const { body: ficha } = await http.get(`/v1/gyms/${body.slug}`).expect(200);
    expect(ficha.latitude).toBeCloseTo(-12.0889, 4);
    expect(ficha.longitude).toBeCloseTo(-77.0356, 4);
  });

  it('media coordenada en el alta no entra', async () => {
    // Un punto en el ecuador no es medio dato: es un pin equivocado, y el mapa
    // lo dibujaría sin dudar.
    const { status } = await signUp({
      uid: `dueno-${runId}-pin-a-medias`,
      gymName: `Dojo Pin A Medias ${runId}`,
      taxId: RUC[3]!,
      address: 'Av. Arequipa 3150, Lince',
      latitude: -12.0889,
    });
    expect(status).toBe(400);
  });

  it('el dueño la corrige, y puede poner su punto en el mapa', async () => {
    const { body: local } = await signUp({
      uid: `dueno-${runId}-mapa`,
      gymName: `Dojo Del Mapa ${runId}`,
      taxId: RUC[3]!,
    });
    const owner = { Authorization: `Bearer ${local.session.accessToken}` };

    const { body: saved } = await http
      .post('/v1/staff/location')
      .set(owner)
      .send({
        address: 'Av. Arequipa 3000, San Isidro',
        latitude: -12.0931,
        longitude: -77.0349,
      })
      .expect(201);

    expect(saved.address).toBe('Av. Arequipa 3000, San Isidro');
    expect(saved.latitude).toBeCloseTo(-12.0931, 4);

    const { body: record } = await http.get(`/v1/gyms/${local.slug}`).expect(200);
    expect(record.latitude).toBeCloseTo(-12.0931, 4);
    expect(record.longitude).toBeCloseTo(-77.0349, 4);
  });

  it('media coordenada no se guarda: es un punto en el ecuador', async () => {
    const { body: local } = await signUp({
      uid: `dueno-${runId}-media-coordenada`,
      gymName: `Dojo Media Coordenada ${runId}`,
      taxId: RUC[0]!,
    });

    const { status } = await http
      .post('/v1/staff/location')
      .set({ Authorization: `Bearer ${local.session.accessToken}` })
      .send({ address: 'Av. Arequipa 3000, San Isidro', latitude: -12.0931, longitude: null });

    expect(status).toBe(400);
  });

  it('un punto que no está en el mapa tampoco', async () => {
    // Teclear «-77.0» sin el punto da 770, y el mapa lo dibujaría sin dudar.
    const { body: local } = await signUp({
      uid: `dueno-${runId}-punto-imposible`,
      gymName: `Dojo Imposible ${runId}`,
      taxId: RUC[1]!,
    });

    const { status } = await http
      .post('/v1/staff/location')
      .set({ Authorization: `Bearer ${local.session.accessToken}` })
      .send({ address: 'Av. Arequipa 3000, San Isidro', latitude: -12.0931, longitude: 770 });

    expect(status).toBe(400);
  });
});

suite('el plan gratis', () => {
  it('un gimnasio de hasta 10 alumnos no paga nada', async () => {
    const { body } = await signUp({
      uid: `pequeno-${runId}`,
      gymName: `Dojo Pequeño ${runId}`,
      taxId: RUC[3]!,
      saasTier: 'free',
    });

    const { body: subscription } = await http
      .get('/v1/staff/subscription')
      .set(auth(body.session.accessToken))
      .expect(200);

    expect(subscription.state.status).toBe('free');
    expect(subscription.priceCents).toBe(0);
    expect(subscription.notice.title).toBe('Plan gratis');
  });

  /**
   * La regla que sostiene el escalón. Si esta prueba se rompe, un dojo de seis
   * alumnos amanece en solo lectura por una deuda de cero soles.
   */
  it('NO SE CORTA aunque su fecha esté vencida hace tres meses', async () => {
    const { body } = await signUp({
      uid: `pequeno-vencido-${runId}`,
      gymName: `Dojo Pequeño Vencido ${runId}`,
      taxId: RUC[0]!,
      saasTier: 'free',
    }).then(async (res) => {
      await vencer(res.body.tenantId);
      return res;
    });

    const { body: subscription } = await http
      .get('/v1/staff/subscription')
      .set(auth(body.session.accessToken))
      .expect(200);

    expect(subscription.state.status).toBe('free');
    expect(subscription.state.canWrite).toBe(true);
  });
});

suite('códigos de promoción', () => {
  let ownerToken = '';
  let tenantId = '';

  it('un código suma un mes al mes gratis', async () => {
    await createCode(`LANZA${runId}`, 1, 2);

    const { body } = await signUp({
      uid: `promo-${runId}`,
      gymName: `Dojo Con Código ${runId}`,
      taxId: RUC[1]!,
    });
    ownerToken = body.session.accessToken;
    tenantId = body.tenantId;

    const before = await http.get('/v1/staff/subscription').set(auth(ownerToken)).expect(200);
    const redemption = await http
      .post('/v1/staff/promo')
      .set(auth(ownerToken))
      .send({ code: `lanza-${runId}` }) // escrito distinto a propósito
      .expect(201);

    expect(redemption.body.redeemed).toBe(true);
    expect(redemption.body.freeMonths).toBe(1);

    const after = await http.get('/v1/staff/subscription').set(auth(ownerToken)).expect(200);
    expect(after.body.state.freeDaysLeft).toBeGreaterThan(before.body.state.freeDaysLeft);
  });

  it('el mismo gimnasio no lo canjea dos veces', async () => {
    const { body } = await http
      .post('/v1/staff/promo')
      .set(auth(ownerToken))
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
      .set(auth(ownerToken))
      .send({ code: 'NOEXISTE9999' })
      .expect(201);

    expect(body.redeemed).toBe(false);
    expect(body.reason).toBe('not_found');
  });

  it('el tope de usos se cumple', async () => {
    await createCode(`UNICO${runId}`, 1, 1);

    const first = await signUp({
      uid: `promo-tope-a-${runId}`,
      gymName: `Dojo Tope Uno ${runId}`,
      taxId: RUC[2]!,
      promoCode: `UNICO${runId}`,
    });
    expect(first.body.promo).toEqual({ applied: true, freeMonths: 1 });

    const second = await signUp({
      uid: `promo-tope-b-${runId}`,
      gymName: `Dojo Tope Dos ${runId}`,
      taxId: RUC[3]!,
      promoCode: `UNICO${runId}`,
    });

    // El segundo gimnasio SE CREA igual: perder un alta por un código agotado
    // sería cambiar un cliente por una promoción.
    expect(second.status).toBe(201);
    expect(second.body.promo).toEqual({ applied: false, reason: 'exhausted' });
  });

  it('canjear levanta el corte de un gimnasio ya cortado', async () => {
    // Es el caso que justifica que la ruta siga abierta en solo lectura: si el
    // corte bloqueara la forma de levantarlo, sería una trampa.
    await vencer(tenantId);
    const cortado = await http.get('/v1/staff/subscription').set(auth(ownerToken)).expect(200);
    expect(cortado.body.state.canWrite).toBe(false);

    await createCode(`RESCATE${runId}`, 1, 5);
    const redemption = await http
      .post('/v1/staff/promo')
      .set(auth(ownerToken))
      .send({ code: `RESCATE${runId}` })
      .expect(201);

    expect(redemption.body.redeemed).toBe(true);
    const vivo = await http.get('/v1/staff/subscription').set(auth(ownerToken)).expect(200);
    expect(vivo.body.state.canWrite).toBe(true);
    // Y el mes cuenta desde HOY, no desde la fecha que ya pasó.
    expect(vivo.body.state.freeDaysLeft).toBeGreaterThanOrEqual(27);
  });
});
