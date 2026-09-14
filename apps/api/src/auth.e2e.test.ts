/**
 * Autenticación de punta a punta: vinculación de cuentas y cambio de modo.
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
const createdTenants: string[] = [];

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
  if (app !== undefined && createdTenants.length > 0) {
    const { schema, withoutTenantIsolation } = await import('./db/client');
    const { DATABASE } = await import('./db/db.module');
    const db = app.get(DATABASE);
    // `staff` y `saas_subscriptions` se van en cascada con el tenant.
    await withoutTenantIsolation(db, (tx) =>
      tx.delete(schema.tenants).where(inArray(schema.tenants.id, createdTenants)),
    );
  }
  await app?.close();
});

suite('entrar con Google', () => {
  it('una cuenta sin ficha NO recibe sesión: recibe el QR con el que la inscriben', async () => {
    // Es la decisión central: la ficha del padrón existe antes que la cuenta, y
    // adivinar a cuál corresponde sería regalarle a alguien el historial de otro.
    const token = declareIdentity('diego-google');
    const { body } = await http.post('/v1/auth/google').send({ idToken: token }).expect(201);

    expect(body.linked).toBe(false);
    expect(body.accessToken).toBeUndefined();
    expect(body.claim.qrToken).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(new Date(body.claim.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('entrar dos veces devuelve el MISMO QR', async () => {
    // Quien cierra y abre la app en la cola del mostrador sigue mostrando el mismo.
    const token = declareIdentity('lucia-google');
    const first = await http.post('/v1/auth/google').send({ idToken: token }).expect(201);
    const second = await http.post('/v1/auth/google').send({ idToken: token }).expect(201);
    expect(second.body.claim.qrToken).toBe(first.body.claim.qrToken);
  });

  it('rechaza un token que Firebase no valida', async () => {
    await http.post('/v1/auth/google').send({ idToken: 'x'.repeat(120) }).expect(401);
  });
});

/**
 * Solicitudes de vínculo (migración 0023).
 *
 * Reemplazan a las pruebas del código de 6 dígitos. Cuidan la regla nueva
 * —ningún gimnasio aparece en la app de alguien sin que lo acepte— y que aceptar
 * no sirva para quedarse con la ficha de otra persona.
 */
