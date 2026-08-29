/**
 * Prueba de punta a punta contra un Postgres real.
 *
 * Levanta la api completa —guards, controladores, transacciones, RLS— y la
 * recorre por HTTP. Es lo único que demuestra que las piezas encajan: los tests
 * de esquema prueban las restricciones y los de `@sinchi/shared` prueban las
 * reglas, pero ninguno prueba que el pago que registra el mostrador libere de
 * verdad el acceso en la puerta.
 *
 * Se salta si no hay `TEST_DATABASE_URL`, para que `npm test` siga corriendo sin
 * base. Para levantarla:
 *
 *   docker run -d --name sinchi-pg -e POSTGRES_PASSWORD=postgres -p 55432:5432 postgres:17
 *   docker exec -i sinchi-pg psql -U postgres -c "create role sinchi_app login password 'app_local' nosuperuser nobypassrls"
 *   docker exec -i sinchi-pg psql -U postgres -c "create database sinchi_test owner sinchi_app"
 *
 * El rol es NO superusuario y dueño de las tablas a propósito: así reproduce a
 * `neondb_owner` de Neon, donde `FORCE ROW LEVEL SECURITY` sí aplica. Con un
 * superusuario, RLS se salta y el aislamiento no probaría nada.
 */
import { randomBytes } from 'node:crypto';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { encodeQrPayload, generateTotp, type HmacFn } from '@sinchi/shared';

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const suite = DATABASE_URL === undefined ? describe.skip : describe;

const hmacSha256: HmacFn = (key, message) => hmac(sha256, key, message);

let app: INestApplication;
let http: ReturnType<typeof request>;

interface Tokens {
  student: string;
  frontDesk: string;
  owner: string;
  novaFrontDesk: string;
}
const token: Tokens = { student: '', frontDesk: '', owner: '', novaFrontDesk: '' };

interface RosterEntry {
  membership: { id: string };
  user: { name: string; id: string };
  tenant: { id: string; name: string };
  plan: { id: string; name: string; priceCents: number };
  subscription: { status: string; nextBillingDate: unknown };
  pendingPlan: { name: string } | null;
  level: string;
  badge: string;
  receivable: { due: boolean; amountCents: number; periodsOwed: number };
  quota: {
    limit: number | null;
    used: number;
    remaining: number | null;
    exhausted: boolean;
    isLastSession: boolean;
  };
  delinquency: { status: string; daysPastDue: number };
}

const login = async (phone: string): Promise<string> => {
  const response = await http.post('/v1/auth/dev-login').send({ phone }).expect(201);
  return response.body.accessToken as string;
};

const auth = (bearer: string) => ({ Authorization: `Bearer ${bearer}` });

const find = (roster: readonly RosterEntry[], name: string): RosterEntry => {
  const entry = roster.find((row) => row.user.name === name);
  if (entry === undefined) throw new Error(`${name} no está en el padrón.`);
  return entry;
};

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;

  process.env.DATABASE_URL = DATABASE_URL;
  process.env.JWT_SECRET ??= randomBytes(48).toString('base64url');
  process.env.ENCRYPTION_KEY ??= randomBytes(32).toString('base64');
  process.env.ALLOW_DEV_LOGIN = 'true';
  process.env.NODE_ENV = 'test';

  // Estos tests registran pagos y cambian planes. Sin resembrar, la segunda
  // corrida arranca con el estado que dejo la primera y las aserciones fallan
  // por motivos que no tienen que ver con el codigo.
  const { runSeed } = await import('./db/seed');
  await runSeed({ reset: true, quiet: true });

  const { AppModule } = await import('./app.module');
  const { configureApp } = await import('./bootstrap');
  const { loadEnv } = await import('./config/env');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

  app = moduleRef.createNestApplication();
  // La MISMA configuracion que el arranque real. Montar la app a mano aqui es
  // como se cuela un fallo de arranque con todos los tests en verde.
  configureApp(app, loadEnv());
  await app.init();
  http = request(app.getHttpServer());

  token.student = await login('+51987654321');
  token.frontDesk = await login('+51987000111');
  token.novaFrontDesk = await login('+51987000222');
  token.owner = await login('+51987000333');
}, 60_000);

