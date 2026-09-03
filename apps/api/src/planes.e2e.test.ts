/**
 * Los planes del dueno, de punta a punta.
 *
 * Dos cosas que solo se comprueban aqui y no en los tests del dominio:
 *
 *  1. **que un gimnasio nuevo nazca usable.** Es el hueco que abrio el alta
 *     desde la app: `plans` quedaba vacia, el alta de un alumno exige `plan_id`,
 *     y el local que se registraba un martes no podia inscribir a nadie;
 *
 *  2. **que la clase suelta se cobre y abra la puerta.** El plan `drop_in` no
 *     debe nada nunca, asi que el unico freno que tiene es el cargo del dia. Si
 *     eso se rompe, la puerta se abre gratis y nada falla.
 *
 * Necesita `TEST_DATABASE_URL`, igual que los demas e2e.
 */
import { randomBytes, randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UnauthorizedException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { inArray } from 'drizzle-orm';
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
const celular = (): string => `+519${siguiente().slice(0, 8)}`;

/** RUC reales: el alta comprueba el digito verificador. */
const RUC = ['20100070970', '20131312955', '20100047218'];

const auth = (bearer: string) => ({ Authorization: `Bearer ${bearer}` });

/** Los gimnasios que esta prueba crea son PERMANENTES: se borran al terminar. */
const creados: string[] = [];

interface Local {
  readonly tenantId: string;
  readonly dueno: string;
}

let indiceRuc = 0;

async function nuevoGimnasio(): Promise<Local> {
  const uid = `dueno-planes-${runId}-${++contador}`;
  const { body, status } = await http.post('/v1/gyms/signup').send({
    idToken: declareIdentity(uid),
    gymName: `Dojo Planes ${runId} ${contador}`,
    taxId: RUC[indiceRuc++ % RUC.length]!,
    saasTier: 'up_to_60',
    ownerName: `Dueño ${uid}`,
    documentId: siguiente(),
    phone: celular(),
  });
  if (status !== 201) throw new Error(`No se pudo crear el gimnasio: ${JSON.stringify(body)}`);
  creados.push(body.tenantId as string);
  return { tenantId: body.tenantId as string, dueno: body.session.accessToken as string };
}

/**
 * Una recepcionista de verdad en ese local.
 *
 * Se inserta a mano porque el alta solo crea al dueno, y sin ella no hay forma
 * de comprobar lo que mas importa de estas rutas: que recepcion LEA los planes y
 * no pueda tocar los precios.
 */
async function recepcion(tenantId: string): Promise<string> {
  const { schema, withTenant, withoutTenantIsolation } = await import('./db/client');
  const { DATABASE } = await import('./db/db.module');
  const db = app.get(DATABASE);
  const phone = celular();

  // `users` vive FUERA del tenant y `staff` dentro, asi que son dos contextos
  // distintos: insertar la fila de staff sin adoptar el gimnasio la rechaza el
  // WITH CHECK de su politica RLS, que es exactamente lo que tiene que pasar.
  const userId = await withoutTenantIsolation(db, async (tx) => {
    const [user] = await tx
      .insert(schema.users)
      .values({ name: `Recepción ${runId}`, documentId: siguiente(), phone })
      .returning({ id: schema.users.id });
    return user!.id;
  });

  await withTenant(db, tenantId, (tx) =>
    tx.insert(schema.staff).values({
      tenantId,
      userId,
      role: 'front_desk',
      displayName: 'Recepción',
    }),
  );

  const { body } = await http.post('/v1/auth/dev-login').send({ phone }).expect(201);
  return body.accessToken as string;
}

const planBase = {
  name: 'Mañanas',
  type: 'sessions_per_week' as const,
  sessionsPerWeek: 2,
  allowedDays: null,
  priceCents: 13_000,
  active: true,
};

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
    await withoutTenantIsolation(app.get(DATABASE), (tx) =>
      tx.delete(schema.tenants).where(inArray(schema.tenants.id, creados)),
    );
  }
  await app?.close();
});

