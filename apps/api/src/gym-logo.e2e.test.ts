/**
 * El logo del gimnasio, de punta a punta.
 *
 * Lo que solo se comprueba aquí y no en los tests del dominio:
 *
 *  1. **que lo que se guarda es lo que dicen los bytes**, no lo que declara
 *     quien sube. Un SVG con `Content-Type: image/png` y una cabecera PNG que
 *     dice medir 20.000 × 20.000 tienen que rebotar en la api, porque la app de
 *     todo el que mira el directorio es la que abriría esa imagen;
 *  2. **que la dirección de un logo no cambie nunca de contenido.** Es lo que
 *     permite servirla con un año de caché: cambiar el logo tiene que dar otra
 *     dirección, y la vieja dejar de responder;
 *  3. **que el logo viaje con el gimnasio** a las tres pantallas que lo pintan:
 *     el directorio, la ficha y la billetera del alumno;
 *  4. **que la imagen sea pública y escribirla no.** RLS no se puede probar con
 *     PGlite —ahí se corre como superusuario— así que es aquí donde se ve que
 *     servirla sin sesión no abre ningún hueco.
 *
 * Necesita `TEST_DATABASE_URL`, igual que los demás e2e.
 */
import { randomBytes, randomInt } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UnauthorizedException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { inArray } from 'drizzle-orm';
import { gymLogoPath } from '@sinchi/shared';
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

/**
 * Un PNG de verdad, del tamaño pedido: un rojo liso con transparencia.
 *
 * Se arma con zlib y no se lee de un archivo para que el tamaño sea un
 * parámetro de la prueba. Es un PNG válido entero, no solo una cabecera: lo
 * abriría cualquier visor.
 */
