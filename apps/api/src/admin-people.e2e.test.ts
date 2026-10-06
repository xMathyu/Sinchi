/**
 * Las personas desde el panel de Sinchi, de punta a punta.
 *
 * Tres cosas se prueban aquí que no se ven leyendo el código:
 *
 *  1. **el baneo muerde en las dos puertas**: la sesión de Sinchi que ya estaba
 *     abierta, y todo lo que entra con un token de Google. Para probar la
 *     segunda, esta suite NO sustituye `FirebaseVerifier` entero como las
 *     demás: usa el verdadero y solo falsea `decode`, que es la parte de Google.
 *     Sustituirlo entero se llevaría justo la comprobación que hay que probar;
 *  2. **eliminar cumple la política publicada**: se va la ficha con todo lo que
 *     la identifica, y el cobro SE QUEDA sin decir de quién — en la caja del
 *     gimnasio, con el rol de la api sujeto a RLS. Es lo que la 0027 hizo
 *     posible y lo que no se deduce del esquema;
 *  3. **la baja no levanta un baneo**: la misma cuenta de Google vuelve con un
 *     uid nuevo después de borrar su usuario de Firebase, y tiene que seguir
 *     fuera.
 *
 * Necesita `TEST_DATABASE_URL` y un rol sin BYPASSRLS, igual que los demás e2e.
 */
