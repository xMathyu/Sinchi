/**
 * El contrato entre la app y la api, verificado contra una api de verdad.
 *
 * Existe por una razón concreta: un cliente HTTP escrito a mano es una copia del
 * contrato del servidor, y las copias se separan. Una ruta renombrada o un campo
 * que cambia de nombre compila perfectamente en los dos lados y falla en el
 * dispositivo del alumno.
 *
 * Este test es la única forma de que ese desfase salga en CI y no en la puerta
 * del gimnasio. No prueba las pantallas —eso necesitaría un runtime de React
 * Native— prueba que las rutas existen, que devuelven lo que los tipos dicen, y
 * que los errores llegan clasificados.
 *
 * Se salta sin `TEST_API_URL`. Para correrlo:
 *   cd apps/api && DATABASE_URL=... ALLOW_DEV_LOGIN=true npm start
 *   cd apps/mobile && TEST_API_URL=http://localhost:3000/v1 npx vitest run src/data/api.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ApiError,
  fetchMe,
  fetchMembership,
  fetchRoster,
  fetchStaffMember,
  fetchCheckInPreview,
  fetchPlansFor,
  fetchWallet,
  linkDevice,
  markManual,
  ping,
  recordPayment,
  setApiBase,
  setCredentialProvider,
} from './api';

const API_URL = process.env.TEST_API_URL;
const suite = API_URL === undefined ? describe.skip : describe;

let studentToken: string | null = null;
let staffToken: string | null = null;
/** Qué token usa la petición en curso. */
let active: 'student' | 'staff' | 'none' = 'none';

