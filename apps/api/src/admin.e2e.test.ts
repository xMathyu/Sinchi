/**
 * El panel de Sinchi, de punta a punta.
 *
 * Lo que se prueba aquí es quién puede hacer qué, y no la aritmética: las
 * consultas que cuentan alumnos se leen; las cerraduras no se ven mirando el
 * código. Cinco son las que importan y cada una tiene su prueba:
 *
 *  1. entrar exige estar en `platform_admins` Y traer el correo verificado;
 *  2. los dos tipos de token son EXCLUYENTES —el del panel no abre un gimnasio,
 *     el de un dueño no abre el panel—, que es lo que hace que un `owner` no
 *     pueda suspender al dojo de al lado;
 *  3. suspender corta la sesión del staff de verdad;
 *  4. borrar exige suspensión previa y el identificador escrito, y la cascada
 *     se lleva lo de dentro **con el rol de la api, sujeto a RLS** — que es la
 *     duda real de este cambio y no se resuelve leyendo la documentación;
 *  5. retirarle el acceso a alguien corta el token que YA tenía abierto.
 *
 * Necesita `TEST_DATABASE_URL` y un rol sin BYPASSRLS, igual que los demás e2e:
 * con un rol que se salta RLS, la prueba 4 pasa sin probar nada.
 */
import { randomBytes, randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UnauthorizedException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { eq, inArray } from 'drizzle-orm';
import { FirebaseVerifier, type VerifiedIdentity } from './auth/firebase';

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const suite = DATABASE_URL === undefined ? describe.skip : describe;

let app: INestApplication;
let http: ReturnType<typeof request>;

/** El que nace con la migración 0024. */
const FOUNDER = 'xmathyu@gmail.com';

const identities = new Map<string, VerifiedIdentity>();
const fakeVerifier = {
  verify: async (idToken: string): Promise<VerifiedIdentity> => {
    const identity = identities.get(idToken);
    if (identity === undefined) throw new UnauthorizedException('Sesion invalida.');
    return identity;
  },
};

/**
 * Declara una identidad de Firebase de mentira.
 *
 * `emailVerified` y `provider` son parámetros porque son justo lo que la puerta
 * del panel comprueba: sin poder falsearlos, las dos pruebas que importan no se
 * pueden escribir.
 */
function declareIdentity(
  uid: string,
  email: string,
  options: { readonly verified?: boolean; readonly provider?: string } = {},
): string {
  const token = `${uid}.${'x'.repeat(120)}`;
  identities.set(token, {
    uid,
    email,
    emailVerified: options.verified ?? true,
    displayName: uid,
    provider: options.provider ?? 'google.com',
  });
  return token;
}

const runId = randomInt(10_000_000, 89_000_000);
let contador = 0;
const nextValue = (): string => String(runId + ++contador);

/** RUC reales: el alta comprueba el dígito verificador. */
const RUC = ['20100070970', '20131312955', '20100047218'];

const auth = (bearer: string) => ({ Authorization: `Bearer ${bearer}` });

/** Lo que esta prueba crea y tiene que recoger: los tenants son permanentes. */
const created: string[] = [];
const codes: string[] = [];
const invited: string[] = [];

let adminToken = '';
let founderId = '';

interface CreatedGym {
  readonly tenantId: string;
  readonly slug: string;
  readonly ownerToken: string;
  readonly ownerUid: string;
}

/** Un gimnasio nuevo con su dueño dentro, por la puerta pública del alta. */
async function crearGimnasio(label: string): Promise<CreatedGym> {
  const uid = `dueno-${runId}-${label}`;
  const res = await http
    .post('/v1/gyms/signup')
    .send({
      idToken: declareIdentity(uid, `${uid}@example.com`),
      gymName: `Dojo ${label} ${runId}`,
      taxId: RUC[contador % RUC.length]!,
      saasTier: 'up_to_60',
      address: 'Av. Primavera 120, Surco',
      ownerName: `Dueño ${label}`,
      documentId: nextValue(),
      phone: `+519${nextValue().slice(0, 8)}`,
    })
    .expect(201);

  created.push(res.body.tenantId as string);
  return {
    tenantId: res.body.tenantId as string,
    slug: res.body.slug as string,
    ownerToken: res.body.session.accessToken as string,
    ownerUid: uid,
  };
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

  const entrada = await http
    .post('/v1/admin/session')
    .send({ idToken: declareIdentity(`admin-${runId}`, FOUNDER) })
    .expect(201);

  adminToken = entrada.body.accessToken as string;
  founderId = entrada.body.adminId as string;
}, 90_000);