afterAll(async () => {
  await app?.close();
});

suite('salud', () => {
  it('responde vivo y listo', async () => {
    await http.get('/v1/health').expect(200);
    const ready = await http.get('/v1/health/ready').expect(200);
    expect(ready.body.database).toBe('ok');
  });
});

suite('autenticación', () => {
  it('rechaza sin token', async () => {
    await http.get('/v1/me').expect(401);
  });

  it('rechaza un token inventado', async () => {
    await http.get('/v1/me').set(auth('no.es.un.token')).expect(401);
  });

  it('un alumno no entra a las rutas de staff', async () => {
    await http.get('/v1/staff/roster').set(auth(token.student)).expect(403);
  });

  it('recepción no ve los reportes: son del dueño', async () => {
    await http.get('/v1/staff/summary').set(auth(token.frontDesk)).expect(403);
    await http.get('/v1/staff/summary').set(auth(token.owner)).expect(200);
  });
});

suite('billetera del alumno', () => {
  it('devuelve una identidad con sus tres gimnasios', async () => {
    // Es la idea del producto: una persona, una app, todas sus suscripciones.
    const { body } = await http.get('/v1/me').set(auth(token.student)).expect(200);

    expect(body.user.name).toBe('Mathyu Quispe');
    expect(body.wallet).toHaveLength(3);

    const names = body.wallet.map((entry: RosterEntry) => entry.tenant?.name ?? '').sort();
    expect(names).toEqual([
      'Dojo Shotokan Miraflores',
      'Iron Muay Thai Lince',
      'Nova BJJ Surco',
    ]);
  });

  it('cada membresía llega con su semáforo calculado', async () => {
    const { body } = await http.get('/v1/me/wallet').set(auth(token.student)).expect(200);

    const byGym = new Map<string, RosterEntry & { tenant: { name: string } }>(
      body.map((entry: RosterEntry & { tenant: { name: string } }) => [entry.tenant.name, entry]),
    );

    // Al día, plan ilimitado.
    expect(byGym.get('Dojo Shotokan Miraflores')!.level).toBe('ok');

    // Le queda exactamente una sesion de la semana. El numero absoluto depende
    // del dia en que se sembro —solo se puede marcar una vez por dia—, asi que
    // se afirma la propiedad y no la cifra.
    const nova = byGym.get('Nova BJJ Surco')!;
    expect(nova.quota.remaining).toBe(1);
    expect(nova.quota.isLastSession).toBe(true);
    expect(nova.level).toBe('warn');
    expect(nova.badge).toBe('1 SESIÓN');

    // 12 días de mora contra 5 de gracia.
    const iron = byGym.get('Iron Muay Thai Lince')!;
    expect(iron.delinquency.status).toBe('suspended');
    expect(iron.level).toBe('blocked');
    expect(iron.receivable.due).toBe(true);
  });

  it('el estado se recalcula: la columna sembrada decía "active"', async () => {
    // El seed deja `status = 'active'` a propósito. Que la api devuelva
    // "suspended" prueba que manda `evaluateDelinquency` y no la columna.
    const { body } = await http.get('/v1/me/wallet').set(auth(token.student)).expect(200);
    const iron = body.find(
      (entry: RosterEntry & { tenant: { name: string } }) =>
        entry.tenant.name === 'Iron Muay Thai Lince',
    );
    expect(iron.subscription.status).toBe('suspended');
    expect(iron.delinquency.daysPastDue).toBe(12);
  });

  it('no puede leer una membresía ajena', async () => {
    const { body: roster } = await http
      .get('/v1/staff/roster')
      .set(auth(token.frontDesk))
      .expect(200);
    const ajena = find(roster, 'Diego Salas').membership.id;

    // Mismo 404 que si no existiera: decir "existe pero no es tuya" confirma
    // la existencia de una membresía ajena.
    await http.get(`/v1/me/memberships/${ajena}`).set(auth(token.student)).expect(404);
  });
});