function png(width: number, height: number): Buffer {
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 4, 0xd4)]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  const chunk = (type: string, data: Buffer): Buffer => {
    const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed));
    return Buffer.concat([length, typed, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Un 3 × 2 pasado a JPEG por `sips`, con su EXIF delante del tamaño. */
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAA6ADAAQAAAABAAAAAgAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAAgADAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQAAf/aAAwDAQACEQMRAD8A+c6KKK/Cz/VQ/9k=',
  'base64',
);

interface Local {
  readonly tenantId: string;
  readonly slug: string;
  readonly owner: string;
}

async function newGym(): Promise<Local> {
  const uid = `dueno-logo-${runId}-${++contador}`;
  const { body, status } = await http.post('/v1/gyms/signup').send({
    idToken: declareIdentity(uid),
    gymName: `Dojo Logo ${runId} ${contador}`,
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

const upload = (bearer: string, bytes: Buffer, contentType = 'image/png') =>
  http
    .post('/v1/staff/logo')
    .set(auth(bearer))
    .attach('logo', bytes, { filename: 'logo', contentType });

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

/** Un alumno inscrito, con su sesión. Hace falta un plan para inscribirlo. */
async function newStudent(local: Local): Promise<string> {
  const { body: plan } = await http
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
  const phone = nextPhone();
  await http
    .post('/v1/staff/members')
    .set(auth(local.owner))
    .send({ name: `Alumno ${nextValue()}`, documentId: nextValue(), phone, planId: plan.id })
    .expect(201);
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
    // El logo se va en cascada con el gimnasio.
    await withoutTenantIsolation(app.get(DATABASE), (tx) =>
      tx.delete(schema.tenants).where(inArray(schema.tenants.id, created)),
    );
  }
  await app?.close();
});

/**
 * Los tests que inscriben a un alumno hacen varios viajes a la base, y contra
 * una base remota eso no cabe en los 30s de `vitest.config.ts`.
 */
const STUDENT_TIMEOUT = 90_000;

suite('el logo del gimnasio', () => {
  it('el dueño lo sube y cualquiera lo ve, sin sesión', async () => {
    const local = await newGym();
    const imagen = png(300, 120);

    const { body } = await upload(local.owner, imagen).expect(201);
    expect(body.logoId).toEqual(expect.any(String));

    const { body: leido } = await http.get('/v1/staff/logo').set(auth(local.owner)).expect(200);
    expect(leido.logoId).toBe(body.logoId);

    const servido = await http.get(`/v1${gymLogoPath(body.logoId as string)}`).expect(200);
    expect(servido.headers['content-type']).toBe('image/png');
    expect(servido.headers['cache-control']).toContain('immutable');
    expect(servido.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(servido.body as Buffer, imagen)).toBe(0);
  });

  /**
   * La billetera y el padrón salen de la misma vista de membresía (`toTenant`):
   * el padrón es de donde la puerta saca el gimnasio, y la billetera, de donde
   * la saca el alumno. Se mira el padrón porque un alumno recién inscrito por el
   * mostrador todavía no aceptó el vínculo y su billetera está vacía.
   */
  it('sale en el directorio, en la ficha y en la vista de cada membresía', async () => {
    const local = await newGym();
    await newStudent(local);
    const { body } = await upload(local.owner, png(64, 64)).expect(201);

    const { body: directorio } = await http.get('/v1/gyms').expect(200);
    const tarjeta = (directorio as { id: string; logoId: string | null }[]).find(
      (gym) => gym.id === local.tenantId,
    );
    expect(tarjeta?.logoId).toBe(body.logoId);

    const { body: ficha } = await http.get(`/v1/gyms/${local.slug}`).expect(200);
    expect(ficha.logoId).toBe(body.logoId);

    const { body: padron } = await http.get('/v1/staff/roster').set(auth(local.owner)).expect(200);
    const entrada = (padron as { tenant: { logoId: string | null } }[])[0];
    expect(entrada?.tenant.logoId).toBe(body.logoId);
  }, STUDENT_TIMEOUT);

  it('un gimnasio sin logo lo dice con null, no con un hueco', async () => {
    const local = await newGym();
    const { body } = await http.get('/v1/staff/logo').set(auth(local.owner)).expect(200);
    expect(body.logoId).toBeNull();
    const { body: ficha } = await http.get(`/v1/gyms/${local.slug}`).expect(200);
    expect(ficha.logoId).toBeNull();
  });

  /**
   * La dirección se sirve con un año de caché. Si cambiar el logo la reusara,
   * el alumno seguiría viendo el viejo hasta reinstalar la app.
   */
  it('cambiarlo da otra dirección, y la vieja deja de servir', async () => {
    const local = await newGym();
    const { body: primero } = await upload(local.owner, png(100, 100)).expect(201);
    const { body: segundo } = await upload(local.owner, JPEG, 'image/jpeg').expect(201);

    expect(segundo.logoId).not.toBe(primero.logoId);
    await http.get(`/v1${gymLogoPath(primero.logoId as string)}`).expect(404);
    const servido = await http.get(`/v1${gymLogoPath(segundo.logoId as string)}`).expect(200);
    expect(servido.headers['content-type']).toBe('image/jpeg');
  });

  it('quitarlo devuelve al gimnasio a sus iniciales', async () => {
    const local = await newGym();
    const { body } = await upload(local.owner, png(80, 40)).expect(201);

    const { body: quitado } = await http.delete('/v1/staff/logo').set(auth(local.owner)).expect(200);
    expect(quitado.logoId).toBeNull();

    const { body: leido } = await http.get('/v1/staff/logo').set(auth(local.owner)).expect(200);
    expect(leido.logoId).toBeNull();
    await http.get(`/v1${gymLogoPath(body.logoId as string)}`).expect(404);
  });

  it('recepción lo ve, pero cambiarlo es del dueño', async () => {
    const local = await newGym();
    const frontDesk = await newFrontDesk(local);
    await upload(local.owner, png(50, 50)).expect(201);

    const { body } = await http.get('/v1/staff/logo').set(auth(frontDesk)).expect(200);
    expect(body.logoId).toEqual(expect.any(String));
    await upload(frontDesk, png(50, 50)).expect(403);
    await http.delete('/v1/staff/logo').set(auth(frontDesk)).expect(403);
  });

  it('sin sesión no se sube', async () => {
    await http
      .post('/v1/staff/logo')
      .attach('logo', png(10, 10), { filename: 'logo', contentType: 'image/png' })
      .expect(401);
  });

  /**
   * El tipo que se declara es texto que escribe el cliente. Lo que manda son los
   * bytes: un SVG puede llevar código dentro, y se serviría a todo el directorio.
   */
  it('lo que no es PNG ni JPEG no entra, aunque diga serlo', async () => {
    const local = await newGym();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const { body } = await upload(local.owner, svg, 'image/png').expect(400);
    expect(body.message).toContain('PNG o un JPG');

    const { body: leido } = await http.get('/v1/staff/logo').set(auth(local.owner)).expect(200);
    expect(leido.logoId).toBeNull();
  });

  /**
   * La bomba de descompresión: un PNG liso de 20.000 × 20.000 pesa casi nada y
   * al abrirlo ocupa gigas. La app de quien mire el directorio es la que lo
   * abriría, así que no se acepta aunque pese poco. Aquí es de 2000 × 2000 para
   * que armarla no le cueste a la prueba lo que le costaría a un teléfono.
   */
  it('una imagen de más de 512 por lado no entra, aunque pese poco', async () => {
    const local = await newGym();
    const bomba = png(2000, 2000);
    expect(bomba.length).toBeLessThan(100_000);
    const { body } = await upload(local.owner, bomba).expect(400);
    expect(body.message).toContain('512');
  });

  it('sin imagen, lo dice', async () => {
    const local = await newGym();
    const { body } = await http
      .post('/v1/staff/logo')
      .set(auth(local.owner))
      .field('otra', 'cosa')
      .expect(400);
    expect(body.message).toContain('Falta la imagen');
  });

  it('el dueño de un gimnasio no toca el logo de otro', async () => {
    const uno = await newGym();
    const otro = await newGym();
    const { body } = await upload(uno.owner, png(40, 40)).expect(201);

    // Las rutas no llevan id: el gimnasio sale del token. Quitar «el suyo» no
    // puede alcanzar al de al lado.
    await http.delete('/v1/staff/logo').set(auth(otro.owner)).expect(200);
    await http.get(`/v1${gymLogoPath(body.logoId as string)}`).expect(200);
    const { body: delOtro } = await http.get('/v1/staff/logo').set(auth(otro.owner)).expect(200);
    expect(delOtro.logoId).toBeNull();
  });

  it('una dirección que no es de ningún logo responde 404', async () => {
    await http.get(`/v1${gymLogoPath('00000000-0000-4000-8000-000000000000')}`).expect(404);
    await http.get(`/v1${gymLogoPath('no-es-un-id')}`).expect(400);
  });
});
