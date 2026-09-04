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
import type { CheckInMethod, PaymentRail, Plan } from '@sinchi/shared';
import {
  ApiError,
  cancelMembership,
  changePlan as changePlanRemote,
  enrollMember,
  identityExists,
  confirmClaim,
  fetchClaims,
  fetchPlansFor,
  fetchSaasSubscription,
  fetchSummary,
  redeemPromoCode,
  signUpGym,
  fetchStaffMember,
  fetchRoster,
  fetchStaffPlans,
  fetchPlanesDelDueno,
  fetchPrecios,
  crearPlan,
  editarPlan,
  archivarPlan,
  borrarPlan,
  guardarPrecios,
  fetchEventos,
  fetchEvento,
  fetchRutinas,
  fetchRutina,
  fetchRutinasDeMiGimnasio,
  fetchRutinaDeMiGimnasio,
  fetchRutinaPublica,
  crearRutina,
  editarRutina,
  cambiarEstadoRutina,
  cambiarPublicoRutina,
  borrarRutina,
  pedirSubidaDeVideo,
  confirmarSubidaDeVideo,
  subirArchivoDeVideo,
  crearEvento,
  editarEvento,
  cambiarEstadoEvento,
  borrarEvento,
  fetchPlazas,
  inscribirEnEvento,
  cambiarEstadoPlaza,
  cobrarPlaza,
  type EventoConCupo,
  type EventoDto,
  type EventoEscrito,
  type BibliotecaDto,
  type RutinaDto,
  type RutinaDetalleDto,
  type RutinaEscrita,
  type PlazaDto,
  type PlanConUso,
  type PlanEscrito,
  type PreciosDelLocal,
  markManual,
  recordPayment,
  resubscribe,
  scanQr,
  setOwnPin,
  type CheckInOutcomeDto,
  type RedeemPromoDto,
  type SaasSubscriptionDto,
  type SignUpGymDto,
  type SignUpGymInput,
  type SummaryDto,
} from './api';
import { currentFirebaseToken, getSessionState, saveSession } from './session';
import {
  cancelSubscription as cancelSubscriptionLocal,
  changePlan as changePlanLocal,
  clearScanVerdict,
  getState,
  markAttendance as markAttendanceLocal,
  recordManualPayment as recordPaymentLocal,
  resolveQr,
  setScanVerdict,
  viewMembership,
  type MembershipView,
  type RosterEntry,
} from './store';
import { hydrate, hydrateStaff } from './hydrate';

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

/**
 * `true` cuando hay una sesión real, del rol que sea.
 *
 * `conServidor` no sirve para las escrituras del alumno: descarta el rol
 * `student` a propósito, porque distingue quién puede escribir en el padrón.
 * Cambiar de plan y cancelar son del alumno, y usar aquel guardia las mandaba al
 * store —a memoria— con sesión real.
 */
const haySesion = (): boolean => getSessionState().status === 'signed_in';

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

// ---------------------------------------------------------------------------
// Suscripción del alumno
// ---------------------------------------------------------------------------

/**
 * Planes a los que puede cambiar esta membresía.
 *
 * Sin sesión salen del store, que en la demostración los tiene todos.
 */
export async function planesPara(membershipId: string): Promise<readonly Plan[]> {
  if (!haySesion()) {
    const vista = viewMembership(membershipId);
    return getState().plans.filter((plan) => plan.tenantId === vista.tenant.id && plan.active);
  }
  return await fetchPlansFor(membershipId);
}

/**
 * Cambia de plan.
 *
 * Escribía SOLO en memoria: `changePlan` de `store.ts` movía la suscripción
 * local y la pantalla se cerraba como si hubiera funcionado, hasta que la
 * siguiente carga desde la api lo revertía sin decir nada. Es el mismo fallo que
 * `actions.ts` vino a cerrar para el staff, repetido en el modo alumno.
 *
 * El dominio decide qué significa el cambio —subir cobra el diferencial
 * prorrateado hoy, bajar espera a la renovación— y eso lo calcula el servidor con
 * las mismas funciones de `@sinchi/shared`. Aquí solo se manda la intención.
 */