suite('padrón del staff', () => {
  it('trae los cuatro estados del semáforo', async () => {
    const { body: roster } = await http
      .get('/v1/staff/roster')
      .set(auth(token.frontDesk))
      .expect(200);

    expect(find(roster, 'Lucía Ferrer').level).toBe('ok');
    expect(find(roster, 'Julio Salcedo').quota.exhausted).toBe(true);
    expect(find(roster, 'Julio Salcedo').quota.remaining).toBe(0);
    expect(find(roster, 'Julio Salcedo').level).toBe('alert');
    expect(find(roster, 'Rosa Salazar').delinquency.status).toBe('in_grace');
    expect(find(roster, 'Diego Salas').delinquency.status).toBe('suspended');
  });

  it('busca por nombre y por documento', async () => {
    const porNombre = await http
      .get('/v1/staff/roster/search?q=sal')
      .set(auth(token.frontDesk))
      .expect(200);
    // Salas, Salcedo, Salazar.
    expect(porNombre.body).toHaveLength(3);

    const porDoc = await http
      .get('/v1/staff/roster/search?q=70112334')
      .set(auth(token.frontDesk))
      .expect(200);
    expect(porDoc.body).toHaveLength(1);
    expect(porDoc.body[0].user.name).toBe('Diego Salas');
  });
});

suite('aislamiento por tenant', () => {
  it('recepción de un gimnasio no ve el padrón del otro', async () => {
    const shotokan = await http.get('/v1/staff/roster').set(auth(token.frontDesk)).expect(200);
    const nova = await http.get('/v1/staff/roster').set(auth(token.novaFrontDesk)).expect(200);

    const shotokanIds = new Set(shotokan.body.map((row: RosterEntry) => row.membership.id));
    const novaIds = new Set(nova.body.map((row: RosterEntry) => row.membership.id));

    expect(shotokanIds.size).toBeGreaterThan(0);
    expect(novaIds.size).toBeGreaterThan(0);
    for (const id of novaIds) expect(shotokanIds.has(id)).toBe(false);
  });

  it('no puede leer una membresía de otro gimnasio por su id', async () => {
    // La defensa real: aunque el uuid sea correcto, RLS no devuelve la fila.
    const nova = await http.get('/v1/staff/roster').set(auth(token.novaFrontDesk)).expect(200);
    const ajena = nova.body[0].membership.id;

    await http.get(`/v1/staff/members/${ajena}`).set(auth(token.frontDesk)).expect(404);
  });
});

