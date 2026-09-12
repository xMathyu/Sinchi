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
const siguiente = (): string => String(runId + ++contador);
const celular = (): string => `+519${siguiente().slice(0, 8)}`;

/** RUC reales: el alta comprueba el digito verificador. */
const RUC = ['20100070970', '20131312955', '20100047218'];

const auth = (bearer: string) => ({ Authorization: `Bearer ${bearer}` });

/** Los gimnasios que esta prueba crea son PERMANENTES: se borran al terminar. */
const creados: string[] = [];

interface Local {
  readonly tenantId: string;
  readonly slug: string;
  readonly dueno: string;
}

let indiceRuc = 0;

async function nuevoGimnasio(): Promise<Local> {
  const uid = `dueno-horarios-${runId}-${++contador}`;
  const { body, status } = await http.post('/v1/gyms/signup').send({
    idToken: declareIdentity(uid),
    gymName: `Dojo Horarios ${runId} ${contador}`,
    taxId: RUC[indiceRuc++ % RUC.length]!,
    saasTier: 'up_to_60',
    monthlyPriceCents: 12_000,
    ownerName: `Dueño ${uid}`,
    documentId: siguiente(),
    phone: celular(),
  });
  if (status !== 201) throw new Error(`No se pudo crear el gimnasio: ${JSON.stringify(body)}`);
  creados.push(body.tenantId as string);
  return {
    tenantId: body.tenantId as string,
    slug: body.slug as string,
    dueno: body.session.accessToken as string,
  };
}

/**
 * Una recepcionista de verdad en ese local.
 *
 * Se inserta a mano porque el alta solo crea al dueno, y sin ella no hay forma
 * de comprobar lo que mas importa del permiso: que recepcion LEA el horario —lo
 * necesita en la puerta— y no pueda cambiarlo.
 */
async function recepcion(tenantId: string): Promise<string> {
  const { schema, withTenant, withoutTenantIsolation } = await import('./db/client');
  const { DATABASE } = await import('./db/db.module');
  const db = app.get(DATABASE);
  const phone = celular();

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

const bloqueBase = {
  name: 'Muay Thai principiantes',
  weekday: 1,
  startTime: '19:00',
  endTime: '20:30',
  capacity: 20,
  instructor: 'Sergio',
  active: true,
};

/** Un bloque en cada dia de la semana: garantiza que siempre haya cupo cercano. */
async function publicarSemanaEntera(local: Local): Promise<void> {
  for (const weekday of [1, 2, 3, 4, 5, 6, 7]) {
    await http
      .post('/v1/staff/schedules')
      .set(auth(local.dueno))
      .send({ ...bloqueBase, weekday })
      .expect(201);
  }
}

const fichaDe = async (slug: string) => (await http.get(`/v1/gyms/${slug}`).expect(200)).body;

const tarjetaDe = async (slug: string) => {
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
  if (app !== undefined && creados.length > 0) {
    const { schema, withoutTenantIsolation } = await import('./db/client');
    const { DATABASE } = await import('./db/db.module');
    await withoutTenantIsolation(app.get(DATABASE), (tx) =>
      tx.delete(schema.tenants).where(inArray(schema.tenants.id, creados)),
    );
  }
  await app?.close();
});