afterAll(async () => {
  if (app !== undefined) {
    const { schema, withoutTenantIsolation } = await import('./db/client');
    const { DATABASE } = await import('./db/db.module');
    const db = app.get(DATABASE);

    await withoutTenantIsolation(db, async (tx) => {
      if (created.length > 0) {
        await tx.delete(schema.tenants).where(inArray(schema.tenants.id, created));
      }
      if (codes.length > 0) {
        await tx.delete(schema.saasPromoCodes).where(inArray(schema.saasPromoCodes.code, codes));
      }
      // El registro apunta a los administradores con RESTRICT, así que primero
      // se va lo que hicieron. Es la misma razón por la que en producción el
      // acceso se retira en vez de borrarse.
      await tx.delete(schema.platformActions);
      if (invited.length > 0) {
        await tx
          .delete(schema.platformAdmins)
          .where(inArray(schema.platformAdmins.email, invited));
      }
      // El fundador se queda: nace con la migración, no con esta prueba. Solo se
      // le deshace lo que la prueba le tocó.
      await tx
        .update(schema.platformAdmins)
        .set({ revokedAt: null })
        .where(eq(schema.platformAdmins.email, FOUNDER));
    });
  }
  await app?.close();
});

suite('entrar al panel de Sinchi', () => {
  it('deja entrar al correo que está en la tabla, verificado por Google', () => {
    expect(adminToken.length).toBeGreaterThan(20);
    expect(founderId.length).toBeGreaterThan(20);
  });

  it('no deja entrar a un correo que no administra Sinchi', async () => {
    const res = await http
      .post('/v1/admin/session')
      .send({ idToken: declareIdentity(`intruso-${runId}`, `intruso-${runId}@gmail.com`) });

    expect(res.status).toBe(401);
    // El mismo mensaje que para un correo sin verificar: distinguirlos le
    // confirma a quien prueba direcciones cuál de ellas está en la tabla.
    expect(res.body.message).toContain('no administra Sinchi');
  });

  /**
   * El ataque real: registrarse con el correo del fundador en un proveedor que
   * no verifica nada. Estar en la tabla no basta — hay que PRESENTAR el correo
   * verificado.
   */
  it('no deja entrar con el correo del fundador sin verificar', async () => {
    const res = await http
      .post('/v1/admin/session')
      .send({
        idToken: declareIdentity(`falso-${runId}`, FOUNDER, { verified: false }),
      });

    expect(res.status).toBe(401);
    expect(res.body.message).toContain('no administra Sinchi');
  });

  it('no deja entrar con correo y contraseña, aunque el correo sea el correcto', async () => {
    const res = await http.post('/v1/admin/session').send({
      idToken: declareIdentity(`password-${runId}`, FOUNDER, { provider: 'password' }),
    });

    expect(res.status).toBe(401);
    expect(res.body.message).toContain('con Google');
  });
});

suite('los dos mundos no se tocan', () => {
  it('el token del panel de Sinchi no abre las rutas de un gimnasio', async () => {
    const res = await http.get('/v1/staff/roster').set(auth(adminToken));

    expect(res.status).toBe(403);
    expect(res.body.message).toContain('no abre las rutas de un gimnasio');
  });

  /**
   * La que de verdad importa: un dueño con su sesión normal no puede mirar —ni
   * tocar— el resto de la red. Sin esto, el panel entero sería una escalada de
   * privilegios a un `GET` de distancia.
   */
  it('la sesión de un dueño no abre el panel de Sinchi', async () => {
    const gym = await crearGimnasio('curioso');

    for (const ruta of ['/v1/admin/overview', '/v1/admin/gyms', '/v1/admin/admins']) {
      const res = await http.get(ruta).set(auth(gym.ownerToken));
      expect(res.status, ruta).toBe(403);
      expect(res.body.message, ruta).toContain('panel de Sinchi');
    }
  });

  it('sin token no se entra a nada del panel', async () => {
    await http.get('/v1/admin/gyms').expect(401);
  });
});