suite('la puerta', () => {
  let diego = '';
  let julio = '';
  let lucia = '';

  beforeAll(async () => {
    const { body: roster } = await http.get('/v1/staff/roster').set(auth(token.frontDesk));
    diego = find(roster, 'Diego Salas').membership.id;
    julio = find(roster, 'Julio Salcedo').membership.id;
    lucia = find(roster, 'Lucía Ferrer').membership.id;
  });

  it('deja pasar a quien está al día', async () => {
    const { body } = await http
      .post('/v1/staff/checkin/manual')
      .set(auth(token.frontDesk))
      .send({ membershipId: lucia })
      .expect(201);

    expect(body.registered).toBe(true);
    expect(body.result.allowed).toBe(true);
    expect(body.message.title).toBe('Puede pasar');
  });

  it('un segundo marcado el mismo día no consume otra sesión', async () => {
    // El doble escaneo en la puerta es lo normal, no la excepción.
    const { body } = await http
      .post('/v1/staff/checkin/manual')
      .set(auth(token.frontDesk))
      .send({ membershipId: lucia })
      .expect(201);

    expect(body.registered).toBe(true);
    expect(body.alreadyRegistered).toBe(true);
  });

  it('bloquea al moroso con el motivo, no con un error', async () => {
    const { body } = await http
      .post('/v1/staff/checkin/manual')
      .set(auth(token.frontDesk))
      .send({ membershipId: diego })
      .expect(201);

    expect(body.registered).toBe(false);
    expect(body.result.allowed).toBe(false);
    expect(body.result.reason.code).toBe('delinquent');
    expect(body.result.reason.daysPastDue).toBe(12);
    expect(body.message.action).toBe('Cobrar S/ 120 en mostrador');
  });

  it('rechaza por cupo agotado a quien está al día', async () => {
    const { body } = await http
      .post('/v1/staff/checkin/manual')
      .set(auth(token.frontDesk))
      .send({ membershipId: julio })
      .expect(201);

    expect(body.result.allowed).toBe(false);
    expect(body.result.reason.code).toBe('quota_exhausted');
    expect(body.result.reason.used).toBe(body.result.reason.limit);
    // Dojo Shotokan tiene la política `block`: no ofrece clase suelta.
    expect(body.result.reason.offerDropIn).toBe(false);
  });

  it('un segundo intento del que ya marco devuelve el registro existente', async () => {
    // Julio tiene el cupo agotado justamente porque ya marco hoy. Forzar el
    // ingreso no crea un segundo marcado: el indice unico por dia lo impide y la
    // api devuelve el que ya estaba.
    const { body } = await http
      .post('/v1/staff/checkin/manual')
      .set(auth(token.frontDesk))
      .send({ membershipId: julio, overrideDenial: true })
      .expect(201);

    expect(body.registered).toBe(true);
    expect(body.alreadyRegistered).toBe(true);
  });

  it('dejar pasar a un moroso queda auditado', async () => {
    // Existe porque el recepcionista lo va a hacer con o sin boton. Teniendolo,
    // queda con su nombre y el motivo en vez de volverse invisible.
    const { body } = await http
      .post('/v1/staff/checkin/manual')
      .set(auth(token.frontDesk))
      .send({ membershipId: diego, overrideDenial: true })
      .expect(201);

    expect(body.registered).toBe(true);
    expect(body.alreadyRegistered).toBe(false);
    expect(body.attendance.method).toBe('manual');
    expect(body.attendance.recordedBy).not.toBeNull();
    expect(body.attendance.overrodeDenial).toBe(true);
  });
});