beforeAll(async () => {
  if (API_URL === undefined) return;
  setApiBase(API_URL);

  setCredentialProvider({
    getToken: () => (active === 'student' ? studentToken : active === 'staff' ? staffToken : null),
    getDeviceToken: async () => null,
  });

  // `dev-login` en vez de Google: probar el intercambio con Firebase exigiría un
  // ID token real. Lo que este test verifica es el contrato de las rutas, y para
  // eso da igual cómo se obtuvo la sesión.
  const login = async (phone: string): Promise<string> => {
    const response = await fetch(`${API_URL}/auth/dev-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }),
    });
    if (!response.ok) throw new Error(`dev-login falló: ${response.status}`);
    return ((await response.json()) as { accessToken: string }).accessToken;
  };

  studentToken = await login('+51987654321'); // Mathyu, 3 gimnasios
  staffToken = await login('+51987000111'); // Ana, Dojo Shotokan
}, 60_000);

afterAll(() => {
  active = 'none';
});

suite('salud', () => {
  it('responde', async () => {
    expect(await ping()).toBe(true);
  });
});

suite('rutas del alumno', () => {
  beforeAll(() => {
    active = 'student';
  });

  it('/me trae identidad y billetera con la forma que dicen los tipos', async () => {
    const me = await fetchMe();

    expect(typeof me.user.name).toBe('string');
    expect(typeof me.user.documentId).toBe('string');
    expect(me.wallet.length).toBeGreaterThan(0);

    for (const entry of me.wallet) {
      // Si la api renombra cualquiera de estos, el test cae aquí y no en el
      // dispositivo del alumno.
      expect(entry.membership.id).toBeTruthy();
      expect(entry.tenant.name).toBeTruthy();
      expect(entry.plan.name).toBeTruthy();
      expect(['ok', 'warn', 'alert', 'blocked']).toContain(entry.level);
      expect(typeof entry.badge).toBe('string');
      expect(typeof entry.receivable.due).toBe('boolean');
      expect(typeof entry.receivable.amountCents).toBe('number');
      expect(typeof entry.quota.used).toBe('number');
      expect(typeof entry.delinquency.daysPastDue).toBe('number');
    }
  });

  it('las fechas civiles llegan como { year, month, day }, no como cadena', async () => {
    // Es el punto donde una serialización descuidada rompe todo el cálculo de
    // fechas: `PlainDate` es un objeto, y si llegara "2026-09-12" las funciones
    // de `@sinchi/shared` darían NaN en silencio.
    const wallet = await fetchWallet();
    const next = wallet[0]!.subscription.nextBillingDate;

    expect(typeof next).toBe('object');
    expect(typeof next.year).toBe('number');
    expect(typeof next.month).toBe('number');
    expect(typeof next.day).toBe('number');
    expect(next.month).toBeGreaterThanOrEqual(1);
    expect(next.month).toBeLessThanOrEqual(12);
  });

  it('los montos son enteros de céntimos, nunca decimales', async () => {
    const wallet = await fetchWallet();
    for (const entry of wallet) {
      expect(Number.isInteger(entry.plan.priceCents)).toBe(true);
      expect(Number.isInteger(entry.receivable.amountCents)).toBe(true);
    }
  });

  it('el detalle trae historial de pagos y asistencia', async () => {
    const wallet = await fetchWallet();
    const detail = await fetchMembership(wallet[0]!.membership.id);

    expect(Array.isArray(detail.charges)).toBe(true);
    expect(Array.isArray(detail.attendances)).toBe(true);
  });

  it('la vista previa del check-in trae el veredicto y su mensaje', async () => {
    const wallet = await fetchWallet();
    const preview = await fetchCheckInPreview(wallet[0]!.membership.id);

    expect(typeof preview.result.allowed).toBe('boolean');
    expect(preview.message.title.length).toBeGreaterThan(0);
    expect(preview.message.reason.length).toBeGreaterThan(0);
    expect(['ok', 'warn', 'alert', 'blocked']).toContain(preview.message.level);
  });

  it('los planes a los que puede cambiar', async () => {
    const wallet = await fetchWallet();
    const plans = await fetchPlansFor(wallet[0]!.membership.id);

    expect(plans.length).toBeGreaterThan(0);
    for (const plan of plans) {
      expect(['unlimited', 'sessions_per_week', 'fixed_days']).toContain(plan.type);
    }
  });

  it('siembra el secreto TOTP con los parámetros que espera el generador', async () => {
    const link = await linkDevice();

    expect(link.algorithm).toBe('HMAC-SHA256');
    expect(link.periodSeconds).toBe(30);
    expect(link.digits).toBe(8);
    // 32 bytes en base64.
    expect(Buffer.from(link.secret, 'base64').length).toBe(32);
  });

  it('una membresía ajena da 404, no 403', async () => {
    // Mismo código que si no existiera: decir "existe pero no es tuya" confirma
    // la existencia de una membresía ajena.
    await expect(fetchMembership('00000000-0000-0000-0000-000000000000')).rejects.toMatchObject({
      status: 404,
    });
  });
});

suite('hidratacion del store', () => {
  it('los datos salen del servidor, no de demo.ts', async () => {
    const { loadFromApi } = await import('./hydrate');
    const { buildDemoData } = await import('./demo');

    const datos = await loadFromApi();
    const demo = buildDemoData();

    // La comprobacion que importa, y no se puede hacer por nombre: la base de
    // pruebas tiene su propio "Mathyu Quispe", igual que demo.ts. Lo que
    // distingue un origen del otro son los ids — los de demo.ts son constantes
    // escritas a mano.
    //
    // Esto es lo que se persiguio media tarde: la app mostraba tres gimnasios
    // inventados aunque la sesion fuera real, porque ninguna pantalla de
    // contenido preguntaba al servidor.
    expect(datos.user.id).not.toBe(demo.user.id);
    const idsDemo = new Set(demo.tenants.map((t) => t.id));
    for (const tenant of datos.tenants) {
      expect(idsDemo.has(tenant.id)).toBe(false);
    }

    // Y coincide con lo que la api dice por su cuenta.
    const me = await fetchMe();
    expect(datos.user.id).toBe(me.user.id);
    expect(datos.memberships).toHaveLength(me.wallet.length);

    // La forma tiene que servir tal cual al store.
    expect(datos.users).toHaveLength(1);
    expect(datos.memberships.length).toBe(datos.subscriptions.length);
    expect(datos.activeTenantId).toBe(datos.tenants[0]!.id);

    // Sin gimnasios repetidos: dos membresias del mismo local traen el mismo
    // tenant, y duplicarlo saldria en el selector de "Mi QR".
    const ids = datos.tenants.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const cargo of datos.charges) {
      expect(Number.isInteger(cargo.amountCents)).toBe(true);
    }

    // Sin esto las comprobaciones de abajo serian vacias: un bucle sobre un
    // array vacio no afirma nada y el test pasaria sin mirar ni una fecha.
    expect(datos.charges.length).toBeGreaterThan(0);
    expect(datos.attendances.length).toBeGreaterThan(0);

    // Lo que se cayo en el telefono: `Charge.createdAt` esta declarado como
    // `Date`, pero JSON entrega la cadena ISO. El tipo mentia, y la mentira no
    // explotaba aqui sino en el store, ordenando con `b.createdAt.getTime()` —
    // "undefined is not a function" a tres saltos del origen.
    for (const cargo of datos.charges) {
      expect(cargo.createdAt).toBeInstanceOf(Date);
      expect(Number.isNaN(cargo.createdAt.getTime())).toBe(false);
    }
    for (const asistencia of datos.attendances) {
      expect(asistencia.checkedInAt).toBeInstanceOf(Date);
      if (asistencia.syncedAt !== null) expect(asistencia.syncedAt).toBeInstanceOf(Date);
    }
    expect(datos.user.createdAt).toBeInstanceOf(Date);
    for (const sub of datos.subscriptions) {
      if (sub.canceledAt !== null) expect(sub.canceledAt).toBeInstanceOf(Date);
    }

    // Y las fechas civiles siguen siendo objetos: PlainDate se eligio
    // precisamente para sobrevivir al viaje sin revivir nada.
    for (const sub of datos.subscriptions) {
      expect(typeof sub.nextBillingDate).toBe('object');
      expect(sub.nextBillingDate).toHaveProperty('year');
    }
  });
});

suite('rutas del staff', () => {
  beforeAll(() => {
    active = 'staff';
  });

  it('el padrón llega completo y con estado', async () => {
    const roster = await fetchRoster();

    expect(roster.length).toBeGreaterThan(0);
    for (const entry of roster) {
      expect(entry.user.name).toBeTruthy();
      expect(['ok', 'warn', 'alert', 'blocked']).toContain(entry.level);
    }
  });

  it('un rechazo de check-in llega con 200 y motivo, no como error', async () => {
    // Es la decisión de diseño de la api: un rechazo no es un fallo de la
    // petición, es el resultado del negocio. Si llegara como excepción, la
    // pantalla del staff no podría mostrar el motivo.
    const roster = await fetchRoster();
    const suspendido = roster.find((entry) => entry.level === 'blocked');
    if (suspendido === undefined) return; // el seed no dejó ninguno

    const outcome = await markManual({ membershipId: suspendido.membership.id });

    expect(outcome.registered).toBe(false);
    expect(outcome.result.allowed).toBe(false);
    if (!outcome.result.allowed) {
      expect(outcome.result.reason.code).toBeTruthy();
    }
    expect(outcome.message.title.length).toBeGreaterThan(0);
  });

  it('registrar un pago devuelve el estado de DESPUÉS', async () => {
    // El mostrador tiene que ver el acceso liberado sin recargar la pantalla.
    const roster = await fetchRoster();
    const deudor = roster.find((entry) => entry.receivable.due);
    if (deudor === undefined) return;

    const result = await recordPayment({
      membershipId: deudor.membership.id,
      type: 'renewal',
      rail: 'cash',
    });

    expect(result.charge.status).toBe('succeeded');
    expect(result.charge.rail).toBe('cash');
    expect(result.view.receivable.due).toBe(false);
  });

  it('el detalle de un alumno del padrón', async () => {
    const roster = await fetchRoster();
    const detail = await fetchStaffMember(roster[0]!.membership.id);
    expect(detail.membership.id).toBe(roster[0]!.membership.id);
  });
});

suite('errores', () => {
  it('sin sesión da un ApiError 401 clasificado', async () => {
    active = 'none';
    try {
      await fetchMe();
      throw new Error('debería haber fallado');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).isUnauthorized).toBe(true);
    }
  });

  it('un host inalcanzable se distingue de un error del servidor', async () => {
    // La pantalla trata los dos casos distinto: sin red se sigue operando contra
    // la caché; con un 500 hay que parar.
    const original = API_URL as string;
    setApiBase('http://127.0.0.1:9');
    active = 'student';

    try {
      await fetchMe();
      throw new Error('debería haber fallado');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).isOffline).toBe(true);
      expect((error as ApiError).isUnauthorized).toBe(false);
    } finally {
      setApiBase(original);
    }
  });
});