import { randomBytes, randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UnauthorizedException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { eq, inArray } from 'drizzle-orm';
import { TZ_LIMA, formatPlainDate, plainDateInZone } from '@sinchi/shared';
import { FirebaseVerifier, type VerifiedIdentity } from './auth/firebase';
import { AccountBans } from './auth/account-bans';
import { AppleRevocation, type AppleRevocationOutcome } from './auth/apple-revocation';

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const suite = DATABASE_URL === undefined ? describe.skip : describe;

let app: INestApplication;
let http: ReturnType<typeof request>;

const FOUNDER = 'xmathyu@gmail.com';

const identities = new Map<string, VerifiedIdentity>();
/** Los uid que el servicio intentó borrar de Firebase. */
const deletedFromFirebase: string[] = [];

function declareIdentity(uid: string, email: string, provider = 'google.com'): string {
  const token = `${uid}.${'x'.repeat(120)}`;
  identities.set(token, {
    uid,
    email,
    emailVerified: true,
    displayName: uid,
    provider,
  });
  return token;
}

/** Las cuentas que entran con Apple, para lo que Firebase diría de ellas. */
const appleUids = new Set<string>();
/** Los códigos de Apple que la api canjeó y revocó. */
const revokedCodes: string[] = [];

/**
 * La revocación de verdad —decide cuándo pedir el código— con la llave puesta y
 * sin hablar con Apple.
 */
class AppleWithKey extends AppleRevocation {
  override get configured(): boolean {
    return true;
  }
  override async revokeWithCode(code: string): Promise<AppleRevocationOutcome> {
    revokedCodes.push(code);
    return 'revoked';
  }
}

const runId = randomInt(10_000_000, 89_000_000);
let contador = 0;
const nextValue = (): string => String(runId + ++contador);
/** DNI de 8 dígitos, distinto por corrida: es único en la red. */
const nextDni = (): string => String(10_000_000 + ((runId + ++contador * 7919) % 89_999_999));
const nextPhone = (): string => `+519${nextValue().slice(0, 8)}`;

const auth = (bearer: string) => ({ Authorization: `Bearer ${bearer}` });
const hoy = (): string => formatPlainDate(plainDateInZone(new Date(), TZ_LIMA));

const created: string[] = [];
const uids: string[] = [];

let adminToken = '';
let ownerToken = '';
let ownerUserId = '';
let ownerDocument = '';
let planId = '';
let gymSlug = '';

/** Rosa: alumna vinculada, con app. */
const rosa = {
  uid: `rosa-${runId}`,
  email: `rosa.${runId}@ejemplo.pe`,
  name: `Rosa Prueba ${runId}`,
  document: '',
  phone: '',
  userId: '',
  token: '',
  membershipId: '',
};

/** El curioso del directorio: entró con Google y no está en ningún padrón. */
const curioso = {
  uid: `curioso-${runId}`,
  email: `curioso.${runId}@ejemplo.pe`,
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
    .useFactory({
      // El verdadero, con la lista de baneos verdadera. Solo se falsea lo que
      // habla con Google: verificar la firma del token y borrar el usuario.
      factory: (bans: AccountBans) => {
        const verifier = new FirebaseVerifier(bans);
        verifier.decode = async (idToken: string) => {
          const identity = identities.get(idToken);
          if (identity === undefined) throw new UnauthorizedException('Sesion invalida.');
          return identity;
        };
        verifier.deleteAccount = async (uid: string) => {
          deletedFromFirebase.push(uid);
          return { outcome: 'deleted' as const };
        };
        verifier.providersOf = async (uid: string) =>
          appleUids.has(uid) ? ['apple.com'] : ['google.com'];
        return verifier;
      },
      inject: [AccountBans],
    })
    .overrideProvider(AppleRevocation)
    .useValue(new AppleWithKey())
    .compile();

  app = moduleRef.createNestApplication();
  configureApp(app, loadEnv());
  await app.init();
  http = request(app.getHttpServer());

  adminToken = (
    await http
      .post('/v1/admin/session')
      .send({ idToken: declareIdentity(`admin-${runId}`, FOUNDER) })
      .expect(201)
  ).body.accessToken as string;

  // Un gimnasio con su dueño, por la puerta pública del alta.
  const ownerUid = `dueno-${runId}`;
  uids.push(ownerUid);
  ownerDocument = nextValue();
  const gym = await http
    .post('/v1/gyms/signup')
    .send({
      idToken: declareIdentity(ownerUid, `${ownerUid}@example.com`),
      gymName: `Dojo Personas ${runId}`,
      saasTier: 'up_to_60',
      address: 'Av. Primavera 120, Surco',
      ownerName: `Dueño Personas ${runId}`,
      documentId: ownerDocument,
      phone: nextPhone(),
    })
    .expect(201);
  created.push(gym.body.tenantId as string);
  gymSlug = gym.body.slug as string;
  ownerToken = gym.body.session.accessToken as string;
  ownerUserId = gym.body.session.userId as string;

  planId = (
    await http
      .post('/v1/staff/plans')
      .set(auth(ownerToken))
      .send({
        name: 'Mensualidad',
        type: 'unlimited',
        sessionsPerWeek: null,
        allowedDays: null,
        priceCents: 12_000,
      })
      .expect(201)
  ).body.id as string;

  // Rosa: el mostrador la invita con su correo, y entra con Google ya inscrita.
  rosa.document = nextDni();
  rosa.phone = nextPhone();
  uids.push(rosa.uid);
  await http
    .post('/v1/staff/invites')
    .set(auth(ownerToken))
    .send({
      fullName: rosa.name,
      email: rosa.email,
      documentId: rosa.document,
      phone: rosa.phone,
      planId,
    })
    .expect(201);

  const entrada = await http
    .post('/v1/auth/google')
    .send({ idToken: declareIdentity(rosa.uid, rosa.email) })
    .expect(201);
  expect(entrada.body.linked).toBe(true);
  rosa.token = entrada.body.accessToken as string;
  rosa.userId = entrada.body.userId as string;

  const roster = await http.get('/v1/staff/roster').set(auth(ownerToken)).expect(200);
  rosa.membershipId = (
    roster.body as { membership: { id: string }; user: { name: string } }[]
  ).find((row) => row.user.name === rosa.name)!.membership.id;

  // El curioso: entra con Google y no está en ningún padrón.
  uids.push(curioso.uid);
  const suelto = await http
    .post('/v1/auth/google')
    .send({ idToken: declareIdentity(curioso.uid, curioso.email) })
    .expect(201);
  expect(suelto.body.linked).toBe(false);
}, 120_000);