suite('cobro en mostrador libera el acceso', () => {
  let diego = '';

  beforeAll(async () => {
    const { body: roster } = await http.get('/v1/staff/roster').set(auth(token.frontDesk));
    diego = find(roster, 'Diego Salas').membership.id;
  });

  it('el cobro extiende la renovación y reactiva', async () => {
    // Es el ciclo del MD 4.5: un pago manual activa lo mismo que activaría un
    // cobro con tarjeta.
    const antes = await http.get(`/v1/staff/members/${diego}`).set(auth(token.frontDesk));
    expect(antes.body.delinquency.status).toBe('suspended');
    const deuda = antes.body.receivable.amountCents;
    expect(deuda).toBeGreaterThan(0);

    const { body } = await http
      .post('/v1/staff/payments')
      .set(auth(token.frontDesk))
      .send({ membershipId: diego, type: 'renewal', rail: 'cash' })
      .expect(201);

    expect(body.charge.status).toBe('succeeded');
    expect(body.charge.rail).toBe('cash');
    expect(body.charge.amountCents).toBe(deuda);
    expect(body.charge.recordedBy).not.toBeNull();
    // La respuesta trae el estado de DESPUÉS: el mostrador no debe recargar.
    expect(body.view.delinquency.status).toBe('active');
    expect(body.view.receivable.due).toBe(false);
  });

  it('y el acceso queda liberado al instante', async () => {
    const { body } = await http
      .post('/v1/staff/checkin/manual')
      .set(auth(token.frontDesk))
      .send({ membershipId: diego })
      .expect(201);

    expect(body.registered).toBe(true);
    expect(body.result.allowed).toBe(true);
  });

  it('pagar dos veces adelanta dos periodos, no cobra dos el mismo', async () => {
    // Cada pago mueve `nextBillingDate`, asi que el segundo cubre el periodo
    // siguiente: pagar dos meses adelantados es valido. Lo que el indice unico
    // de la base impide es dos cargos exitosos del MISMO periodo, y eso se
    // verifica en `schema.test.ts` contra Postgres.
    const antes = await http.get(`/v1/staff/members/${diego}`).set(auth(token.frontDesk));
    const fechaAntes = antes.body.subscription.nextBillingDate;

    const primero = await http
      .post('/v1/staff/payments')
      .set(auth(token.frontDesk))
      .send({ membershipId: diego, type: 'renewal', rail: 'cash' })
      .expect(201);
    expect(primero.body.alreadyRecorded).toBe(false);

    const segundo = await http
      .post('/v1/staff/payments')
      .set(auth(token.frontDesk))
      .send({ membershipId: diego, type: 'renewal', rail: 'cash' })
      .expect(201);
    expect(segundo.body.alreadyRecorded).toBe(false);

    // Periodos distintos y consecutivos.
    expect(segundo.body.charge.periodStart).not.toEqual(primero.body.charge.periodStart);
    expect(primero.body.charge.periodEnd).toEqual(segundo.body.charge.periodStart);
    expect(segundo.body.view.subscription.nextBillingDate).not.toEqual(fechaAntes);
  });

  it('la cola offline no duplica: mismo clientId, un solo cargo', async () => {
    const { body: roster } = await http.get('/v1/staff/roster').set(auth(token.frontDesk));
    const rosa = find(roster, 'Rosa Salazar').membership.id;
    const clientId = crypto.randomUUID();

    const primero = await http
      .post('/v1/staff/payments')
      .set(auth(token.frontDesk))
      .send({ membershipId: rosa, type: 'renewal', rail: 'yape', clientId })
      .expect(201);
    expect(primero.body.alreadyRecorded).toBe(false);

    const reintento = await http
      .post('/v1/staff/payments')
      .set(auth(token.frontDesk))
      .send({ membershipId: rosa, type: 'renewal', rail: 'yape', clientId })
      .expect(201);
    expect(reintento.body.alreadyRecorded).toBe(true);
    expect(reintento.body.charge.id).toBe(primero.body.charge.id);
  });

  it('rechaza el riel de tarjeta: no existe en la versión 1', async () => {
    const { body: roster } = await http.get('/v1/staff/roster').set(auth(token.frontDesk));
    const lucia = find(roster, 'Lucía Ferrer').membership.id;

    // Lo rechaza el esquema de entrada antes de llegar al servicio, que es lo
    // deseable: falla en el borde. Detras hay dos redes mas —la guarda del
    // servicio y la restriccion `charges_no_card_rail_yet` de la base.
    const { body } = await http
      .post('/v1/staff/payments')
      .set(auth(token.frontDesk))
      .send({ membershipId: lucia, type: 'renewal', rail: 'card' })
      .expect(400);

    expect(JSON.stringify(body)).toMatch(/rail/);
  });
});

