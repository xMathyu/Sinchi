/**
 * Eventos con fecha, de punta a punta.
 *
 * Lo que solo se comprueba aqui y no en los tests del dominio:
 *
 *  1. **que el cupo aguante.** Es lo unico que separa vender treinta plazas de
 *     vender treinta y una, y la garantia real no es el `select` del servicio
 *     sino el indice unico. Se prueba con dos reservas simultaneas;
 *  2. **que el ledger admita a quien no es alumno.** Un seminario lo paga gente
 *     de fuera, y su plata tiene que entrar en "cobrado este mes" sin inventarle
 *     una ficha en el padron;
 *  3. **que cancelar no borre a nadie**: las reservas son la lista de a quien
 *     hay que avisar.
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

const runId = randomInt(10_000_000, 89_000_000);
let contador = 0;
const nextValue = (): string => String(runId + ++contador);
const nextPhone = (): string => `+519${nextValue().slice(0, 8)}`;

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
  const uid = `dueno-eventos-${runId}-${++contador}`;
  const { body, status } = await http.post('/v1/gyms/signup').send({
    idToken: declareIdentity(uid),
    gymName: `Dojo Eventos ${runId} ${contador}`,
    taxId: RUC[taxIdIndex++ % RUC.length]!,
    saasTier: 'up_to_60',
    address: 'Av. Primavera 120, Surco',
    ownerName: `Dueño ${uid}`,
    documentId: nextValue(),
    phone: nextPhone(),
  });
  if (status !== 201) throw new Error(`No se pudo crear el gimnasio: ${JSON.stringify(body)}`);
  created.push(body.tenantId as string);

  /**
   * Su primera tarifa, escrita a mano porque el alta ya no escribe ninguna.
   *
   * El local nace con `plans` vacia a proposito —un gimnasio cobra distinto por
   * 2 y por 3 veces por semana, y a menudo distinto por modalidad, asi que
   * ninguna cifra puesta por nosotros seria la suya— y su primera pantalla
   * despues de registrarse es Planes. Esto es ese paso: sin el no hay `planId`
   * con el que inscribir, que es lo que estas pruebas necesitan.
   */
  await http
    .post('/v1/staff/plans')
    .set(auth(body.session.accessToken as string))
    .send({
      name: 'Mensualidad',
      type: 'unlimited',
      sessionsPerWeek: null,
      allowedDays: null,
      priceCents: 12_000,
    })
    .expect(201);

  return {
    tenantId: body.tenantId as string,
    slug: body.slug as string,
    owner: body.session.accessToken as string,
  };
}

/** Una fecha futura estable, para que el evento nunca nazca en el pasado. */
function inDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const baseEvent = () => ({
  name: 'Seminario con Jorge Linares',
  description: 'Tres horas de técnica de boxeo.',
  instructor: 'Jorge Linares',
  date: inDays(20),
  startTime: '10:00',
  endTime: '13:00',
  capacity: 3,
  memberPriceCents: 8_000,
  guestPriceCents: 12_000,
  published: true,
});

async function createEvent(local: Local, overrides: Record<string, unknown> = {}) {
  const { body, status } = await http
    .post('/v1/staff/events')
    .set(auth(local.owner))
    .send({ ...baseEvent(), ...overrides });
  if (status !== 201) throw new Error(`No se pudo crear el evento: ${JSON.stringify(body)}`);
  return body;
}

async function enrollStudent(local: Local, eventId: string) {
  const { body: plans } = await http.get('/v1/staff/plans').set(auth(local.owner));
  const { body: student } = await http
    .post('/v1/staff/members')
    .set(auth(local.owner))
    .send({
      name: `Alumno ${nextValue()}`,
      documentId: nextValue(),
      phone: nextPhone(),
      planId: plans[0].id,
    })
    .expect(201);

  const membershipId = student.view.membership.id as string;
  const { body } = await http
    .post(`/v1/staff/events/${eventId}/registrations`)
    .set(auth(local.owner))
    .send({ membershipId })
    .expect(201);

  return { membershipId, outcome: body };
}

/**
 * Alguien de la calle reservando desde el directorio.
 *
 * Con `uid` repetido se simula a la MISMA persona volviendo, y entonces manda
 * su cuenta: el celular se deja cambiar a proposito, porque es justo el hueco
 * por el que alguien podria llevarse dos plazas del mismo seminario.
 */