export async function cambiarPlan(membershipId: string, planId: string): Promise<void> {
  if (!haySesion()) {
    changePlanLocal(membershipId, planId);
    return;
  }
  await changePlanRemote(membershipId, planId);
  await hydrate();
}

/** Cancela la suscripción. Misma historia que `cambiarPlan`: escribía en memoria. */
export async function cancelarSuscripcion(membershipId: string): Promise<void> {
  if (!haySesion()) {
    cancelSubscriptionLocal(membershipId);
    return;
  }
  await cancelMembership(membershipId);
  await hydrate();
}

// ---------------------------------------------------------------------------
// Vinculación de cuentas
// ---------------------------------------------------------------------------

export interface Vinculacion {
  readonly id: string;
  readonly code: string;
  readonly email: string | null;
  readonly displayName: string | null;
  readonly expiresAt: Date;
}

/**
 * Códigos de vinculación vigentes en este gimnasio.
 *
 * `docs/autenticacion.md` describe el flujo entero —el alumno entra con Google,
 * la api responde `linked: false` con un código de seis dígitos, y recepción lo
 * confirma contra la ficha del padrón— y la app nunca tuvo la última mitad.
 * `fetchClaims` y `confirmClaim` llevaban escritos desde entonces sin que ninguna
 * pantalla los llamara, así que un alumno recién instalado se quedaba en
 * `unlinked` indefinidamente, mirando un código que nadie podía canjear.
 */
export async function vinculacionesPendientes(): Promise<readonly Vinculacion[]> {
  if (conServidor() === null) return [];
  const filas = await fetchClaims();
  return filas.map((fila) => ({
    id: fila.id,
    code: fila.code,
    email: fila.email,
    displayName: fila.displayName,
    expiresAt: new Date(fila.expiresAt),
  }));
}

/**
 * Vincula una cuenta de Google con una ficha del padrón.
 *
 * La api comprueba que la ficha sea de ESTE gimnasio y rechaza si ya tiene otra
 * cuenta: el vínculo lo hace una persona con prisa y las personas se equivocan.
 * Aquí no se replica ninguna de esas dos reglas — replicarlas sería tener dos
 * verdades sobre quién puede vincular a quién.
 */
export async function vincularCuenta(code: string, membershipId: string): Promise<void> {
  const sesion = conServidor();
  if (sesion === null) throw new Error('Vincular cuentas necesita una sesión de turno abierta.');
  await confirmClaim(code, membershipId);
  await refrescarPadron(sesion);
}

/**
 * Resumen del gimnasio, solo para el dueño.
 *
 * Ajustes anunciaba el rol `owner` como «todo lo anterior más reportes» y no
 * había ninguno: `/staff/summary` existía en la api y la app ni siquiera lo
 * declaraba. Devuelve `null` cuando quien mira no es el dueño, para que la
 * pantalla no tenga que decidirlo por su cuenta — la api responde 403 y eso ya
 * sería un error visible por algo que es simplemente "no te toca".
 */
export async function resumenDelGimnasio(): Promise<SummaryDto | null> {
  const estado = getSessionState();
  if (estado.status !== 'signed_in' || estado.session.role !== 'owner') return null;
  return await fetchSummary();
}

/**
 * La suscripción del gimnasio a Sinchi: el mes gratis y lo que viene después.
 *
 * `null` cuando quien mira no es el dueño, por la misma razón que el resumen: no
 * es un error, es que no le toca.
 */
export async function suscripcionSinchi(): Promise<SaasSubscriptionDto | null> {
  const estado = getSessionState();
  if (estado.status !== 'signed_in' || estado.session.role !== 'owner') return null;
  return await fetchSaasSubscription();
}

/** Canjea un código de promoción. El rechazo viene en el resultado, no como error. */
export const canjearCodigo = (code: string): Promise<RedeemPromoDto> => redeemPromoCode(code);

/**
 * Da de alta un gimnasio y deja la sesión de dueño puesta.
 *
 * Guardar la sesión aquí y no en la pantalla es lo que hace que el alta termine
 * DENTRO del modo staff: el layout raíz enruta en cuanto ve la sesión.
 */
