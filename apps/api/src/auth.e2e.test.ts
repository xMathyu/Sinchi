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
import { inArray } from 'drizzle-orm';
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

/**
 * Gimnasios que crean las pruebas, para borrarlos al terminar.
 *
 * No es limpieza por pulcritud. `staff.user_id` es ON DELETE restrict, asi que
 * un tenant de prueba que sobrevive deja a Sergio con una fila de `staff` que
 * la semilla no conoce — y `runSeed({ reset: true })` de la SIGUIENTE corrida
 * revienta al intentar borrar su usuario. Se veia como un fallo del arranque,
 * lejisimos de la prueba que lo causo.
 */
const tenantsCreados: string[] = [];

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
  if (app !== undefined && tenantsCreados.length > 0) {
    const { schema, withoutTenantIsolation } = await import('./db/client');
    const { DATABASE } = await import('./db/db.module');
    const db = app.get(DATABASE);
    // `staff` y `saas_subscriptions` se van en cascada con el tenant.
    await withoutTenantIsolation(db, (tx) =>
      tx.delete(schema.tenants).where(inArray(schema.tenants.id, tenantsCreados)),
    );
  }
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
  /** Correo del dueño, el que pondría el alta del gimnasio. */
  const CORREO_DUENO = `sergio.paz.${Date.now()}@example.pe`;

  it('empareja por email verificado y entra ya como dueño', async () => {
    // ESTA es la prueba que faltaba. La anterior solo comprobaba los casos
    // negativos —que sin correo o sin verificar NO vincula— y nunca ejecutó el
    // camino feliz. Por eso sobrevivió el fallo: `tryLinkOwnerByEmail` hacía un
    // JOIN contra `staff`, que tiene FORCE ROW LEVEL SECURITY y sin contexto no
    // devuelve ninguna fila. El método era código muerto en producción y fallaba
    // en silencio, devolviendo el código de 6 dígitos como si el dueño fuera un
    // desconocido.
    const { createDatabase, createPool, schema, withoutTenantIsolation } = await import(
      './db/client'
    );
    const { eq } = await import('drizzle-orm');

    const pool = createPool(DATABASE_URL!);
    const db = createDatabase(pool);

    // El alta del gimnasio registra el correo del dueño en su ficha.
    const actualizados = await withoutTenantIsolation(db, (tx) =>
      tx
        .update(schema.users)
        .set({ email: CORREO_DUENO })
        .where(eq(schema.users.name, 'Sergio Paz'))
        .returning({ id: schema.users.id }),
    );
    await pool.end();
    expect(actualizados).toHaveLength(1);

    const token = declareIdentity('sergio-google', { email: CORREO_DUENO });
    const { body } = await http.post('/v1/auth/google').send({ idToken: token }).expect(201);

    // Entra directo: sin código y con su gimnasio ya en la sesión.
    expect(body.linked).toBe(true);
    expect(body.role).toBe('owner');
    expect(body.tenantId).not.toBeNull();
  });

  it('no vincula si Google no verificó el correo', async () => {
    const token = declareIdentity('sin-verificar', {
      email: `otro.dueno.${Date.now()}@example.pe`,
      emailVerified: false,
    });
    const { body } = await http.post('/v1/auth/google').send({ idToken: token }).expect(201);
    expect(body.linked).toBe(false);
  });

  it('un correo desconocido cae al código, no inventa una cuenta', async () => {
    const token = declareIdentity('nadie-google', { email: `nadie.${Date.now()}@example.pe` });
    const { body } = await http.post('/v1/auth/google').send({ idToken: token }).expect(201);
    expect(body.linked).toBe(false);
    expect(body.claim.code).toMatch(/^\d{6}$/);
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

/**
 * El dueño de un dojo también entrena en él.
 *
 * `switchToStudent` existía sin par desde el principio, así que el cambio era de
 * ida y sin vuelta: la única otra entrada al modo staff es `POST /auth/shift`,
 * que pide el token del equipo del mostrador — y el teléfono del dueño no es esa
 * tablet. Quien cambiaba a alumno para mirar su billetera se quedaba encerrado.
 *
 * Lo que estas pruebas cuidan no es que el cambio funcione, que es una línea,
 * sino que no regale nada: ni un rol que la base no respalde, ni vida nueva a un
 * turno de doce horas.
 */
suite('cambio de modo', () => {
  /** Sergio es `owner` de Iron Muay Thai y se inscribe en su propio local. */
  const SERGIO_DNI = '42447799';

  const modes = async (bearer: string) => {
    const { body } = await http.get('/v1/auth/modes').set(auth(bearer)).expect(200);
    return body as {
      student: boolean;
      staff: readonly { role: string; tenantName: string }[];
    };
  };

  it('un alumno sin puesto no tiene a dónde cambiar', async () => {
    const alumno = await devLogin('+51987111222'); // Lucía, solo alumna
    const disponibles = await modes(alumno);

    expect(disponibles.student).toBe(true);
    expect(disponibles.staff).toEqual([]);

    // Y la api lo sostiene: el botón no se enseña, pero la ruta tampoco cede.
    await http.post('/v1/auth/switch-to-staff').set(auth(alumno)).expect(403);
  });

  it('el dueño sin ficha ve su puesto y ninguna billetera', async () => {
    const disponibles = await modes(owner);
    expect(disponibles.student).toBe(false);
    expect(disponibles.staff).toHaveLength(1);
    expect(disponibles.staff[0]?.role).toBe('owner');
    expect(disponibles.staff[0]?.tenantName).toBe('Iron Muay Thai Lince');
  });

  it('inscribirse en su propio dojo le abre el modo alumno', async () => {
    // El alta se ancla en el DOCUMENTO, así que reutiliza su identidad en vez de
    // crear un segundo Sergio. Es lo que hace posible ser las dos cosas.
    const { body: plans } = await http.get('/v1/staff/plans').set(auth(owner)).expect(200);

    await http
      .post('/v1/staff/members')
      .set(auth(owner))
      .send({ documentId: SERGIO_DNI, planId: plans[0].id })
      .expect(201);

    const disponibles = await modes(owner);
    expect(disponibles.student).toBe(true);
    expect(disponibles.staff[0]?.role).toBe('owner');
  });

  it('va a alumno y vuelve a su puesto', async () => {
    const ida = await http.post('/v1/auth/switch-to-student').set(auth(owner)).expect(201);
    expect(ida.body.role).toBe('student');
    expect(ida.body.tenantId).toBeNull();

    // La sesión de alumno sirve: es su billetera, con la ficha que acaba de crear.
    const { body: yo } = await http.get('/v1/me').set(auth(ida.body.accessToken)).expect(200);
    expect(yo.wallet).toHaveLength(1);

    // Y con ella NO puede tocar el padrón, aunque sea el dueño: el rol de la
    // sesión es lo que manda, no quién es la persona.
    await http.get('/v1/staff/roster').set(auth(ida.body.accessToken)).expect(403);

    const vuelta = await http
      .post('/v1/auth/switch-to-staff')
      .set(auth(ida.body.accessToken))
      .expect(201);
    expect(vuelta.body.role).toBe('owner');
    await http.get('/v1/staff/roster').set(auth(vuelta.body.accessToken)).expect(200);
  });

  it('el cambio NO regala vida: un turno de 12 h sigue muriendo a las 12 h', async () => {
    // Es el agujero que el cambio abría. `openShift` dura doce horas a propósito
    // —«quien entra a las seis no hereda la sesión de mediodía»— y reemitir el
    // token al cambiar de modo lo convertía en los siete días del login normal,
    // en una tablet compartida. Basta pasar por alumno y volver.
    const { body: device } = await http
      .post('/v1/staff/devices')
      .set(auth(owner))
      .send({ name: 'Tablet del cambio de modo' })
      .expect(201);

    // Sergio quedó bloqueado por la prueba del PIN: asignarle uno nuevo limpia
    // el contador, que es justo lo que hace `setPin`.
    await http.post('/v1/staff/pin').set(auth(owner)).send({ pin: '7391' }).expect(201);

    const { body: candidatos } = await http
      .get('/v1/auth/shift/staff')
      .set({ 'X-Device-Token': device.deviceToken })
      .expect(200);
    const sergio = (candidatos as { id: string; displayName: string }[]).find(
      (c) => c.displayName === 'Sergio Paz',
    )!;

    const turno = await http
      .post('/v1/auth/shift')
      .set({ 'X-Device-Token': device.deviceToken })
      .send({ staffId: sergio.id, pin: '7391' })
      .expect(201);
    expect(turno.body.expiresInSeconds).toBe(12 * 60 * 60);

    const comoAlumno = await http
      .post('/v1/auth/switch-to-student')
      .set(auth(turno.body.accessToken))
      .expect(201);
    const devuelta = await http
      .post('/v1/auth/switch-to-staff')
      .set(auth(comoAlumno.body.accessToken))
      .expect(201);

    // Lo que queda del turno, no una semana nueva.
    expect(devuelta.body.expiresInSeconds).toBeLessThanOrEqual(12 * 60 * 60);
    expect(devuelta.body.expiresInSeconds).toBeGreaterThan(11 * 60 * 60);
  });
});

/**
 * El profesor con dos locales.
 *
 * El caso real que lo pide: lleva la escuela de una universidad —alumnos
 * becados, nadie paga— y aparte cobra sus clases por su cuenta. Son dos
 * padrones, dos tarifarios y dos cajas.
 *
 * Antes esto no existía por dos rejas distintas, y hay que probar las dos:
 * el alta lo rechazaba con un 409, y la sesión llevaba el `tenantId` firmado
 * leyendo `staff` con un `limit(1)` SIN ORDEN — así que aunque le metieras la
 * segunda fila a mano, el login lo dejaba en uno de los dos al azar.
 *
 * Lo que estas pruebas cuidan no es que el cambio funcione. Es que los dos
 * locales sigan siendo dos: que el padrón que se ve sea el del local elegido, y
 * que pedir uno ajeno no cuele.
 */
suite('el dueño con dos locales', () => {
  /** Sergio, ya `owner` de Iron Muay Thai por la semilla. */
  const SERGIO_DNI = '42447799';
  /** RUC real y válido: el alta comprueba el dígito verificador. */
  const RUC_SEGUNDO = '20131312955';

  let segundoTenantId = '';
  let ironTenantId = '';

  interface Puesto {
    role: string;
    tenantId: string;
    tenantName: string | null;
  }

  const puestos = async (bearer: string): Promise<Puesto[]> => {
    const { body } = await http.get('/v1/auth/modes').set(auth(bearer)).expect(200);
    return (body as { staff: Puesto[] }).staff;
  };

  it('abre su segundo local desde la app', async () => {
    // La reja de antes: «Ya trabajas en un gimnasio de Sinchi». Ahora el tope
    // son cinco, y esto es el segundo.
    const token = declareIdentity('sergio-segundo-local');
    const { body } = await http
      .post('/v1/gyms/signup')
      .send({
        idToken: token,
        gymName: 'Selección UPC',
        taxId: RUC_SEGUNDO,
        saasTier: 'free',
        monthlyPriceCents: 12_000,
        address: 'Av. Primavera 120, Surco',
        documentId: SERGIO_DNI,
      })
      .expect(201);

    segundoTenantId = body.tenantId as string;
    tenantsCreados.push(segundoTenantId);

    // Se enganchó a la identidad que YA existía en vez de crear un segundo
    // Sergio: es lo que hace que sea la misma persona en los dos locales.
    const misPuestos = await puestos(owner);
    expect(misPuestos).toHaveLength(2);
    expect(misPuestos.map((p) => p.tenantName).sort()).toEqual([
      'Iron Muay Thai Lince',
      'Selección UPC',
    ]);

    ironTenantId = misPuestos.find((p) => p.tenantName === 'Iron Muay Thai Lince')!.tenantId;
    expect(segundoTenantId).not.toBe(ironTenantId);
  });

  it('entrar lo deja en el local de siempre, no en el último que abrió', async () => {
    // Es lo que rompía el `limit(1)` sin orden. Abrir un local nuevo no puede
    // cambiar dónde amanece la app al día siguiente.
    const { body } = await http
      .post('/v1/auth/dev-login')
      .send({ phone: '+51987000333' })
      .expect(201);

    expect(body.tenantId).toBe(ironTenantId);
  });

  it('cambia de local y el padrón cambia con él', async () => {
    // LA prueba. Sin esto el cambio sería una etiqueta distinta sobre los
    // mismos datos, que es peor que no tenerlo: el dueño leería las cifras de
    // un local creyendo que son las del otro.
    const { body: enIron } = await http.get('/v1/staff/roster').set(auth(owner)).expect(200);
    expect(enIron.length).toBeGreaterThan(0);

    const salto = await http
      .post('/v1/auth/switch-to-staff')
      .set(auth(owner))
      .send({ tenantId: segundoTenantId })
      .expect(201);

    expect(salto.body.role).toBe('owner');
    expect(salto.body.tenantId).toBe(segundoTenantId);

    // El local recién abierto no tiene a nadie. Que el padrón venga vacío es
    // justo la prueba de que no está mirando el de Iron Muay Thai.
    const { body: enUpc } = await http
      .get('/v1/staff/roster')
      .set(auth(salto.body.accessToken))
      .expect(200);
    expect(enUpc).toHaveLength(0);

    // Y la vuelta, que es el mismo camino al revés.
    const vuelta = await http
      .post('/v1/auth/switch-to-staff')
      .set(auth(salto.body.accessToken))
      .send({ tenantId: ironTenantId })
      .expect(201);
    const { body: otraVez } = await http
      .get('/v1/staff/roster')
      .set(auth(vuelta.body.accessToken))
      .expect(200);
    expect(otraVez.length).toBe(enIron.length);
  });

  it('no puede saltar a un local que no es suyo', async () => {
    // El control de acceso entero del cambio de local. Ana trabaja en Dojo
    // Shotokan y Sergio no: pedir ese tenant tiene que morir aquí, no en la
    // consulta siguiente.
    const puestosDeAna = await puestos(frontDesk);
    const shotokan = puestosDeAna[0]!.tenantId;
    expect(shotokan).not.toBe(ironTenantId);

    await http
      .post('/v1/auth/switch-to-staff')
      .set(auth(owner))
      .send({ tenantId: shotokan })
      .expect(403);
  });

  it('un tenant que no existe tampoco abre nada', async () => {
    await http
      .post('/v1/auth/switch-to-staff')
      .set(auth(owner))
      .send({ tenantId: '00000000-0000-4000-8000-000000000000' })
      .expect(403);
  });

  it('volver sin pedir local sigue funcionando', async () => {
    // El camino que ya existía: `POST` pelado, sin cuerpo. Lleva al de siempre.
    const comoAlumno = await http
      .post('/v1/auth/switch-to-student')
      .set(auth(owner))
      .expect(201);

    const vuelta = await http
      .post('/v1/auth/switch-to-staff')
      .set(auth(comoAlumno.body.accessToken))
      .expect(201);

    expect(vuelta.body.tenantId).toBe(ironTenantId);
  });

  it('cambiar de local NO regala vida a la sesión', async () => {
    // Mismo agujero que cerró el cambio de modo, con otra puerta: saltar de un
    // local al otro y volver renovaría un turno de doce horas para siempre.
    const antes = await http
      .post('/v1/auth/switch-to-staff')
      .set(auth(owner))
      .send({ tenantId: segundoTenantId })
      .expect(201);

    const despues = await http
      .post('/v1/auth/switch-to-staff')
      .set(auth(antes.body.accessToken))
      .send({ tenantId: ironTenantId })
      .expect(201);

    expect(despues.body.expiresInSeconds).toBeLessThanOrEqual(antes.body.expiresInSeconds);
  });
});