afterAll(async () => {
  if (app !== undefined) {
    const { schema, withoutTenantIsolation } = await import('./db/client');
    const { DATABASE } = await import('./db/db.module');
    const db = app.get(DATABASE);

    await withoutTenantIsolation(db, async (tx) => {
      if (created.length > 0) {
        await tx.delete(schema.tenants).where(inArray(schema.tenants.id, created));
      }
      await tx.delete(schema.accountBans).where(inArray(schema.accountBans.firebaseUid, uids));
      await tx
        .delete(schema.accountBans)
        .where(inArray(schema.accountBans.email, [rosa.email, curioso.email]));
      await tx.delete(schema.accountClaims).where(inArray(schema.accountClaims.firebaseUid, uids));
      await tx.delete(schema.platformActions);
    });
  }
  await app?.close();
});

suite('la lista de personas', () => {
  it('encuentra una ficha por su documento', async () => {
    const { body } = await http
      .get(`/v1/admin/people?q=${rosa.document}`)
      .set(auth(adminToken))
      .expect(200);

    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].id).toBe(rosa.userId);
    expect(body.rows[0].hasApp).toBe(true);
    expect(body.rows[0].banned).toBe(false);
  });

  it('encuentra un celular aunque se escriba con espacios', async () => {
    const conEspacios = `${rosa.phone.slice(0, 6)} ${rosa.phone.slice(6)}`;
    const { body } = await http
      .get(`/v1/admin/people?q=${encodeURIComponent(conEspacios)}`)
      .set(auth(adminToken))
      .expect(200);

    expect(body.rows.map((row: { id: string }) => row.id)).toContain(rosa.userId);
  });

  /**
   * La cuenta sin ficha va en su pestaña, y la que YA tiene ficha no: su uid
   * abre la de Rosa, y aparecer en las dos listas invitaría a eliminar la mitad.
   */
  it('las cuentas sin ficha van aparte, y sin las que ya tienen ficha', async () => {
    const sueltas = await http
      .get(`/v1/admin/people?kind=account&q=${encodeURIComponent(curioso.email)}`)
      .set(auth(adminToken))
      .expect(200);
    expect(sueltas.body.rows.map((row: { id: string }) => row.id)).toContain(curioso.uid);

    const deRosa = await http
      .get(`/v1/admin/people?kind=account&q=${encodeURIComponent(rosa.email)}`)
      .set(auth(adminToken))
      .expect(200);
    expect(deRosa.body.rows).toEqual([]);
  });

  it('un comodín de SQL se busca como texto', async () => {
    const { body } = await http.get('/v1/admin/people?q=%25').set(auth(adminToken)).expect(200);
    // «%» a secas no puede devolver a todo el mundo.
    expect(body.rows.length).toBeLessThan(body.pageSize);
  });

  it('la sesión de un dueño no ve la lista', async () => {
    await http.get('/v1/admin/people').set(auth(ownerToken)).expect(403);
  });
});

suite('la ficha de una persona', () => {
  it('trae sus gimnasios, contados con su propio contexto', async () => {
    const { body } = await http
      .get(`/v1/admin/people/${rosa.userId}`)
      .set(auth(adminToken))
      .expect(200);

    expect(body.memberships).toHaveLength(1);
    expect(body.memberships[0].tenantName).toBe(`Dojo Personas ${runId}`);
    expect(body.staff).toEqual([]);
    expect(body.confirmationKey).toBe(rosa.document);
  });

  it('dice dónde trabaja quien es del equipo de un gimnasio', async () => {
    const { body } = await http
      .get(`/v1/admin/people/${ownerUserId}`)
      .set(auth(adminToken))
      .expect(200);
    expect(body.staff).toHaveLength(1);
    expect(body.staff[0].role).toBe('owner');
  });

  it('un id que no es uuid es un 400, no un 500', async () => {
    await http.get('/v1/admin/people/no-es-un-uuid').set(auth(adminToken)).expect(400);
  });
});