export async function registrarGimnasio(
  input: Omit<SignUpGymInput, 'idToken'>,
): Promise<SignUpGymDto> {
  const idToken = currentFirebaseToken();
  if (idToken === null) {
    throw new ApiError(401, 'Entra con Google antes de registrar tu gimnasio.');
  }

  const alta = await signUpGym({ ...input, idToken });
  await saveSession({
    accessToken: alta.session.accessToken,
    expiresInSeconds: alta.session.expiresInSeconds,
    role: alta.session.role,
    userId: alta.session.userId,
    tenantId: alta.session.tenantId,
  });
  return alta;
}

/**
 * Fija el PIN de turno de quien tiene la sesión abierta.
 *
 * Cerraba un círculo que no tenía salida: para abrir turno en el equipo del
 * mostrador hace falta un PIN, `shift.tsx` decía «el dueño puede asignarle uno
 * desde su cuenta», y esa pantalla no existía en ninguna parte. Quien entraba
 * con Google y no tenía PIN no podía volver a entrar por el mostrador nunca.
 *
 * La api solo deja cambiar el PIN de otra persona al dueño, y con razón: si
 * recepción pudiera cambiar el de un compañero, podría marcar asistencia a su
 * nombre y la auditoría dejaría de significar nada. Aquí se fija únicamente el
 * propio.
 */
export async function fijarMiPin(pin: string): Promise<void> {
  if (conServidor() === null) throw new Error('Fijar el PIN necesita una sesión de turno.');
  await setOwnPin(pin);
}

// ---------------------------------------------------------------------------
// Refresco
// ---------------------------------------------------------------------------

/**
 * Vuelve a pedir los datos de quien tiene la sesión abierta.
 *
 * Faltaba, y se notaba justo donde más duele: el padrón se cargaba una vez al
 * abrir turno y no se volvía a pedir nunca. Si el alumno cambiaba de plan desde
 * su teléfono, o si otra recepcionista cobraba desde otro equipo, el mostrador
 * seguía viendo el estado del momento en que entró — sin nada que lo dijera.
 *
 * Las escrituras propias sí recargaban (`refrescarPadron`), y eso disimulaba el
 * agujero: todo lo que hacía el mostrador se veía al instante, y solo lo que
 * pasaba fuera se quedaba viejo.
 */
export async function refrescarDatos(): Promise<void> {
  const estado = getSessionState();
  if (estado.status !== 'signed_in') return;

  const { role, userId, tenantId } = estado.session;
  if (role === 'student') {
    await hydrate();
    return;
  }
  await hydrateStaff({ userId, tenantId, role });
}

/**
 * Reactiva a alguien que canceló.
 *
 * Estaba sin salida: el alumno cancela desde su app —o el mostrador lo hace por
 * él— y a partir de ahí no había forma de volver. Ni el alumno, porque unirse a
 * un gimnasio no es algo que haga por su cuenta en este producto, ni el
 * mostrador, porque `/staff/members/:id/resubscribe` existía en la api y la app
 * ni siquiera lo declaraba. La única salida era entrar a la base a mano.
 *
 * No es un alta: la ficha y el historial siguen ahí, y por eso hay un endpoint
 * aparte. Volver a registrar a la persona le crearía una segunda identidad en el
 * mismo local.
 */
export async function reactivarSuscripcion(
  membershipId: string,
  planId: string,
): Promise<void> {
  const sesion = conServidor();
  if (sesion === null) throw new Error('Reactivar necesita una sesión de turno abierta.');
  await resubscribe(membershipId, planId);
  await refrescarPadron(sesion);
}

/** Planes activos del local. Para el mostrador, no para la billetera del alumno. */
export async function planesDelGimnasio(): Promise<readonly Plan[]> {
  if (conServidor() === null) return getState().plans.filter((plan) => plan.active);
  return (await fetchStaffPlans()).filter((plan) => plan.active);
}

// ---------------------------------------------------------------------------
// La oferta del gimnasio
// ---------------------------------------------------------------------------

/**
 * Todo lo que el dueño puede tocar exige servidor, y no por comodidad.
 *
 * Cambiar un precio en la caché de un teléfono sin conexión y sincronizarlo
 * después es la peor versión de esto: dos dispositivos escribirían dos tarifas
 * distintas para el mismo plan y ganaría el último en subir. El padrón sí se
 * puede leer sin red porque nadie lo escribe desde dos sitios a la vez; una
 * tarifa, sí.
 */