suite('QR firmado de punta a punta', () => {
  it('el código que genera el dispositivo del alumno valida en la puerta', async () => {
    // Es el circuito completo del MD 4.6: el servidor siembra el secreto, el
    // dispositivo genera el código sin internet y la puerta lo verifica.
    const link = await http.post('/v1/me/device').set(auth(token.student)).send({}).expect(201);

    expect(link.body.algorithm).toBe('HMAC-SHA256');
    expect(link.body.periodSeconds).toBe(30);

    const secret = new Uint8Array(Buffer.from(link.body.secret as string, 'base64'));
    const code = generateTotp(secret, new Date(), hmacSha256);
    const payload = encodeQrPayload({
      subject: 'user',
      id: link.body.userId as string,
      code,
    });

    // Se escanea en Dojo Shotokan, que opera con horario libre. Nova BJJ si
    // controla horarios, asi que alli el veredicto dependeria de la hora a la
    // que corren los tests y la prueba dejaria de ser determinista.
    const { body } = await http
      .post('/v1/staff/checkin/qr')
      .set(auth(token.frontDesk))
      .send({ payload, record: false })
      .expect(201);

    expect(body.view.user.name).toBe('Mathyu Quispe');
    expect(body.view.tenant.name).toBe('Dojo Shotokan Miraflores');
    expect(body.result.allowed).toBe(true);
  });

  it('rechaza un código de otro secreto', async () => {
    const link = await http.post('/v1/me/device').set(auth(token.student)).send({}).expect(201);
    const otro = new Uint8Array(randomBytes(32));
    const code = generateTotp(otro, new Date(), hmacSha256);
    const payload = encodeQrPayload({ subject: 'user', id: link.body.userId as string, code });

    await http
      .post('/v1/staff/checkin/qr')
      .set(auth(token.frontDesk))
      .send({ payload })
      .expect(400);
  });

  it('rechaza un QR que no es de Sinchi', async () => {
    await http
      .post('/v1/staff/checkin/qr')
      .set(auth(token.frontDesk))
      .send({ payload: 'https://ejemplo.com/algun-qr' })
      .expect(400);
  });

  it('rotar el secreto invalida el código anterior', async () => {
    // Es lo que hay que hacer cuando el alumno pierde el celular.
    const antes = await http.get('/v1/me').set(auth(token.student)).expect(200);
    const viejo = await http.post('/v1/me/device').set(auth(token.student)).send({}).expect(201);
    const codigoViejo = generateTotp(
      new Uint8Array(Buffer.from(viejo.body.secret as string, 'base64')),
      new Date(),
      hmacSha256,
    );

    await http.post('/v1/me/device').set(auth(token.student)).send({ rotate: true }).expect(201);

    const payload = encodeQrPayload({
      subject: 'user',
      id: antes.body.user.id as string,
      code: codigoViejo,
    });
    await http
      .post('/v1/staff/checkin/qr')
      .set(auth(token.frontDesk))
      .send({ payload })
      .expect(400);
  });
});

