/**
 * Los avisos al teléfono, de punta a punta (migración 0029).
 *
 * El envío a Expo se sustituye: lo que se prueba es a QUIÉN se avisa, con QUÉ
 * y qué pasa con el teléfono que ya no existe. Mandar avisos de verdad desde
 * una prueba es mandárselos al teléfono de alguien.
 */
import { randomBytes, randomInt } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { UnauthorizedException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { inArray } from 'drizzle-orm';
import { FirebaseVerifier, type VerifiedIdentity } from './auth/firebase';
import { ExpoPushClient, type PushNotice, type PushTicket } from './modules/push/push.service';

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

/** Lo que la api le habría mandado a Expo, y los teléfonos que Expo da por muertos. */
const sent: (PushNotice & { readonly to: string })[] = [];
const uninstalled = new Set<string>();
const fakeExpo = {
  send: async (messages: readonly (PushNotice & { readonly to: string })[]) => {
    sent.push(...messages);
    return messages.map(
      (message): PushTicket =>
        uninstalled.has(message.to)
          ? {
              status: 'error',
              message: 'not registered',
              details: { error: 'DeviceNotRegistered' },
            }
          : { status: 'ok', id: `ticket-${message.to}` },
    );
  },
};

const runId = randomInt(10_000_000, 89_000_000);
let contador = 0;
const nextValue = (): string => String(runId + ++contador);
const nextPhone = (): string => `+519${nextValue().slice(0, 8)}`;
const nextToken = (): string => `ExponentPushToken[qa-${runId}-${++contador}]`;

const RUC = ['20100070970', '20131312955', '20100047218'];
const auth = (bearer: string) => ({ Authorization: `Bearer ${bearer}` });
const created: string[] = [];

interface Local {
  readonly tenantId: string;
  readonly slug: string;
  readonly owner: string;
}

let taxIdIndex = 0;

async function newGym(): Promise<Local> {
  const uid = `dueno-avisos-${runId}-${++contador}`;
  const { body, status } = await http.post('/v1/gyms/signup').send({
    idToken: declareIdentity(uid),
    gymName: `Dojo Avisos ${runId} ${contador}`,
    taxId: RUC[taxIdIndex++ % RUC.length]!,
    saasTier: 'up_to_60',
    address: 'Av. Primavera 120, Surco',
    ownerName: `Dueño ${uid}`,
    documentId: nextValue(),
    phone: nextPhone(),
  });
  if (status !== 201) throw new Error(`No se pudo crear el gimnasio: ${JSON.stringify(body)}`);
  created.push(body.tenantId as string);
  return {
    tenantId: body.tenantId as string,
    slug: body.slug as string,
    owner: body.session.accessToken as string,
  };
}

/** Una recepcionista del local, con su sesión. */
async function frontDeskToken(tenantId: string): Promise<string> {
  const { schema, withTenant, withoutTenantIsolation } = await import('./db/client');
  const { DATABASE } = await import('./db/db.module');
  const db = app.get(DATABASE);
  const phone = nextPhone();

  const userId = await withoutTenantIsolation(db, async (tx) => {
    const [user] = await tx
      .insert(schema.users)
      .values({ name: `Recepción ${runId}`, documentId: nextValue(), phone })
      .returning({ id: schema.users.id });
    return user!.id;
  });
  await withTenant(db, tenantId, (tx) =>
    tx.insert(schema.staff).values({ tenantId, userId, role: 'front_desk', displayName: 'Recepción' }),
  );

  const { body } = await http.post('/v1/auth/dev-login').send({ phone }).expect(201);
  return body.accessToken as string;
}

/** Publica una clase cada día y un plan: con eso se puede reservar cualquier cosa. */
async function openForBookings(local: Local): Promise<{ readonly planId: string }> {
  for (const weekday of [1, 2, 3, 4, 5, 6, 7]) {
    await http
      .post('/v1/staff/schedules')
      .set(auth(local.owner))
      .send({
        name: 'Karate adultos',
        weekdays: [weekday],
        startTime: '19:00',
        endTime: '20:30',
        capacity: null,
        instructor: null,
        active: true,
      })
      .expect(201);
  }
  const { body: plan } = await http
    .post('/v1/staff/plans')
    .set(auth(local.owner))
    .send({ name: 'Ilimitado', type: 'unlimited', priceCents: 18_000 })
    .expect(201);
  return { planId: plan.id as string };
}

/** Alguien de fuera reserva la primera hora que haya. */
async function book(local: Local, extra: Record<string, unknown> = {}) {
  const { body: record } = await http.get(`/v1/gyms/${local.slug}`).expect(200);
  const slot = record.slots[0];
  const date = `${slot.date.year}-${String(slot.date.month).padStart(2, '0')}-${String(slot.date.day).padStart(2, '0')}`;
  const { body } = await http
    .post(`/v1/gyms/${local.slug}/trial`)
    .send({
      idToken: declareIdentity(`visitante-avisos-${runId}-${++contador}`),
      fullName: 'Valeria Torres',
      phone: nextPhone(),
      classScheduleId: slot.scheduleId,
      date,
      ...extra,
    })
    .expect(201);
  expect(body.booked).toBe(true);
  return body.booking as { readonly id: string };
}

const register = (session: string, token: string, platform = 'ios') =>
  http.post('/v1/me/push-devices').set(auth(session)).send({ token, platform });

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
  const { MailService } = await import('./modules/mail/mail.service');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(FirebaseVerifier)
    .useValue(fakeVerifier)
    .overrideProvider(ExpoPushClient)
    .useValue(fakeExpo)
    // El `.env` puede traer la llave de Resend: sin esto, cada reserva de la
    // prueba le mandaría un correo de verdad a un dueño inventado.
    .overrideProvider(MailService)
    .useValue({ disponible: false, notifyBooking: async () => ({ enviado: false, denial: null }) })
    .compile();

  app = moduleRef.createNestApplication();
  configureApp(app, loadEnv());
  await app.init();
  http = request(app.getHttpServer());
}, 90_000);

