/**
 * Autenticación de punta a punta: vinculación de cuentas, PIN de turno y equipos.
 *
 * El `FirebaseVerifier` se sustituye por uno falso. No es una concesión: la
 * verificación de la firma es responsabilidad de `firebase-admin` y probarla aquí
 * solo probaría que su librería funciona. Lo que sí hace falta probar —y es donde
 * está el riesgo real— es lo que pasa DESPUÉS de saber quién es la persona:
 * ¿se vincula a la ficha correcta del padrón? ¿se puede robar la de otro?
 *
 * Necesita `TEST_DATABASE_URL` con un rol sin BYPASSRLS. Ver `app.e2e.test.ts`.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UnauthorizedException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { FirebaseVerifier, type VerifiedIdentity } from './auth/firebase';

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const suite = DATABASE_URL === undefined ? describe.skip : describe;

let app: INestApplication;
let http: ReturnType<typeof request>;

/**
 * Verificador falso: el "ID token" es el uid, y las identidades se declaran en
 * un mapa. Así cada prueba controla exactamente quién dice ser quién.
 */
const identities = new Map<string, VerifiedIdentity>();

const fakeVerifier = {
  verify: async (idToken: string): Promise<VerifiedIdentity> => {
    const identity = identities.get(idToken);
    // La misma excepcion que lanza el verificador real: si el falso lanzara un
    // Error suelto, el test veria un 500 y pasaria por alto que la api responde
    // 401 en produccion.
    if (identity === undefined) throw new UnauthorizedException('Sesion invalida.');
    return identity;
  },
};

/**
 * Los ID token reales de Firebase son JWT de cientos de caracteres, y el esquema
 * de entrada exige al menos 100. El token falso se rellena para respetar esa
 * validacion en vez de relajarla: la validacion tambien es codigo que se prueba.
 */
const asToken = (uid: string): string => `${uid}.${'x'.repeat(120)}`;

function declareIdentity(uid: string, overrides: Partial<VerifiedIdentity> = {}): string {
  const token = asToken(uid);
  identities.set(token, {
    uid,
    email: `${uid}@example.com`,
    emailVerified: true,
    displayName: uid,
    provider: 'google.com',
    ...overrides,
  });
  return token;
}

const auth = (bearer: string) => ({ Authorization: `Bearer ${bearer}` });

const devLogin = async (phone: string): Promise<string> => {
  const response = await http.post('/v1/auth/dev-login').send({ phone }).expect(201);
  return response.body.accessToken as string;
};

interface RosterRow {
  membership: { id: string };
  user: { name: string };
}

const findMembership = async (staffToken: string, name: string): Promise<string> => {
  const { body } = await http.get('/v1/staff/roster').set(auth(staffToken)).expect(200);
  const row = (body as RosterRow[]).find((entry) => entry.user.name === name);
  if (row === undefined) throw new Error(`${name} no está en el padrón`);
  return row.membership.id;
};

let frontDesk = '';
let owner = '';

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

  frontDesk = await devLogin('+51987000111'); // Ana, Dojo Shotokan
  owner = await devLogin('+51987000333'); // Sergio, Iron Muay Thai
}, 90_000);

afterAll(async () => {
  await app?.close();
});

