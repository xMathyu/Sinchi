/**
 * Invitaciones por enlace, de punta a punta.
 *
 * Es la parte del sistema donde **la posesion del enlace es la autorizacion**, y
 * por eso las pruebas que importan no son las del camino feliz sino las de los
 * limites: que un enlace no valga dos veces, que caducar signifique algo, que
 * revocar corte de inmediato, y que un recepcionista no pueda invitar contra el
 * padron de otro gimnasio.
 *
 * Necesita `TEST_DATABASE_URL` con un rol SIN BYPASSRLS: con BYPASSRLS las
 * pruebas de aislamiento pasarian sin probar nada.
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

const identities = new Map<string, VerifiedIdentity>();

const fakeVerifier = {
  verify: async (idToken: string): Promise<VerifiedIdentity> => {
    const identity = identities.get(idToken);
    if (identity === undefined) throw new UnauthorizedException('Sesion invalida.');
    return identity;
  },
};

const asToken = (uid: string): string => `${uid}.${'x'.repeat(120)}`;

function declareIdentity(uid: string): string {
  const token = asToken(uid);
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

let frontDesk = '';
/** Recepcion de OTRO gimnasio: el control de aislamiento. */
let otherGym = '';
let planId = '';
let tenantId = '';

/**
 * DNI y telefono distintos por invitacion **y por ejecucion**.
 *
 * `users` los tiene como unicos y las cuentas que crea un `claim` sobreviven al
 * `reset` de la siembra —solo se borran las que ella misma sembro—, asi que un
 * contador que empieza en cero cada vez choca con la corrida anterior. El
 * sintoma era desconcertante: la suite pasaba una vez y fallaba la siguiente sin
 * que nada hubiera cambiado.
 */
const runId = randomInt(10_000_000, 89_000_000);
let personCounter = 0;
const nextDni = (): string => String(runId + ++personCounter);
const nextPhone = (): string => `+51${String(runId + personCounter).padStart(9, '9')}`;

interface PlanRow {
  id: string;
  name: string;
}

const createInvite = async (
  token: string,
  overrides: Record<string, unknown> = {},
): Promise<request.Response> =>
  http
    .post('/v1/staff/invites')
    .set(auth(token))
    .send({
      fullName: 'Alumno de Prueba',
      documentId: nextDni(),
      phone: nextPhone(),
      planId,
      ...overrides,
    });

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

  frontDesk = await login('+51987000111'); // Ana, Dojo Shotokan
  otherGym = await login('+51987000222'); // Carlos, Nova BJJ

  const { body } = await http.get('/v1/staff/plans').set(auth(frontDesk)).expect(200);
  const plans = body as PlanRow[];
  planId = plans[0]!.id;

  const roster = await http.get('/v1/staff/roster').set(auth(frontDesk)).expect(200);
  tenantId = (roster.body as { membership: { tenantId: string } }[])[0]!.membership.tenantId;
});

afterAll(async () => {
  await app?.close();
});