async function outsideBooking(local: Local, eventId: string, uid?: string) {
  return http
    .post(`/v1/gyms/${local.slug}/events/${eventId}/book`)
    .send({
      idToken: declareIdentity(uid ?? `visita-${runId}-${++contador}`),
      fullName: `Visita ${nextValue()}`,
      phone: nextPhone(),
    });
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

suite('el dueño escribe el evento', () => {
  it('lo crea publicado y sale en «lo que viene»', async () => {
    const local = await newGym();
    const event = await createEvent(local);

    expect(event.status).toBe('published');
    expect(event.memberPriceCents).toBe(8_000);
    expect(event.guestPriceCents).toBe(12_000);

    const { body: list } = await http.get('/v1/staff/events').set(auth(local.owner)).expect(200);
    const found = list.find((row: { event: { id: string } }) => row.event.id === event.id);
    expect(found.seatsLeft).toBe(3);
    expect(found.seatsTaken).toBe(0);
  });

  it('rechaza el que acaba antes de empezar, con el motivo del dominio', async () => {
    const local = await newGym();
    const { status, body } = await http
      .post('/v1/staff/events')
      .set(auth(local.owner))
      .send({ ...baseEvent(), startTime: '19:00', endTime: '18:00' });

    expect(status).toBe(400);
    expect(String(body.message)).toContain('después');
  });

  it('no deja publicar algo que ya pasó', async () => {
    const local = await newGym();
    const { status } = await http
      .post('/v1/staff/events')
      .set(auth(local.owner))
      .send({ ...baseEvent(), date: inDays(-3) });

    expect(status).toBe(400);
  });

  it('recepción lo lee pero no lo escribe', async () => {
    const local = await newGym();
    await createEvent(local);

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

    const { body: staffSession } = await http.post('/v1/auth/dev-login').send({ phone }).expect(201);
    const frontDesk = staffSession.accessToken as string;

    await http.get('/v1/staff/events').set(auth(frontDesk)).expect(200);
    await http.post('/v1/staff/events').set(auth(frontDesk)).send(baseEvent()).expect(403);
  });
});

suite('el borrador no se vende', () => {
  it('no sale en el directorio hasta que se publica', async () => {
    const local = await newGym();
    const event = await createEvent(local, { published: false });

    const { body: record } = await http.get(`/v1/gyms/${local.slug}`).expect(200);
    expect(record.events).toHaveLength(0);

    await http
      .post(`/v1/staff/events/${event.id}/status`)
      .set(auth(local.owner))
      .send({ status: 'published' })
      .expect(201);

    const { body: after } = await http.get(`/v1/gyms/${local.slug}`).expect(200);
    expect(after.events).toHaveLength(1);
    expect(after.events[0].event.name).toContain('Jorge Linares');
  });

  it('reservar un borrador se rechaza con motivo, no con un 500', async () => {
    const local = await newGym();
    const event = await createEvent(local, { published: false });

    const { body, status } = await outsideBooking(local, event.id);
    expect(status).toBe(201);
    expect(body.booked).toBe(false);
    expect(body.reason.code).toBe('not_published');
  });
});

suite('las dos formas de coger plaza', () => {
  it('el mostrador inscribe a un alumno y le cobra SU precio', async () => {
    const local = await newGym();
    const event = await createEvent(local);
    const { outcome } = await enrollStudent(local, event.id);

    expect(outcome.booked).toBe(true);
    expect(outcome.registration.registration.priceCents).toBe(8_000);
    expect(outcome.registration.isMember).toBe(true);
    expect(outcome.registration.paid).toBe(false);
  });

  it('quien viene de fuera reserva desde el directorio y paga el suyo', async () => {
    const local = await newGym();
    const event = await createEvent(local);

    const { body, status } = await outsideBooking(local, event.id);
    expect(status).toBe(201);
    expect(body.booked).toBe(true);
    expect(body.registration.registration.priceCents).toBe(12_000);
    expect(body.registration.isMember).toBe(false);
  });

  it('la misma persona no coge dos plazas del mismo evento', async () => {
    const local = await newGym();
    const event = await createEvent(local);
    const uid = `repetido-${runId}-${++contador}`;

    const primera = await outsideBooking(local, event.id, uid);
    expect(primera.body.booked).toBe(true);

    const segunda = await outsideBooking(local, event.id, uid);
    expect(segunda.body.booked).toBe(false);
    expect(segunda.body.reason.code).toBe('already_registered');
  });

  /**
   * El hueco que el celular solo no tapa: la misma cuenta escribiendo otro
   * numero. Con cupo de por medio, esa segunda plaza se la quita a alguien.
   */
  it('ni cambiando de celular con la misma cuenta', async () => {
    const local = await newGym();
    const event = await createEvent(local);
    const uid = `dos-celulares-${runId}-${++contador}`;

    // `outsideBooking` manda un celular distinto en cada llamada.
    expect((await outsideBooking(local, event.id, uid)).body.booked).toBe(true);
    const segunda = await outsideBooking(local, event.id, uid);
    expect(segunda.body.booked).toBe(false);
    expect(segunda.body.reason.code).toBe('already_registered');
  });
});

suite('el cupo', () => {
  it('se agota y lo dice con el número de plazas', async () => {
    const local = await newGym();
    const event = await createEvent(local, { capacity: 2 });

    expect((await outsideBooking(local, event.id)).body.booked).toBe(true);
    expect((await outsideBooking(local, event.id)).body.booked).toBe(true);

    const full = await outsideBooking(local, event.id);
    expect(full.body.booked).toBe(false);
    expect(full.body.reason.code).toBe('sold_out');
    expect(full.body.reason.capacity).toBe(2);
  });

  /**
   * La prueba que de verdad importa del cupo: el `select` del servicio no para
   * una carrera, el indice unico si. Dos personas distintas van a la vez a por
   * las dos ultimas plazas de un evento de 2 — las dos entran — y una tercera
   * simultanea tiene que quedarse fuera.
   */
  it('dos reservas simultáneas no venden la misma plaza', async () => {
    const local = await newGym();
    const event = await createEvent(local, { capacity: 2 });

    const outcomes = await Promise.all([
      outsideBooking(local, event.id),
      outsideBooking(local, event.id),
      outsideBooking(local, event.id),
    ]);

    const entraron = outcomes.filter((r) => r.body.booked === true).length;
    expect(entraron).toBeLessThanOrEqual(2);

    const { body } = await http
      .get(`/v1/staff/events/${event.id}`)
      .set(auth(local.owner))
      .expect(200);
    expect(body.seatsTaken).toBeLessThanOrEqual(2);
  });

  it('sin cupo declarado no se llena nunca', async () => {
    const local = await newGym();
    const event = await createEvent(local, { capacity: null });

    for (let i = 0; i < 4; i += 1) {
      expect((await outsideBooking(local, event.id)).body.booked).toBe(true);
    }

    const { body } = await http
      .get(`/v1/staff/events/${event.id}`)
      .set(auth(local.owner))
      .expect(200);
    expect(body.seatsLeft).toBeNull();
  });

  it('cancelar una plaza la libera', async () => {
    const local = await newGym();
    const event = await createEvent(local, { capacity: 1 });

    const primera = await outsideBooking(local, event.id);
    expect((await outsideBooking(local, event.id)).body.reason.code).toBe('sold_out');

    await http
      .post(
        `/v1/staff/events/registrations/${primera.body.registration.registration.id}/status`,
      )
      .set(auth(local.owner))
      .send({ status: 'canceled' })
      .expect(201);

    expect((await outsideBooking(local, event.id)).body.booked).toBe(true);
  });

  it('el cupo no puede bajar por debajo de lo ya vendido', async () => {
    const local = await newGym();
    const event = await createEvent(local, { capacity: 3 });
    await outsideBooking(local, event.id);
    await outsideBooking(local, event.id);

    const { status, body } = await http
      .post(`/v1/staff/events/${event.id}`)
      .set(auth(local.owner))
      .send({ ...baseEvent(), capacity: 1 });

    expect(status).toBe(409);
    expect(String(body.message)).toContain('2');
  });
});

suite('cobrar la plaza', () => {
  it('el de fuera paga y su plata entra en el ledger sin ser alumno', async () => {
    const local = await newGym();
    const event = await createEvent(local);
    const booking = await outsideBooking(local, event.id);
    const registrationId = booking.body.registration.registration.id as string;

    const { body: pagada } = await http
      .post(`/v1/staff/events/registrations/${registrationId}/pay`)
      .set(auth(local.owner))
      .send({ rail: 'cash' })
      .expect(201);

    expect(pagada.paid).toBe(true);
    expect(pagada.registration.membershipId).toBeNull();

    // La comprobación que importa: sale en «cobrado este mes» del dueño.
    const { body: summary } = await http
      .get('/v1/staff/summary')
      .set(auth(local.owner))
      .expect(200);
    expect(summary.collectedThisMonthCents).toBeGreaterThanOrEqual(12_000);
  });

  it('cobrar dos veces no cobra dos veces', async () => {
    const local = await newGym();
    const event = await createEvent(local);
    const booking = await outsideBooking(local, event.id);
    const registrationId = booking.body.registration.registration.id as string;

    const primera = await http
      .post(`/v1/staff/events/registrations/${registrationId}/pay`)
      .set(auth(local.owner))
      .send({ rail: 'cash' })
      .expect(201);

    const segunda = await http
      .post(`/v1/staff/events/registrations/${registrationId}/pay`)
      .set(auth(local.owner))
      .send({ rail: 'yape' })
      .expect(201);

    expect(segunda.body.registration.chargeId).toBe(primera.body.registration.chargeId);
  });

  it('la plaza del alumno sí queda colgada de su ficha', async () => {
    const local = await newGym();
    const event = await createEvent(local);
    const { membershipId, outcome } = await enrollStudent(local, event.id);

    await http
      .post(
        `/v1/staff/events/registrations/${outcome.registration.registration.id}/pay`,
      )
      .set(auth(local.owner))
      .send({ rail: 'cash' })
      .expect(201);

    const { body: record } = await http
      .get(`/v1/staff/members/${membershipId}`)
      .set(auth(local.owner))
      .expect(200);

    const cargo = record.charges.find((c: { type: string }) => c.type === 'event');
    expect(cargo.amountCents).toBe(8_000);
  });
});

suite('cancelar el evento', () => {
  it('no borra a nadie: la lista es a quién hay que avisar', async () => {
    const local = await newGym();
    const event = await createEvent(local);
    await outsideBooking(local, event.id);
    await outsideBooking(local, event.id);

    await http
      .post(`/v1/staff/events/${event.id}/status`)
      .set(auth(local.owner))
      .send({ status: 'canceled' })
      .expect(201);

    const { body: list } = await http
      .get(`/v1/staff/events/${event.id}/registrations`)
      .set(auth(local.owner))
      .expect(200);
    expect(list).toHaveLength(2);

    // Y deja de recibir reservas nuevas.
    const fresh = await outsideBooking(local, event.id);
    expect(fresh.body.reason.code).toBe('event_canceled');
  });

  it('borrar solo vale mientras nadie tenga plaza', async () => {
    const local = await newGym();
    const blank = await createEvent(local);
    await http.delete(`/v1/staff/events/${blank.id}`).set(auth(local.owner)).expect(200);

    const withPeople = await createEvent(local, { date: inDays(25) });
    await outsideBooking(local, withPeople.id);

    const { status, body } = await http
      .delete(`/v1/staff/events/${withPeople.id}`)
      .set(auth(local.owner));
    expect(status).toBe(409);
    expect(String(body.message)).toContain('Cancélalo');
  });
});

suite('la lista del día', () => {
  it('distingue quién tiene plaza de quién ya pagó, y marca asistencia', async () => {
    const local = await newGym();
    const event = await createEvent(local);
    const booking = await outsideBooking(local, event.id);
    const registrationId = booking.body.registration.registration.id as string;

    const { body: before } = await http
      .get(`/v1/staff/events/${event.id}/registrations`)
      .set(auth(local.owner));
    expect(before[0].paid).toBe(false);

    await http
      .post(`/v1/staff/events/registrations/${registrationId}/pay`)
      .set(auth(local.owner))
      .send({ rail: 'cash' })
      .expect(201);

    await http
      .post(`/v1/staff/events/registrations/${registrationId}/status`)
      .set(auth(local.owner))
      .send({ status: 'attended' })
      .expect(201);

    const { body: after } = await http
      .get(`/v1/staff/events/${event.id}/registrations`)
      .set(auth(local.owner));
    expect(after[0].paid).toBe(true);
    expect(after[0].registration.status).toBe('attended');
  });

  it('quien reservó puede volver a encontrar su plaza', async () => {
    const local = await newGym();
    const event = await createEvent(local);
    const uid = `mis-plazas-${runId}-${++contador}`;
    await outsideBooking(local, event.id, uid);

    const { body } = await http
      .post('/v1/gyms/events/mine')
      .send({ idToken: declareIdentity(uid) })
      .expect(201);

    expect(body).toHaveLength(1);
    expect(body[0].registration.eventId).toBe(event.id);
  });
});