suite('corregir los datos', () => {
  it('corrige los cuatro, y el registro guarda QUÉ cambió, no los valores', async () => {
    rosa.document = nextDni();
    rosa.phone = nextPhone();
    const nombre = `Rosa Corregida ${runId}`;

    const { body } = await http
      .post(`/v1/admin/people/${rosa.userId}`)
      .set(auth(adminToken))
      .send({ name: nombre, phone: rosa.phone, documentId: rosa.document, email: rosa.email })
      .expect(201);

    expect(body.name).toBe(nombre);
    expect(body.documentId).toBe(rosa.document);
    rosa.name = nombre;

    const actions = (
      await http
        .get(`/v1/admin/actions?subject=${rosa.userId}`)
        .set(auth(adminToken))
        .expect(200)
    ).body;
    const edicion = actions.find((row: { action: string }) => row.action === 'person.update');
    expect(edicion.detail.fields).toEqual(expect.arrayContaining(['name', 'phone', 'documentId']));
    // La política promete borrar sus datos con su cuenta: un registro que
    // guardara el antes y el después los conservaría para siempre.
    expect(JSON.stringify(edicion.detail)).not.toContain(nombre);
  });

  it('no deja quedarse con el documento de otra persona', async () => {
    const res = await http
      .post(`/v1/admin/people/${rosa.userId}`)
      .set(auth(adminToken))
      .send({ name: rosa.name, phone: rosa.phone, documentId: ownerDocument, email: rosa.email });

    expect(res.status).toBe(409);
    expect(res.body.message).toContain('otra persona');
  });

  it('un celular inválido se rechaza con la frase de la app', async () => {
    const res = await http
      .post(`/v1/admin/people/${rosa.userId}`)
      .set(auth(adminToken))
      .send({ name: rosa.name, phone: '123', documentId: rosa.document, email: '' });
    expect(res.status).toBe(400);
  });
});

suite('banear', () => {
  /**
   * La sesión de Rosa dura una semana. Un baneo que esperara a que caducara
   * sería una semana más de app para alguien a quien acabamos de sacar.
   */
  it('corta la sesión que ya estaba abierta, con el motivo', async () => {
    await http.get('/v1/me').set(auth(rosa.token)).expect(200);

    await http
      .post(`/v1/admin/people/${rosa.userId}/ban`)
      .set(auth(adminToken))
      .send({ reason: 'Insulta a los gimnasios por el chat' })
      .expect(201);

    const res = await http.get('/v1/me').set(auth(rosa.token));
    // 401 y no 403: es lo que hace que la app suelte la sesión y la lleve al
    // login, donde lee el motivo. Con un 403 se quedaría dentro, viendo un error
    // en cada pantalla.
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('account_banned');
    expect(res.body.message).toContain('Insulta a los gimnasios');
  });

  /** La otra puerta: todo lo que entra con un token de Google. */
  it('no la deja volver a entrar con Google', async () => {
    const res = await http
      .post('/v1/auth/google')
      .send({ idToken: declareIdentity(rosa.uid, rosa.email) });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('account_banned');
  });

  it('no banea dos veces', async () => {
    const res = await http
      .post(`/v1/admin/people/${rosa.userId}/ban`)
      .set(auth(adminToken))
      .send({ reason: 'Insulta a los gimnasios por el chat' });
    expect(res.status).toBe(403);
    expect(res.body.message).toContain('ya está baneada');
  });

  /** Banear a una alumna no castiga a su gimnasio. */
  it('su gimnasio sigue funcionando y la sigue viendo en su padrón', async () => {
    const roster = await http.get('/v1/staff/roster').set(auth(ownerToken)).expect(200);
    const names = (roster.body as { user: { name: string } }[]).map((row) => row.user.name);
    expect(names).toContain(rosa.name);
  });

  it('levantar el baneo le devuelve la app al momento', async () => {
    const ficha = (
      await http.get(`/v1/admin/people/${rosa.userId}`).set(auth(adminToken)).expect(200)
    ).body;
    const vivo = ficha.bans.find((ban: { liftedAt: string | null }) => ban.liftedAt === null);

    await http.post(`/v1/admin/bans/${vivo.id}/lift`).set(auth(adminToken)).expect(201);
    await http.get('/v1/me').set(auth(rosa.token)).expect(200);

    const despues = (
      await http.get(`/v1/admin/people/${rosa.userId}`).set(auth(adminToken)).expect(200)
    ).body;
    // Levantado, no borrado: es historia que alguien va a preguntar.
    expect(despues.bans).toHaveLength(1);
    expect(despues.bans[0].liftedByEmail).toBe(FOUNDER);
  });

  it('a una cuenta sin ficha también, por su cuenta de Google', async () => {
    await http
      .post(`/v1/admin/accounts/${curioso.uid}/ban`)
      .set(auth(adminToken))
      .send({ reason: 'Reserva clases de prueba que nunca viene' })
      .expect(201);

    const res = await http
      .post('/v1/auth/google')
      .send({ idToken: declareIdentity(curioso.uid, curioso.email) });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('account_banned');
  });
});