function exigeServidor(que: string): void {
  if (conServidor() === null) {
    throw new Error(`${que} necesita conexión: es una decisión del local, no de este equipo.`);
  }
}

export async function planesDelDueno(): Promise<readonly PlanConUso[]> {
  exigeServidor('Ver tus planes');
  return await fetchPlanesDelDueno();
}

export async function guardarPlan(
  planId: string | null,
  plan: PlanEscrito,
): Promise<Plan> {
  exigeServidor('Guardar un plan');
  return planId === null ? await crearPlan(plan) : await editarPlan(planId, plan);
}

export async function archivarOReactivarPlan(planId: string, activo: boolean): Promise<Plan> {
  exigeServidor('Archivar un plan');
  return await archivarPlan(planId, activo);
}

export async function eliminarPlan(planId: string): Promise<void> {
  exigeServidor('Borrar un plan');
  await borrarPlan(planId);
}

export async function preciosDelLocal(): Promise<PreciosDelLocal> {
  exigeServidor('Ver lo que cobras');
  return await fetchPrecios();
}

// ---------------------------------------------------------------------------
// Eventos con fecha
// ---------------------------------------------------------------------------

/**
 * Todo lo de eventos exige servidor, igual que los precios.
 *
 * Aqui el motivo es todavia mas fuerte que en los planes: lo que se reparte es
 * CUPO. Dos equipos del mostrador vendiendo plazas contra su propia caché
 * venderian la misma dos veces, y el sábado se presentan dos personas para una
 * silla. El cupo lo cuenta el servidor con la fila del evento bloqueada, y esa
 * garantía no se puede replicar sin conexión.
 */
export async function eventosDelGimnasio(
  opciones: { readonly past?: boolean; readonly drafts?: boolean } = {},
): Promise<readonly EventoConCupo[]> {
  exigeServidor('Ver los eventos');
  return await fetchEventos(opciones);
}

export async function eventoDelGimnasio(eventId: string): Promise<EventoConCupo> {
  exigeServidor('Ver un evento');
  return await fetchEvento(eventId);
}

export async function guardarEvento(
  eventId: string | null,
  evento: EventoEscrito,
): Promise<EventoDto> {
  exigeServidor('Guardar un evento');
  return eventId === null ? await crearEvento(evento) : await editarEvento(eventId, evento);
}

export async function publicarEvento(
  eventId: string,
  status: 'draft' | 'published' | 'canceled',
): Promise<EventoDto> {
  exigeServidor('Cambiar un evento');
  return await cambiarEstadoEvento(eventId, status);
}

export async function eliminarEvento(eventId: string): Promise<void> {
  exigeServidor('Borrar un evento');
  await borrarEvento(eventId);
}

export async function plazasDelEvento(eventId: string): Promise<readonly PlazaDto[]> {
  exigeServidor('Ver los inscritos');
  return await fetchPlazas(eventId);
}

export async function inscribirAlumnoEnEvento(eventId: string, membershipId: string) {
  exigeServidor('Inscribir en un evento');
  return await inscribirEnEvento(eventId, membershipId);
}

export async function marcarPlaza(
  registrationId: string,
  status: 'booked' | 'attended' | 'no_show' | 'canceled',
): Promise<PlazaDto> {
  exigeServidor('Marcar una plaza');
  return await cambiarEstadoPlaza(registrationId, status);
}

export async function cobrarPlazaDeEvento(
  registrationId: string,
  rail: 'cash' | 'yape' | 'bank_transfer',
): Promise<PlazaDto> {
  exigeServidor('Cobrar una plaza');
  return await cobrarPlaza(registrationId, rail);
}


// ---------------------------------------------------------------------------
// Rutinas
// ---------------------------------------------------------------------------

