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
const nextValue = (): string => String(runId + ++contador);
const nextPhone = (): string => `+519${nextValue().slice(0, 8)}`;

/** RUC reales: el alta comprueba el digito verificador. */
const RUC = ['20100070970', '20131312955', '20100047218'];

const auth = (bearer: string) => ({ Authorization: `Bearer ${bearer}` });

/** Los gimnasios que esta prueba crea son PERMANENTES: se borran al terminar. */
const created: string[] = [];

interface Local {
  readonly tenantId: string;
  readonly owner: string;
}

let taxIdIndex = 0;

async function newGym(): Promise<Local> {
  const uid = `dueno-planes-${runId}-${++contador}`;
  const { body, status } = await http.post('/v1/gyms/signup').send({
    idToken: declareIdentity(uid),
    gymName: `Dojo Planes ${runId} ${contador}`,
    taxId: RUC[taxIdIndex++ % RUC.length]!,
    saasTier: 'up_to_60',
    address: 'Av. Primavera 120, Surco',
    ownerName: `Dueño ${uid}`,
    documentId: nextValue(),
    phone: nextPhone(),
  });
  if (status !== 201) throw new Error(`No se pudo crear el gimnasio: ${JSON.stringify(body)}`);
  created.push(body.tenantId as string);
  return { tenantId: body.tenantId as string, owner: body.session.accessToken as string };
}

/**
 * Una recepcionista de verdad en ese local.
 *
 * Se inserta a mano porque el alta solo crea al dueno, y sin ella no hay forma
 * de comprobar lo que mas importa de estas rutas: que recepcion LEA los planes y
 * no pueda tocar los precios.
 */
