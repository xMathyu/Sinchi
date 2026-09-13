/**
 * Los horarios del dueno, de punta a punta.
 *
 * Lo que se comprueba aqui y en ningun otro sitio es la CADENA COMPLETA que un
 * gimnasio nuevo tenia rota: `class_schedules` solo la sabia llenar un script
 * nuestro, asi que el local que se daba de alta desde la app nacia con sus
 * planes y con cero bloques, y sin bloques su ficha publica no tiene ni una hora
 * que reservar. La tarjeta del directorio le ofrecia "1 clase gratis" a quien la
 * abria y la pantalla de dentro contestaba "este gimnasio todavia no publico sus
 * horarios": la unica via de alta que empieza FUERA del local estaba muerta para
 * todos los locales nuevos, y el dueno no tenia donde arreglarlo.
 *
 * Por eso el test que importa no es "el POST devuelve 201" sino el de abajo del
 * todo: alguien que no es nadie en la red reserva su primera clase en un
 * gimnasio que se dio de alta hace un minuto.
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
  readonly slug: string;
  readonly owner: string;
}

let taxIdIndex = 0;

async function newGym(): Promise<Local> {
  const uid = `dueno-horarios-${runId}-${++contador}`;
  const { body, status } = await http.post('/v1/gyms/signup').send({
    idToken: declareIdentity(uid),
    gymName: `Dojo Horarios ${runId} ${contador}`,
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

/**
 * Una recepcionista de verdad en ese local.
 *
 * Se inserta a mano porque el alta solo crea al dueno, y sin ella no hay forma
 * de comprobar lo que mas importa del permiso: que recepcion LEA el horario —lo
 * necesita en la puerta— y no pueda cambiarlo.
 */
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

/**
 * Lo que se manda al CREAR, con los dias en plural.
 *
 * `POST /staff/schedules` escribe un bloque por dia marcado, asi que la
 * respuesta es siempre una LISTA — tambien con un solo dia. `publish` la
 * deshace para las pruebas que solo miran el bloque.
 */
const baseBlock = {
  name: 'Muay Thai principiantes',
  weekdays: [1],
  startTime: '19:00',
  endTime: '20:30',
  capacity: 20,
  instructor: 'Sergio',
  active: true,
};

/** Lo mismo en singular, que es lo que acepta EDITAR un bloque. */
const editedBlock = (extra: Record<string, unknown> = {}) => {
  const { weekdays, ...rest } = baseBlock;
  return { ...rest, weekday: weekdays[0], ...extra };
};

/** Publica marcando un solo dia y devuelve ese bloque. */
async function publish(local: Local, extra: Record<string, unknown> = {}) {
  const { body } = await http
    .post('/v1/staff/schedules')
    .set(auth(local.owner))
    .send({ ...baseBlock, ...extra })
    .expect(201);
  return body[0];
}

/** Un bloque en cada dia de la semana: garantiza que siempre haya cupo cercano. */
async function publishWholeWeek(local: Local): Promise<void> {
  for (const weekday of [1, 2, 3, 4, 5, 6, 7]) {
    await http
      .post('/v1/staff/schedules')
      .set(auth(local.owner))
      .send({ ...baseBlock, weekdays: [weekday] })
      .expect(201);
  }
}

const recordOf = async (slug: string) => (await http.get(`/v1/gyms/${slug}`).expect(200)).body;

