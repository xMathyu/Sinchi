/**
 * Escrituras del staff: marcar asistencia y registrar pagos.
 *
 * Existe porque las pantallas llamaban directamente a las funciones de
 * `store.ts`, que escriben en memoria. Con el padrón viniendo del servidor eso
 * dejó de funcionar y de la peor manera: `markAttendance` recalculaba la vista
 * desde `state.memberships` —vacío, porque el padrón vive ahora en
 * `remoteRoster`— y la app moría con "Membresía ... no encontrada" al tocar el
 * botón.
 *
 * El criterio para decidir a dónde va cada escritura no es una bandera de
 * configuración sino el estado de la sesión: si hay una real, manda el servidor;
 * si no, se escribe en el store, que es lo que sostiene el modo demostración.
 * Así no hay forma de tener una app "conectada" que escriba en memoria.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import type { CheckInMethod, PaymentRail } from '@sinchi/shared';
import {
  ApiError,
  fetchStaffMember,
  markManual,
  recordPayment,
  scanQr,
  type CheckInOutcomeDto,
} from './api';
import { getSessionState } from './session';
import {
  clearScanVerdict,
  markAttendance as markAttendanceLocal,
  recordManualPayment as recordPaymentLocal,
  resolveQr,
  setScanVerdict,
  viewMembership,
  type MembershipView,
} from './store';
import { hydrateStaff } from './hydrate';

/**
 * Llave de idempotencia con forma de UUID.
 *
 * La api la exige como UUID —lo valida el esquema de entrada—, pero tiene que
 * ser **determinista**: la misma persona, el mismo día, el mismo concepto deben
 * producir la misma llave, o tocar el botón dos veces mientras la red va lenta
 * crearía dos cargos. Un `randomUUID()` sería un UUID válido y una idempotencia
 * inútil.
 *
 * Se deriva de un sha256 del texto y se le da forma de UUID v4 (los bits de
 * versión y variante en su sitio) para que pase la validación sin mentir sobre
 * su origen: no es aleatorio, es una función del contenido.
 */