suite('mirar la red', () => {
  it('cuenta los gimnasios y suma lo de dentro', async () => {
    const overview = (await http.get('/v1/admin/overview').set(auth(adminToken)).expect(200)).body;

    expect(overview.gyms.total).toBeGreaterThan(0);
    expect(overview.gyms.active + overview.gyms.suspended).toBe(overview.gyms.total);
    expect(overview.people.admins).toBeGreaterThanOrEqual(1);
    // El dueño del gimnasio recién creado es una ficha de staff, no un alumno,
    // así que lo que se afirma es lo que sí tiene que existir.
    expect(overview.network.activeMembers).toBeGreaterThanOrEqual(0);
  });

  it('lista cada gimnasio con su suscripción y sus números', async () => {
    const gym = await crearGimnasio('listado');
    const gyms = (await http.get('/v1/admin/gyms').set(auth(adminToken)).expect(200)).body;

    const mio = gyms.find((row: { id: string }) => row.id === gym.tenantId);
    expect(mio).toBeDefined();
    expect(mio.slug).toBe(gym.slug);
    // Recién dado de alta: está en su mes gratis y puede escribir.
    expect(mio.saas.canWrite).toBe(true);
    expect(mio.stats.staffCount).toBe(1);
  });

  /**
   * Los números salen con contexto de CADA gimnasio (`withTenant`). Si algún día
   * alguien los junta en una sola consulta sin contexto, RLS devolvería cero
   * filas y esta prueba lo diría.
   */
  it('el detalle trae el staff y los planes del gimnasio', async () => {
    const gym = await crearGimnasio('detalle');
    const detail = (
      await http.get(`/v1/admin/gyms/${gym.tenantId}`).set(auth(adminToken)).expect(200)
    ).body;

    expect(detail.staff).toHaveLength(1);
    expect(detail.staff[0].role).toBe('owner');
    // Sin planes todavia: el alta crea el local y el dueno escribe sus planes
    // despues, desde la app. Lo que se afirma es que la lista LLEGA.
    expect(detail.planList).toEqual([]);
    expect(detail.stats.staffCount).toBe(1);
  });
});

suite('editar un gimnasio', () => {
  it('cambia lo que se le manda y deja el resto quieto', async () => {
    const gym = await crearGimnasio('editar');

    const updated = (
      await http
        .post(`/v1/admin/gyms/${gym.tenantId}`)
        .set(auth(adminToken))
        .send({ graceDays: 12, enrollmentFeeCents: 5000 })
        .expect(201)
    ).body;

    expect(updated.graceDays).toBe(12);
    expect(updated.enrollmentFeeCents).toBe(5000);
    expect(updated.name).toBe(`Dojo editar ${runId}`);
  });

  it('el identificador se normaliza como en el alta', async () => {
    const gym = await crearGimnasio('slug');
    const updated = (
      await http
        .post(`/v1/admin/gyms/${gym.tenantId}`)
        .set(auth(adminToken))
        .send({ slug: `Dojo Renombrado ${runId}` })
        .expect(201)
    ).body;

    expect(updated.slug).toBe(`dojo-renombrado-${runId}`);
  });

  it('un RUC inventado no entra', async () => {
    const gym = await crearGimnasio('ruc');
    const res = await http
      .post(`/v1/admin/gyms/${gym.tenantId}`)
      .set(auth(adminToken))
      .send({ taxId: '20123456789' });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('RUC');
  });

  /** Cambiar el estado es otra ruta, con su motivo. No un campo más del parche. */
  it('el parche no puede suspender por la puerta de atrás', async () => {
    const gym = await crearGimnasio('parche');
    await http
      .post(`/v1/admin/gyms/${gym.tenantId}`)
      .set(auth(adminToken))
      .send({ status: 'suspended' })
      .expect(201);

    const detail = (
      await http.get(`/v1/admin/gyms/${gym.tenantId}`).set(auth(adminToken)).expect(200)
    ).body;
    expect(detail.status).toBe('active');
  });

  it('cada edición queda en el registro con el antes y el después', async () => {
    const gym = await crearGimnasio('registro');
    await http
      .post(`/v1/admin/gyms/${gym.tenantId}`)
      .set(auth(adminToken))
      .send({ graceDays: 9 })
      .expect(201);

    const actions = (
      await http
        .get(`/v1/admin/actions?tenantId=${gym.tenantId}`)
        .set(auth(adminToken))
        .expect(200)
    ).body;

    const edicion = actions.find((row: { action: string }) => row.action === 'gym.update');
    expect(edicion).toBeDefined();
    expect(edicion.adminEmail).toBe(FOUNDER);
    expect(edicion.detail.graceDays).toEqual({ from: 5, to: 9 });
  });
});