suite('un gimnasio nuevo nace con tarifas', () => {
  it('trae planes de arranque, uno de ellos de clase suelta', async () => {
    const local = await nuevoGimnasio();
    const { body } = await http.get('/v1/staff/plans').set(auth(local.dueno)).expect(200);

    // Sin esto el alta dejaba el local inutilizable: inscribir exige `planId`.
    expect(body.length).toBeGreaterThan(0);
    expect(body.some((p: { type: string }) => p.type === 'drop_in')).toBe(true);
    expect(body.every((p: { active: boolean }) => p.active)).toBe(true);
  });

  it('y se puede inscribir a alguien el mismo dia, sin que nadie siembre nada', async () => {
    const local = await nuevoGimnasio();
    const { body: planes } = await http.get('/v1/staff/plans').set(auth(local.dueno));

    const { status } = await http
      .post('/v1/staff/members')
      .set(auth(local.dueno))
      .send({
        name: 'Alumna del primer día',
        documentId: siguiente(),
        phone: celular(),
        planId: planes[0].id,
      });

    expect(status).toBe(201);
  });
});

suite('el dueño escribe sus planes', () => {
  it('crea uno y aparece en la lista del mostrador', async () => {
    const local = await nuevoGimnasio();
    const { body: creado, status } = await http
      .post('/v1/staff/plans')
      .set(auth(local.dueno))
      .send(planBase);

    expect(status).toBe(201);
    expect(creado.priceCents).toBe(13_000);

    const { body: lista } = await http.get('/v1/staff/plans').set(auth(local.dueno));
    expect(lista.some((p: { id: string }) => p.id === creado.id)).toBe(true);
  });

  it('rechaza el plan por sesiones sin sesiones, con el motivo del dominio', async () => {
    const local = await nuevoGimnasio();
    const { body, status } = await http
      .post('/v1/staff/plans')
      .set(auth(local.dueno))
      .send({ ...planBase, sessionsPerWeek: null });

    expect(status).toBe(400);
    expect(String(body.message)).toContain('cuántas veces por semana');
  });

  it('no deja dos planes activos con el mismo nombre', async () => {
    const local = await nuevoGimnasio();
    await http.post('/v1/staff/plans').set(auth(local.dueno)).send(planBase).expect(201);

    const { status, body } = await http
      .post('/v1/staff/plans')
      .set(auth(local.dueno))
      // Distinto precio, mismo nombre en otra caja: sigue siendo la misma tarifa
      // leida dos veces, y el mostrador elegiria una al azar en el alta.
      .send({ ...planBase, name: '  mañanas  ', priceCents: 20_000 });

    expect(status).toBe(409);
    expect(String(body.message)).toContain('Mañanas');
  });

  it('cambiar el precio no toca lo ya cobrado, solo lo de adelante', async () => {
    const local = await nuevoGimnasio();
    const { body: plan } = await http
      .post('/v1/staff/plans')
      .set(auth(local.dueno))
      .send(planBase);

    const { body: alumno } = await http
      .post('/v1/staff/members')
      .set(auth(local.dueno))
      .send({
        name: 'Alumno con plan',
        documentId: siguiente(),
        phone: celular(),
        planId: plan.id,
      })
      .expect(201);

    const membershipId = alumno.view.membership.id as string;
    await http
      .post('/v1/staff/payments')
      .set(auth(local.dueno))
      .send({ membershipId, type: 'renewal', rail: 'cash' })
      .expect(201);

    await http
      .post(`/v1/staff/plans/${plan.id}`)
      .set(auth(local.dueno))
      .send({ ...planBase, priceCents: 20_000 })
      .expect(201);

    const { body: ficha } = await http
      .get(`/v1/staff/members/${membershipId}`)
      .set(auth(local.dueno))
      .expect(200);

    // El cargo del ledger conserva lo que se cobró; el plan ya vale otra cosa.
    const cobrado = ficha.charges.find((c: { type: string }) => c.type === 'renewal');
    expect(cobrado.amountCents).toBe(13_000);
    expect(ficha.plan.priceCents).toBe(20_000);
  });
});