const cardOf = async (slug: string) => {
  const { body } = await http.get('/v1/gyms').expect(200);
  return body.find((g: { slug: string }) => g.slug === slug);
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

suite('un gimnasio nuevo nace sin horario, y puede escribirlo', () => {
  it('nace con la lista vacía y sin una sola hora reservable', async () => {
    const local = await newGym();

    const { body: list } = await http
      .get('/v1/staff/schedules/all')
      .set(auth(local.owner))
      .expect(200);
    expect(list).toEqual([]);

    // Este es el estado que dejaba muerta la clase gratis: la ficha ofrece la
    // clase de prueba y no tiene ni un cupo que ofrecer.
    const record = await recordOf(local.slug);
    expect(record.trialClassEnabled).toBe(true);
    expect(record.schedules).toEqual([]);
    expect(record.slots).toEqual([]);
  });

  it('el dueño publica uno y sale en su ficha y en el directorio', async () => {
    const local = await newGym();

    const created = await publish(local);

    expect(created.name).toBe(baseBlock.name);
    expect(created.weekday).toBe(1);
    expect(created.capacity).toBe(20);

    const record = await recordOf(local.slug);
    expect(record.schedules).toHaveLength(1);
    expect(record.slots.length).toBeGreaterThan(0);

    // Antes salia "0 clases por semana" y sin disciplinas, que es como se ve un
    // local cerrado.
    const card = await cardOf(local.slug);
    expect(card.weeklyClasses).toBe(1);
    expect(card.disciplines).toEqual([baseBlock.name]);
  });

  it('la lista del mostrador solo trae los activos; la del dueño, todos', async () => {
    const local = await newGym();
    const created = await publish(local);

    await http
      .post(`/v1/staff/schedules/${created.id}/active`)
      .set(auth(local.owner))
      .send({ active: false })
      .expect(201);

    // El escaner valida contra lo que el local da HOY: un bloque archivado
    // abriria la puerta a deshora.
    const { body: frontDesk } = await http
      .get('/v1/staff/schedules')
      .set(auth(local.owner))
      .expect(200);
    expect(frontDesk).toEqual([]);

    const { body: ownerToken } = await http
      .get('/v1/staff/schedules/all')
      .set(auth(local.owner))
      .expect(200);
    expect(ownerToken).toHaveLength(1);
    expect(ownerToken[0].active).toBe(false);

    // Y desaparece de la ficha publica: no se ofrece lo que no se da.
    const record = await recordOf(local.slug);
    expect(record.schedules).toEqual([]);
  });

  it('reactivar lo devuelve al horario sin volver a teclearlo', async () => {
    const local = await newGym();
    const created = await publish(local);

    await http
      .post(`/v1/staff/schedules/${created.id}/active`)
      .set(auth(local.owner))
      .send({ active: false })
      .expect(201);
    await http
      .post(`/v1/staff/schedules/${created.id}/active`)
      .set(auth(local.owner))
      .send({ active: true })
      .expect(201);

    const record = await recordOf(local.slug);
    expect(record.schedules).toHaveLength(1);
    expect(record.schedules[0].name).toBe(baseBlock.name);
  });

  /**
   * Lo pidieron los primeros duenos: «que se puedan elegir varios dias».
   *
   * El dojo que da muay thai lunes, miercoles y viernes a las 19:00 tenia que
   * teclear seis campos tres veces, y el tercero se abandona: el horario queda
   * a medias y el directorio anuncia una clase por semana donde hay tres.
   */
  it('publica la misma clase en varios días de una vez', async () => {
    const local = await newGym();

    const { body: created } = await http
      .post('/v1/staff/schedules')
      .set(auth(local.owner))
      .send({ ...baseBlock, weekdays: [1, 3, 5] })
      .expect(201);

    expect(created).toHaveLength(3);
    expect(created.map((b: { weekday: number }) => b.weekday).sort()).toEqual([1, 3, 5]);
    // Misma hora, mismo nombre, mismo aforo: lo unico que cambia es el dia.
    expect(new Set(created.map((b: { startTime: string }) => b.startTime)).size).toBe(1);

    const card = await cardOf(local.slug);
    expect(card.weeklyClasses).toBe(3);
    // Tres bloques de la misma clase son UNA disciplina, no tres.
    expect(card.disciplines).toEqual([baseBlock.name]);
  });

  /**
   * Son tres bloques y no uno con tres dias, y eso es lo que hace posible la
   * otra mitad de lo que se pidio: «puede variar la hora».
   */
  it('cada día queda por separado: cambiarle la hora a uno no toca los otros', async () => {
    const local = await newGym();
    const { body: created } = await http
      .post('/v1/staff/schedules')
      .set(auth(local.owner))
      .send({ ...baseBlock, weekdays: [1, 5] })
      .expect(201);

    const viernes = created.find((b: { weekday: number }) => b.weekday === 5);
    await http
      .post(`/v1/staff/schedules/${viernes.id}`)
      .set(auth(local.owner))
      .send(editedBlock({ weekday: 5, startTime: '18:00', endTime: '19:30' }))
      .expect(201);

    const { body: all } = await http
      .get('/v1/staff/schedules/all')
      .set(auth(local.owner))
      .expect(200);

    const byDay = new Map(
      all.map((h: { schedule: { weekday: number; startTime: string } }) => [
        h.schedule.weekday,
        h.schedule.startTime,
      ]),
    );
    expect(byDay.get(5)).toBe('18:00');
    expect(byDay.get(1)).toBe('19:00');
  });

  it('el día repetido no duplica el bloque', async () => {
    // Dos veces el martes es el mismo martes, y dos bloques idénticos salen en
    // el directorio como dos clases distintas.
    const local = await newGym();
    const { body: created } = await http
      .post('/v1/staff/schedules')
      .set(auth(local.owner))
      .send({ ...baseBlock, weekdays: [2, 2, 2] })
      .expect(201);

    expect(created).toHaveLength(1);
  });

  it('sin ningún día no publica nada', async () => {
    const local = await newGym();
    await http
      .post('/v1/staff/schedules')
      .set(auth(local.owner))
      .send({ ...baseBlock, weekdays: [] })
      .expect(400);
  });

  it('editar cambia lo que se ofrece de aquí en adelante', async () => {
    const local = await newGym();
    const created = await publish(local);

    const { body: edited } = await http
      .post(`/v1/staff/schedules/${created.id}`)
      .set(auth(local.owner))
      .send(editedBlock({ name: 'Muay Thai avanzados', startTime: '20:00', endTime: '21:30' }))
      .expect(201);

    expect(edited.id).toBe(created.id);
    expect(edited.name).toBe('Muay Thai avanzados');
    expect(edited.startTime).toBe('20:00');
  });
});

suite('lo que el horario no acepta', () => {
  it('rechaza la clase que termina antes de empezar, con su motivo', async () => {
    const local = await newGym();
    const { body } = await http
      .post('/v1/staff/schedules')
      .set(auth(local.owner))
      .send({ ...baseBlock, startTime: '20:00', endTime: '19:00' })
      .expect(400);

    // El texto del dominio, no un error de la base: es el mismo que apaga el
    // boton en la app.
    expect(body.message).toContain('terminar antes de empezar');
  });

  it('rechaza el bloque de duración cero', async () => {
    const local = await newGym();
    await http
      .post('/v1/staff/schedules')
      .set(auth(local.owner))
      .send({ ...baseBlock, startTime: '19:00', endTime: '19:00' })
      .expect(400);
  });

  it('rechaza el día que no existe', async () => {
    const local = await newGym();
    await http
      .post('/v1/staff/schedules')
      .set(auth(local.owner))
      .send({ ...baseBlock, weekdays: [8] })
      .expect(400);
  });

  it('rechaza el aforo de cero', async () => {
    const local = await newGym();
    await http
      .post('/v1/staff/schedules')
      .set(auth(local.owner))
      .send({ ...baseBlock, capacity: 0 })
      .expect(400);
  });

  it('no encuentra el bloque de otro gimnasio', async () => {
    const uno = await newGym();
    const other = await newGym();
    const created = await publish(uno);

    // Aislamiento por tenant: para el otro local ese bloque no existe.
    await http
      .post(`/v1/staff/schedules/${created.id}`)
      .set(auth(other.owner))
      .send(editedBlock())
      .expect(404);
  });
});

suite('quién puede tocarlo', () => {
  it('recepción lo lee —lo necesita en la puerta— pero no lo escribe', async () => {
    const local = await newGym();
    await http.post('/v1/staff/schedules').set(auth(local.owner)).send(baseBlock).expect(201);

    const frontDesk = await frontDeskToken(local.tenantId);

    await http.get('/v1/staff/schedules').set(auth(frontDesk)).expect(200);

    await http.post('/v1/staff/schedules').set(auth(frontDesk)).send(baseBlock).expect(403);
    await http.get('/v1/staff/schedules/all').set(auth(frontDesk)).expect(403);
  });

  it('sin sesión no se escribe nada', async () => {
    await http.post('/v1/staff/schedules').send(baseBlock).expect(401);
  });
});

suite('lo que el dueño necesita saber antes de tocarlo', () => {
  it('avisa de los bloques que se pisan, sin impedirlos', async () => {
    const local = await newGym();
    // Dos tatamis, dos clases a las 19:00 del lunes: legitimo, y por eso se
    // permite. Lo que no puede pasar es que se entere al ver el horario.
    await http.post('/v1/staff/schedules').set(auth(local.owner)).send(baseBlock).expect(201);
    await http
      .post('/v1/staff/schedules')
      .set(auth(local.owner))
      .send({ ...baseBlock, name: 'Judo adultos', startTime: '20:00', endTime: '21:00' })
      .expect(201);

    const { body } = await http
      .get('/v1/staff/schedules/all')
      .set(auth(local.owner))
      .expect(200);
    expect(body).toHaveLength(2);
    expect(body.every((h: { overlaps: boolean }) => h.overlaps)).toBe(true);
  });

  it('no marca solape entre días distintos ni al tocarse en el borde', async () => {
    const local = await newGym();
    await http.post('/v1/staff/schedules').set(auth(local.owner)).send(baseBlock).expect(201);
    await http
      .post('/v1/staff/schedules')
      .set(auth(local.owner))
      .send({ ...baseBlock, weekdays: [2] })
      .expect(201);
    // Empieza justo cuando la del lunes acaba: horario seguido, no choque.
    await http
      .post('/v1/staff/schedules')
      .set(auth(local.owner))
      .send({ ...baseBlock, name: 'Clinch', startTime: '20:30', endTime: '21:30' })
      .expect(201);

    const { body } = await http.get('/v1/staff/schedules/all').set(auth(local.owner));
    expect(body.every((h: { overlaps: boolean }) => !h.overlaps)).toBe(true);
  });
});

suite('el directorio no anuncia una clase suelta como mensualidad', () => {
  /**
   * La tarjeta lee `fromPriceCents` como "desde X al mes", y una clase suelta no
   * es un mes. Un local con la mensualidad en S/ 120 y la clase suelta en S/ 25
   * salia anunciado como "desde S/ 25 al mes" — cinco veces menos, y en la
   * pantalla donde la gente compara dojos.
   */
  it('el «desde» sale de la mensualidad más barata, no del drop_in', async () => {
    const local = await newGym();
    await http.post('/v1/staff/schedules').set(auth(local.owner)).send(baseBlock).expect(201);

    // Las DOS las escribe el dueño: el alta ya no crea ninguna tarifa.
    await http
      .post('/v1/staff/plans')
      .set(auth(local.owner))
      .send({
        name: 'Mensualidad',
        type: 'unlimited',
        sessionsPerWeek: null,
        allowedDays: null,
        priceCents: 12_000,
      })
      .expect(201);

    await http
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

    const { body: plans } = await http.get('/v1/staff/plans').set(auth(local.owner)).expect(200);
    const dropIn = plans.find((p: { type: string }) => p.type === 'drop_in');
    const cheapestMonthly = Math.min(
      ...plans
        .filter((p: { type: string }) => p.type !== 'drop_in')
        .map((p: { priceCents: number }) => p.priceCents),
    );
    expect(dropIn.priceCents).toBeLessThan(cheapestMonthly);

    const card = await cardOf(local.slug);
    expect(card.fromPriceCents).toBe(cheapestMonthly);

    const record = await recordOf(local.slug);
    expect(record.fromPriceCents).toBe(cheapestMonthly);
  });
});

suite('el alta no revienta con un celular ya registrado', () => {
  /**
   * Es una ruta PUBLICA y devolvia 500 «Internal server error» cuando el celular
   * chocaba con el indice unico de `users`. No es raro: quien ya entrena en otro
   * local esta ahi con ese numero, y si teclea su documento con un digito
   * cambiado no lo encuentra la busqueda que reutiliza la identidad. Un 500 no
   * le dice al dueno que corregir, y lo que se pierde es un alta.
   */
  it('responde 409 con un motivo, no 500', async () => {
    const compartido = nextPhone();
    const first = await newGym();
    expect(first.tenantId).toBeDefined();

    // Alguien que ya existe en la red con ese celular.
    const { schema, withoutTenantIsolation } = await import('./db/client');
    const { DATABASE } = await import('./db/db.module');
    await withoutTenantIsolation(app.get(DATABASE), (tx) =>
      tx
        .insert(schema.users)
        .values({ name: 'Ya estaba', documentId: nextValue(), phone: compartido }),
    );

    const uid = `dueno-choque-${runId}-${++contador}`;
    const { body, status } = await http.post('/v1/gyms/signup').send({
      idToken: declareIdentity(uid),
      gymName: `Dojo Choque ${runId} ${contador}`,
      taxId: RUC[taxIdIndex++ % RUC.length]!,
      saasTier: 'free',
      address: 'Av. Primavera 120, Surco',
      ownerName: 'Dueño con celular repetido',
      // Documento DISTINTO: si coincidiera, el alta adoptaria esa identidad y no
      // llegaria nunca al indice.
      documentId: nextValue(),
      phone: compartido,
    });

    expect(status).toBe(409);
    expect(String(body.message)).toContain('celular');
  });
});

suite('la cadena entera: alguien que no es nadie reserva en un gimnasio de hoy', () => {
  /**
   * El test que resume por que existe todo lo de arriba.
   *
   * Antes se cortaba en el paso 2: el gimnasio nacia sin horarios, no habia
   * forma de escribirlos, y la unica via de alta que empieza fuera del local
   * —la que atiende a quien todavia no entrena en ningun sitio— no se podia
   * completar en ningun gimnasio nuevo.
   */
  it('se da de alta, publica su horario, y un desconocido reserva su clase gratis', async () => {
    // 1. Cualquiera crea su gimnasio, gratis.
    const local = await newGym();

    // 2. Y publica sus clases el mismo dia, sin que nadie le siembre nada.
    await publishWholeWeek(local);

    // 3. Sale vivo en el directorio: con sus clases y su disciplina.
    const card = await cardOf(local.slug);
    expect(card.weeklyClasses).toBe(7);
    expect(card.trialClassEnabled).toBe(true);

    // 4. Su ficha ofrece horas de verdad.
    const record = await recordOf(local.slug);
    expect(record.slots.length).toBeGreaterThan(0);
    const quota = record.slots[0];

    // 5. Alguien SIN ficha en ningun padron reserva.
    const visitante = declareIdentity(`visitante-${runId}-${++contador}`);
    const isoDate = `${quota.date.year}-${String(quota.date.month).padStart(2, '0')}-${String(quota.date.day).padStart(2, '0')}`;
    const { body: trialRow } = await http
      .post(`/v1/gyms/${local.slug}/trial`)
      .send({
        idToken: visitante,
        fullName: 'Carla Visitante',
        phone: nextPhone(),
        classScheduleId: quota.scheduleId,
        date: isoDate,
      })
      .expect(201);

    expect(trialRow.booked).toBe(true);
    expect(trialRow.booking.className).toBe(baseBlock.name);

    // 6. Y el mostrador la ve venir.
    const { body: pruebas } = await http
      .get('/v1/staff/trials')
      .set(auth(local.owner))
      .expect(200);
    expect(pruebas.some((r: { fullName: string }) => r.fullName === 'Carla Visitante')).toBe(true);
  });

  /**
   * Borrar un bloque no puede llevarse por delante a quien ya reservo: la
   * reserva lleva copiada la clase y la hora, y el FK es ON DELETE set null.
   */
  it('borrar el bloque conserva la reserva que apuntaba a él', async () => {
    const local = await newGym();
    await publishWholeWeek(local);

    const record = await recordOf(local.slug);
    const quota = record.slots[0];
    const isoDate = `${quota.date.year}-${String(quota.date.month).padStart(2, '0')}-${String(quota.date.day).padStart(2, '0')}`;

    await http
      .post(`/v1/gyms/${local.slug}/trial`)
      .send({
        idToken: declareIdentity(`visitante-borrado-${runId}-${++contador}`),
        fullName: 'Quien ya reservó',
        phone: nextPhone(),
        classScheduleId: quota.scheduleId,
        date: isoDate,
      })
      .expect(201);

    // El dueño lo ve venir antes de tocarlo: es el numero que convierte
    // "borrar" en una decision y no en una apuesta.
    const { body: before } = await http.get('/v1/staff/schedules/all').set(auth(local.owner));
    const row = before.find((h: { schedule: { id: string } }) => h.schedule.id === quota.scheduleId);
    expect(row.upcomingTrials).toBe(1);

    await http
      .delete(`/v1/staff/schedules/${quota.scheduleId}`)
      .set(auth(local.owner))
      .expect(200);

    const { body: pruebas } = await http.get('/v1/staff/trials').set(auth(local.owner)).expect(200);
    const trialRow = pruebas.find((r: { fullName: string }) => r.fullName === 'Quien ya reservó');
    expect(trialRow).toBeDefined();
    expect(trialRow.className).toBe(baseBlock.name);
    expect(trialRow.startTime).toBe(baseBlock.startTime);
  });
});