suite('suspender un gimnasio', () => {
  it('exige un motivo escrito', async () => {
    const gym = await crearGimnasio('sinmotivo');
    const res = await http
      .post(`/v1/admin/gyms/${gym.tenantId}/suspend`)
      .set(auth(adminToken))
      .send({ reason: 'x' });

    expect(res.status).toBe(400);
  });

  /**
   * La prueba que da sentido a todo: suspender tiene que significar algo. Si
   * esto se rompe y alguien lo "arregla" quitando la comprobación del login,
   * suspender vuelve a ser una columna que nadie mira.
   */
  it('el dueño de un gimnasio suspendido no puede volver a entrar', async () => {
    const gym = await crearGimnasio('suspendido');

    const suspended = (
      await http
        .post(`/v1/admin/gyms/${gym.tenantId}/suspend`)
        .set(auth(adminToken))
        .send({ reason: 'Cobra por fuera y no responde' })
        .expect(201)
    ).body;

    expect(suspended.status).toBe('suspended');
    expect(suspended.suspendedAt).not.toBeNull();

    const res = await http
      .post('/v1/auth/google')
      .send({ idToken: declareIdentity(gym.ownerUid, `${gym.ownerUid}@example.com`) });

    expect(res.status).toBe(403);
    // El motivo viaja: quien entra tiene que saber qué pasó, no reinstalar la app.
    expect(res.body.message).toContain('Cobra por fuera');
  });

  it('reactivar le devuelve la entrada, y el motivo se queda en el registro', async () => {
    const gym = await crearGimnasio('reactivado');
    await http
      .post(`/v1/admin/gyms/${gym.tenantId}/suspend`)
      .set(auth(adminToken))
      .send({ reason: 'Duplicado de otro local' })
      .expect(201);

    const restored = (
      await http
        .post(`/v1/admin/gyms/${gym.tenantId}/restore`)
        .set(auth(adminToken))
        .expect(201)
    ).body;

    expect(restored.status).toBe('active');
    expect(restored.suspendedAt).toBeNull();

    const login = await http
      .post('/v1/auth/google')
      .send({ idToken: declareIdentity(gym.ownerUid, `${gym.ownerUid}@example.com`) })
      .expect(201);
    expect(login.body.role).toBe('owner');

    const actions = (
      await http
        .get(`/v1/admin/actions?tenantId=${gym.tenantId}`)
        .set(auth(adminToken))
        .expect(200)
    ).body;
    expect(actions.some((row: { action: string }) => row.action === 'gym.suspend')).toBe(true);
    expect(actions.some((row: { action: string }) => row.action === 'gym.restore')).toBe(true);
  });
});