suite('archivar y borrar', () => {
  it('archivar lo saca del mostrador pero no de la lista del dueño', async () => {
    const local = await nuevoGimnasio();
    const { body: plan } = await http
      .post('/v1/staff/plans')
      .set(auth(local.dueno))
      .send(planBase);

    await http
      .post(`/v1/staff/plans/${plan.id}/active`)
      .set(auth(local.dueno))
      .send({ active: false })
      .expect(201);

    const { body: mostrador } = await http.get('/v1/staff/plans').set(auth(local.dueno));
    expect(mostrador.some((p: { id: string }) => p.id === plan.id)).toBe(false);

    const { body: todos } = await http.get('/v1/staff/plans/all').set(auth(local.dueno));
    const archivado = todos.find((row: { plan: { id: string } }) => row.plan.id === plan.id);
    expect(archivado.plan.active).toBe(false);
  });

  it('archivar deja libre el nombre para el plan que lo reemplaza', async () => {
    const local = await nuevoGimnasio();
    const { body: viejo } = await http
      .post('/v1/staff/plans')
      .set(auth(local.dueno))
      .send(planBase);

    await http
      .post(`/v1/staff/plans/${viejo.id}/active`)
      .set(auth(local.dueno))
      .send({ active: false })
      .expect(201);

    // Subir precios es exactamente esto: archivar el viejo y escribir el nuevo.
    await http
      .post('/v1/staff/plans')
      .set(auth(local.dueno))
      .send({ ...planBase, priceCents: 16_000 })
      .expect(201);
  });

  it('borra el plan que nadie usa: el tipeo de hace dos minutos', async () => {
    const local = await nuevoGimnasio();
    const { body: plan } = await http
      .post('/v1/staff/plans')
      .set(auth(local.dueno))
      .send({ ...planBase, name: 'Mañnas' });

    await http.delete(`/v1/staff/plans/${plan.id}`).set(auth(local.dueno)).expect(200);

    const { body: todos } = await http.get('/v1/staff/plans/all').set(auth(local.dueno));
    expect(todos.some((row: { plan: { id: string } }) => row.plan.id === plan.id)).toBe(false);
  });

  it('no borra el plan que alguien paga, y dice que lo archive', async () => {
    const local = await nuevoGimnasio();
    const { body: plan } = await http
      .post('/v1/staff/plans')
      .set(auth(local.dueno))
      .send(planBase);

    await http
      .post('/v1/staff/members')
      .set(auth(local.dueno))
      .send({
        name: 'Alumna fiel',
        documentId: siguiente(),
        phone: celular(),
        planId: plan.id,
      })
      .expect(201);

    const { status, body } = await http.delete(`/v1/staff/plans/${plan.id}`).set(auth(local.dueno));
    expect(status).toBe(409);
    expect(String(body.message)).toContain('Archívalo');

    // La salida que sí existe.
    await http
      .post(`/v1/staff/plans/${plan.id}/active`)
      .set(auth(local.dueno))
      .send({ active: false })
      .expect(201);
  });

  it('la lista del dueño dice cuánta gente tiene cada plan', async () => {
    const local = await nuevoGimnasio();
    const { body: plan } = await http
      .post('/v1/staff/plans')
      .set(auth(local.dueno))
      .send(planBase);

    await http
      .post('/v1/staff/members')
      .set(auth(local.dueno))
      .send({ name: 'Uno', documentId: siguiente(), phone: celular(), planId: plan.id })
      .expect(201);

    const { body: todos } = await http.get('/v1/staff/plans/all').set(auth(local.dueno));
    const fila = todos.find((row: { plan: { id: string } }) => row.plan.id === plan.id);
    expect(fila.activeMembers).toBe(1);
    expect(fila.deletable).toBe(false);
  });
});

suite('quién puede tocar los precios', () => {
  it('recepción lee los planes pero no los escribe', async () => {
    const local = await nuevoGimnasio();
    const mostrador = await recepcion(local.tenantId);

    await http.get('/v1/staff/plans').set(auth(mostrador)).expect(200);
    await http.post('/v1/staff/plans').set(auth(mostrador)).send(planBase).expect(403);
    await http.get('/v1/staff/plans/all').set(auth(mostrador)).expect(403);
  });

  it('recepción lee lo que cobra el local, porque es quien lo cobra', async () => {
    const local = await nuevoGimnasio();
    const mostrador = await recepcion(local.tenantId);

    const { body } = await http.get('/v1/staff/pricing').set(auth(mostrador)).expect(200);
    expect(body).toHaveProperty('enrollmentFeeCents');

    await http.post('/v1/staff/pricing').set(auth(mostrador)).send(body).expect(403);
  });
});