beforeEach(() => {
  sent.length = 0;
  uninstalled.clear();
});

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

suite('el aviso de una reserva', () => {
  it('la inscripción le llega al dueño y a recepción, y abre Reservas', async () => {
    const local = await newGym();
    const { planId } = await openForBookings(local);
    const frontDesk = await frontDeskToken(local.tenantId);
    const ownerPhone = nextToken();
    const deskPhone = nextToken();
    await register(local.owner, ownerPhone).expect(201);
    await register(frontDesk, deskPhone, 'android').expect(201);

    const booking = await book(local, { kind: 'enrollment', planId });

    expect(sent.map((message) => message.to).sort()).toEqual([ownerPhone, deskPhone].sort());
    const [notice] = sent;
    expect(notice!.title).toMatch(/^Inscripción: Valeria Torres viene el /);
    expect(notice!.body).toContain('plan Ilimitado');
    expect(notice!.data).toEqual({ url: '/staff/trials', bookingId: booking.id });
    expect(notice!.channelId).toBe('reservas');
  });

  it('la prueba también avisa, con su propio título', async () => {
    const local = await newGym();
    await openForBookings(local);
    await register(local.owner, nextToken()).expect(201);

    await book(local);

    expect(sent).toHaveLength(1);
    expect(sent[0]!.title).toMatch(/^Clase de prueba: /);
  });

  it('el staff de otro gimnasio no se entera de nada', async () => {
    const mine = await newGym();
    const other = await newGym();
    await openForBookings(mine);
    await register(other.owner, nextToken()).expect(201);

    await book(mine);

    expect(sent).toHaveLength(0);
  });

  it('el teléfono que desinstaló la app se borra al primer rechazo', async () => {
    const local = await newGym();
    await openForBookings(local);
    const phone = nextToken();
    await register(local.owner, phone).expect(201);
    uninstalled.add(phone);

    await book(local);
    expect(sent).toHaveLength(1);

    // El segundo aviso ya no lo intenta: ese teléfono no va a volver.
    sent.length = 0;
    await book(local);
    expect(sent).toHaveLength(0);
  });
});

suite('el teléfono es del aparato, no de la persona', () => {
  it('al cambiar de sesión en el mismo teléfono, el aviso va a quien entró', async () => {
    const local = await newGym();
    await openForBookings(local);
    const other = await newGym();
    const phone = nextToken();

    // Ana cierra su turno y en el mismo teléfono entra el dueño de otro local.
    await register(local.owner, phone).expect(201);
    await register(other.owner, phone).expect(201);

    await book(local);
    expect(sent).toHaveLength(0);
  });

  it('al cerrar sesión se quita, pero nadie puede quitar el teléfono de otro', async () => {
    const local = await newGym();
    await openForBookings(local);
    const stranger = await newGym();
    const phone = nextToken();
    await register(local.owner, phone).expect(201);

    // Otra sesión que conoce el token no lo puede dejar mudo.
    await http
      .post('/v1/me/push-devices/remove')
      .set(auth(stranger.owner))
      .send({ token: phone })
      .expect(201);
    await book(local);
    expect(sent).toHaveLength(1);

    sent.length = 0;
    await http
      .post('/v1/me/push-devices/remove')
      .set(auth(local.owner))
      .send({ token: phone })
      .expect(201);
    await book(local);
    expect(sent).toHaveLength(0);
  });

  it('rechaza lo que no es un token de Expo, y a quien no tiene sesión', async () => {
    const local = await newGym();
    const { body } = await register(local.owner, 'hola').expect(400);
    expect(String(body.message)).toContain('token de avisos');
    await http
      .post('/v1/me/push-devices')
      .send({ token: nextToken(), platform: 'ios' })
      .expect(401);
  });
});