suite('invitaciones', () => {
  it('el staff crea una y el token se devuelve una sola vez', async () => {
    const { body, status } = await createInvite(frontDesk);
    expect(status).toBe(201);

    // Un token corto seria adivinable, que es exactamente lo que el codigo de 6
    // digitos podia permitirse solo porque lo confirmaba una persona.
    expect(body.token.length).toBeGreaterThanOrEqual(40);
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('la vista previa dice a que invitan sin consumir la invitacion', async () => {
    const { body: invite } = await createInvite(frontDesk);

    const first = await http.get(`/v1/invites/${invite.token}`).expect(200);
    expect(first.body.gymName).toBeTruthy();
    expect(first.body.planName).toBeTruthy();
    expect(Number.isInteger(first.body.priceCents)).toBe(true);

    // Mirar dos veces tiene que seguir funcionando: si abrirla la quemara, verla
    // por curiosidad dejaria a la persona fuera.
    await http.get(`/v1/invites/${invite.token}`).expect(200);
  });

  it('aceptarla deja a la persona dentro, con plan y cargos pendientes', async () => {
    const { body: invite } = await createInvite(frontDesk, { fullName: 'Rosa Palomino' });
    const idToken = declareIdentity(`uid-rosa-${Date.now()}`);

    const { body: session } = await http
      .post(`/v1/invites/${invite.token}/claim`)
      .send({ idToken })
      .expect(201);

    expect(session.linked).toBe(true);
    expect(session.role).toBe('student');

    // La prueba de que quedo inscrita de verdad: sale en el padron del gimnasio.
    const roster = await http.get('/v1/staff/roster').set(auth(frontDesk)).expect(200);
    const names = (roster.body as { user: { name: string } }[]).map((r) => r.user.name);
    expect(names).toContain('Rosa Palomino');
  });

  it('el enlace inscribe pero NO cobra: los cargos nacen pendientes', async () => {
    const { createDatabase, createPool, schema, withTenant } = await import('./db/client');
    const { and, eq } = await import('drizzle-orm');
    const pool = createPool(DATABASE_URL!);
    const db = createDatabase(pool);

    // El gimnasio sembrado no cobra matricula, asi que sin esto la prueba solo
    // veria la mensualidad y la rama del cargo de inscripcion no se ejercitaria
    // nunca. Se pone aqui y no en la siembra para que quede a la vista que es
    // condicion de esta prueba.
    await withTenant(db, tenantId, (tx) =>
      tx
        .update(schema.tenants)
        .set({ enrollmentFeeCents: 5000 })
        .where(eq(schema.tenants.id, tenantId)),
    );

    const { body: invite } = await createInvite(frontDesk, { fullName: 'Pago Pendiente' });
    const idToken = declareIdentity(`uid-pendiente-${Date.now()}`);

    await http.post(`/v1/invites/${invite.token}/claim`).send({ idToken }).expect(201);

    // Se mira la tabla y no la billetera: lo que esta prueba defiende es un
    // invariante contable —que nadie de por cobrado lo que nadie pago—, y eso
    // vive en `charges.status`, no en como la app decida presentarlo.
    const rows = await withTenant(db, tenantId, (tx) =>
      tx
        .select({
          type: schema.charges.type,
          amountCents: schema.charges.amountCents,
          status: schema.charges.status,
        })
        .from(schema.charges)
        .innerJoin(schema.memberships, eq(schema.memberships.id, schema.charges.membershipId))
        .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
        .where(and(eq(schema.users.name, 'Pago Pendiente'))),
    );
    await pool.end();

    // Mensualidad y matricula.
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === 'pending')).toBe(true);
    expect(rows.map((r) => r.type).sort()).toEqual(['enrollment', 'renewal']);
    // Enteros de centimos, nunca decimales.
    expect(rows.every((r) => Number.isInteger(r.amountCents) && r.amountCents > 0)).toBe(true);
  });

  it('no vale dos veces', async () => {
    const { body: invite } = await createInvite(frontDesk);

    await http
      .post(`/v1/invites/${invite.token}/claim`)
      .send({ idToken: declareIdentity(`uid-primero-${Date.now()}`) })
      .expect(201);

    // El segundo llega con una identidad distinta: es el caso del enlace
    // reenviado por WhatsApp que abre otra persona.
    await http
      .post(`/v1/invites/${invite.token}/claim`)
      .send({ idToken: declareIdentity(`uid-segundo-${Date.now()}`) })
      .expect(404);

    await http.get(`/v1/invites/${invite.token}`).expect(404);
  });

  it('una invitacion caducada no sirve', async () => {
    const { body: invite } = await createInvite(frontDesk, { ttlDays: 1 });

    // Se envejece SOLO esta, y con contexto de gimnasio: `invites` tiene FORCE
    // RLS, asi que un update sin tenant no pasa el WITH CHECK y afectaria cero
    // filas — el test pasaria por razones equivocadas. Y acotarlo a este token
    // evita envejecer las invitaciones de las otras pruebas.
    const { createDatabase, createPool, schema, withTenant } = await import('./db/client');
    const { hashDeviceToken } = await import('./auth/secrets');
    const { eq, sql } = await import('drizzle-orm');

    const pool = createPool(DATABASE_URL!);
    const db = createDatabase(pool);
    const affected = await withTenant(db, tenantId, (tx) =>
      tx
        .update(schema.invites)
        .set({ expiresAt: sql`now() - interval '1 hour'` })
        .where(eq(schema.invites.tokenHash, hashDeviceToken(invite.token)))
        .returning({ id: schema.invites.id }),
    );
    await pool.end();
    expect(affected).toHaveLength(1);

    await http.get(`/v1/invites/${invite.token}`).expect(404);
    await http
      .post(`/v1/invites/${invite.token}/claim`)
      .send({ idToken: declareIdentity(`uid-tarde-${Date.now()}`) })
      .expect(404);
  });

  it('un token inventado no revela si existio', async () => {
    const inventado = randomBytes(32).toString('base64url');
    const { body } = await http.get(`/v1/invites/${inventado}`).expect(404);

    // Mismo mensaje que para una consumida o caducada: distinguirlas le diria a
    // quien prueba enlaces al azar si acerto con uno que existio.
    expect(body.message).toContain('ya no es válida');
  });

  it('un token de Firebase invalido no quema la invitacion', async () => {
    const { body: invite } = await createInvite(frontDesk);

    await http
      .post(`/v1/invites/${invite.token}/claim`)
      .send({ idToken: asToken('nunca-declarado') })
      .expect(401);

    // Si se consumiera antes de verificar, alguien podria inutilizar enlaces
    // ajenos a base de mandar basura.
    await http.get(`/v1/invites/${invite.token}`).expect(200);
  });

  it('recepcion de otro gimnasio no puede invitar contra este plan', async () => {
    // `planId` es del Dojo Shotokan; Carlos es de Nova BJJ. RLS tiene que hacer
    // que ese plan sencillamente no exista para el.
    const { status } = await createInvite(otherGym);
    expect(status).toBe(404);
  });

  it('la misma cuenta no puede acabar con dos fichas en el mismo gimnasio', async () => {
    const uid = `uid-repetido-${Date.now()}`;
    const idToken = declareIdentity(uid);

    const primera = await createInvite(frontDesk, { fullName: 'Doble Ficha' });
    await http.post(`/v1/invites/${primera.body.token}/claim`).send({ idToken }).expect(201);

    const segunda = await createInvite(frontDesk, { fullName: 'Doble Ficha' });
    const { status } = await http
      .post(`/v1/invites/${segunda.body.token}/claim`)
      .send({ idToken });

    // Dos fichas serian dos cupos y dos deudas para la misma persona.
    expect(status).toBe(400);
  });

  it('revocar corta el enlace al instante', async () => {
    const { body: invite } = await createInvite(frontDesk, { fullName: 'Se Revoca' });
    await http.get(`/v1/invites/${invite.token}`).expect(200);

    const { body: pendientes } = await http
      .get('/v1/staff/invites')
      .set(auth(frontDesk))
      .expect(200);
    const fila = (pendientes as { id: string; fullName: string }[]).find(
      (row) => row.fullName === 'Se Revoca',
    );
    expect(fila).toBeDefined();

    await http.delete(`/v1/staff/invites/${fila!.id}`).set(auth(frontDesk)).expect(200);

    await http.get(`/v1/invites/${invite.token}`).expect(404);
    await http
      .post(`/v1/invites/${invite.token}/claim`)
      .send({ idToken: declareIdentity(`uid-revocado-${Date.now()}`) })
      .expect(404);
  });

  it('la lista de invitaciones NO devuelve el token', async () => {
    await createInvite(frontDesk, { fullName: 'Sin Token Visible' });

    const { body } = await http.get('/v1/staff/invites').set(auth(frontDesk)).expect(200);
    const fila = (body as Record<string, unknown>[]).find(
      (row) => row.fullName === 'Sin Token Visible',
    );

    // Si la lista lo devolviera, la base seria una copia de todos los enlaces
    // vivos y perder el acceso al panel valdria por perderlos todos.
    expect(fila).toBeDefined();
    expect(Object.keys(fila!)).not.toContain('token');
    expect(Object.keys(fila!)).not.toContain('tokenHash');
  });

  it('no se puede revocar una invitacion de otro gimnasio', async () => {
    const { body: invite } = await createInvite(frontDesk, { fullName: 'Ajena' });
    const { body: pendientes } = await http
      .get('/v1/staff/invites')
      .set(auth(frontDesk))
      .expect(200);
    const fila = (pendientes as { id: string; fullName: string }[]).find(
      (row) => row.fullName === 'Ajena',
    )!;

    await http.delete(`/v1/staff/invites/${fila.id}`).set(auth(otherGym)).expect(404);
    // Y sigue sirviendo: el intento fallido no puede tener efectos.
    await http.get(`/v1/invites/${invite.token}`).expect(200);
  });

  it('sin sesion de staff no se puede crear una invitacion', async () => {
    await http
      .post('/v1/staff/invites')
      .send({ fullName: 'Sin Permiso', documentId: nextDni(), phone: '+51900000000', planId })
      .expect(401);
  });
});