async function frontDeskToken(tenantId: string): Promise<string> {
  const { schema, withTenant, withoutTenantIsolation } = await import('./db/client');
  const { DATABASE } = await import('./db/db.module');
  const db = app.get(DATABASE);
  const phone = nextPhone();

  // `users` vive FUERA del tenant y `staff` dentro, asi que son dos contextos
  // distintos: insertar la fila de staff sin adoptar el gimnasio la rechaza el
  // WITH CHECK de su politica RLS, que es exactamente lo que tiene que pasar.
  const userId = await withoutTenantIsolation(db, async (tx) => {
    const [user] = await tx
      .insert(schema.users)
      .values({ name: `Recepción ${runId}`, documentId: nextValue(), phone })
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
  if (app !== undefined && created.length > 0) {
    const { schema, withoutTenantIsolation } = await import('./db/client');
    const { DATABASE } = await import('./db/db.module');
    await withoutTenantIsolation(app.get(DATABASE), (tx) =>
      tx.delete(schema.tenants).where(inArray(schema.tenants.id, created)),
    );
  }
  await app?.close();
});

suite('un gimnasio nuevo nace SIN tarifas, y las escribe el dueno', () => {
  /**
   * Ninguna, y es deliberado. Van dos intentos antes de este.
   *
   * Primero fueron cuatro precios de ejemplo, y el directorio los anunciaba como
   * si el local los hubiera decidido. Despues, UNA mensualidad pedida en el
   * formulario del alta: la cifra ya era suya, pero un gimnasio cobra distinto
   * por 2 y por 3 veces por semana y a menudo distinto por modalidad —tai chi,
   * sanda, lucha—, asi que obligarle a resumirlo en un numero producia un precio
   * publicado que tampoco era su precio.
   *
   * Lo que hay que sostener sigue siendo lo mismo: que el local no se quede
   * inutilizable SIN ENTERARSE. Eso ya no lo arregla sembrar una tarifa, lo
   * arregla que su primera pantalla despues del alta sea esta, y que las dos que
   * dependen de que haya tarifas —el directorio y el alta de un alumno— digan
   * que faltan en vez de ensenar un precio inventado o un cargando eterno.
   */
  it('trae la lista vacia: ni una tarifa que no haya escrito el', async () => {
    const local = await newGym();
    const { body } = await http.get('/v1/staff/plans').set(auth(local.owner)).expect(200);

    expect(body).toEqual([]);
  });

  it('escribe la primera y ya puede inscribir, el mismo dia y sin que nadie siembre nada', async () => {
    const local = await newGym();

    const { body: plan } = await http
      .post('/v1/staff/plans')
      .set(auth(local.owner))
      .send(planBase)
      .expect(201);

    const { status } = await http
      .post('/v1/staff/members')
      .set(auth(local.owner))
      .send({
        name: 'Alumna del primer día',
        documentId: nextValue(),
        phone: nextPhone(),
        planId: plan.id,
      });

    expect(status).toBe(201);
  });

  /**
   * El camino que NO puede existir: inscribir sin tarifas.
   *
   * La app apaga el boton y dice por que, pero la api es la autoridad y tiene
   * que negarse igual — es lo que separa una pantalla prudente de una regla.
   */
  it('sin ninguna tarifa no se puede inscribir a nadie', async () => {
    const local = await newGym();

    const { status } = await http
      .post('/v1/staff/members')
      .set(auth(local.owner))
      .send({
        name: 'Alumna sin plan',
        documentId: nextValue(),
        phone: nextPhone(),
        planId: '00000000-0000-4000-8000-000000000000',
      });

    expect(status).toBeGreaterThanOrEqual(400);
  });
});

suite('el dueño escribe sus planes', () => {
  it('crea uno y aparece en la lista del mostrador', async () => {
    const local = await newGym();
    const { body: created, status } = await http
      .post('/v1/staff/plans')
      .set(auth(local.owner))
      .send(planBase);

    expect(status).toBe(201);
    expect(created.priceCents).toBe(13_000);

    const { body: list } = await http.get('/v1/staff/plans').set(auth(local.owner));
    expect(list.some((p: { id: string }) => p.id === created.id)).toBe(true);
  });

  it('rechaza el plan por sesiones sin sesiones, con el motivo del dominio', async () => {
    const local = await newGym();
    const { body, status } = await http
      .post('/v1/staff/plans')
      .set(auth(local.owner))
      .send({ ...planBase, sessionsPerWeek: null });

    expect(status).toBe(400);
    expect(String(body.message)).toContain('cuántas veces por semana');
  });

  it('no deja dos planes activos con el mismo nombre', async () => {
    const local = await newGym();
    await http.post('/v1/staff/plans').set(auth(local.owner)).send(planBase).expect(201);

    const { status, body } = await http
      .post('/v1/staff/plans')
      .set(auth(local.owner))
      // Distinto precio, mismo nombre en otra caja: sigue siendo la misma tarifa
      // leida dos veces, y el mostrador elegiria una al azar en el alta.
      .send({ ...planBase, name: '  mañanas  ', priceCents: 20_000 });

    expect(status).toBe(409);
    expect(String(body.message)).toContain('Mañanas');
  });

  it('cambiar el precio no toca lo ya cobrado, solo lo de adelante', async () => {
    const local = await newGym();
    const { body: plan } = await http
      .post('/v1/staff/plans')
      .set(auth(local.owner))
      .send(planBase);

    const { body: student } = await http
      .post('/v1/staff/members')
      .set(auth(local.owner))
      .send({
        name: 'Alumno con plan',
        documentId: nextValue(),
        phone: nextPhone(),
        planId: plan.id,
      })
      .expect(201);

    const membershipId = student.view.membership.id as string;
    await http
      .post('/v1/staff/payments')
      .set(auth(local.owner))
      .send({ membershipId, type: 'renewal', rail: 'cash' })
      .expect(201);

    await http
      .post(`/v1/staff/plans/${plan.id}`)
      .set(auth(local.owner))
      .send({ ...planBase, priceCents: 20_000 })
      .expect(201);

    const { body: record } = await http
      .get(`/v1/staff/members/${membershipId}`)
      .set(auth(local.owner))
      .expect(200);

    // El cargo del ledger conserva lo que se cobró; el plan ya vale otra cosa.
    const cobrado = record.charges.find((c: { type: string }) => c.type === 'renewal');
    expect(cobrado.amountCents).toBe(13_000);
    expect(record.plan.priceCents).toBe(20_000);
  });
});

suite('archivar y borrar', () => {
  it('archivar lo saca del mostrador pero no de la lista del dueño', async () => {
    const local = await newGym();
    const { body: plan } = await http
      .post('/v1/staff/plans')
      .set(auth(local.owner))
      .send(planBase);

    await http
      .post(`/v1/staff/plans/${plan.id}/active`)
      .set(auth(local.owner))
      .send({ active: false })
      .expect(201);

    const { body: frontDesk } = await http.get('/v1/staff/plans').set(auth(local.owner));
    expect(frontDesk.some((p: { id: string }) => p.id === plan.id)).toBe(false);

    const { body: all } = await http.get('/v1/staff/plans/all').set(auth(local.owner));
    const archivado = all.find((row: { plan: { id: string } }) => row.plan.id === plan.id);
    expect(archivado.plan.active).toBe(false);
  });

  it('archivar deja libre el nombre para el plan que lo reemplaza', async () => {
    const local = await newGym();
    const { body: previous } = await http
      .post('/v1/staff/plans')
      .set(auth(local.owner))
      .send(planBase);

    await http
      .post(`/v1/staff/plans/${previous.id}/active`)
      .set(auth(local.owner))
      .send({ active: false })
      .expect(201);

    // Subir precios es exactamente esto: archivar el viejo y escribir el nuevo.
    await http
      .post('/v1/staff/plans')
      .set(auth(local.owner))
      .send({ ...planBase, priceCents: 16_000 })
      .expect(201);
  });

  it('borra el plan que nadie usa: el tipeo de hace dos minutos', async () => {
    const local = await newGym();
    const { body: plan } = await http
      .post('/v1/staff/plans')
      .set(auth(local.owner))
      .send({ ...planBase, name: 'Mañnas' });

    await http.delete(`/v1/staff/plans/${plan.id}`).set(auth(local.owner)).expect(200);

    const { body: all } = await http.get('/v1/staff/plans/all').set(auth(local.owner));
    expect(all.some((row: { plan: { id: string } }) => row.plan.id === plan.id)).toBe(false);
  });

  it('no borra el plan que alguien paga, y dice que lo archive', async () => {
    const local = await newGym();
    const { body: plan } = await http
      .post('/v1/staff/plans')
      .set(auth(local.owner))
      .send(planBase);

    await http
      .post('/v1/staff/members')
      .set(auth(local.owner))
      .send({
        name: 'Alumna fiel',
        documentId: nextValue(),
        phone: nextPhone(),
        planId: plan.id,
      })
      .expect(201);

    const { status, body } = await http.delete(`/v1/staff/plans/${plan.id}`).set(auth(local.owner));
    expect(status).toBe(409);
    expect(String(body.message)).toContain('Archívalo');

    // La salida que sí existe.
    await http
      .post(`/v1/staff/plans/${plan.id}/active`)
      .set(auth(local.owner))
      .send({ active: false })
      .expect(201);
  });

  it('la lista del dueño dice cuánta gente tiene cada plan', async () => {
    const local = await newGym();
    const { body: plan } = await http
      .post('/v1/staff/plans')
      .set(auth(local.owner))
      .send(planBase);

    await http
      .post('/v1/staff/members')
      .set(auth(local.owner))
      .send({ name: 'Uno', documentId: nextValue(), phone: nextPhone(), planId: plan.id })
      .expect(201);

    const { body: all } = await http.get('/v1/staff/plans/all').set(auth(local.owner));
    const found = all.find((row: { plan: { id: string } }) => row.plan.id === plan.id);
    expect(found.activeMembers).toBe(1);
    expect(found.deletable).toBe(false);
  });
});

suite('quién puede tocar los precios', () => {
  it('recepción lee los planes pero no los escribe', async () => {
    const local = await newGym();
    const frontDesk = await frontDeskToken(local.tenantId);

    await http.get('/v1/staff/plans').set(auth(frontDesk)).expect(200);
    await http.post('/v1/staff/plans').set(auth(frontDesk)).send(planBase).expect(403);
    await http.get('/v1/staff/plans/all').set(auth(frontDesk)).expect(403);
  });

  it('recepción lee lo que cobra el local, porque es quien lo cobra', async () => {
    const local = await newGym();
    const frontDesk = await frontDeskToken(local.tenantId);

    const { body } = await http.get('/v1/staff/pricing').set(auth(frontDesk)).expect(200);
    expect(body).toHaveProperty('enrollmentFeeCents');

    await http.post('/v1/staff/pricing').set(auth(frontDesk)).send(body).expect(403);
  });
});

suite('lo que el local cobra aparte', () => {
  it('el dueño lo cambia y se lee de vuelta', async () => {
    const local = await newGym();
    const pricing = {
      enrollmentFeeCents: 5_000,
      dropInPriceCents: 3_000,
      quotaOverflowPolicy: 'offer_drop_in',
      trialClassEnabled: true,
      trialClassPriceCents: 0,
      graceDays: 10,
    };

    await http.post('/v1/staff/pricing').set(auth(local.owner)).send(pricing).expect(201);

    const { body } = await http.get('/v1/staff/pricing').set(auth(local.owner)).expect(200);
    expect(body).toMatchObject(pricing);
  });

  it('la app que no conoce la gracia guarda sus precios sin borrarla', async () => {
    const local = await newGym();
    const precios = {
      enrollmentFeeCents: 0,
      dropInPriceCents: null,
      quotaOverflowPolicy: 'block',
      trialClassEnabled: true,
      trialClassPriceCents: 0,
    };
    await http
      .post('/v1/staff/pricing')
      .set(auth(local.owner))
      .send({ ...precios, graceDays: 12 })
      .expect(201);

    // Lo que manda una app instalada antes de este campo.
    const { body } = await http
      .post('/v1/staff/pricing')
      .set(auth(local.owner))
      .send({ ...precios, enrollmentFeeCents: 4_000 })
      .expect(201);

    expect(body.graceDays).toBe(12);
    expect(body.enrollmentFeeCents).toBe(4_000);
  });

  it('la gracia va de 0 a 60, con el motivo en vez del 500 del CHECK', async () => {
    const local = await newGym();
    const precios = {
      enrollmentFeeCents: 0,
      dropInPriceCents: null,
      quotaOverflowPolicy: 'block',
      trialClassEnabled: true,
      trialClassPriceCents: 0,
    };

    for (const graceDays of [61, -1, 2.5]) {
      const { status, body } = await http
        .post('/v1/staff/pricing')
        .set(auth(local.owner))
        .send({ ...precios, graceDays });
      expect(status).toBe(400);
      expect(String(body.message)).toContain('días de gracia');
    }

    await http
      .post('/v1/staff/pricing')
      .set(auth(local.owner))
      .send({ ...precios, graceDays: 0 })
      .expect(201);
  });

  it('no deja ofrecer clase suelta sin precio: el mostrador tendría que inventarlo', async () => {
    const local = await newGym();
    const { status, body } = await http
      .post('/v1/staff/pricing')
      .set(auth(local.owner))
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
    const local = await newGym();
    const { status } = await http
      .post('/v1/staff/pricing')
      .set(auth(local.owner))
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
  /**
   * Inscribe a alguien en un plan de clase suelta.
   *
   * La escribe la propia prueba: el alta ya no siembra tarifas, así que el plan
   * `drop_in` es lo que haría el dueño desde su pantalla de planes al aparecer
   * el primero que quiere entrenar un sábado sin amarrarse a un mes.
   */
  async function dropInStudent(local: Local) {
    const { body: plan } = await http
      .post('/v1/staff/plans')
      .set(auth(local.owner))
      .send({
        name: 'Clase suelta',
        type: 'drop_in',
        sessionsPerWeek: null,
        allowedDays: null,
        priceCents: 2_500,
      })
      .expect(201);

    const { body } = await http
      .post('/v1/staff/members')
      .set(auth(local.owner))
      .send({
        name: 'Visita del sábado',
        documentId: nextValue(),
        phone: nextPhone(),
        planId: plan.id,
      })
      .expect(201);

    return { membershipId: body.view.membership.id as string, plan };
  }

  it('no debe nada aunque no haya pagado: no es un moroso', async () => {
    const local = await newGym();
    const { membershipId } = await dropInStudent(local);

    const { body } = await http
      .get(`/v1/staff/members/${membershipId}`)
      .set(auth(local.owner))
      .expect(200);

    expect(body.receivable.amountCents).toBe(0);
    expect(body.subscription.status).toBe('active');
  });

  it('la puerta lo para hasta que pague la clase de hoy', async () => {
    const local = await newGym();
    const { membershipId, plan } = await dropInStudent(local);

    const { body } = await http
      .post('/v1/staff/checkin/manual')
      .set(auth(local.owner))
      .send({ membershipId })
      .expect(201);

    expect(body.registered).toBe(false);
    expect(body.result.reason.code).toBe('drop_in_unpaid');
    // `alert`, no `blocked`: le falta pagar lo de hoy, no debe una mensualidad.
    expect(body.result.level).toBe('alert');
    expect(body.result.reason.priceCents).toBe(plan.priceCents);
  });

  it('pagada la clase, entra — y se le cobra el precio de SU plan', async () => {
    const local = await newGym();
    const { membershipId, plan } = await dropInStudent(local);

    // El precio de clase suelta DEL LOCAL es otro y no debe ganarle al del plan:
    // es el que paga el alumno con mensualidad que agota su cupo.
    await http
      .post('/v1/staff/pricing')
      .set(auth(local.owner))
      .send({
        enrollmentFeeCents: 0,
        dropInPriceCents: 9_900,
        quotaOverflowPolicy: 'offer_drop_in',
        trialClassEnabled: true,
        trialClassPriceCents: 0,
      })
      .expect(201);

    const { body: chargeRow } = await http
      .post('/v1/staff/payments')
      .set(auth(local.owner))
      .send({ membershipId, type: 'drop_in', rail: 'cash' })
      .expect(201);

    expect(chargeRow.charge.amountCents).toBe(plan.priceCents);

    const { body } = await http
      .post('/v1/staff/checkin/manual')
      .set(auth(local.owner))
      .send({ membershipId })
      .expect(201);

    expect(body.registered).toBe(true);
    expect(body.result.allowed).toBe(true);
  });

  it('no tiene cupo semanal: el semáforo no lo agota', async () => {
    const local = await newGym();
    const { membershipId } = await dropInStudent(local);

    const { body } = await http
      .get(`/v1/staff/members/${membershipId}`)
      .set(auth(local.owner))
      .expect(200);

    expect(body.quota.limit).toBeNull();
    expect(body.quota.exhausted).toBe(false);
  });
});