function llaveIdempotente(texto: string): string {
  const h = sha256(new TextEncoder().encode(texto));
  const b = Array.from(h.slice(0, 16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = b.map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** El día local, que es el que define "ya vino hoy". */
const hoyISO = (): string => new Date().toISOString().slice(0, 10);

/** `true` cuando hay una sesión de staff de verdad detrás. */
function conServidor(): { readonly userId: string; readonly tenantId: string | null } | null {
  const estado = getSessionState();
  if (estado.status !== 'signed_in') return null;
  if (estado.session.role === 'student') return null;
  return { userId: estado.session.userId, tenantId: estado.session.tenantId };
}

export interface ResultadoAsistencia {
  readonly registrada: boolean;
  /** Ya estaba marcada hoy. No es un error: la puerta se toca dos veces. */
  readonly repetida: boolean;
  readonly titulo: string;
  readonly detalle: string;
}

/**
 * Marca asistencia.
 *
 * `clientId` es la llave de idempotencia: la misma persona, el mismo día, el
 * mismo aparato. Sin ella, tocar el botón dos veces mientras la red va lenta
 * dejaría dos asistencias y consumiría dos veces del cupo semanal.
 */
export async function marcarAsistencia(input: {
  readonly membershipId: string;
  readonly method: CheckInMethod;
  readonly overrideDenial?: boolean;
}): Promise<ResultadoAsistencia> {
  const sesion = conServidor();

  if (sesion === null) {
    // Modo demostración: se escribe en memoria y se responde con lo mismo que
    // habría dicho el servidor, para que la pantalla no tenga dos caminos.
    markAttendanceLocal({
      membershipId: input.membershipId,
      method: input.method,
      overrideDenial: input.overrideDenial === true,
    });
    return { registrada: true, repetida: false, titulo: 'Asistencia marcada', detalle: '' };
  }

  const salida: CheckInOutcomeDto = await markManual({
    membershipId: input.membershipId,
    overrideDenial: input.overrideDenial === true,
    clientId: llaveIdempotente(`manual:${input.membershipId}:${hoyISO()}`),
  });

  // El padrón cambió —el cupo baja, el semáforo puede cambiar— así que se
  // recarga. No se parchea a mano el estado local: el servidor acaba de
  // recalcularlo todo y copiar esa lógica aquí sería tener dos verdades.
  await refrescarPadron(sesion);

  return {
    registrada: salida.registered,
    repetida: salida.alreadyRegistered === true,
    titulo: salida.message.title,
    detalle: salida.message.detail ?? '',
  };
}

export interface ResultadoPago {
  readonly repetido: boolean;
  readonly montoCents: number;
}

/**
 * Registra un pago cobrado en el mostrador.
 *
 * En la v1 no hay cobro automático: esto no mueve dinero, deja constancia de que
 * alguien pagó. Por eso `rail` es obligatorio — efectivo, Yape o transferencia—
 * y no tiene valor por defecto: adivinarlo falsearía la conciliación de caja.
 */
export async function registrarPago(input: {
  readonly membershipId: string;
  readonly type: 'renewal' | 'enrollment' | 'drop_in';
  readonly rail: PaymentRail;
  readonly periods?: number;
  readonly amountCents?: number;
}): Promise<ResultadoPago> {
  const sesion = conServidor();

  if (sesion === null) {
    recordPaymentLocal({
      membershipId: input.membershipId,
      type: input.type,
      rail: input.rail,
      periods: input.periods ?? 1,
    });
    return { repetido: false, montoCents: input.amountCents ?? 0 };
  }

  if (input.rail === 'card') {
    // El carril de tarjeta llega con Culqi; hasta entonces aceptarlo dejaría un
    // cargo diciendo que se cobró por un medio que no existe.
    throw new Error('El pago con tarjeta todavía no está disponible.');
  }

  const salida = await recordPayment({
    membershipId: input.membershipId,
    type: input.type,
    rail: input.rail,
    periods: input.periods ?? 1,
    ...(input.amountCents === undefined ? {} : { amountCents: input.amountCents }),
    clientId: llaveIdempotente(`pago:${input.membershipId}:${input.type}:${hoyISO()}`),
  });

  await refrescarPadron(sesion);

  return { repetido: salida.alreadyRecorded, montoCents: salida.charge.amountCents };
}

// ---------------------------------------------------------------------------
// Puerta
// ---------------------------------------------------------------------------

export type ResultadoEscaneo =
  | { readonly ok: true; readonly membershipId: string }
  | { readonly ok: false; readonly titulo: string; readonly detalle: string };

/**
 * Valida un QR leido en la puerta.
 *
 * Con sesion real manda el servidor, y no por gusto: es el unico que puede
 * verificar la firma TOTP. Sin esa verificacion, la captura de pantalla del QR
 * de ayer abre la puerta igual que el codigo vivo, y el control de aforo —que es
 * lo que el gimnasio compra— deja de existir. El dispositivo del mostrador no
 * puede hacerlo porque no cachea las claves del padron (ver el ultimo punto del
 * README).
 *
 * Sin servidor —modo demostracion, o wifi caido— se resuelve contra el padron en
 * cache. Eso es la promesa del MD 4.6: la puerta sigue funcionando. Lo que se
 * pierde es exactamente la firma, y por eso el veredicto local se marca como tal
 * en vez de presentarse como si el servidor lo hubiera confirmado.
 */
export async function evaluarQr(payload: string): Promise<ResultadoEscaneo> {
  const sesion = conServidor();

  if (sesion !== null) {
    try {
      // `record: true`: el servidor verifica la firma y registra en la misma
      // llamada. Separarlo en dos pasos no es posible — el codigo rota cada 30
      // segundos y ya habria vencido cuando el recepcionista confirme.
      const salida = await scanQr(payload, { record: true });
      setScanVerdict({
        membershipId: salida.view.membership.id,
        result: salida.result,
        message: salida.message,
        registered: salida.registered,
      });
      await refrescarPadron(sesion);
      return { ok: true, membershipId: salida.view.membership.id };
    } catch (causa) {
      if (!(causa instanceof ApiError) || !causa.isOffline) {
        // La api responde en espanol y con el motivo concreto ("el codigo ya
        // venció", "no vinculó su dispositivo"). Reescribirlo aqui solo lo
        // empeoraria.
        return {
          ok: false,
          titulo: 'No se pudo validar',
          detalle: causa instanceof Error ? causa.message : 'Intenta de nuevo.',
        };
      }
      // Sin red se sigue, contra la cache.
    }
  }

  clearScanVerdict();
  const local = resolveQr(payload);
  if (local.ok) return { ok: true, membershipId: local.membershipId };

  return {
    ok: false,
    titulo: 'Código no reconocido',
    detalle:
      local.reason === 'not_sinchi'
        ? 'Ese QR no es de Sinchi.'
        : local.reason === 'unknown_user'
          ? 'El código es de Sinchi, pero no corresponde a ningún usuario.'
          : 'Este alumno no tiene membresía en este local.',
  };
}

// ---------------------------------------------------------------------------
// Ficha del alumno
// ---------------------------------------------------------------------------

/**
 * Trae la ficha completa de un alumno del padron.
 *
 * El padron de `/staff/roster` llega sin cargos ni asistencias a proposito:
 * pedirlos de cada alumno serian sesenta peticiones para pintar una lista. El
 * historial se pide al abrir a UNA persona, que es cuando de verdad se necesita.
 */
export async function cargarDetalleAlumno(membershipId: string): Promise<MembershipView> {
  if (conServidor() === null) return viewMembership(membershipId);
  return await fetchStaffMember(membershipId);
}

/**
 * Vuelve a pedir el padron despues de escribir.
 *
 * Se traga el error a proposito: la escritura ya ocurrio y el servidor tiene la
 * verdad. Fallar aqui solo significa que la lista se vera vieja hasta la
 * siguiente carga, y eso no justifica presentarle un error a quien acaba de
 * cobrar bien.
 */
async function refrescarPadron(sesion: {
  readonly userId: string;
  readonly tenantId: string | null;
}): Promise<void> {
  await hydrateStaff({
    userId: sesion.userId,
    tenantId: sesion.tenantId,
    role: 'front_desk',
  }).catch(() => {});
}