suite('lo que el local cobra aparte', () => {
  it('el dueño lo cambia y se lee de vuelta', async () => {
    const local = await nuevoGimnasio();
    const pricing = {
      enrollmentFeeCents: 5_000,
      dropInPriceCents: 3_000,
      quotaOverflowPolicy: 'offer_drop_in',
      trialClassEnabled: true,
      trialClassPriceCents: 0,
    };

    await http.post('/v1/staff/pricing').set(auth(local.dueno)).send(pricing).expect(201);

    const { body } = await http.get('/v1/staff/pricing').set(auth(local.dueno)).expect(200);
    expect(body).toMatchObject(pricing);
  });

  it('no deja ofrecer clase suelta sin precio: el mostrador tendría que inventarlo', async () => {
    const local = await nuevoGimnasio();
    const { status, body } = await http
      .post('/v1/staff/pricing')
      .set(auth(local.dueno))
      .send({
        enrollmentFeeCents: 0,
        dropInPriceCents: null,
        quotaOverflowPolicy: 'offer_drop_in',
        trialClassEnabled: true,
        trialClassPriceCents: 0,
      });

    expect(status).toBe(400);
    expect(String(body.message)).toContain('ponle precio');
  });

  it('caza el precio escrito en céntimos por error', async () => {
    const local = await nuevoGimnasio();
    const { status } = await http
      .post('/v1/staff/pricing')
      .set(auth(local.dueno))
      .send({
        enrollmentFeeCents: 99_999_999,
        dropInPriceCents: null,
        quotaOverflowPolicy: 'block',
        trialClassEnabled: true,
        trialClassPriceCents: 0,
      });

    expect(status).toBe(400);
  });
});

suite('la clase suelta en la puerta', () => {
  /** Inscribe a alguien en el plan de clase suelta que trae el gimnasio nuevo. */
  async function alumnoDeClaseSuelta(local: Local) {
    const { body: planes } = await http.get('/v1/staff/plans').set(auth(local.dueno));
    const plan = planes.find((p: { type: string }) => p.type === 'drop_in');

    const { body } = await http
      .post('/v1/staff/members')
      .set(auth(local.dueno))
      .send({
        name: 'Visita del sábado',
        documentId: siguiente(),
        phone: celular(),
        planId: plan.id,
      })
      .expect(201);

    return { membershipId: body.view.membership.id as string, plan };
  }

  it('no debe nada aunque no haya pagado: no es un moroso', async () => {
    const local = await nuevoGimnasio();
    const { membershipId } = await alumnoDeClaseSuelta(local);

    const { body } = await http
      .get(`/v1/staff/members/${membershipId}`)
      .set(auth(local.dueno))
      .expect(200);

    expect(body.receivable.amountCents).toBe(0);
    expect(body.subscription.status).toBe('active');
  });

  it('la puerta lo para hasta que pague la clase de hoy', async () => {
    const local = await nuevoGimnasio();
    const { membershipId, plan } = await alumnoDeClaseSuelta(local);

    const { body } = await http
      .post('/v1/staff/checkin/manual')
      .set(auth(local.dueno))
      .send({ membershipId })
      .expect(201);

    expect(body.registered).toBe(false);
    expect(body.result.reason.code).toBe('drop_in_unpaid');
    // `alert`, no `blocked`: le falta pagar lo de hoy, no debe una mensualidad.
    expect(body.result.level).toBe('alert');
    expect(body.result.reason.priceCents).toBe(plan.priceCents);
  });

  it('pagada la clase, entra — y se le cobra el precio de SU plan', async () => {
    const local = await nuevoGimnasio();
    const { membershipId, plan } = await alumnoDeClaseSuelta(local);

    // El precio de clase suelta DEL LOCAL es otro y no debe ganarle al del plan:
    // es el que paga el alumno con mensualidad que agota su cupo.
    await http
      .post('/v1/staff/pricing')
      .set(auth(local.dueno))
      .send({
        enrollmentFeeCents: 0,
        dropInPriceCents: 9_900,
        quotaOverflowPolicy: 'offer_drop_in',
        trialClassEnabled: true,
        trialClassPriceCents: 0,
      })
      .expect(201);

    const { body: cobro } = await http
      .post('/v1/staff/payments')
      .set(auth(local.dueno))
      .send({ membershipId, type: 'drop_in', rail: 'cash' })
      .expect(201);

    expect(cobro.charge.amountCents).toBe(plan.priceCents);

    const { body } = await http
      .post('/v1/staff/checkin/manual')
      .set(auth(local.dueno))
      .send({ membershipId })
      .expect(201);

    expect(body.registered).toBe(true);
    expect(body.result.allowed).toBe(true);
  });

  it('no tiene cupo semanal: el semáforo no lo agota', async () => {
    const local = await nuevoGimnasio();
    const { membershipId } = await alumnoDeClaseSuelta(local);

    const { body } = await http
      .get(`/v1/staff/members/${membershipId}`)
      .set(auth(local.dueno))
      .expect(200);

    expect(body.quota.limit).toBeNull();
    expect(body.quota.exhausted).toBe(false);
  });
});