suite('eliminar una cuenta', () => {
  let requestId = '';

  beforeAll(async () => {
    if (DATABASE_URL === undefined) return;

    // Lo que un alumno de verdad deja: un cobro con su ficha, una marca en la
    // puerta, y la baja pedida desde su app.
    await http
      .post('/v1/staff/payments')
      .set(auth(ownerToken))
      .send({ membershipId: rosa.membershipId, type: 'enrollment', rail: 'cash', amountCents: 5_000 })
      .expect(201);
    await http
      .post('/v1/staff/checkin/manual')
      .set(auth(ownerToken))
      .send({ membershipId: rosa.membershipId, overrideDenial: true })
      .expect(201);

    requestId = (
      await http
        .post('/v1/me/account/deletion-request')
        .set(auth(rosa.token))
        .send({ reason: 'Me llamo Rosa y ya no entreno' })
        .expect(201)
    ).body.request.id as string;
  });

  it('la baja pedida aparece con los días que le quedan', async () => {
    const { body } = await http
      .get('/v1/admin/people/deletion-requests')
      .set(auth(adminToken))
      .expect(200);
    const suya = body.find((row: { userId: string }) => row.userId === rosa.userId);
    expect(suya.daysLeft).toBe(30);
  });

  /**
   * Su fila de `staff` es la que abre el gimnasio. Eliminarla dejaría un local
   * sin nadie que pueda entrar a él.
   */
  it('no elimina a quien trabaja en un gimnasio', async () => {
    const res = await http
      .delete(`/v1/admin/people/${ownerUserId}`)
      .set(auth(adminToken))
      .send({ confirm: ownerDocument });
    expect(res.status).toBe(403);
    expect(res.body.message).toContain(`Dojo Personas ${runId}`);
  });

  it('no elimina si lo escrito no es su documento', async () => {
    const res = await http
      .delete(`/v1/admin/people/${rosa.userId}`)
      .set(auth(adminToken))
      .send({ confirm: rosa.name });
    expect(res.status).toBe(403);
    expect(res.body.message).toContain('no coincide');
  });

  it('se lleva la ficha y deja el cobro en la caja, sin decir de quién', async () => {
    const { body } = await http
      .delete(`/v1/admin/people/${rosa.userId}`)
      .set(auth(adminToken))
      .send({ confirm: rosa.document })
      .expect(200);

    expect(body.memberships).toBe(1);
    expect(body.chargesAnonymized).toBeGreaterThanOrEqual(1);
    expect(body.firebase).toBe('deleted');
    expect(deletedFromFirebase).toContain(rosa.uid);

    await http.get(`/v1/admin/people/${rosa.userId}`).set(auth(adminToken)).expect(404);

    // Fuera del padrón...
    const roster = await http.get('/v1/staff/roster').set(auth(ownerToken)).expect(200);
    const names = (roster.body as { user: { name: string } }[]).map((row) => row.user.name);
    expect(names).not.toContain(rosa.name);

    // ...pero la caja del gimnasio sigue cuadrando. Es lo único que la política
    // promete conservar, y `charges.membership_id` era CASCADE.
    const ledger = (
      await http
        .get(`/v1/staff/reports/charges?from=${hoy()}&through=${hoy()}`)
        .set(auth(ownerToken))
        .expect(200)
    ).body;
    const matricula = ledger.rows.find(
      (row: { charge: { amountCents: number; type: string } }) =>
        row.charge.type === 'enrollment' && row.charge.amountCents === 5_000,
    );
    expect(matricula).toBeDefined();
    expect(matricula.memberName).toBeNull();
  });

  /**
   * La prueba de que se cumplió. Antes de la 0027 la solicitud colgaba de la
   * persona con CASCADE: ejecutar la baja borraba la prueba de haberla hecho.
   */
  it('la solicitud queda hecha, con fecha, y sin a quién apuntar', async () => {
    const { schema, withoutTenantIsolation } = await import('./db/client');
    const { DATABASE } = await import('./db/db.module');
    const [row] = await withoutTenantIsolation(app.get(DATABASE), (tx) =>
      tx
        .select()
        .from(schema.accountDeletionRequests)
        .where(eq(schema.accountDeletionRequests.id, requestId)),
    );

    expect(row?.status).toBe('done');
    expect(row?.resolvedAt).not.toBeNull();
    expect(row?.userId).toBeNull();
    // Lo que escribió al pedirla puede decir cualquier cosa, incluido su nombre.
    expect(row?.reason).toBeNull();
  });

  it('el registro guarda números, no sus datos', async () => {
    const actions = (
      await http
        .get(`/v1/admin/actions?subject=${rosa.userId}`)
        .set(auth(adminToken))
        .expect(200)
    ).body;
    const baja = actions.find((row: { action: string }) => row.action === 'person.delete');
    expect(baja.detail.memberships).toBe(1);
    expect(baja.detail.firebase).toBe('deleted');
    expect(JSON.stringify(actions)).not.toContain(rosa.document);
  });
});