suite('solicitudes de vínculo', () => {
  /** Único por corrida: las identidades que crea un alta sobreviven al reset. */
  const run = String(Date.now()).slice(-7);
  const VALERIA = { dni: `8${run}`, phone: `+5199${run}`, name: 'Valeria Torres' };
  let valeriaSession = '';

  const monthlyPlan = async (bearer: string): Promise<string> => {
    const { body } = await http.get('/v1/staff/plans').set(auth(bearer)).expect(200);
    const plan = (body as { id: string; type: string }[]).find((p) => p.type !== 'drop_in');
    if (plan === undefined) throw new Error('El gimnasio sembrado no tiene mensualidades');
    return plan.id;
  };

  const wallet = async (bearer: string): Promise<string[]> => {
    const { body } = await http.get('/v1/me/wallet').set(auth(bearer)).expect(200);
    return (body as { tenant: { name: string } }[]).map((view) => view.tenant.name).sort();
  };

  it('la que va por celular la ve quien entra con ese celular, y aceptar la vincula', async () => {
    const julio = await findMembership(frontDesk, 'Julio Salcedo');
    const { body: enviada } = await http
      .post(`/v1/staff/members/${julio}/link-request`)
      .set(auth(frontDesk))
      .expect(201);
    expect(enviada.request.status).toBe('pending');
    expect(enviada.accountLinked).toBe(false);

    // Con espacios, como lo escribe la gente: la ficha lo tiene sin ellos.
    const token = declareIdentity('julio-google');
    await http
      .post('/v1/auth/google')
      .send({ idToken: token, phone: '+51 987 333 444' })
      .expect(201);

    const { body: pendientes } = await http
      .post('/v1/link-requests/mine')
      .send({ idToken: token })
      .expect(201);
    expect(pendientes).toHaveLength(1);
    expect(pendientes[0].gymName).toBe('Dojo Shotokan Miraflores');

    const { body: sesion } = await http
      .post(`/v1/link-requests/${pendientes[0].id}/accept`)
      .send({ idToken: token })
      .expect(201);
    expect(sesion.linked).toBe(true);
    expect(sesion.role).toBe('student');

    const me = await http.get('/v1/me').set(auth(sesion.accessToken)).expect(200);
    expect(me.body.user.name).toBe('Julio Salcedo');

    const { body: estado } = await http
      .get(`/v1/staff/members/${julio}/link-request`)
      .set(auth(frontDesk))
      .expect(200);
    expect(estado.request.status).toBe('accepted');
    expect(estado.accountLinked).toBe(true);
  });

  it('otra cuenta no la ve ni puede contestarla', async () => {
    const rosa = await findMembership(frontDesk, 'Rosa Salazar');
    const { body: enviada } = await http
      .post(`/v1/staff/members/${rosa}/link-request`)
      .set(auth(frontDesk))
      .expect(201);

    const extrano = declareIdentity('extrano-google');
    await http
      .post('/v1/auth/google')
      .send({ idToken: extrano, phone: '+51900000001' })
      .expect(201);

    const { body: pendientes } = await http
      .post('/v1/link-requests/mine')
      .send({ idToken: extrano })
      .expect(201);
    expect(pendientes).toHaveLength(0);

    // Con el id en la mano tampoco: el mismo 404 que si no existiera.
    await http
      .post(`/v1/link-requests/${enviada.request.id}/accept`)
      .send({ idToken: extrano })
      .expect(404);
  });

  it('recepción escanea el QR de una cuenta, la inscribe, y la cuenta acepta', async () => {
    const token = declareIdentity(`valeria-${run}`);
    const { body: cuenta } = await http
      .post('/v1/auth/google')
      .send({ idToken: token, fullName: VALERIA.name, phone: VALERIA.phone })
      .expect(201);

    // Canjear el QR le ahorra al mostrador teclear lo que la persona ya escribió.
    const { body: vista } = await http
      .post('/v1/staff/accounts/lookup')
      .set(auth(frontDesk))
      .send({ token: cuenta.claim.qrToken })
      .expect(201);
    expect(vista).toEqual({
      displayName: VALERIA.name,
      phone: VALERIA.phone,
      email: `valeria-${run}@example.com`,
    });

    const { body: alta } = await http
      .post('/v1/staff/members')
      .set(auth(frontDesk))
      .send({
        documentId: VALERIA.dni,
        name: vista.displayName,
        phone: vista.phone,
        planId: await monthlyPlan(frontDesk),
        accountToken: cuenta.claim.qrToken,
      })
      .expect(201);
    expect(alta.linkRequestSent).toBe(true);

    const { body: pendientes } = await http
      .post('/v1/link-requests/mine')
      .send({ idToken: token })
      .expect(201);
    expect(pendientes.map((p: { gymName: string }) => p.gymName)).toEqual([
      'Dojo Shotokan Miraflores',
    ]);

    const { body: sesion } = await http
      .post(`/v1/link-requests/${pendientes[0].id}/accept`)
      .send({ idToken: token })
      .expect(201);
    valeriaSession = sesion.accessToken as string;
    expect(await wallet(valeriaSession)).toEqual(['Dojo Shotokan Miraflores']);
  });

  it('quien ya es alumna no ve el gimnasio nuevo en su billetera hasta aceptar', async () => {
    // Es el caso que la regla vino a cerrar: con su DNI, cualquier gimnasio podía
    // meterse en la app de alguien que ya entrenaba en otro.
    const { body: alta } = await http
      .post('/v1/staff/members')
      .set(auth(owner))
      .send({ documentId: VALERIA.dni, planId: await monthlyPlan(owner) })
      .expect(201);
    expect(alta.reusedIdentity).toBe(true);
    expect(alta.linkRequestSent).toBe(true);
    const iron = alta.view.membership.id as string;
    const ironName = alta.view.tenant.name as string;

    expect(await wallet(valeriaSession)).toEqual(['Dojo Shotokan Miraflores']);

    const { body: pendientes } = await http
      .get('/v1/me/link-requests')
      .set(auth(valeriaSession))
      .expect(200);
    expect(pendientes.map((p: { gymName: string }) => p.gymName)).toEqual([ironName]);

    await http
      .post(`/v1/me/link-requests/${pendientes[0].id}/reject`)
      .set(auth(valeriaSession))
      .expect(201);
    expect(await wallet(valeriaSession)).toEqual(['Dojo Shotokan Miraflores']);

    // El gimnasio ve el rechazo, y puede volver a pedirlo.
    const { body: rechazada } = await http
      .get(`/v1/staff/members/${iron}/link-request`)
      .set(auth(owner))
      .expect(200);
    expect(rechazada.request.status).toBe('rejected');

    await http.post(`/v1/staff/members/${iron}/link-request`).set(auth(owner)).expect(201);
    const { body: otraVez } = await http
      .get('/v1/me/link-requests')
      .set(auth(valeriaSession))
      .expect(200);
    await http
      .post(`/v1/me/link-requests/${otraVez[0].id}/accept`)
      .set(auth(valeriaSession))
      .expect(201);

    expect(await wallet(valeriaSession)).toEqual(['Dojo Shotokan Miraflores', ironName].sort());
  });

  it('un QR vencido o inventado no se canjea', async () => {
    const { body } = await http
      .post('/v1/staff/accounts/lookup')
      .set(auth(frontDesk))
      .send({ token: 'x'.repeat(24) })
      .expect(404);
    expect(JSON.stringify(body)).toMatch(/venció/);
  });

  it('recepción no mira ni reenvía solicitudes de otro gimnasio', async () => {
    const ajena = await findMembership(owner, 'Mathyu Quispe'); // su ficha en Iron Muay Thai
    await http.get(`/v1/staff/members/${ajena}/link-request`).set(auth(frontDesk)).expect(404);
    await http.post(`/v1/staff/members/${ajena}/link-request`).set(auth(frontDesk)).expect(404);
  });

  it('el dueño puede desvincular; recepción no', async () => {
    const julio = await findMembership(frontDesk, 'Julio Salcedo');
    await http.delete(`/v1/staff/members/${julio}/account`).set(auth(frontDesk)).expect(403);
  });
});