suite('eliminar un gimnasio', () => {
  it('no borra uno activo, aunque se escriba bien el identificador', async () => {
    const gym = await crearGimnasio('activo');
    const res = await http
      .delete(`/v1/admin/gyms/${gym.tenantId}`)
      .set(auth(adminToken))
      .send({ slug: gym.slug });

    expect(res.status).toBe(403);
    expect(res.body.message).toContain('Suspéndelo primero');
  });

  it('no borra si el identificador no coincide', async () => {
    const gym = await crearGimnasio('mistipeo');
    await http
      .post(`/v1/admin/gyms/${gym.tenantId}/suspend`)
      .set(auth(adminToken))
      .send({ reason: 'Siembra de pruebas en producción' })
      .expect(201);

    const res = await http
      .delete(`/v1/admin/gyms/${gym.tenantId}`)
      .set(auth(adminToken))
      .send({ slug: `${gym.slug}-x` });

    expect(res.status).toBe(403);
    expect(res.body.message).toContain('no coincide');
  });

  /**
   * La duda real de todo este cambio: la api corre con un rol SIN BYPASSRLS, y
   * lo que cuelga de un gimnasio vive detrás de `FORCE ROW LEVEL SECURITY`. Si
   * la cascada de Postgres no atravesara las políticas, este borrado fallaría —
   * y no hay forma de saberlo leyendo el código.
   */
  it('borra el gimnasio y la cascada se lleva lo de dentro, con el rol de la api', async () => {
    const gym = await crearGimnasio('borrado');
    await http
      .post(`/v1/admin/gyms/${gym.tenantId}/suspend`)
      .set(auth(adminToken))
      .send({ reason: 'Local que nunca existió' })
      .expect(201);

    await http
      .delete(`/v1/admin/gyms/${gym.tenantId}`)
      .set(auth(adminToken))
      .send({ slug: gym.slug })
      .expect(200);

    await http.get(`/v1/admin/gyms/${gym.tenantId}`).set(auth(adminToken)).expect(404);

    const { schema, withoutTenantIsolation } = await import('./db/client');
    const { DATABASE } = await import('./db/db.module');
    const db = app.get(DATABASE);

    const quedan = await withoutTenantIsolation(db, (tx) =>
      tx.select().from(schema.tenants).where(eq(schema.tenants.id, gym.tenantId)),
    );
    expect(quedan).toHaveLength(0);

    // El registro sobrevive al gimnasio: `platform_actions.tenant_id` no tiene
    // clave foránea justo para esto.
    const actions = (
      await http
        .get(`/v1/admin/actions?tenantId=${gym.tenantId}`)
        .set(auth(adminToken))
        .expect(200)
    ).body;
    const borrado = actions.find((row: { action: string }) => row.action === 'gym.delete');
    expect(borrado).toBeDefined();
    expect(borrado.subject).toBe(gym.slug);
    expect(borrado.detail.staffCount).toBe(1);
  });
});

suite('códigos de promoción', () => {
  it('crea un código y lo lista con sus canjes', async () => {
    const code = `PANEL${runId}`;
    codes.push(code);

    const created = (
      await http
        .post('/v1/admin/promos')
        .set(auth(adminToken))
        .send({ code, freeMonths: 2, maxRedemptions: 5, note: 'prueba del panel' })
        .expect(201)
    ).body;

    expect(created.code).toBe(code);
    expect(created.redeemedCount).toBe(0);
    expect(created.redemptions).toEqual([]);
  });

  it('no deja crear dos veces el mismo código', async () => {
    const code = `REPE${runId}`;
    codes.push(code);

    await http
      .post('/v1/admin/promos')
      .set(auth(adminToken))
      .send({ code, freeMonths: 1, maxRedemptions: 1 })
      .expect(201);

    const res = await http
      .post('/v1/admin/promos')
      .set(auth(adminToken))
      .send({ code, freeMonths: 12, maxRedemptions: 999 });

    expect(res.status).toBe(409);
  });

  it('rechaza un código que nacería vencido', async () => {
    const res = await http
      .post('/v1/admin/promos')
      .set(auth(adminToken))
      .send({ code: `VIEJO${runId}`, freeMonths: 1, maxRedemptions: 1, expiresOn: '2020-01-01' });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('vencimiento');
  });

  it('apagar un código lo deja sin canjear, y el canje aparece en la lista', async () => {
    const code = `APAGA${runId}`;
    codes.push(code);

    const promo = (
      await http
        .post('/v1/admin/promos')
        .set(auth(adminToken))
        .send({ code, freeMonths: 1, maxRedemptions: 10 })
        .expect(201)
    ).body;

    // Un gimnasio lo canjea antes de que se apague.
    const gym = await crearGimnasio('canje');
    await http
      .post('/v1/staff/promo')
      .set(auth(gym.ownerToken))
      .send({ code })
      .expect(201);

    await http
      .post(`/v1/admin/promos/${promo.id}/status`)
      .set(auth(adminToken))
      .send({ active: false })
      .expect(201);

    const promos = (await http.get('/v1/admin/promos').set(auth(adminToken)).expect(200)).body;
    const mio = promos.find((row: { code: string }) => row.code === code);

    expect(mio.active).toBe(false);
    expect(mio.redeemedCount).toBe(1);
    expect(mio.redemptions[0].tenantSlug).toBe(gym.slug);
  });
});