/**
 * La biblioteca exige servidor, y el motivo no es el mismo que en los eventos.
 *
 * Allí lo que se protege es el CUPO. Aquí es el ACCESO: quién puede ver una
 * rutina de alumnos lo decide la api, que es la única que sabe si la suscripción
 * sigue viva. Una caché local de contenido exclusivo sería contenido exclusivo
 * guardado en el teléfono de alguien que quizá ya se dio de baja.
 *
 * Que el video en sí sea un enlace público de YouTube no cambia el argumento:
 * una cosa es que se pueda compartir a mano y otra que la app lo reparta sola.
 *
 * Ojo con el guardia: `exigeServidor` descarta el rol `student` a propósito
 * —distingue quién puede ESCRIBIR en el padrón— así que sirve para la
 * biblioteca del mostrador y NO para la del alumno. Usarlo en las dos dejaba al
 * alumno con «necesita conexión» teniendo sesión y wifi, y lo encontró el
 * simulador, no la lectura del código.
 */
export async function bibliotecaDelGimnasio(): Promise<BibliotecaDto> {
  exigeServidor('Ver las rutinas');
  return await fetchRutinas();
}

export async function rutinaDelGimnasio(routineId: string): Promise<RutinaDetalleDto> {
  exigeServidor('Ver una rutina');
  return await fetchRutina(routineId);
}

/** Sesión de la persona, del rol que sea: la del alumno también vale. */
function exigeSesion(que: string): void {
  if (!haySesion()) {
    throw new Error(`${que} necesita que hayas entrado con tu cuenta.`);
  }
}

/** La del alumno, por su membresía en ese local. */
export async function bibliotecaDeMiGimnasio(membershipId: string): Promise<BibliotecaDto> {
  exigeSesion('Ver las rutinas de tu gimnasio');
  return await fetchRutinasDeMiGimnasio(membershipId);
}

export async function rutinaDeMiGimnasio(
  membershipId: string,
  routineId: string,
): Promise<RutinaDetalleDto> {
  exigeSesion('Ver una rutina');
  return await fetchRutinaDeMiGimnasio(membershipId, routineId);
}

/**
 * La que se abre desde el directorio.
 *
 * Sin guardia ninguna, y es lo correcto: la llama gente que no tiene cuenta de
 * nada —es la única ruta del producto que entrega contenido a un desconocido— y
 * exigirle sesión para ver el video que el gimnasio publicó para atraerlo sería
 * cerrarle la puerta con la que se le estaba invitando a entrar.
 */
export async function rutinaPublica(
  slug: string,
  routineId: string,
): Promise<RutinaDetalleDto> {
  return await fetchRutinaPublica(slug, routineId);
}

export async function guardarRutina(
  routineId: string | null,
  rutina: RutinaEscrita,
): Promise<RutinaDetalleDto> {
  exigeServidor('Guardar una rutina');
  return routineId === null ? await crearRutina(rutina) : await editarRutina(routineId, rutina);
}

export async function publicarRutina(
  routineId: string,
  status: 'draft' | 'published',
): Promise<RutinaDto> {
  exigeServidor('Publicar una rutina');
  return await cambiarEstadoRutina(routineId, status);
}

export async function cambiarPublicoDeRutina(
  routineId: string,
  visibility: 'public' | 'members',
): Promise<RutinaDto> {
  exigeServidor('Cambiar quién ve la rutina');
  return await cambiarPublicoRutina(routineId, visibility);
}

/**
 * Sube un video del gimnasio y devuelve el id con el que la rutina lo apunta.
 *
 * Tres pasos, y el del medio no pasa por Sinchi:
 *
 *  1. la api firma un permiso para escribir UN objeto, con su tipo y su tope;
 *  2. el telefono sube DIRECTO al almacenamiento — 300 MB por un proceso de
 *     Cloud Run con 512 MiB seria tumbar la api con una sola subida;
 *  3. la api confirma preguntandole al almacenamiento si el archivo llego. No
 *     se le cree al telefono: "ya subi" es justo lo que diria quien no subio.
 *
 * Si el paso 2 o el 3 fallan queda una fila `pending` sin archivo, y eso es
 * exactamente lo que `pending` existe para representar: la rutina no la sirve.
 */