suite('cambio de plan', () => {
  it('un upgrade cobra solo el diferencial prorrateado y no mueve la fecha', async () => {
    const { body: wallet } = await http.get('/v1/me/wallet').set(auth(token.student)).expect(200);
    const nova = wallet.find(
      (entry: RosterEntry & { tenant: { name: string } }) => entry.tenant.name === 'Nova BJJ Surco',
    );
    const antes = nova.subscription.nextBillingDate;

    const { body: plans } = await http
      .get(`/v1/me/memberships/${nova.membership.id}/plans`)
      .set(auth(token.student))
      .expect(200);

    const ilimitado = plans.find((plan: { name: string }) => plan.name === 'Ilimitado');
    expect(ilimitado).toBeDefined();
    expect(ilimitado.priceCents).toBeGreaterThan(nova.plan.priceCents);

    const { body } = await http
      .post(`/v1/me/memberships/${nova.membership.id}/plan`)
      .set(auth(token.student))
      .send({ planId: ilimitado.id })
      .expect(201);

    expect(body.decision.kind).toBe('upgrade');
    // Solo la diferencia por los días que faltan, no los S/ 30 completos.
    expect(body.decision.chargeTodayCents).toBeGreaterThan(0);
    // Solo la parte proporcional, nunca el diferencial mensual completo.
    expect(body.decision.chargeTodayCents).toBeLessThan(
      ilimitado.priceCents - nova.plan.priceCents,
    );
    // La fecha de cobro NO se toca.
    expect(body.view.subscription.nextBillingDate).toEqual(antes);
    expect(body.view.plan.name).toBe('Ilimitado');
  });

  it('un downgrade no cobra nada y queda pendiente', async () => {
    const { body: wallet } = await http.get('/v1/me/wallet').set(auth(token.student)).expect(200);
    const nova = wallet.find(
      (entry: RosterEntry & { tenant: { name: string } }) => entry.tenant.name === 'Nova BJJ Surco',
    );

    const { body: plans } = await http
      .get(`/v1/me/memberships/${nova.membership.id}/plans`)
      .set(auth(token.student))
      .expect(200);
    const masBarato = [...plans]
      .sort((a: { priceCents: number }, b: { priceCents: number }) => a.priceCents - b.priceCents)
      .find((plan: { priceCents: number }) => plan.priceCents < nova.plan.priceCents);
    expect(masBarato).toBeDefined();

    const { body } = await http
      .post(`/v1/me/memberships/${nova.membership.id}/plan`)
      .set(auth(token.student))
      .send({ planId: masBarato.id })
      .expect(201);

    expect(body.decision.kind).toBe('downgrade');
    expect(body.decision.chargeTodayCents).toBe(0);
    // Sigue con el plan caro hasta la renovacion: nunca hay devoluciones.
    expect(body.view.plan.name).toBe('Ilimitado');
    expect(body.view.pendingPlan.name).toBe(masBarato.name);
  });

  it('no acepta un plan de otro gimnasio', async () => {
    const { body: wallet } = await http.get('/v1/me/wallet').set(auth(token.student)).expect(200);
    const nova = wallet.find(
      (entry: RosterEntry & { tenant: { name: string } }) => entry.tenant.name === 'Nova BJJ Surco',
    );
    const shotokan = wallet.find(
      (entry: RosterEntry & { tenant: { name: string } }) =>
        entry.tenant.name === 'Dojo Shotokan Miraflores',
    );

    await http
      .post(`/v1/me/memberships/${nova.membership.id}/plan`)
      .set(auth(token.student))
      .send({ planId: shotokan.plan.id })
      .expect(400);
  });
});

