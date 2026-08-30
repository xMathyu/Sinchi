/**
 * La clase gratis, de punta a punta.
 *
 * Es el unico camino de alta que empieza FUERA del gimnasio, y por eso las
 * pruebas que importan no son las del camino feliz sino las de sus limites:
 * que una persona no pueda reservar dos veces en el mismo local, que el local
 * de al lado no vea sus interesados, y que un gimnasio que no ofrece clase
 * gratis no la de igual.
 *
 * Necesita `TEST_DATABASE_URL` con un rol SIN BYPASSRLS: con BYPASSRLS la
 * prueba de aislamiento pasaria sin probar nada.
 */
import { randomBytes, randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UnauthorizedException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { FirebaseVerifier, type VerifiedIdentity } from './auth/firebase';

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const suite = DATABASE_URL === undefined ? describe.skip : describe;

let app: INestApplication;
let http: ReturnType<typeof request>;

/** Firebase, sustituido: cada token declarado aqui es una persona distinta. */
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

const auth = (bearer: string) => ({ Authorization: `Bearer ${bearer}` });

/**
 * Celulares distintos por persona y por ejecucion.
 *
 * El indice unico que garantiza "una clase gratis por gimnasio" compara
 * celulares, y las reservas de una corrida sobreviven al `reset` de la siembra
 * —solo borra los gimnasios que ella misma sembro—. Un contador que empieza en
 * cero cada vez chocaria con la corrida anterior.
 */
const runId = randomInt(10_000_000, 89_000_000);
let personCounter = 0;
const nextPhone = (): string => `+51${String(runId + ++personCounter).padStart(9, '9')}`;

interface Slot {
  scheduleId: string;
  name: string;
  date: { year: number; month: number; day: number };
  startTime: string;
}

interface GymDetail {
  id: string;
  slug: string;
  name: string;
  trialClassEnabled: boolean;
  fromPriceCents: number | null;
  weeklyClasses: number;
  disciplines: string[];
  plans: { name: string; priceCents: number }[];
  schedules: { id: string }[];
  slots: Slot[];
}

const iso = (d: Slot['date']): string =>
  `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;

/** Reserva como alguien que todavia no tiene ficha en ningun padron. */
const reservar = async (
  slug: string,
  input: { token: string; slot: Slot; fullName?: string; phone?: string },
): Promise<request.Response> =>
  http.post(`/v1/gyms/${slug}/trial`).send({
    idToken: input.token,
    fullName: input.fullName ?? 'Persona Interesada',
    phone: input.phone ?? nextPhone(),
    classScheduleId: input.slot.scheduleId,
    date: iso(input.slot.date),
  });

let novaFrontDesk = '';
let shotokanFrontDesk = '';
let nova: GymDetail;

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

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(FirebaseVerifier)
    .useValue(fakeVerifier)
    .compile();

  app = moduleRef.createNestApplication();
  configureApp(app, loadEnv());
  await app.init();
  http = request(app.getHttpServer());

  const login = async (phone: string): Promise<string> => {
    const { body } = await http.post('/v1/auth/dev-login').send({ phone }).expect(201);
    return body.accessToken as string;
  };

  novaFrontDesk = await login('+51987000222'); // Carlos, Nova BJJ
  shotokanFrontDesk = await login('+51987000111'); // Ana, Dojo Shotokan

  const { body } = await http.get('/v1/gyms/nova-bjj').expect(200);
  nova = body as GymDetail;
});

afterAll(async () => {
  await app?.close();
});

suite('directorio publico', () => {
  it('lista los gimnasios activos sin pedir sesion', async () => {
    const { body } = await http.get('/v1/gyms').expect(200);
    const slugs = (body as GymDetail[]).map((gym) => gym.slug);

    expect(slugs).toContain('nova-bjj');
    expect(slugs).toContain('dojo-shotokan');
  });

  it('cada tarjeta trae desde cuanto y que se entrena', async () => {
    const { body } = await http.get('/v1/gyms').expect(200);
    const gym = (body as GymDetail[]).find((row) => row.slug === 'nova-bjj')!;

    // Sin esto la lista es un menu de nombres: nadie elige un gimnasio del que
    // no sabe ni el precio ni si dan lo que busca.
    expect(gym.fromPriceCents).toBeGreaterThan(0);
    expect(gym.weeklyClasses).toBeGreaterThan(0);
    expect(gym.disciplines.length).toBeGreaterThan(0);
  });

  it('la pagina del gimnasio trae horarios, precios y clases con fecha', async () => {
    expect(nova.plans.length).toBeGreaterThan(0);
    expect(nova.schedules.length).toBeGreaterThan(0);
    expect(nova.slots.length).toBeGreaterThan(0);
    expect(nova.trialClassEnabled).toBe(true);
  });

  it('no ofrece horas de un gimnasio que no da clase gratis', async () => {
    const { body } = await http.get('/v1/gyms/dojo-shotokan').expect(200);
    expect((body as GymDetail).trialClassEnabled).toBe(false);
    expect((body as GymDetail).slots).toEqual([]);
  });

  it('un gimnasio que no existe es 404, no una pagina vacia', async () => {
    await http.get('/v1/gyms/no-existe').expect(404);
  });
});

suite('reservar la clase gratis', () => {
  it('alguien sin cuenta en ningun gimnasio queda anotado', async () => {
    const token = declareIdentity(`prospecto-${runId}-1`);
    const { body, status } = await reservar('nova-bjj', {
      token,
      slot: nova.slots[0]!,
      fullName: 'Ana Interesada',
    });

    expect(status).toBe(201);
    expect(body.booked).toBe(true);
    expect(body.booking.fullName).toBe('Ana Interesada');
    expect(body.booking.className).toBe(nova.slots[0]!.name);
    expect(body.booking.status).toBe('booked');
  });

  it('es una por gimnasio: la segunda dice cual ya tiene', async () => {
    const token = declareIdentity(`prospecto-${runId}-2`);
    const phone = nextPhone();

    const primera = await reservar('nova-bjj', { token, slot: nova.slots[0]!, phone });
    expect(primera.body.booked).toBe(true);

    const segunda = await reservar('nova-bjj', {
      token,
      slot: nova.slots[nova.slots.length - 1]!,
      phone,
    });

    // 200 y no 4xx: no es un error de la peticion, es el resultado del negocio.
    expect(segunda.body.booked).toBe(false);
    expect(segunda.body.reason.code).toBe('already_booked');
    expect(segunda.body.message.detail).toContain(nova.slots[0]!.startTime);
  });

  it('el mismo celular con otra cuenta tampoco reserva dos veces', async () => {
    const phone = nextPhone();
    const primera = await reservar('nova-bjj', {
      token: declareIdentity(`prospecto-${runId}-3a`),
      slot: nova.slots[0]!,
      phone,
    });
    expect(primera.body.booked).toBe(true);

    // Volver a entrar con otra cuenta de Google es cuestion de un minuto; el
    // celular es lo que de verdad identifica a la persona.
    const segunda = await reservar('nova-bjj', {
      token: declareIdentity(`prospecto-${runId}-3b`),
      slot: nova.slots[0]!,
      phone,
    });
    expect(segunda.body.booked).toBe(false);
    expect(segunda.body.reason.code).toBe('already_booked');
  });

  it('una clase gratis por gimnasio, no una en total', async () => {
    const token = declareIdentity(`prospecto-${runId}-4`);
    const phone = nextPhone();

    await reservar('nova-bjj', { token, slot: nova.slots[0]!, phone });

    const { body: iron } = await http.get('/v1/gyms/iron-muay-thai').expect(200);
    const otra = await reservar('iron-muay-thai', {
      token,
      slot: (iron as GymDetail).slots[0]!,
      phone,
    });

    expect(otra.body.booked).toBe(true);
  });

  it('un gimnasio que no la ofrece no la da igual', async () => {
    const { body: shotokan } = await http.get('/v1/gyms/dojo-shotokan').expect(200);
    // Sin horarios publicados no hay ni que elegir; se manda uno de Nova para
    // comprobar que lo que rechaza es la politica del local y no la falta de
    // opciones.
    const { body } = await reservar('dojo-shotokan', {
      token: declareIdentity(`prospecto-${runId}-5`),
      slot: nova.slots[0]!,
    });

    expect((shotokan as GymDetail).trialClassEnabled).toBe(false);
    expect(body.booked).toBe(false);
    expect(body.reason.code).toBe('not_offered');
  });

  it('rechaza una fecha en la que esa clase no se dicta', async () => {
    const slot = nova.slots[0]!;
    const { body } = await http.post('/v1/gyms/nova-bjj/trial').send({
      idToken: declareIdentity(`prospecto-${runId}-6`),
      fullName: 'Fecha Equivocada',
      phone: nextPhone(),
      classScheduleId: slot.scheduleId,
      // Un año atrás: ninguna clase se dicta en el pasado.
      date: `${slot.date.year - 1}-${String(slot.date.month).padStart(2, '0')}-${String(slot.date.day).padStart(2, '0')}`,
    });

    expect(body.booked).toBe(false);
    expect(body.reason.code).toBe('slot_not_available');
  });

  it('sin nombre ni celular no se puede avisar a nadie', async () => {
    await http
      .post('/v1/gyms/nova-bjj/trial')
      .send({
        idToken: declareIdentity(`prospecto-${runId}-7`),
        classScheduleId: nova.slots[0]!.scheduleId,
        date: iso(nova.slots[0]!.date),
      })
      .expect(400);
  });

  it('un token de Firebase invalido no gasta la clase de nadie', async () => {
    await http
      .post('/v1/gyms/nova-bjj/trial')
      .send({
        idToken: `inventado.${'x'.repeat(120)}`,
        fullName: 'Nadie',
        phone: nextPhone(),
        classScheduleId: nova.slots[0]!.scheduleId,
        date: iso(nova.slots[0]!.date),
      })
      .expect(401);
  });

  it('quien ya entrena ahi no reserva una clase de prueba', async () => {
    // Mathyu tiene membresia en Nova: la clase gratis es para conocer un local
    // nuevo, no un descuento para el alumno de la casa.
    const { body: sesion } = await http
      .post('/v1/auth/dev-login')
      .send({ phone: '+51987654321' })
      .expect(201);

    const { body } = await http
      .post('/v1/me/trials')
      .set(auth(sesion.accessToken))
      .send({
        slug: 'nova-bjj',
        classScheduleId: nova.slots[0]!.scheduleId,
        date: iso(nova.slots[0]!.date),
      });

    expect(body.booked).toBe(false);
    expect(body.reason.code).toBe('already_member');
  });
});

suite('lo que ve el gimnasio', () => {
  it('la reserva sale en la lista del mostrador con dia y hora', async () => {
    const token = declareIdentity(`prospecto-${runId}-8`);
    const slot = nova.slots[0]!;
    const { body: reserva } = await reservar('nova-bjj', {
      token,
      slot,
      fullName: 'Visible Enlalista',
    });
    expect(reserva.booked).toBe(true);

    const { body } = await http.get('/v1/staff/trials').set(auth(novaFrontDesk)).expect(200);
    const fila = (body as { id: string; fullName: string; startTime: string; phone: string }[]).find(
      (row) => row.id === reserva.booking.id,
    );

    expect(fila).toBeDefined();
    expect(fila!.fullName).toBe('Visible Enlalista');
    expect(fila!.startTime).toBe(slot.startTime);
    // El celular es lo que convierte la lista en algo accionable.
    expect(fila!.phone.length).toBeGreaterThan(6);
  });

  /** El control que sostiene todo lo demas: un local no ve los leads del otro. */
  it('el gimnasio de al lado no ve esos interesados', async () => {
    const { body: reserva } = await reservar('nova-bjj', {
      token: declareIdentity(`prospecto-${runId}-9`),
      slot: nova.slots[0]!,
    });

    const { body } = await http.get('/v1/staff/trials').set(auth(shotokanFrontDesk)).expect(200);
    const ids = (body as { id: string }[]).map((row) => row.id);

    expect(ids).not.toContain(reserva.booking.id);
  });

  it('el mostrador marca quien vino', async () => {
    const { body: reserva } = await reservar('nova-bjj', {
      token: declareIdentity(`prospecto-${runId}-10`),
      slot: nova.slots[0]!,
    });

    const { body } = await http
      .post(`/v1/staff/trials/${reserva.booking.id}/status`)
      .set(auth(novaFrontDesk))
      .send({ status: 'attended' })
      .expect(201);

    expect(body.status).toBe('attended');
  });

  it('un mostrador ajeno no puede tocar una reserva que no es suya', async () => {
    const { body: reserva } = await reservar('nova-bjj', {
      token: declareIdentity(`prospecto-${runId}-11`),
      slot: nova.slots[0]!,
    });

    await http
      .post(`/v1/staff/trials/${reserva.booking.id}/status`)
      .set(auth(shotokanFrontDesk))
      .send({ status: 'no_show' })
      .expect(404);
  });

  it('la lista exige sesion de staff', async () => {
    await http.get('/v1/staff/trials').expect(401);
  });
});

suite('lo que ve quien reservo', () => {
  it('vuelve a encontrar su reserva con la misma cuenta', async () => {
    const token = declareIdentity(`prospecto-${runId}-12`);
    const { body: reserva } = await reservar('nova-bjj', { token, slot: nova.slots[0]! });

    const { body } = await http.post('/v1/gyms/trials/mine').send({ idToken: token }).expect(201);
    const mias = body as { id: string; gymName: string }[];

    expect(mias.map((row) => row.id)).toContain(reserva.booking.id);
    // El nombre del gimnasio viaja con la reserva: quien la mira puede tenerlas
    // en tres locales distintos y no tiene contexto de ninguno.
    expect(mias[0]!.gymName).toBeTruthy();
  });

  it('otra cuenta no ve las reservas ajenas', async () => {
    const { body: reserva } = await reservar('nova-bjj', {
      token: declareIdentity(`prospecto-${runId}-13`),
      slot: nova.slots[0]!,
    });

    const { body } = await http
      .post('/v1/gyms/trials/mine')
      .send({ idToken: declareIdentity(`prospecto-${runId}-14`) })
      .expect(201);

    expect((body as { id: string }[]).map((row) => row.id)).not.toContain(reserva.booking.id);
  });

  it('cancelar libera el cupo del gimnasio', async () => {
    const token = declareIdentity(`prospecto-${runId}-15`);
    const phone = nextPhone();
    const { body: primera } = await reservar('nova-bjj', { token, slot: nova.slots[0]!, phone });

    await http
      .post(`/v1/gyms/trials/${primera.booking.id}/cancel`)
      .send({ idToken: token })
      .expect(201);

    // Quien avisa que no puede el martes merece poder venir el jueves.
    const segunda = await reservar('nova-bjj', {
      token,
      slot: nova.slots[nova.slots.length - 1]!,
      phone,
    });
    expect(segunda.body.booked).toBe(true);
  });

  it('nadie cancela la reserva de otro', async () => {
    const { body: reserva } = await reservar('nova-bjj', {
      token: declareIdentity(`prospecto-${runId}-16`),
      slot: nova.slots[0]!,
    });

    await http
      .post(`/v1/gyms/trials/${reserva.booking.id}/cancel`)
      .send({ idToken: declareIdentity(`prospecto-${runId}-17`) })
      .expect(404);
  });
});