suite('la baja no levanta un baneo', () => {
  it('se elimina la cuenta sin ficha con su correo escrito', async () => {
    const { body } = await http
      .delete(`/v1/admin/accounts/${curioso.uid}`)
      .set(auth(adminToken))
      .send({ confirm: curioso.email.toUpperCase() })
      .expect(200);

    expect(body.firebase).toBe('deleted');
    await http.get(`/v1/admin/accounts/${curioso.uid}`).set(auth(adminToken)).expect(404);
  });

  /**
   * Borrar su usuario de Firebase hace que la misma cuenta de Google vuelva con
   * un uid NUEVO. Con solo el uid, eliminar la cuenta de alguien baneado sería
   * la forma de quitarse el baneo.
   */
  it('la misma cuenta de Google, con uid nuevo, sigue fuera', async () => {
    const nuevoUid = `curioso-otra-vez-${runId}`;
    uids.push(nuevoUid);

    const res = await http
      .post('/v1/auth/google')
      .send({ idToken: declareIdentity(nuevoUid, curioso.email) });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('account_banned');
  });
});

/**
 * Lo que Apple pidió en la 5.1.1(v): quien crea su cuenta con Google o con Apple
 * y todavía no está en ningún padrón tiene que poder borrarla desde la app.
 */
suite('la persona elimina su propia cuenta sin ficha', () => {
  it('se va en el acto, con lo que dejó en los gimnasios y su usuario de Firebase', async () => {
    const uid = `se-va-${runId}`;
    uids.push(uid);
    const idToken = declareIdentity(uid, `se.va.${runId}@ejemplo.pe`);

    const entrada = await http.post('/v1/auth/google').send({ idToken }).expect(201);
    expect(entrada.body.linked).toBe(false);

    // Deja un rastro dentro de un gimnasio: le escribe preguntando.
    await http
      .post(`/v1/gyms/${gymSlug}/messages`)
      .send({
        idToken,
        body: '¿Tienen clases para niños?',
        fullName: `Se Va ${runId}`,
        phone: nextPhone(),
      })
      .expect(201);
    const antes = await http.get(`/v1/admin/accounts/${uid}`).set(auth(adminToken)).expect(200);
    expect(antes.body.footprint.conversations).toBe(1);

    const { body } = await http.post('/v1/account/delete').send({ idToken }).expect(201);

    // Entró con Google: no hay nada que revocar en Apple.
    expect(body).toEqual({ deleted: true, firebase: 'deleted', apple: null });
    expect(deletedFromFirebase).toContain(uid);
    await http.get(`/v1/admin/accounts/${uid}`).set(auth(adminToken)).expect(404);
    const { body: bandeja } = await http
      .get('/v1/staff/conversations')
      .set(auth(ownerToken))
      .expect(200);
    expect(JSON.stringify(bandeja)).not.toContain(`Se Va ${runId}`);
  });

  it('quien ya tiene ficha no se borra por aquí: su baja es la solicitud de 30 días', async () => {
    // El dueño: su cuenta de Google abre su ficha. (Rosa no sirve aquí: el panel
    // ya la eliminó más arriba.)
    const ownerUid = `dueno-${runId}`;
    const { body } = await http
      .post('/v1/account/delete')
      .send({ idToken: declareIdentity(ownerUid, `${ownerUid}@example.com`) })
      .expect(409);
    expect(String(body.message)).toContain('pide la baja desde Ajustes');
    expect(deletedFromFirebase).not.toContain(ownerUid);
  });

  it('sin un token de Firebase válido no borra nada', async () => {
    await http
      .post('/v1/account/delete')
      .send({ idToken: `nadie.${'x'.repeat(120)}` })
      .expect(401);
  });
});

