/**
 * La biblioteca del gimnasio, de punta a punta.
 *
 * Lo que solo se comprueba aqui y no en los tests del dominio:
 *
 *  1. **que la api no entregue lo que no toca.** `checkRoutineAccess` decide
 *     bien en una prueba unitaria; lo que hay que demostrar es que el JSON que
 *     sale por el cable no lleva el enlace del video ni las instrucciones de una
 *     rutina de alumnos cuando la pide alguien de la calle. Filtrarlo en la
 *     pantalla seria decorativo;
 *  2. **que el moroso siga viendo y el que se dio de baja no.** Es la decision
 *     de producto entera, y vive en una consulta que ninguna funcion pura puede
 *     comprobar;
 *  3. **que la biblioteca de un gimnasio no se vea desde otro.** RLS no se puede
 *     probar con PGlite —ahi se corre como superusuario, que salta las
 *     politicas— asi que este es el unico sitio donde se verifica de verdad;
 *  4. **que los pasos se reescriban enteros y en orden**, que es lo que el
 *     indice unico por posicion protege.
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
import { VideoStorage, type SignedUpload } from './modules/routines/video-storage';

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

/**
 * Almacenamiento de mentira, inyectado como se inyecta `FirebaseVerifier`.
 *
 * Probar la subida de verdad exigiria un bucket real en CI. Lo que si se prueba
 * —y es lo que importa— es el CONTRATO: que se firme una URL contra la ruta
 * derivada del id, que "ya subi" se compruebe contra el almacenamiento en vez de
 * creerselo al cliente, y que la URL de reproduccion solo se firme para quien
 * pasa el control de acceso.
 */
class AlmacenamientoFalso extends VideoStorage {
  readonly enabled = true;
  /** Lo que "existe" en el bucket: ruta → bytes. */
  readonly objetos = new Map<string, number>();
  readonly firmadas: string[] = [];

  async signUpload(input: { objectPath: string }): Promise<SignedUpload> {
    return {
      url: `https://bucket.example/${input.objectPath}?firma=subida`,
      headers: { 'x-goog-content-length-range': '0,314572800' },
      expiresInSeconds: 900,
    };
  }

  async signPlayback(objectPath: string): Promise<string> {
    this.firmadas.push(objectPath);
    return `https://bucket.example/${objectPath}?firma=lectura`;
  }

  async sizeOf(objectPath: string): Promise<number | null> {
    return this.objetos.get(objectPath) ?? null;
  }

  async remove(objectPath: string): Promise<void> {
    this.objetos.delete(objectPath);
  }
}

const almacenamiento = new AlmacenamientoFalso();

const runId = randomInt(10_000_000, 89_000_000);
let contador = 0;
const siguiente = (): string => String(runId + ++contador);
const celular = (): string => `+519${siguiente().slice(0, 8)}`;

const RUC = ['20100070970', '20131312955', '20100047218'];
const auth = (bearer: string) => ({ Authorization: `Bearer ${bearer}` });
const creados: string[] = [];

interface Local {
  readonly tenantId: string;
  readonly slug: string;
  readonly dueno: string;
}

let indiceRuc = 0;