suite('un gimnasio nuevo nace sin horario, y puede escribirlo', () => {
  it('nace con la lista vacía y sin una sola hora reservable', async () => {
    const local = await nuevoGimnasio();

    const { body: lista } = await http
      .get('/v1/staff/schedules/all')
      .set(auth(local.dueno))
      .expect(200);
    expect(lista).toEqual([]);

    // Este es el estado que dejaba muerta la clase gratis: la ficha ofrece la
    // clase de prueba y no tiene ni un cupo que ofrecer.
    const ficha = await fichaDe(local.slug);
    expect(ficha.trialClassEnabled).toBe(true);
    expect(ficha.schedules).toEqual([]);
    expect(ficha.slots).toEqual([]);
  });

  it('el dueño publica uno y sale en su ficha y en el directorio', async () => {
    const local = await nuevoGimnasio();

    const { body: creado } = await http
      .post('/v1/staff/schedules')
      .set(auth(local.dueno))
      .send(bloqueBase)
      .expect(201);

    expect(creado.name).toBe(bloqueBase.name);
    expect(creado.weekday).toBe(1);
    expect(creado.capacity).toBe(20);

    const ficha = await fichaDe(local.slug);
    expect(ficha.schedules).toHaveLength(1);
    expect(ficha.slots.length).toBeGreaterThan(0);

    // Antes salia "0 clases por semana" y sin disciplinas, que es como se ve un
    // local cerrado.
    const tarjeta = await tarjetaDe(local.slug);
    expect(tarjeta.weeklyClasses).toBe(1);
    expect(tarjeta.disciplines).toEqual([bloqueBase.name]);
  });

  it('la lista del mostrador solo trae los activos; la del dueño, todos', async () => {
    const local = await nuevoGimnasio();
    const { body: creado } = await http
      .post('/v1/staff/schedules')
      .set(auth(local.dueno))
      .send(bloqueBase)
      .expect(201);

    await http
      .post(`/v1/staff/schedules/${creado.id}/active`)
      .set(auth(local.dueno))
      .send({ active: false })
      .expect(201);

    // El escaner valida contra lo que el local da HOY: un bloque archivado
    // abriria la puerta a deshora.
    const { body: mostrador } = await http
      .get('/v1/staff/schedules')
      .set(auth(local.dueno))
      .expect(200);
    expect(mostrador).toEqual([]);

    const { body: delDueno } = await http
      .get('/v1/staff/schedules/all')
      .set(auth(local.dueno))
      .expect(200);
    expect(delDueno).toHaveLength(1);
    expect(delDueno[0].active).toBe(false);

    // Y desaparece de la ficha publica: no se ofrece lo que no se da.
    const ficha = await fichaDe(local.slug);
    expect(ficha.schedules).toEqual([]);
  });

  it('reactivar lo devuelve al horario sin volver a teclearlo', async () => {
    const local = await nuevoGimnasio();
    const { body: creado } = await http
      .post('/v1/staff/schedules')
      .set(auth(local.dueno))
      .send(bloqueBase)
      .expect(201);

    await http
      .post(`/v1/staff/schedules/${creado.id}/active`)
      .set(auth(local.dueno))
      .send({ active: false })
      .expect(201);
    await http
      .post(`/v1/staff/schedules/${creado.id}/active`)
      .set(auth(local.dueno))
      .send({ active: true })
      .expect(201);

    const ficha = await fichaDe(local.slug);
    expect(ficha.schedules).toHaveLength(1);
    expect(ficha.schedules[0].name).toBe(bloqueBase.name);
  });

  it('editar cambia lo que se ofrece de aquí en adelante', async () => {
    const local = await nuevoGimnasio();
    const { body: creado } = await http
      .post('/v1/staff/schedules')
      .set(auth(local.dueno))
      .send(bloqueBase)
      .expect(201);

    const { body: editado } = await http
      .post(`/v1/staff/schedules/${creado.id}`)
      .set(auth(local.dueno))
      .send({ ...bloqueBase, name: 'Muay Thai avanzados', startTime: '20:00', endTime: '21:30' })
      .expect(201);

    expect(editado.id).toBe(creado.id);
    expect(editado.name).toBe('Muay Thai avanzados');
    expect(editado.startTime).toBe('20:00');
  });
});

suite('lo que el horario no acepta', () => {
  it('rechaza la clase que termina antes de empezar, con su motivo', async () => {
    const local = await nuevoGimnasio();
    const { body } = await http
      .post('/v1/staff/schedules')
      .set(auth(local.dueno))
      .send({ ...bloqueBase, startTime: '20:00', endTime: '19:00' })
      .expect(400);

    // El texto del dominio, no un error de la base: es el mismo que apaga el
    // boton en la app.
    expect(body.message).toContain('terminar antes de empezar');
  });

  it('rechaza el bloque de duración cero', async () => {
    const local = await nuevoGimnasio();
    await http
      .post('/v1/staff/schedules')
      .set(auth(local.dueno))
      .send({ ...bloqueBase, startTime: '19:00', endTime: '19:00' })
      .expect(400);
  });

  it('rechaza el día que no existe', async () => {
    const local = await nuevoGimnasio();
    await http
      .post('/v1/staff/schedules')
      .set(auth(local.dueno))
      .send({ ...bloqueBase, weekday: 8 })
      .expect(400);
  });

  it('rechaza el aforo de cero', async () => {
    const local = await nuevoGimnasio();
    await http
      .post('/v1/staff/schedules')
      .set(auth(local.dueno))
      .send({ ...bloqueBase, capacity: 0 })
      .expect(400);
  });

  it('no encuentra el bloque de otro gimnasio', async () => {
    const uno = await nuevoGimnasio();
    const otro = await nuevoGimnasio();
    const { body: creado } = await http
      .post('/v1/staff/schedules')
      .set(auth(uno.dueno))
      .send(bloqueBase)
      .expect(201);

    // Aislamiento por tenant: para el otro local ese bloque no existe.
    await http
      .post(`/v1/staff/schedules/${creado.id}`)
      .set(auth(otro.dueno))
      .send(bloqueBase)
      .expect(404);
  });
});

