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
import { markManual, recordPayment, type CheckInOutcomeDto } from './api';
import { getSessionState } from './session';
import {
  markAttendance as markAttendanceLocal,
  recordManualPayment as recordPaymentLocal,
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
  await hydrateStaff({
    userId: sesion.userId,
    tenantId: sesion.tenantId,
    role: 'front_desk',
  }).catch(() => {});

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

  await hydrateStaff({
    userId: sesion.userId,
    tenantId: sesion.tenantId,
    role: 'front_desk',
  }).catch(() => {});

  return { repetido: salida.alreadyRecorded, montoCents: salida.charge.amountCents };
}