suite('vinculación automática del dueño', () => {
  /** Correo del dueño, el que pondría el alta del gimnasio. */
  const OWNER_EMAIL = `sergio.paz.${Date.now()}@example.pe`;

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
        .set({ email: OWNER_EMAIL })
        .where(eq(schema.users.name, 'Sergio Paz'))
        .returning({ id: schema.users.id }),
    );
    await pool.end();
    expect(actualizados).toHaveLength(1);

    const token = declareIdentity('sergio-google', { email: OWNER_EMAIL });
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

  it('un correo desconocido no inventa una cuenta: queda sin ficha', async () => {
    const token = declareIdentity('nadie-google', { email: `nadie.${Date.now()}@example.pe` });
    const { body } = await http.post('/v1/auth/google').send({ idToken: token }).expect(201);
    expect(body.linked).toBe(false);
    expect(body.claim.qrToken).toMatch(/^[A-Za-z0-9_-]{24}$/);
  });
});

/**
 * El dueño de un dojo también entrena en él.
 *
 * `switchToStudent` existía sin par desde el principio, así que el cambio era de
 * ida y sin vuelta: para volver a su puesto había que cerrar sesión y entrar de
 * nuevo. Quien cambiaba a alumno para mirar su billetera se quedaba encerrado.
 *
 * Lo que estas pruebas cuidan no es que el cambio funcione, que es una línea,
 * sino que no regale nada: ni un rol que la base no respalde, ni vida nueva a la
 * sesión que pide el cambio.
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
    const studentRow = await devLogin('+51987111222'); // Lucía, solo alumna
    const disponibles = await modes(studentRow);

    expect(disponibles.student).toBe(true);
    expect(disponibles.staff).toEqual([]);

    // Y la api lo sostiene: el botón no se enseña, pero la ruta tampoco cede.
    await http.post('/v1/auth/switch-to-staff').set(auth(studentRow)).expect(403);
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

  /**
   * Ir y volver NO renueva la sesión.
   *
   * La reemisión se ata al `exp` del token que pide el cambio: lo que queda de
   * vida, nunca más. Sin eso, cada viaje de ida y vuelta devolvería una sesión
   * nueva de siete días, y bastaría con pasar por alumno y volver para tener una
   * sesión eterna en el aparato de quien sea.
   *
   * Lo descubrió el turno del mostrador, que duraba 12 h y se convertía en 7
   * días con dos toques. El turno ya no existe, pero el agujero era del cambio
   * de modo y no del turno: por eso esto sigue aquí, medido contra el login
   * normal.
   */
  it('el cambio NO regala vida: se hereda lo que queda, nunca más', async () => {
    const original = await http
      .post('/v1/auth/switch-to-staff')
      .set(auth(owner))
      .expect(201);

    const asStudent = await http
      .post('/v1/auth/switch-to-student')
      .set(auth(original.body.accessToken))
      .expect(201);
    expect(asStudent.body.expiresInSeconds).toBeLessThanOrEqual(
      original.body.expiresInSeconds,
    );

    const devuelta = await http
      .post('/v1/auth/switch-to-staff')
      .set(auth(asStudent.body.accessToken))
      .expect(201);

    // Lo que quedaba, no una semana nueva a cada salto.
    expect(devuelta.body.expiresInSeconds).toBeLessThanOrEqual(asStudent.body.expiresInSeconds);
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
  const SECOND_TAX_ID = '20131312955';

  let secondTenantId = '';
  let ironTenantId = '';

  interface StaffPost {
    role: string;
    tenantId: string;
    tenantName: string | null;
  }

  const posts = async (bearer: string): Promise<StaffPost[]> => {
    const { body } = await http.get('/v1/auth/modes').set(auth(bearer)).expect(200);
    return (body as { staff: StaffPost[] }).staff;
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
        taxId: SECOND_TAX_ID,
        saasTier: 'free',
        address: 'Av. Primavera 120, Surco',
        documentId: SERGIO_DNI,
      })
      .expect(201);

    secondTenantId = body.tenantId as string;
    createdTenants.push(secondTenantId);

    // Se enganchó a la identidad que YA existía en vez de crear un segundo
    // Sergio: es lo que hace que sea la misma persona en los dos locales.
    const myPosts = await posts(owner);
    expect(myPosts).toHaveLength(2);
    expect(myPosts.map((p) => p.tenantName).sort()).toEqual([
      'Iron Muay Thai Lince',
      'Selección UPC',
    ]);

    ironTenantId = myPosts.find((p) => p.tenantName === 'Iron Muay Thai Lince')!.tenantId;
    expect(secondTenantId).not.toBe(ironTenantId);
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
      .send({ tenantId: secondTenantId })
      .expect(201);

    expect(salto.body.role).toBe('owner');
    expect(salto.body.tenantId).toBe(secondTenantId);

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
    const { body: again } = await http
      .get('/v1/staff/roster')
      .set(auth(vuelta.body.accessToken))
      .expect(200);
    expect(again.length).toBe(enIron.length);
  });

  it('no puede saltar a un local que no es suyo', async () => {
    // El control de acceso entero del cambio de local. Ana trabaja en Dojo
    // Shotokan y Sergio no: pedir ese tenant tiene que morir aquí, no en la
    // consulta siguiente.
    const anaPosts = await posts(frontDesk);
    const shotokan = anaPosts[0]!.tenantId;
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
    const asStudent = await http
      .post('/v1/auth/switch-to-student')
      .set(auth(owner))
      .expect(201);

    const vuelta = await http
      .post('/v1/auth/switch-to-staff')
      .set(auth(asStudent.body.accessToken))
      .expect(201);

    expect(vuelta.body.tenantId).toBe(ironTenantId);
  });

  it('cambiar de local NO regala vida a la sesión', async () => {
    // Mismo agujero que cerró el cambio de modo, con otra puerta: saltar de un
    // local al otro y volver renovaría la sesión indefinidamente.
    const before = await http
      .post('/v1/auth/switch-to-staff')
      .set(auth(owner))
      .send({ tenantId: secondTenantId })
      .expect(201);

    const after = await http
      .post('/v1/auth/switch-to-staff')
      .set(auth(before.body.accessToken))
      .send({ tenantId: ironTenantId })
      .expect(201);

    expect(after.body.expiresInSeconds).toBeLessThanOrEqual(before.body.expiresInSeconds);
  });
});