suite('quién puede tocarlo', () => {
  it('recepción lo lee —lo necesita en la puerta— pero no lo escribe', async () => {
    const local = await nuevoGimnasio();
    await http.post('/v1/staff/schedules').set(auth(local.dueno)).send(bloqueBase).expect(201);

    const mostrador = await recepcion(local.tenantId);

    await http.get('/v1/staff/schedules').set(auth(mostrador)).expect(200);

    await http.post('/v1/staff/schedules').set(auth(mostrador)).send(bloqueBase).expect(403);
    await http.get('/v1/staff/schedules/all').set(auth(mostrador)).expect(403);
  });

  it('sin sesión no se escribe nada', async () => {
    await http.post('/v1/staff/schedules').send(bloqueBase).expect(401);
  });
});

suite('lo que el dueño necesita saber antes de tocarlo', () => {
  it('avisa de los bloques que se pisan, sin impedirlos', async () => {
    const local = await nuevoGimnasio();
    // Dos tatamis, dos clases a las 19:00 del lunes: legitimo, y por eso se
    // permite. Lo que no puede pasar es que se entere al ver el horario.
    await http.post('/v1/staff/schedules').set(auth(local.dueno)).send(bloqueBase).expect(201);
    await http
      .post('/v1/staff/schedules')
      .set(auth(local.dueno))
      .send({ ...bloqueBase, name: 'Judo adultos', startTime: '20:00', endTime: '21:00' })
      .expect(201);

    const { body } = await http
      .get('/v1/staff/schedules/all')
      .set(auth(local.dueno))
      .expect(200);
    expect(body).toHaveLength(2);
    expect(body.every((h: { overlaps: boolean }) => h.overlaps)).toBe(true);
  });

  it('no marca solape entre días distintos ni al tocarse en el borde', async () => {
    const local = await nuevoGimnasio();
    await http.post('/v1/staff/schedules').set(auth(local.dueno)).send(bloqueBase).expect(201);
    await http
      .post('/v1/staff/schedules')
      .set(auth(local.dueno))
      .send({ ...bloqueBase, weekday: 2 })
      .expect(201);
    // Empieza justo cuando la del lunes acaba: horario seguido, no choque.
    await http
      .post('/v1/staff/schedules')
      .set(auth(local.dueno))
      .send({ ...bloqueBase, name: 'Clinch', startTime: '20:30', endTime: '21:30' })
      .expect(201);

    const { body } = await http.get('/v1/staff/schedules/all').set(auth(local.dueno));
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
    const local = await nuevoGimnasio();
    await http.post('/v1/staff/schedules').set(auth(local.dueno)).send(bloqueBase).expect(201);

    // La clase suelta la escribe el dueño: el alta solo crea la mensualidad.
    await http
      .post('/v1/staff/plans')
      .set(auth(local.dueno))
      .send({
        name: 'Clase suelta',
        type: 'drop_in',
        sessionsPerWeek: null,
        allowedDays: null,
        priceCents: 2_500,
      })
      .expect(201);

    const { body: planes } = await http.get('/v1/staff/plans').set(auth(local.dueno)).expect(200);
    const suelta = planes.find((p: { type: string }) => p.type === 'drop_in');
    const mensualMasBarata = Math.min(
      ...planes
        .filter((p: { type: string }) => p.type !== 'drop_in')
        .map((p: { priceCents: number }) => p.priceCents),
    );
    expect(suelta.priceCents).toBeLessThan(mensualMasBarata);

    const tarjeta = await tarjetaDe(local.slug);
    expect(tarjeta.fromPriceCents).toBe(mensualMasBarata);

    const ficha = await fichaDe(local.slug);
    expect(ficha.fromPriceCents).toBe(mensualMasBarata);
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
    const compartido = celular();
    const primero = await nuevoGimnasio();
    expect(primero.tenantId).toBeDefined();

    // Alguien que ya existe en la red con ese celular.
    const { schema, withoutTenantIsolation } = await import('./db/client');
    const { DATABASE } = await import('./db/db.module');
    await withoutTenantIsolation(app.get(DATABASE), (tx) =>
      tx
        .insert(schema.users)
        .values({ name: 'Ya estaba', documentId: siguiente(), phone: compartido }),
    );

    const uid = `dueno-choque-${runId}-${++contador}`;
    const { body, status } = await http.post('/v1/gyms/signup').send({
      idToken: declareIdentity(uid),
      gymName: `Dojo Choque ${runId} ${contador}`,
      taxId: RUC[indiceRuc++ % RUC.length]!,
      saasTier: 'free',
      monthlyPriceCents: 12_000,
      ownerName: 'Dueño con celular repetido',
      // Documento DISTINTO: si coincidiera, el alta adoptaria esa identidad y no
      // llegaria nunca al indice.
      documentId: siguiente(),
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
    const local = await nuevoGimnasio();

    // 2. Y publica sus clases el mismo dia, sin que nadie le siembre nada.
    await publicarSemanaEntera(local);

    // 3. Sale vivo en el directorio: con sus clases y su disciplina.
    const tarjeta = await tarjetaDe(local.slug);
    expect(tarjeta.weeklyClasses).toBe(7);
    expect(tarjeta.trialClassEnabled).toBe(true);

    // 4. Su ficha ofrece horas de verdad.
    const ficha = await fichaDe(local.slug);
    expect(ficha.slots.length).toBeGreaterThan(0);
    const cupo = ficha.slots[0];

    // 5. Alguien SIN ficha en ningun padron reserva.
    const visitante = declareIdentity(`visitante-${runId}-${++contador}`);
    const fecha = `${cupo.date.year}-${String(cupo.date.month).padStart(2, '0')}-${String(cupo.date.day).padStart(2, '0')}`;
    const { body: reserva } = await http
      .post(`/v1/gyms/${local.slug}/trial`)
      .send({
        idToken: visitante,
        fullName: 'Carla Visitante',
        phone: celular(),
        classScheduleId: cupo.scheduleId,
        date: fecha,
      })
      .expect(201);

    expect(reserva.booked).toBe(true);
    expect(reserva.booking.className).toBe(bloqueBase.name);

    // 6. Y el mostrador la ve venir.
    const { body: pruebas } = await http
      .get('/v1/staff/trials')
      .set(auth(local.dueno))
      .expect(200);
    expect(pruebas.some((r: { fullName: string }) => r.fullName === 'Carla Visitante')).toBe(true);
  });

  /**
   * Borrar un bloque no puede llevarse por delante a quien ya reservo: la
   * reserva lleva copiada la clase y la hora, y el FK es ON DELETE set null.
   */
  it('borrar el bloque conserva la reserva que apuntaba a él', async () => {
    const local = await nuevoGimnasio();
    await publicarSemanaEntera(local);

    const ficha = await fichaDe(local.slug);
    const cupo = ficha.slots[0];
    const fecha = `${cupo.date.year}-${String(cupo.date.month).padStart(2, '0')}-${String(cupo.date.day).padStart(2, '0')}`;

    await http
      .post(`/v1/gyms/${local.slug}/trial`)
      .send({
        idToken: declareIdentity(`visitante-borrado-${runId}-${++contador}`),
        fullName: 'Quien ya reservó',
        phone: celular(),
        classScheduleId: cupo.scheduleId,
        date: fecha,
      })
      .expect(201);

    // El dueño lo ve venir antes de tocarlo: es el numero que convierte
    // "borrar" en una decision y no en una apuesta.
    const { body: antes } = await http.get('/v1/staff/schedules/all').set(auth(local.dueno));
    const fila = antes.find((h: { schedule: { id: string } }) => h.schedule.id === cupo.scheduleId);
    expect(fila.upcomingTrials).toBe(1);

    await http
      .delete(`/v1/staff/schedules/${cupo.scheduleId}`)
      .set(auth(local.dueno))
      .expect(200);

    const { body: pruebas } = await http.get('/v1/staff/trials').set(auth(local.dueno)).expect(200);
    const reserva = pruebas.find((r: { fullName: string }) => r.fullName === 'Quien ya reservó');
    expect(reserva).toBeDefined();
    expect(reserva.className).toBe(bloqueBase.name);
    expect(reserva.startTime).toBe(bloqueBase.startTime);
  });
});