/**
 * La revocación de «Entrar con Apple» que Apple espera junto a la 5.1.1(v): borrar
 * la cuenta tiene que desvincularla también de su Apple ID.
 */
suite('la cuenta creada con Apple se desvincula de Apple al borrarse', () => {
  it('sin el código de Apple no borra nada y le pide confirmar con Apple', async () => {
    const uid = `con-apple-${runId}`;
    uids.push(uid);
    appleUids.add(uid);
    const idToken = declareIdentity(uid, `con.apple.${runId}@privaterelay.appleid.com`, 'apple.com');
    await http.post('/v1/auth/google').send({ idToken }).expect(201);

    const { body } = await http.post('/v1/account/delete').send({ idToken }).expect(409);
    expect(body.code).toBe('apple_authorization_required');
    // Sigue entera: el 409 va antes de borrar, que después no habría con qué pedirlo.
    expect(deletedFromFirebase).not.toContain(uid);

    const borrada = await http
      .post('/v1/account/delete')
      .send({ idToken, appleAuthorizationCode: `codigo-de-apple-${runId}` })
      .expect(201);
    expect(borrada.body).toEqual({ deleted: true, firebase: 'deleted', apple: 'revoked' });
    expect(revokedCodes).toContain(`codigo-de-apple-${runId}`);
    expect(deletedFromFirebase).toContain(uid);
  });

  it('desde un teléfono que no puede pedir el código, se borra igual y sin revocar', async () => {
    const uid = `con-apple-android-${runId}`;
    uids.push(uid);
    appleUids.add(uid);
    const idToken = declareIdentity(uid, `android.${runId}@privaterelay.appleid.com`, 'apple.com');
    await http.post('/v1/auth/google').send({ idToken }).expect(201);

    const { body } = await http
      .post('/v1/account/delete')
      .send({ idToken, appleUnavailable: true })
      .expect(201);
    expect(body.apple).toBe('skipped');
    expect(deletedFromFirebase).toContain(uid);
  });

  it('quien tiene ficha y entra con Apple revoca al PEDIR la baja de 30 días', async () => {
    const ownerUid = `dueno-${runId}`;
    appleUids.add(ownerUid);

    const { body } = await http
      .post('/v1/me/account/deletion-request')
      .set(auth(ownerToken))
      .send({})
      .expect(409);
    expect(body.code).toBe('apple_authorization_required');

    const pedida = await http
      .post('/v1/me/account/deletion-request')
      .set(auth(ownerToken))
      .send({ appleAuthorizationCode: `codigo-del-dueno-${runId}` })
      .expect(201);
    expect(pedida.body.apple).toBe('revoked');
    expect(pedida.body.request.status).toBe('pending');
    expect(revokedCodes).toContain(`codigo-del-dueno-${runId}`);

    // Se arrepiente: la solicitud se cancela y su gimnasio sigue como estaba.
    await http.delete('/v1/me/account/deletion-request').set(auth(ownerToken)).expect(200);
    appleUids.delete(ownerUid);
  });
});
