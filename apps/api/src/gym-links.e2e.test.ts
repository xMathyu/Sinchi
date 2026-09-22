/**
 * La web y las redes del gimnasio, de punta a punta.
 *
 * Las reglas de cada red las prueba `gym-links.test.ts` en el dominio. Lo que
 * solo se ve aquí es que la api no guarde NUNCA lo que llegó tal cual: que el
 * alta y «Logo y redes» pasen por la misma normalización, que lo que no es un
 * perfil rebote con su frase antes de tocar la base, y que la ficha pública
 * devuelva las direcciones canónicas.
 *
 * Necesita `TEST_DATABASE_URL`, igual que los demás e2e.
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

const runId = randomInt(10_000_000, 89_000_000);
let contador = 0;
const nextValue = (): string => String(runId + ++contador);
const nextPhone = (): string => `+519${nextValue().slice(0, 8)}`;
const auth = (bearer: string) => ({ Authorization: `Bearer ${bearer}` });
const created: string[] = [];

interface Local {
  readonly tenantId: string;
  readonly slug: string;
  readonly owner: string;
}

const signUp = (links?: Record<string, string>) => {
  const uid = `dueno-redes-${runId}-${++contador}`;
  return http.post('/v1/gyms/signup').send({
    idToken: declareIdentity(uid),
    gymName: `Dojo Redes ${runId} ${contador}`,
    saasTier: 'up_to_60',
    address: 'Av. Primavera 120, Surco',
    ownerName: `Dueño ${uid}`,
    documentId: nextValue(),
    phone: nextPhone(),
    ...(links === undefined ? {} : { links }),
  });
};

async function newGym(links?: Record<string, string>): Promise<Local> {
  const { body, status } = await signUp(links);
  if (status !== 201) throw new Error(`No se pudo crear el gimnasio: ${JSON.stringify(body)}`);
  created.push(body.tenantId as string);
  return {
    tenantId: body.tenantId as string,
    slug: body.slug as string,
    owner: body.session.accessToken as string,
  };
}

/** Una sesión de mostrador en ese gimnasio. */
async function newFrontDesk(local: Local): Promise<string> {
  const { schema, withTenant, withoutTenantIsolation } = await import('./db/client');
  const { DATABASE } = await import('./db/db.module');
  const db = app.get(DATABASE);
  const phone = nextPhone();

  const userId = await withoutTenantIsolation(db, async (tx) => {
    const [user] = await tx
      .insert(schema.users)
      .values({ name: 'Recepción', documentId: nextValue(), phone })
      .returning({ id: schema.users.id });
    return user!.id;
  });
  await withTenant(db, local.tenantId, (tx) =>
    tx.insert(schema.staff).values({
      tenantId: local.tenantId,
      userId,
      role: 'front_desk',
      displayName: 'Recepción',
    }),
  );

  const { body } = await http.post('/v1/auth/dev-login').send({ phone }).expect(201);
  return body.accessToken as string;
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
    await withoutTenantIsolation(app.get(DATABASE), (tx) =>
      tx.delete(schema.tenants).where(inArray(schema.tenants.id, created)),
    );
  }
  await app?.close();
});

const NONE = { website: null, instagram: null, facebook: null, tiktok: null };

suite('la web y las redes del gimnasio', () => {
  /** Nadie escribe `https://`, y casi todos pegan el enlace con su rastreo. */
  it('el alta las guarda normalizadas y la ficha pública las devuelve así', async () => {
    const local = await newGym({
      website: 'MiDojo.pe',
      instagram: 'https://www.instagram.com/MiDojo/?igsh=MWQ1ZGUxMzBkMA==',
      facebook: 'https://m.facebook.com/dojokaizen?mibextid=ZbWKwL',
      tiktok: '@midojo',
    });

    const { body } = await http.get(`/v1/gyms/${local.slug}`).expect(200);
    expect(body.links).toEqual({
      website: 'https://midojo.pe',
      instagram: 'https://www.instagram.com/midojo',
      facebook: 'https://www.facebook.com/dojokaizen',
      tiktok: 'https://www.tiktok.com/@midojo',
    });
  });

  it('sin redes es lo normal: todo en null', async () => {
    const local = await newGym();
    const { body } = await http.get(`/v1/gyms/${local.slug}`).expect(200);
    expect(body.links).toEqual(NONE);
  });

  /**
   * Un enlace mal pegado no puede dejar un gimnasio a medias: se comprueba antes
   * de crear nada.
   */
  it('un alta con un enlace que no sirve rebota entera, con su frase', async () => {
    const { body, status } = await signUp({ instagram: 'https://www.instagram.com/p/C1abc/' });
    expect(status).toBe(400);
    expect(body.message).toContain('publicación');
    expect(body.tenantId).toBeUndefined();
  });

  it('el dueño las cambia desde «Logo y redes», y vaciar es borrar', async () => {
    const local = await newGym({ website: 'midojo.pe' });

    const { body: puesto } = await http
      .post('/v1/staff/links')
      .set(auth(local.owner))
      .send({ website: '', instagram: '@dojo.lince', facebook: null, tiktok: 'tiktok.com/@DojoLince' })
      .expect(201);
    expect(puesto).toEqual({
      website: null,
      instagram: 'https://www.instagram.com/dojo.lince',
      facebook: null,
      tiktok: 'https://www.tiktok.com/@dojolince',
    });

    const { body: leido } = await http.get('/v1/staff/links').set(auth(local.owner)).expect(200);
    expect(leido).toEqual(puesto);
  });

  it('lo que no sirve no cambia nada, y dice por qué', async () => {
    const local = await newGym({ tiktok: '@midojo' });

    const { body } = await http
      .post('/v1/staff/links')
      .set(auth(local.owner))
      .send({ website: 'instagram.com/midojo', instagram: null, facebook: null, tiktok: null })
      .expect(400);
    expect(body.message).toContain('propio campo');

    const { body: leido } = await http.get('/v1/staff/links').set(auth(local.owner)).expect(200);
    expect(leido.tiktok).toBe('https://www.tiktok.com/@midojo');
  });

  it('recepción las ve, pero cambiarlas es del dueño', async () => {
    const local = await newGym({ website: 'midojo.pe' });
    const frontDesk = await newFrontDesk(local);

    const { body } = await http.get('/v1/staff/links').set(auth(frontDesk)).expect(200);
    expect(body.website).toBe('https://midojo.pe');
    await http
      .post('/v1/staff/links')
      .set(auth(frontDesk))
      .send({ website: 'otro.pe', instagram: null, facebook: null, tiktok: null })
      .expect(403);
  });
});