suite('el equipo del panel', () => {
  it('invita por correo a alguien que todavía no ha entrado', async () => {
    const email = `dev${runId}@sinchi.fit`;
    invited.push(email);

    const nuevo = (
      await http
        .post('/v1/admin/admins')
        .set(auth(adminToken))
        .send({ email: ` ${email.toUpperCase()} `, name: 'Dev Nuevo' })
        .expect(201)
    ).body;

    // Normalizado: el correo es la llave con la que se busca al entrar.
    expect(nuevo.email).toBe(email);
    expect(nuevo.hasSignedIn).toBe(false);
    expect(nuevo.invitedByEmail).toBe(FOUNDER);
  });

  it('el invitado entra con su Google y ve el panel', async () => {
    const email = `entra${runId}@sinchi.fit`;
    invited.push(email);

    await http
      .post('/v1/admin/admins')
      .set(auth(adminToken))
      .send({ email })
      .expect(201);

    const sesion = (
      await http
        .post('/v1/admin/session')
        .send({ idToken: declareIdentity(`invitado-${runId}`, email) })
        .expect(201)
    ).body;

    await http.get('/v1/admin/overview').set(auth(sesion.accessToken as string)).expect(200);
  });

  it('no deja invitar dos veces al mismo correo', async () => {
    const email = `doble${runId}@sinchi.fit`;
    invited.push(email);

    await http.post('/v1/admin/admins').set(auth(adminToken)).send({ email }).expect(201);
    const res = await http.post('/v1/admin/admins').set(auth(adminToken)).send({ email });

    expect(res.status).toBe(403);
    expect(res.body.message).toContain('ya tiene acceso');
  });

  it('nadie se quita su propio acceso', async () => {
    const res = await http.delete(`/v1/admin/admins/${founderId}`).set(auth(adminToken));

    expect(res.status).toBe(403);
    expect(res.body.message).toContain('otro administrador');
  });

  /**
   * El token del retirado sigue siendo válido —le quedan horas de vida— y aun
   * así deja de abrir. Es lo que hace `PlatformAdminGuard` releyendo la fila: sin
   * él, retirarle el acceso a alguien no surtiría efecto hasta medio día después.
   */
  it('retirarle el acceso a alguien corta el token que ya tenía abierto', async () => {
    const email = `fuera${runId}@sinchi.fit`;
    invited.push(email);

    const nuevo = (
      await http.post('/v1/admin/admins').set(auth(adminToken)).send({ email }).expect(201)
    ).body;

    const suya = (
      await http
        .post('/v1/admin/session')
        .send({ idToken: declareIdentity(`fuera-${runId}`, email) })
        .expect(201)
    ).body.accessToken as string;

    await http.get('/v1/admin/overview').set(auth(suya)).expect(200);

    await http.delete(`/v1/admin/admins/${nuevo.id}`).set(auth(adminToken)).expect(200);

    const res = await http.get('/v1/admin/overview').set(auth(suya));
    expect(res.status).toBe(401);
    expect(res.body.message).toContain('ya no está vigente');
  });

  it('a quien se le retiró el acceso se le puede volver a invitar', async () => {
    const email = `vuelve${runId}@sinchi.fit`;
    invited.push(email);

    const primero = (
      await http.post('/v1/admin/admins').set(auth(adminToken)).send({ email }).expect(201)
    ).body;
    await http.delete(`/v1/admin/admins/${primero.id}`).set(auth(adminToken)).expect(200);

    const segundo = (
      await http.post('/v1/admin/admins').set(auth(adminToken)).send({ email }).expect(201)
    ).body;

    // La MISMA fila: si naciera una segunda, retirarle el acceso a una dejaría
    // la otra viva.
    expect(segundo.id).toBe(primero.id);
    expect(segundo.revokedAt).toBeNull();
  });
});