suite('alta de alumnos', () => {
  it('reconoce a quien ya esta en la red y no duplica la identidad', async () => {
    // El punto del producto: Mathyu ya existe. Nova no crea una persona nueva,
    // detecta que es el mismo y choca por la membresia, no por los datos.
    const { body: novaPlans } = await http
      .get('/v1/staff/plans')
      .set(auth(token.novaFrontDesk))
      .expect(200);

    const { body } = await http
      .post('/v1/staff/members')
      .set(auth(token.novaFrontDesk))
      .send({
        name: 'Mathyu Quispe',
        documentId: '71448902',
        phone: '+51987654321',
        planId: novaPlans[0].id,
      })
      .expect(409);

    // Que diga "ya esta en el padron" y no "los datos no coinciden" es la
    // prueba de que reconocio a la persona por su celular y documento.
    expect(JSON.stringify(body)).toMatch(/ya está en el padrón/i);

    // Y devuelve CUAL es su ficha. Sin esto el mostrador lee "ya existe" y se
    // queda sin saber a donde ir, que es justo el caso de quien cancelo y
    // vuelve: lo que toca es reinscribirlo, no darlo de alta otra vez.
    expect(body.membershipId).toEqual(expect.any(String));
  });

  it('no reinscribe a quien ya esta dentro, y sabe ensenar las bajas', async () => {
    const { body: plans } = await http
      .get('/v1/staff/plans')
      .set(auth(token.frontDesk))
      .expect(200);

    const { body: activos } = await http
      .get('/v1/staff/roster')
      .set(auth(token.frontDesk))
      .expect(200);
    const alguien = activos[0].membership.id;

    // Reinscribir a alguien que ya esta dentro chocaba contra el indice parcial
    // de una suscripcion viva por membresia, y salia como 500. Un doble toque en
    // el mostrador basta para llegar aqui, y no es un fallo del servidor: es que
    // esa persona no hay que reinscribirla.
    const { body: repetido } = await http
      .post(`/v1/staff/members/${alguien}/resubscribe`)
      .set(auth(token.frontDesk))
      .send({ planId: plans[0].id })
      .expect(409);
    expect(JSON.stringify(repetido)).toMatch(/ya tiene una suscripción activa/i);

    // `includeCanceled` es lo que hace alcanzable a quien cancelo. Sin el, su
    // `membershipId` no lo devuelve ninguna ruta y `resubscribe` —que existe
    // justo para volver— no se puede llamar desde ninguna pantalla.
    const { body: conBajas } = await http
      .get('/v1/staff/roster?includeCanceled=true')
      .set(auth(token.frontDesk))
      .expect(200);
    expect(conBajas.length).toBeGreaterThanOrEqual(activos.length);

    // Y la ficha del mostrador tiene que abrirse aunque la suscripcion no este
    // viva: si se ven en la lista, hay que poder entrar a reinscribirlas.
    await http.get(`/v1/staff/members/${alguien}`).set(auth(token.frontDesk)).expect(200);
  });

  it('inscribe a alguien nuevo y arranca con el primer periodo por cobrar', async () => {
    const { body: plans } = await http
      .get('/v1/staff/plans')
      .set(auth(token.frontDesk))
      .expect(200);
    const dosPorSemana = plans.find((plan: { name: string }) => plan.name === '2x por semana');

    const { body } = await http
      .post('/v1/staff/members')
      .set(auth(token.frontDesk))
      .send({
        name: 'Pedro Nuevo',
        documentId: '99887766',
        phone: '+51999888777',
        planId: dosPorSemana.id,
      })
      .expect(201);

    expect(body.reusedIdentity).toBe(false);
    expect(body.view.user.name).toBe('Pedro Nuevo');
    // Se cobra por adelantado: nace debiendo el mes que empieza.
    expect(body.view.receivable.due).toBe(true);
    expect(body.view.receivable.periodsOwed).toBe(1);
  });

  it('rechaza datos que colisionan a medias', async () => {
    // Mismo celular, otro documento: o hay un tipeo o son dos personas. Fusionar
    // dos alumnos por error se deshace a mano.
    const { body: plans } = await http
      .get('/v1/staff/plans')
      .set(auth(token.frontDesk))
      .expect(200);

    const { body } = await http
      .post('/v1/staff/members')
      .set(auth(token.frontDesk))
      .send({
        name: 'Otro Pedro',
        documentId: '11112222',
        phone: '+51999888777',
        planId: plans[0].id,
      })
      .expect(409);

    expect(JSON.stringify(body)).toMatch(/no coinciden/i);
  });
});

suite('reportes del dueño', () => {
  it('resume el local', async () => {
    const { body } = await http.get('/v1/staff/summary').set(auth(token.owner)).expect(200);

    expect(body).toMatchObject({
      activeMembers: expect.any(Number),
      delinquentMembers: expect.any(Number),
      collectedThisMonthCents: expect.any(Number),
      outstandingCents: expect.any(Number),
      checkInsToday: expect.any(Number),
    });
    expect(body.activeMembers).toBeGreaterThan(0);
  });
});

suite('validación de entrada', () => {
  it('rechaza un uuid mal formado', async () => {
    await http.get('/v1/me/memberships/no-es-uuid').set(auth(token.student)).expect(400);
  });

  it('rechaza un cuerpo incompleto con el detalle del problema', async () => {
    const { body } = await http
      .post('/v1/staff/payments')
      .set(auth(token.frontDesk))
      .send({ type: 'renewal' })
      .expect(400);

    expect(JSON.stringify(body)).toMatch(/membershipId/);
  });
});