export async function subirVideoDeRutina(input: {
  readonly fileUri: string;
  readonly contentType: string;
  readonly sizeBytes?: number;
  readonly originalName?: string;
  readonly onProgreso?: (fraccion: number) => void;
}): Promise<string> {
  exigeServidor('Subir un video');

  const permiso = await pedirSubidaDeVideo({
    contentType: input.contentType,
    ...(input.sizeBytes === undefined ? {} : { sizeBytes: input.sizeBytes }),
    ...(input.originalName === undefined ? {} : { originalName: input.originalName }),
  });

  await subirArchivoDeVideo({
    permiso,
    fileUri: input.fileUri,
    ...(input.onProgreso === undefined ? {} : { onProgreso: input.onProgreso }),
  });

  await confirmarSubidaDeVideo(permiso.assetId);
  return permiso.assetId;
}

export async function eliminarRutina(routineId: string): Promise<void> {
  exigeServidor('Borrar una rutina');
  await borrarRutina(routineId);
}

export async function guardarPreciosDelLocal(
  precios: PreciosDelLocal,
): Promise<PreciosDelLocal> {
  exigeServidor('Guardar lo que cobras');
  return await guardarPrecios(precios);
}

/**
 * Quienes cancelaron y siguen con ficha en el local.
 *
 * Son las unicas personas para las que `reactivarSuscripcion` tiene sentido, y
 * hasta ahora no habia forma de llegar a ellas: cancelar las sacaba del padron y
 * su `membershipId` dejaba de aparecer en ninguna respuesta.
 */
export async function bajasDelGimnasio(): Promise<readonly RosterEntry[]> {
  if (conServidor() === null) return [];
  const todos = await fetchRoster(true);
  return todos
    .filter((entrada) => entrada.subscription.status === 'canceled')
    .map((entrada) => ({ user: entrada.user, view: { ...entrada, attendances: [], charges: [] } }));
}

/**
 * Da de alta a un alumno en el local.
 *
 * Faltaba entera. `POST /staff/members` llevaba escrito desde el principio y
 * ninguna pantalla lo llamaba, asi que un gimnasio recien montado no podia
 * inscribir a nadie desde la app — y el resto del producto da por hecho que el
 * padron ya existe: vincular cuentas exige una ficha contra la que vincular, y
 * el escaner valida contra un padron que nadie podia llenar.
 *
 * Devuelve si la identidad se reutilizo. Importa decirlo: en Sinchi la persona
 * es global y un alumno que ya entrena en otro local NO se registra otra vez, se
 * le suma este gimnasio a la billetera que ya tiene (MD 5).
 */
/**
 * La persona ya esta en el padron de este gimnasio.
 *
 * Lleva la ficha porque el caso normal no es "te equivocaste": es alguien que
 * cancelo y vuelve. Sin el id, el mostrador lee "ya existe" y se queda sin saber
 * a donde ir.
 */
export class YaEnElPadron extends Error {
  constructor(
    message: string,
    readonly membershipId: string | null,
  ) {
    super(message);
    this.name = 'YaEnElPadron';
  }
}

export async function inscribirAlumno(input: {
  readonly name?: string;
  readonly documentId: string;
  readonly phone?: string;
  readonly email?: string;
  readonly planId: string;
}): Promise<{ readonly membershipId: string; readonly identidadReutilizada: boolean }> {
  const sesion = conServidor();
  if (sesion === null) throw new Error('Inscribir necesita una sesión de turno abierta.');

  let salida;
  try {
    salida = await enrollMember(input);
  } catch (causa) {
    if (causa instanceof ApiError && causa.status === 409) {
      const cuerpo = causa.body as { readonly membershipId?: unknown } | null;
      const id = typeof cuerpo?.membershipId === 'string' ? cuerpo.membershipId : null;
      throw new YaEnElPadron(causa.message, id);
    }
    throw causa;
  }
  await refrescarPadron(sesion);
  return {
    membershipId: salida.view.membership.id,
    identidadReutilizada: salida.reusedIdentity,
  };
}

/**
 * ¿Ya hay una identidad Sinchi con ese correo?
 *
 * Lo unico que devuelve es si existe. Con eso el alta sabe si tiene que pedir el
 * nombre y el celular o si le basta el documento, sin ensenarle a este gimnasio
 * los datos de alguien que entrena en otro.
 */
export async function existeIdentidad(email: string): Promise<boolean> {
  if (conServidor() === null) return false;
  return (await identityExists(email)).existe;
}