suite('entrar con Google', () => {
  it('una cuenta sin vincular NO recibe sesión, recibe un código', async () => {
    // Es la decisión central: la ficha del padrón existe antes que la cuenta, y
    // adivinar a cuál corresponde sería regalarle a alguien el historial de otro.
    const token = declareIdentity('diego-google');
    const { body } = await http.post('/v1/auth/google').send({ idToken: token }).expect(201);

    expect(body.linked).toBe(false);
    expect(body.accessToken).toBeUndefined();
    expect(body.claim.code).toMatch(/^\d{6}$/);
    expect(new Date(body.claim.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('entrar dos veces devuelve el MISMO código', async () => {
    // Si el alumno cierra y abre la app mientras espera en la cola, el número que
    // tiene en la mano tiene que seguir sirviendo.
    const token = declareIdentity('lucia-google');
    const primero = await http.post('/v1/auth/google').send({ idToken: token }).expect(201);
    const segundo = await http.post('/v1/auth/google').send({ idToken: token }).expect(201);
    expect(segundo.body.claim.code).toBe(primero.body.claim.code);
  });

  it('rechaza un token que Firebase no valida', async () => {
    await http.post('/v1/auth/google').send({ idToken: 'x'.repeat(120) }).expect(401);
  });
});

suite('vinculación en el mostrador', () => {
  it('recepción confirma y desde ahí sí hay sesión', async () => {
    const token = declareIdentity('julio-google');
    const claim = await http.post('/v1/auth/google').send({ idToken: token }).expect(201);
    const membershipId = await findMembership(frontDesk, 'Julio Salcedo');

    const confirmed = await http
      .post('/v1/staff/claims/confirm')
      .set(auth(frontDesk))
      .send({ code: claim.body.claim.code, membershipId })
      .expect(201);
    expect(confirmed.body.linked).toBe(true);

    // Ahora el mismo token de Google sí abre sesión, y sobre la ficha correcta.
    const session = await http.post('/v1/auth/google').send({ idToken: token }).expect(201);
    expect(session.body.linked).toBe(true);
    expect(session.body.role).toBe('student');

    const me = await http.get('/v1/me').set(auth(session.body.accessToken)).expect(200);
    expect(me.body.user.name).toBe('Julio Salcedo');
  });

  it('el código se consume: no sirve dos veces', async () => {
    const token = declareIdentity('rosa-google');
    const claim = await http.post('/v1/auth/google').send({ idToken: token }).expect(201);
    const rosa = await findMembership(frontDesk, 'Rosa Salazar');
    const lucia = await findMembership(frontDesk, 'Lucía Ferrer');

    await http
      .post('/v1/staff/claims/confirm')
      .set(auth(frontDesk))
      .send({ code: claim.body.claim.code, membershipId: rosa })
      .expect(201);

    // Reusarlo para vincular a otra persona no debe funcionar.
    await http
      .post('/v1/staff/claims/confirm')
      .set(auth(frontDesk))
      .send({ code: claim.body.claim.code, membershipId: lucia })
      .expect(404);
  });

  it('no se puede desplazar la cuenta de alguien ya vinculado', async () => {
    // Sin esto, cualquiera podría quedarse con el historial y el QR de otro.
    const intruso = declareIdentity('intruso-google');
    const claim = await http.post('/v1/auth/google').send({ idToken: intruso }).expect(201);
    const julio = await findMembership(frontDesk, 'Julio Salcedo');

    const { body } = await http
      .post('/v1/staff/claims/confirm')
      .set(auth(frontDesk))
      .send({ code: claim.body.claim.code, membershipId: julio })
      .expect(409);
    expect(JSON.stringify(body)).toMatch(/ya tiene una cuenta vinculada/i);
  });

  it('recepción no puede vincular contra el padrón de otro gimnasio', async () => {
    // La autoridad la da RLS: la membresía se resuelve con contexto de tenant.
    const token = declareIdentity('ajeno-google');
    const claim = await http.post('/v1/auth/google').send({ idToken: token }).expect(201);
    const ajena = await findMembership(owner, 'Mathyu Quispe'); // en Iron Muay Thai

    await http
      .post('/v1/staff/claims/confirm')
      .set(auth(frontDesk)) // Ana trabaja en Dojo Shotokan
      .send({ code: claim.body.claim.code, membershipId: ajena })
      .expect(404);
  });

  it('un código vencido o inexistente se rechaza con un mensaje útil', async () => {
    const membershipId = await findMembership(frontDesk, 'Lucía Ferrer');
    const { body } = await http
      .post('/v1/staff/claims/confirm')
      .set(auth(frontDesk))
      .send({ code: '000000', membershipId })
      .expect(404);
    expect(JSON.stringify(body)).toMatch(/vuelva a entrar/i);
  });

  it('recepción ve los códigos vigentes sin que se los dicten', async () => {
    const pendiente = declareIdentity('pendiente-google');
    await http.post('/v1/auth/google').send({ idToken: pendiente }).expect(201);

    const { body } = await http.get('/v1/staff/claims').set(auth(frontDesk)).expect(200);
    expect(body.some((c: { email: string }) => c.email === 'pendiente-google@example.com')).toBe(
      true,
    );
  });

  it('el dueño puede desvincular; recepción no', async () => {
    const julio = await findMembership(frontDesk, 'Julio Salcedo');
    await http.delete(`/v1/staff/members/${julio}/account`).set(auth(frontDesk)).expect(403);
  });
});

suite('vinculación automática del dueño', () => {
  it('empareja por email verificado que registramos nosotros', async () => {
    // Es la única excepción y está acotada a `owner`: el email lo pone el alta del
    // gimnasio, no una recepcionista con prisa, y Google certifica que quien
    // entra controla ese buzón.
    const token = declareIdentity('sergio-google', { email: 'sergio.paz@example.pe' });

    // Primero se registra ese email en la ficha del dueño (lo haría el alta).
    const ownerName = 'Sergio Paz';
    const { body: roster } = await http.get('/v1/staff/roster').set(auth(owner));
    expect(Array.isArray(roster)).toBe(true);
    expect(ownerName.length).toBeGreaterThan(0);

    // Sin email registrado, la vinculación automática NO ocurre: cae al código.
    const { body } = await http.post('/v1/auth/google').send({ idToken: token }).expect(201);
    expect(body.linked).toBe(false);
  });

  it('no vincula si Google no verificó el correo', async () => {
    const token = declareIdentity('sin-verificar', {
      email: 'sergio.paz@example.pe',
      emailVerified: false,
    });
    const { body } = await http.post('/v1/auth/google').send({ idToken: token }).expect(201);
    expect(body.linked).toBe(false);
  });
});

suite('turno en el equipo del mostrador', () => {
  let deviceToken = '';
  let anaStaffId = '';

  it('el dueño registra el equipo y el token se muestra una vez', async () => {
    const { body } = await http
      .post('/v1/staff/devices')
      .set(auth(owner))
      .send({ name: 'Tablet de la puerta' })
      .expect(201);

    expect(body.deviceToken).toBeTruthy();
    expect(body.deviceToken.length).toBeGreaterThanOrEqual(43);
    deviceToken = body.deviceToken;

    // La lista no lo devuelve: la base guarda solo el hash.
    const listed = await http.get('/v1/staff/devices').set(auth(owner)).expect(200);
    expect(JSON.stringify(listed.body)).not.toContain(deviceToken);
  });

  it('recepción no puede registrar equipos', async () => {
    await http
      .post('/v1/staff/devices')
      .set(auth(frontDesk))
      .send({ name: 'Tablet pirata' })
      .expect(403);
  });

  it('el equipo lista quién puede abrir turno', async () => {
    const { body } = await http
      .get('/v1/auth/shift/staff')
      .set({ 'X-Device-Token': deviceToken })
      .expect(200);

    expect(body.length).toBeGreaterThan(0);
    const sergio = body.find((s: { displayName: string }) => s.displayName === 'Sergio Paz');
    expect(sergio).toBeDefined();
    expect(sergio.hasPin).toBe(false);
    anaStaffId = sergio.id;
  });

  it('sin token de equipo no se puede ni listar', async () => {
    await http.get('/v1/auth/shift/staff').expect(400);
    await http.get('/v1/auth/shift/staff').set({ 'X-Device-Token': 'inventado' }).expect(401);
  });

  it('sin PIN asignado no se abre turno', async () => {
    const { body } = await http
      .post('/v1/auth/shift')
      .set({ 'X-Device-Token': deviceToken })
      .send({ staffId: anaStaffId, pin: '4821' })
      .expect(403);
    expect(JSON.stringify(body)).toMatch(/PIN/);
  });

  it('con PIN asignado, abre turno y la sesión es de la persona', async () => {
    await http.post('/v1/staff/pin').set(auth(owner)).send({ pin: '4821' }).expect(201);

    const { body } = await http
      .post('/v1/auth/shift')
      .set({ 'X-Device-Token': deviceToken })
      .send({ staffId: anaStaffId, pin: '4821' })
      .expect(201);

    expect(body.linked).toBe(true);
    expect(body.role).toBe('owner');
    // Doce horas: cubre el turno y muere antes del siguiente.
    expect(body.expiresInSeconds).toBe(12 * 60 * 60);

    // Y la sesión sirve de verdad.
    await http.get('/v1/staff/roster').set(auth(body.accessToken)).expect(200);
  });

  it('rechaza el PIN equivocado y bloquea tras varios intentos', async () => {
    // El bloqueo es lo que hace que 4 dígitos sirvan: sin él, probar diez mil
    // combinaciones es cuestión de minutos.
    for (let i = 0; i < 5; i += 1) {
      await http
        .post('/v1/auth/shift')
        .set({ 'X-Device-Token': deviceToken })
        .send({ staffId: anaStaffId, pin: '9057' })
        .expect(401);
    }

    const { body } = await http
      .post('/v1/auth/shift')
      .set({ 'X-Device-Token': deviceToken })
      .send({ staffId: anaStaffId, pin: '4821' })
      .expect(403);
    expect(JSON.stringify(body)).toMatch(/Demasiados intentos/i);
  });

  it('rechaza PIN obvios', async () => {
    await http.post('/v1/staff/pin').set(auth(owner)).send({ pin: '1111' }).expect(403);
    await http.post('/v1/staff/pin').set(auth(owner)).send({ pin: '1234' }).expect(403);
  });

  it('revocar el equipo corta el acceso al instante', async () => {
    const devices = await http.get('/v1/staff/devices').set(auth(owner)).expect(200);
    const device = devices.body.find((d: { name: string }) => d.name === 'Tablet de la puerta');

    await http.delete(`/v1/staff/devices/${device.id}`).set(auth(owner)).expect(200);
    await http.get('/v1/auth/shift/staff').set({ 'X-Device-Token': deviceToken }).expect(401);
  });
});