async function nuevoGimnasio(): Promise<Local> {
  const uid = `dueno-rutinas-${runId}-${++contador}`;
  const { body, status } = await http.post('/v1/gyms/signup').send({
    idToken: declareIdentity(uid),
    gymName: `Dojo Rutinas ${runId} ${contador}`,
    taxId: RUC[indiceRuc++ % RUC.length]!,
    saasTier: 'up_to_60',
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

const VIDEO = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

/**
 * Los tests que dan de alta a un alumno hacen siete viajes a la base —crear el
 * gimnasio, dos rutinas, leer planes, inscribir, iniciar sesion y leer— y contra
 * una base remota eso no cabe en los 30s de `vitest.config.ts`.
 */
const ALUMNO_TIMEOUT = 90_000;

const rutinaBase = () => ({
  title: 'Uchimata paso a paso',
  summary: 'La entrada, el desequilibrio y la caída.',
  videoUrl: VIDEO,
  level: 'beginner',
  visibility: 'public',
  published: true,
  items: [
    {
      title: 'Kumi kata',
      instructions: 'Agarra la solapa y controla la manga.',
      videoUrl: 'https://youtu.be/dQw4w9WgXcQ',
      videoAssetId: null,
      prescription: '5 minutos',
    },
  ],
});

async function crearRutina(local: Local, overrides: Record<string, unknown> = {}) {
  const { body, status } = await http
    .post('/v1/staff/routines')
    .set(auth(local.dueno))
    .send({ ...rutinaBase(), ...overrides });
  if (status !== 201) throw new Error(`No se pudo crear la rutina: ${JSON.stringify(body)}`);
  return body;
}

/** Un alumno del padrón, con su sesión puesta. */
async function nuevoAlumno(local: Local) {
  const { body: planes } = await http.get('/v1/staff/plans').set(auth(local.dueno));
  const phone = celular();
  const { body: alumno } = await http
    .post('/v1/staff/members')
    .set(auth(local.dueno))
    .send({ name: `Alumno ${siguiente()}`, documentId: siguiente(), phone, planId: planes[0].id })
    .expect(201);

  const { body: sesion } = await http.post('/v1/auth/dev-login').send({ phone }).expect(201);
  return {
    membershipId: alumno.view.membership.id as string,
    token: sesion.accessToken as string,
  };
}

/** Una sesión de mostrador en ese gimnasio. */
async function nuevaRecepcion(local: Local): Promise<string> {
  const { schema, withTenant, withoutTenantIsolation } = await import('./db/client');
  const { DATABASE } = await import('./db/db.module');
  const db = app.get(DATABASE);
  const phone = celular();

  const userId = await withoutTenantIsolation(db, async (tx) => {
    const [user] = await tx
      .insert(schema.users)
      .values({ name: 'Recepción', documentId: siguiente(), phone })
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
    .overrideProvider(VideoStorage)
    .useValue(almacenamiento)
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

suite('el dueño escribe la rutina', () => {
  it('la crea con sus pasos y sale en la biblioteca', async () => {
    const local = await nuevoGimnasio();
    const creada = await crearRutina(local);

    expect(creada.unlocked).toBe(true);
    expect(creada.card.routine.status).toBe('published');
    expect(creada.items).toHaveLength(1);

    const { body } = await http.get('/v1/staff/routines').set(auth(local.dueno)).expect(200);
    expect(body.routines).toHaveLength(1);
    expect(body.routines[0].itemCount).toBe(1);
  });

  /**
   * El dueño copia de la barra del navegador y se lleva la lista y el segundo
   * por el que iba. Guardado tal cual, el uchimata empieza por la mitad.
   */
  it('guarda el enlace canónico, no el que pegó', async () => {
    const local = await nuevoGimnasio();
    const creada = await crearRutina(local, {
      videoUrl: 'https://youtu.be/dQw4w9WgXcQ?t=42',
    });
    expect(creada.card.routine.videoUrl).toBe(VIDEO);
  });

  it('rechaza un enlace que no se entiende, con el motivo del dominio', async () => {
    const local = await nuevoGimnasio();
    const { status, body } = await http
      .post('/v1/staff/routines')
      .set(auth(local.dueno))
      .send({ ...rutinaBase(), videoUrl: 'mi video' });

    expect(status).toBe(400);
    expect(String(body.message)).toContain('enlace');
  });

  it('rechaza el título suelto: sin video, sin explicación y sin pasos', async () => {
    const local = await nuevoGimnasio();
    const { status } = await http
      .post('/v1/staff/routines')
      .set(auth(local.dueno))
      .send({ ...rutinaBase(), videoUrl: null, summary: null, items: [] });

    expect(status).toBe(400);
  });

  /**
   * Reordenar, quitar el tercero y añadir dos al final es UNA operación para
   * quien la escribe. Se reescriben enteros, y el índice único por posición es
   * lo que impide que quede un orden ambiguo.
   */
  it('reescribe los pasos enteros y respeta el orden', async () => {
    const local = await nuevoGimnasio();
    const creada = await crearRutina(local, {
      items: [
        { title: 'Uno', instructions: null, videoUrl: null, videoAssetId: null, prescription: null },
        { title: 'Dos', instructions: null, videoUrl: null, videoAssetId: null, prescription: null },
        { title: 'Tres', instructions: null, videoUrl: null, videoAssetId: null, prescription: null },
      ],
    });

    const { body } = await http
      .post(`/v1/staff/routines/${creada.card.routine.id}`)
      .set(auth(local.dueno))
      .send({
        ...rutinaBase(),
        items: [
          { title: 'Tres', instructions: null, videoUrl: null, videoAssetId: null, prescription: null },
          { title: 'Uno', instructions: null, videoUrl: null, videoAssetId: null, prescription: null },
        ],
      })
      .expect(201);

    expect(body.items.map((item: { title: string }) => item.title)).toEqual(['Tres', 'Uno']);
    expect(body.items.map((item: { position: number }) => item.position)).toEqual([0, 1]);
  });

  it('recepción la lee pero no la escribe', async () => {
    const local = await nuevoGimnasio();
    await crearRutina(local);
    const mostrador = await nuevaRecepcion(local);

    await http.get('/v1/staff/routines').set(auth(mostrador)).expect(200);
    await http.post('/v1/staff/routines').set(auth(mostrador)).send(rutinaBase()).expect(403);
  });
});

suite('quién ve qué', () => {
  /**
   * EL test. Que la regla decida bien en una función pura no prueba nada si el
   * JSON lleva el enlace igual: quien mira desde la calle recibe el anzuelo
   * —título, de qué va, cuántos pasos— y ni un video ni una instrucción.
   */
  it('la api no entrega el video de una rutina de alumnos a quien no lo es', async () => {
    const local = await nuevoGimnasio();
    const exclusiva = await crearRutina(local, {
      title: 'Serie completa de kata',
      visibility: 'members',
    });

    const { body } = await http
      .get(`/v1/gyms/${local.slug}/routines/${exclusiva.card.routine.id}`)
      .expect(200);

    expect(body.unlocked).toBe(false);
    expect(body.reason.code).toBe('members_only');
    // El anzuelo: bastante para querer entrar, nada para consumir.
    expect(body.teaser.title).toBe('Serie completa de kata');
    expect(body.teaser.itemCount).toBe(1);
    expect(JSON.stringify(body)).not.toContain('dQw4w9WgXcQ');
    expect(JSON.stringify(body)).not.toContain('Agarra la solapa');
  });

  it('la pública sí se abre entera desde la calle, sin cuenta de nada', async () => {
    const local = await nuevoGimnasio();
    const abierta = await crearRutina(local);

    const { body } = await http
      .get(`/v1/gyms/${local.slug}/routines/${abierta.card.routine.id}`)
      .expect(200);

    expect(body.unlocked).toBe(true);
    expect(body.card.routine.videoUrl).toBe(VIDEO);
    expect(body.items[0].instructions).toContain('solapa');
  });

  /**
   * «12 rutinas más para alumnos» vende la mensualidad mejor que cualquier
   * texto, y enseñar los títulos regalaría la mitad del valor.
   */
  it('la ficha del directorio cuenta lo exclusivo sin enseñarlo', async () => {
    const local = await nuevoGimnasio();
    await crearRutina(local);
    await crearRutina(local, { title: 'Kata 1', visibility: 'members' });
    await crearRutina(local, { title: 'Kata 2', visibility: 'members' });

    const { body: ficha } = await http.get(`/v1/gyms/${local.slug}`).expect(200);
    expect(ficha.routines).toHaveLength(1);
    expect(ficha.membersOnlyRoutines).toBe(2);
    expect(JSON.stringify(ficha.routines)).not.toContain('Kata');
  });

  it('el borrador no existe para nadie de fuera', async () => {
    const local = await nuevoGimnasio();
    const oculta = await crearRutina(local, { published: false });

    const { body: ficha } = await http.get(`/v1/gyms/${local.slug}`).expect(200);
    expect(ficha.routines).toHaveLength(0);
    // Ni siquiera con candado: no hay nada que vender de algo que aún no existe.
    await http.get(`/v1/gyms/${local.slug}/routines/${oculta.card.routine.id}`).expect(404);
  });

  it('el alumno del padrón ve lo suyo y lo público', async () => {
    const local = await nuevoGimnasio();
    await crearRutina(local);
    const exclusiva = await crearRutina(local, { title: 'Kata', visibility: 'members' });
    const alumno = await nuevoAlumno(local);

    const { body } = await http
      .get(`/v1/me/memberships/${alumno.membershipId}/routines`)
      .set(auth(alumno.token))
      .expect(200);

    expect(body.routines).toHaveLength(2);
    // Para quien ya las tiene, el gancho no dice nada.
    expect(body.membersOnly).toBe(0);

    const { body: ficha } = await http
      .get(`/v1/me/memberships/${alumno.membershipId}/routines/${exclusiva.card.routine.id}`)
      .set(auth(alumno.token))
      .expect(200);
    expect(ficha.unlocked).toBe(true);
    expect(ficha.card.routine.videoUrl).toBe(VIDEO);
  }, ALUMNO_TIMEOUT);

  /**
   * La decisión de producto, comprobada: al moroso ya se le cierra la puerta
   * —esa es la palanca que cobra— y quitarle además el video no recupera un sol.
   */
  it('el alumno que debe sigue viendo lo de alumnos', async () => {
    const local = await nuevoGimnasio();
    const exclusiva = await crearRutina(local, { visibility: 'members' });
    const alumno = await nuevoAlumno(local);

    const { schema, withTenant } = await import('./db/client');
    const { DATABASE } = await import('./db/db.module');
    const { eq } = await import('drizzle-orm');
    await withTenant(app.get(DATABASE), local.tenantId, (tx) =>
      tx
        .update(schema.subscriptions)
        .set({ status: 'suspended' })
        .where(eq(schema.subscriptions.membershipId, alumno.membershipId)),
    );

    const { body } = await http
      .get(`/v1/me/memberships/${alumno.membershipId}/routines/${exclusiva.card.routine.id}`)
      .set(auth(alumno.token))
      .expect(200);
    expect(body.unlocked).toBe(true);
  }, ALUMNO_TIMEOUT);

  /** La baja sí: quien se fue dejó de ser alumno. */
  it('el que se dio de baja se queda con lo público', async () => {
    const local = await nuevoGimnasio();
    await crearRutina(local);
    const exclusiva = await crearRutina(local, { title: 'Kata', visibility: 'members' });
    const alumno = await nuevoAlumno(local);

    await http
      .post(`/v1/me/memberships/${alumno.membershipId}/cancel`)
      .set(auth(alumno.token))
      .expect(201);

    const { body } = await http
      .get(`/v1/me/memberships/${alumno.membershipId}/routines`)
      .set(auth(alumno.token))
      .expect(200);
    expect(body.routines).toHaveLength(1);

    const { body: ficha } = await http
      .get(`/v1/me/memberships/${alumno.membershipId}/routines/${exclusiva.card.routine.id}`)
      .set(auth(alumno.token))
      .expect(200);
    expect(ficha.unlocked).toBe(false);
  }, ALUMNO_TIMEOUT);

  /**
   * RLS de verdad. No se puede probar con PGlite —ahí se corre como
   * superusuario, que salta las políticas— así que este es el único sitio donde
   * se comprueba que la biblioteca de un gimnasio no se ve desde otro.
   */
  it('la biblioteca de un gimnasio no se ve desde otro', async () => {
    const uno = await nuevoGimnasio();
    const otro = await nuevoGimnasio();
    const rutina = await crearRutina(uno);

    await http
      .get(`/v1/staff/routines/${rutina.card.routine.id}`)
      .set(auth(otro.dueno))
      .expect(404);

    const { body } = await http.get('/v1/staff/routines').set(auth(otro.dueno)).expect(200);
    expect(body.routines).toHaveLength(0);
  });
});

suite('publicar, cambiar de público y borrar', () => {
  it('cambia el público con un toque, sin abrir el editor', async () => {
    const local = await nuevoGimnasio();
    const rutina = await crearRutina(local);

    const { body } = await http
      .post(`/v1/staff/routines/${rutina.card.routine.id}/visibility`)
      .set(auth(local.dueno))
      .send({ visibility: 'members' })
      .expect(201);

    expect(body.visibility).toBe('members');
    const { body: ficha } = await http.get(`/v1/gyms/${local.slug}`).expect(200);
    expect(ficha.routines).toHaveLength(0);
    expect(ficha.membersOnlyRoutines).toBe(1);
  });

  /**
   * La pausa que impide que una rutina desaparezca de golpe de la app de quien
   * la estaba usando. No hay a quién avisar como en un evento con plazas
   * vendidas, pero sí quien la tenga abierta esta tarde.
   */
  it('no se borra una publicada; despublicada sí', async () => {
    const local = await nuevoGimnasio();
    const rutina = await crearRutina(local);
    const id = rutina.card.routine.id as string;

    await http.delete(`/v1/staff/routines/${id}`).set(auth(local.dueno)).expect(409);

    await http
      .post(`/v1/staff/routines/${id}/status`)
      .set(auth(local.dueno))
      .send({ status: 'draft' })
      .expect(201);

    await http.delete(`/v1/staff/routines/${id}`).set(auth(local.dueno)).expect(200);
    await http.get(`/v1/staff/routines/${id}`).set(auth(local.dueno)).expect(404);
  });
});

suite('subir el video', () => {
  /** Sube «el archivo» al bucket falso, como haría el teléfono. */
  async function subir(local: Local, bytes = 12_345) {
    const { body } = await http
      .post('/v1/staff/routines/videos')
      .set(auth(local.dueno))
      .send({ contentType: 'video/mp4', sizeBytes: bytes, originalName: 'uchimata.mp4' })
      .expect(201);

    // La ruta se deriva del gimnasio y del id, nunca del nombre del archivo.
    expect(body.uploadUrl).toContain(`gyms/${local.tenantId}/routines/${body.assetId}.mp4`);
    // El tope va firmado en la cabecera: lo aplica el almacenamiento, no la api.
    expect(body.headers['x-goog-content-length-range']).toBe('0,314572800');

    almacenamiento.objetos.set(`gyms/${local.tenantId}/routines/${body.assetId}.mp4`, bytes);
    return body.assetId as string;
  }

  it('firma la subida y confirma contra el almacenamiento', async () => {
    const local = await nuevoGimnasio();
    const assetId = await subir(local, 9_000_000);

    const { body } = await http
      .post(`/v1/staff/routines/videos/${assetId}/ready`)
      .set(auth(local.dueno))
      .expect(201);

    // El tamaño lo dice el almacenamiento, no el cliente.
    expect(body.sizeBytes).toBe(9_000_000);
  });

  /**
   * «Ya subí» es justo lo que diría quien no subió nada, y una rutina publicada
   * contra un objeto inexistente es un reproductor en negro que el dueño
   * descubre por un alumno.
   */
  it('no se cree al cliente: sin archivo en el bucket, no hay confirmación', async () => {
    const local = await nuevoGimnasio();
    const { body } = await http
      .post('/v1/staff/routines/videos')
      .set(auth(local.dueno))
      .send({ contentType: 'video/mp4' })
      .expect(201);

    await http
      .post(`/v1/staff/routines/videos/${body.assetId}/ready`)
      .set(auth(local.dueno))
      .expect(409);
  });

  it('rechaza lo que no es un video, y lo que no cabe', async () => {
    const local = await nuevoGimnasio();
    await http
      .post('/v1/staff/routines/videos')
      .set(auth(local.dueno))
      .send({ contentType: 'application/pdf' })
      .expect(400);

    await http
      .post('/v1/staff/routines/videos')
      .set(auth(local.dueno))
      .send({ contentType: 'video/mp4', sizeBytes: 400 * 1024 * 1024 })
      .expect(400);
  });

  it('recepción no sube: es material de la escuela', async () => {
    const local = await nuevoGimnasio();
    const mostrador = await nuevaRecepcion(local);
    await http
      .post('/v1/staff/routines/videos')
      .set(auth(mostrador))
      .send({ contentType: 'video/mp4' })
      .expect(403);
  });

  /**
   * EL punto entero de subir en vez de enlazar: el objeto es privado, así que
   * la única forma de verlo es una URL firmada, y la api solo la firma para
   * quien pasa `checkRoutineAccess`. Un YouTube oculto no podía dar esto.
   */
  it('el video subido solo se firma para quien tiene acceso', async () => {
    const local = await nuevoGimnasio();
    const assetId = await subir(local);
    await http
      .post(`/v1/staff/routines/videos/${assetId}/ready`)
      .set(auth(local.dueno))
      .expect(201);

    const exclusiva = await crearRutina(local, {
      title: 'Kata en video propio',
      visibility: 'members',
      videoUrl: null,
      videoAssetId: assetId,
      items: [],
    });
    const routineId = exclusiva.card.routine.id as string;

    // El dueño la abre: URL firmada.
    const { body: delDueno } = await http
      .get(`/v1/staff/routines/${routineId}`)
      .set(auth(local.dueno))
      .expect(200);
    expect(delDueno.card.routine.videoUrl).toContain('firma=lectura');

    // Desde la calle: ni la URL firmada ni la ruta del objeto.
    const { body: deLaCalle } = await http
      .get(`/v1/gyms/${local.slug}/routines/${routineId}`)
      .expect(200);
    expect(deLaCalle.unlocked).toBe(false);
    expect(JSON.stringify(deLaCalle)).not.toContain('firma=lectura');
    expect(JSON.stringify(deLaCalle)).not.toContain(assetId);
  });

  /**
   * Un video cuya subida se cayó a la mitad no tiene objeto detrás: firmar su
   * URL daría un reproductor en negro en vez de una rutina sin video.
   */
  it('un video sin confirmar no se sirve', async () => {
    const local = await nuevoGimnasio();
    const { body: pendiente } = await http
      .post('/v1/staff/routines/videos')
      .set(auth(local.dueno))
      .send({ contentType: 'video/mp4' })
      .expect(201);

    const rutina = await crearRutina(local, {
      videoUrl: null,
      videoAssetId: pendiente.assetId,
      items: [],
    });

    const { body } = await http
      .get(`/v1/staff/routines/${rutina.card.routine.id}`)
      .set(auth(local.dueno))
      .expect(200);
    expect(body.card.routine.videoUrl).toBeNull();
  });

  it('rechaza tener archivo y enlace a la vez, con el motivo del dominio', async () => {
    const local = await nuevoGimnasio();
    const assetId = await subir(local);
    const { status, body } = await http
      .post('/v1/staff/routines')
      .set(auth(local.dueno))
      .send({ ...rutinaBase(), videoAssetId: assetId });

    expect(status).toBe(400);
    expect(String(body.message)).toContain('uno de los dos');
  });

  /**
   * Sin esto, cambiar el video de un paso cinco veces deja cuatro archivos
   * pagándose para siempre en un bucket que nadie mira.
   */
  it('al quitar un video de la rutina, el archivo se borra del bucket', async () => {
    const local = await nuevoGimnasio();
    const assetId = await subir(local);
    await http
      .post(`/v1/staff/routines/videos/${assetId}/ready`)
      .set(auth(local.dueno))
      .expect(201);

    const ruta = `gyms/${local.tenantId}/routines/${assetId}.mp4`;
    const rutina = await crearRutina(local, { videoUrl: null, videoAssetId: assetId, items: [] });
    expect(almacenamiento.objetos.has(ruta)).toBe(true);

    // Se reemplaza por un enlace: el archivo ya no lo usa nadie.
    await http
      .post(`/v1/staff/routines/${rutina.card.routine.id}`)
      .set(auth(local.dueno))
      .send({ ...rutinaBase(), items: [] })
      .expect(201);

    expect(almacenamiento.objetos.has(ruta)).toBe(false);
  });
});
