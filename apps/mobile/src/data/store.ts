/**
 * Store de la app.
 *
 * Sustituye a la api mientras no existe, pero no la imita a medias: todas las
 * derivaciones pasan por las funciones puras de `@sinchi/shared`, y las
 * mutaciones son las mismas cuatro operaciones que expondra el backend
 * (registrar pago, marcar asistencia, cambiar plan, sincronizar). Cuando llegue
 * la api solo cambia de donde salen los datos.
 *
 * Version 1: sin cobro automatico. El unico camino por el que entra dinero es
 * un pago manual registrado por el staff (efectivo, Yape o transferencia).
 */
import {
  accessMessage,
  advanceBillingDate,
  applyPayment,
  asId,
  computeQuota,
  computeReceivable,
  decidePlanChange,
  evaluateDelinquency,
  formatPENShort,
  isoWeekOf,
  membershipStatus,
  parseQrPayload,
  type AccessLevel,
  type AccessMessage,
  type Attendance,
  type Charge,
  type ChargeType,
  type CheckInMethod,
  type DelinquencyState,
  type Membership,
  type PaymentRail,
  type Plan,
  type PlainDate,
  type QuotaState,
  type Receivable,
  type Staff,
  type Subscription,
  type Tenant,
  type User,
  type AppRole,
  type CheckInResult,
  validateCheckIn,
  localTimeInZone,
  TZ_LIMA,
  ZERO,
  type Cents,
  cents,
} from '@sinchi/shared';
import { buildDemoData, today, type DemoData } from './demo';

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

/** Marcado o cobro pendiente de subir. El wifi de los gimnasios es malo. */
export interface QueuedItem {
  readonly id: string;
  readonly kind: 'attendance' | 'payment';
  readonly label: string;
  readonly detail: string;
  readonly at: Date;
}

export interface State extends DemoData {
  readonly role: AppRole;
  /** Gimnasio activo en el selector de "Mi QR". */
  readonly activeTenantId: string;
  readonly online: boolean;
  /** Hay una carga desde la api en curso. */
  readonly hidratando: boolean;
  /**
   * Padron traido del servidor, ya calculado.
   *
   * `null` = no hay sesion de staff y manda `viewRoster()` sobre los datos
   * locales. Se guarda calculado en vez de recalcularlo aqui porque
   * `/staff/roster` ya devuelve el semaforo de cada alumno: recomponerlo en el
   * telefono exigiria traer los cargos y las asistencias de CADA persona del
   * padron —sesenta peticiones en un gimnasio mediano— para llegar al mismo
   * numero que el servidor ya calculo con el mismo dominio.
   */
  readonly remoteRoster: readonly RosterEntry[] | null;
  readonly queue: readonly QueuedItem[];
  readonly lastSyncAt: Date | null;
}

function initialState(): State {
  const demo = buildDemoData();
  return {
    ...demo,
    role: 'student',
    activeTenantId: demo.tenants[0]?.id ?? '',
    online: true,
    hidratando: false,
    remoteRoster: null,
    queue: [],
    lastSyncAt: new Date(),
  };
}

let state: State = initialState();
const listeners = new Set<() => void>();

function setState(next: State): void {
  state = next;
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const getState = (): State => state;

/**
 * Lo que la api puede llenar del estado.
 *
 * No es todo: `staff`, `schedules` y la cola de sincronizacion no vienen de
 * `/me`, y el rol lo dicta la sesion. Se enumera en vez de aceptar un `State`
 * parcial para que anadir un campo al store obligue a decidir si la api lo trae
 * — un `Partial<State>` dejaria campos de demostracion vivos sin que nadie lo
 * note.
 */
export interface RemoteData {
  readonly user: State['user'];
  readonly users: State['users'];
  readonly tenants: State['tenants'];
  readonly memberships: State['memberships'];
  readonly subscriptions: State['subscriptions'];
  readonly plans: State['plans'];
  readonly charges: State['charges'];
  readonly attendances: State['attendances'];
  readonly activeTenantId: string;
}

/**
 * Sustituye los datos de demostracion por los de verdad.
 *
 * Sustituye, no mezcla: si se fusionaran, un gimnasio inventado sobreviviria a
 * la primera carga y el alumno veria su membresia real junto a tres que no
 * existen. Es exactamente el sintoma que hizo falta perseguir.
 */
export function marcarHidratando(valor: boolean): void {
  setState({ ...state, hidratando: valor });
}

/**
 * Deja el padron del servidor y quien lo mira.
 *
 * `staff` sale de la sesion, no de un endpoint: el token ya dice `staffId`,
 * `tenantId` y `role`, y pedir otra vez lo que ya se tiene firmado seria una
 * ida y vuelta de mas.
 */
export function applyRemoteRoster(roster: readonly RosterEntry[], staff: Staff): void {
  setState({ ...state, remoteRoster: roster, staff, lastSyncAt: new Date() });
}

export function applyRemoteData(data: RemoteData): void {
  setState({
    ...state,
    ...data,
    // Sin datos de demostracion detras: el staff y los horarios llegaran cuando
    // haya endpoints que los sirvan, y hasta entonces vacios es la verdad.
    schedules: [],
    queue: [],
    // Si sobreviviera, un alumno veria el padron del staff que uso el telefono
    // antes que el.
    remoteRoster: null,
    lastSyncAt: new Date(),
  });
}

/** Solo para desarrollo: vuelve a los datos de demostracion. */
export function resetState(): void {
  setState(initialState());
}

// ---------------------------------------------------------------------------
// Derivaciones
// ---------------------------------------------------------------------------

export interface MembershipView {
  readonly membership: Membership;
  /** Identidad global del alumno: vive fuera del tenant (MD 5). */
  readonly user: User;
  readonly tenant: Tenant;
  readonly plan: Plan;
  /** Con el estado recalculado por el dominio, no el guardado. */
  readonly subscription: Subscription;
  readonly pendingPlan: Plan | null;
  readonly quota: QuotaState;
  readonly receivable: Receivable;
  readonly delinquency: DelinquencyState;
  /** Semaforo de la membresia, no del check-in de hoy. */
  readonly level: AccessLevel;
  readonly badge: string;
  readonly attendances: readonly Attendance[];
  readonly charges: readonly Charge[];
}

function findTenant(tenantId: string): Tenant {
  const tenant = state.tenants.find((t) => t.id === tenantId);
  if (tenant === undefined) throw new Error(`Gimnasio ${tenantId} no encontrado.`);
  return tenant;
}

function findPlan(planId: string): Plan {
  const plan = state.plans.find((p) => p.id === planId);
  if (plan === undefined) throw new Error(`Plan ${planId} no encontrado.`);
  return plan;
}

export function viewMembership(membershipId: string, hoy: PlainDate = today()): MembershipView {
  const membership = state.memberships.find((m) => m.id === membershipId);
  if (membership === undefined) throw new Error(`Membresía ${membershipId} no encontrada.`);

  const subscriptionRaw = state.subscriptions.find((s) => s.membershipId === membership.id);
  if (subscriptionRaw === undefined) {
    throw new Error(`La membresía ${membershipId} no tiene suscripción.`);
  }

  const user = state.users.find((u) => u.id === membership.userId);
  if (user === undefined) throw new Error(`Usuario ${membership.userId} no encontrado.`);

  const tenant = findTenant(membership.tenantId);
  const plan = findPlan(subscriptionRaw.planId);

  const receivable = computeReceivable({
    subscription: subscriptionRaw,
    plan,
    policy: tenant.billingDatePolicy,
    today: hoy,
  });

  // El estado persistido es un cache; la definicion es `evaluateDelinquency`.
  const delinquency = evaluateDelinquency({
    nextBillingDate: subscriptionRaw.nextBillingDate,
    today: hoy,
    graceDays: tenant.graceDays,
    periodPaid: !receivable.due,
    canceled: subscriptionRaw.status === 'canceled',
  });

  const subscription: Subscription = { ...subscriptionRaw, status: delinquency.status };
  const attendances = state.attendances.filter((a) => a.membershipId === membership.id);
  const quota = computeQuota(plan, attendances, hoy);
  const { level, badge } = membershipStatus({ delinquency, receivable, quota });

  return {
    membership,
    user,
    tenant,
    plan,
    subscription,
    pendingPlan: subscriptionRaw.pendingPlanId === null ? null : findPlan(subscriptionRaw.pendingPlanId),
    quota,
    receivable,
    delinquency,
    level,
    badge,
    attendances,
    charges: state.charges
      .filter((c) => c.membershipId === membership.id)
      .slice()
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
  };
}

/** Billetera del alumno: sus membresias en todos los gimnasios de la red. */
export function viewWallet(hoy: PlainDate = today()): readonly MembershipView[] {
  return state.memberships
    .filter((m) => m.userId === state.user.id)
    .map((m) => viewMembership(m.id, hoy));
}

export interface CheckInPreview {
  readonly result: CheckInResult;
  readonly message: AccessMessage;
  readonly view: MembershipView;
}

/**
 * Que pasaria si el alumno marcara ahora en este gimnasio.
 *
 * Es lo que la pantalla "Mi QR" muestra antes de que el alumno llegue a la
 * puerta: el mismo veredicto que vera el staff, calculado con la misma funcion.
 */
export function previewCheckIn(
  membershipId: string,
  hoy: PlainDate = today(),
  now: Date = new Date(),
): CheckInPreview {
  const view = viewMembership(membershipId, hoy);
  const result = validateCheckIn({
    subscription: view.subscription,
    plan: view.plan,
    attendances: view.attendances,
    schedules: state.schedules.filter((s) => s.tenantId === view.tenant.id),
    today: hoy,
    time: localTimeInZone(now, TZ_LIMA),
    graceDays: view.tenant.graceDays,
    quotaOverflowPolicy: view.tenant.quotaOverflowPolicy,
    dropInPriceCents: view.tenant.dropInPriceCents,
    debtCents: view.receivable.amountCents,
    daysPastDue: view.delinquency.daysPastDue,
  });
  return { result, message: accessMessage(result), view };
}

// ---------------------------------------------------------------------------
// Padron del staff
// ---------------------------------------------------------------------------

export interface RosterEntry {
  readonly user: User;
  readonly view: MembershipView;
}

/** Padron del gimnasio donde trabaja el staff, cacheado en el dispositivo. */
export function viewRoster(hoy: PlainDate = today()): readonly RosterEntry[] {
  const tenantId = state.staff.tenantId;
  return state.memberships
    .filter((m) => m.tenantId === tenantId)
    .map((m) => {
      const view = viewMembership(m.id, hoy);
      return { user: view.user, view };
    })
    .sort((a, b) => a.user.name.localeCompare(b.user.name, 'es'));
}

export type QrResolution =
  | { readonly ok: true; readonly membershipId: string }
  | { readonly ok: false; readonly reason: 'not_sinchi' | 'unknown_user' | 'not_a_member' };

/**
 * Resuelve un QR leido contra el padron del gimnasio.
 *
 * El payload trae el id del usuario GLOBAL: el mismo codigo lo identifica en
 * cualquier local de la red, y cada local resuelve contra su propia membresia
 * (MD 5).
 *
 * Aqui solo se comprueba la estructura. La firma TOTP la valida el servidor al
 * sincronizar; para validarla tambien sin conexion, el dispositivo tendria que
 * cachear las claves de verificacion del padron, lo que es viable pero es una
 * decision de seguridad que hay que tomar aparte (guardar N secretos en un
 * dispositivo de mostrador no es gratis).
 */
export function resolveQr(raw: string): QrResolution {
  const payload = parseQrPayload(raw);
  if (payload === null || payload.subject !== 'user') return { ok: false, reason: 'not_sinchi' };

  const user = state.users.find((u) => u.id === payload.id);
  if (user === undefined) return { ok: false, reason: 'unknown_user' };

  const membership = state.memberships.find(
    (m) => m.userId === user.id && m.tenantId === state.staff.tenantId,
  );
  if (membership === undefined) return { ok: false, reason: 'not_a_member' };

  return { ok: true, membershipId: membership.id };
}

export interface ScanOutcome {
  readonly entry: RosterEntry;
  readonly result: CheckInResult;
  readonly message: AccessMessage;
}

/**
 * Validacion local de un escaneo.
 *
 * Corre en el dispositivo, contra el padron en cache, funcione o no el wifi. El
 * servidor reconcilia despues y tiene la ultima palabra (MD 4.6).
 */
export function validateScan(
  membershipId: string,
  hoy: PlainDate = today(),
  now: Date = new Date(),
): ScanOutcome {
  const preview = previewCheckIn(membershipId, hoy, now);
  const entry = viewRoster(hoy).find((r) => r.view.membership.id === membershipId);
  if (entry === undefined) throw new Error(`La membresía ${membershipId} no está en el padrón.`);
  return { entry, result: preview.result, message: preview.message };
}

// ---------------------------------------------------------------------------
// Acciones
// ---------------------------------------------------------------------------

export function setRole(role: AppRole): void {
  setState({ ...state, role });
}

export function setActiveTenant(tenantId: string): void {
  setState({ ...state, activeTenantId: tenantId });
}

export function setOnline(online: boolean): void {
  setState({ ...state, online });
}

let sequence = 0;
const nextId = (prefix: string): string => `${prefix}-${(sequence += 1)}-${Date.now()}`;

export interface ManualPaymentInput {
  readonly membershipId: string;
  readonly type: ChargeType;
  readonly rail: PaymentRail;
  /** Periodos que cubre. Solo aplica a `renewal`. */
  readonly periods?: number;
  /** Monto explicito para matricula y clase suelta. */
  readonly amountCents?: Cents;
}

/**
 * Registra un pago hecho en mostrador.
 *
 * Un pago manual crea un cargo igual que uno con tarjeta y activa el MISMO
 * ciclo (MD 4.5): extiende la renovacion, reactiva la suscripcion y libera el
 * check-in al instante. Que el dinero haya entrado en efectivo no lo convierte
 * en un caso aparte.
 */
export function recordManualPayment(input: ManualPaymentInput, hoy: PlainDate = today()): Charge {
  const view = viewMembership(input.membershipId, hoy);
  const periods = input.periods ?? Math.max(1, view.receivable.periodsOwed);

  const amount =
    input.type === 'renewal'
      ? cents(view.plan.priceCents * periods)
      : (input.amountCents ?? view.tenant.dropInPriceCents ?? ZERO);

  const periodStart = view.subscription.nextBillingDate;
  const periodEnd = advanceBillingDate(periodStart, view.tenant.billingDatePolicy);

  const charge: Charge = {
    id: asId(nextId('charge')),
    tenantId: view.tenant.id,
    subscriptionId: view.subscription.id,
    membershipId: view.membership.id,
    type: input.type,
    amountCents: amount,
    status: 'succeeded',
    rail: input.rail,
    culqiChargeId: null,
    errorCode: null,
    attempt: 1,
    periodStart: input.type === 'renewal' ? periodStart : null,
    periodEnd: input.type === 'renewal' ? periodEnd : null,
    // Queda auditado con quien lo registro: es el hueco por donde entran favores.
    recordedBy: state.staff.id,
    createdAt: new Date(),
  };

  const subscriptions =
    input.type === 'renewal'
      ? state.subscriptions.map((s) => {
          if (s.id !== view.subscription.id) return s;
          const applied = applyPayment({
            subscription: s,
            policy: view.tenant.billingDatePolicy,
            periodsPaid: periods,
          });
          return { ...s, ...applied };
        })
      : state.subscriptions;

  setState({
    ...state,
    charges: [...state.charges, charge],
    subscriptions,
    queue: state.online
      ? state.queue
      : [
          ...state.queue,
          {
            id: charge.id,
            kind: 'payment',
            label: `${view.membership.internalAlias ?? nameOf(view.membership.userId)} · ${formatPENShort(amount)} ${railLabel(input.rail)}`,
            detail: 'pago en mostrador',
            at: charge.createdAt,
          },
        ],
  });

  return charge;
}

function nameOf(userId: string): string {
  return state.users.find((u) => u.id === userId)?.name ?? 'Alumno';
}

const RAIL_LABEL: Readonly<Record<PaymentRail, string>> = {
  cash: 'efectivo',
  yape: 'Yape',
  bank_transfer: 'transferencia',
  card: 'tarjeta',
};
export const railLabel = (rail: PaymentRail): string => RAIL_LABEL[rail];

export interface MarkAttendanceInput {
  readonly membershipId: string;
  readonly method: CheckInMethod;
  /** `true` cuando el staff deja pasar a pesar de un rechazo. Queda auditado. */
  readonly overrideDenial?: boolean;
}

/** Registra una asistencia. Si el dispositivo esta offline, entra a la cola. */
export function markAttendance(input: MarkAttendanceInput, hoy: PlainDate = today()): Attendance {
  const preview = previewCheckIn(input.membershipId, hoy);
  if (!preview.result.allowed && input.overrideDenial !== true) {
    throw new Error(preview.message.title);
  }

  const attendance: Attendance = {
    id: asId(nextId('attendance')),
    tenantId: preview.view.tenant.id,
    membershipId: preview.view.membership.id,
    subscriptionId: preview.view.subscription.id,
    classScheduleId: preview.result.allowed ? preview.result.classScheduleId : null,
    checkedInAt: new Date(),
    isoWeek: isoWeekOf(hoy).key,
    method: input.method,
    deviceId: asId('device-puerta-principal'),
    recordedBy: input.method === 'manual' ? state.staff.id : null,
    overrodeDenial: input.overrideDenial === true && !preview.result.allowed,
    syncedAt: state.online ? new Date() : null,
  };

  setState({
    ...state,
    attendances: [...state.attendances, attendance],
    queue: state.online
      ? state.queue
      : [
          ...state.queue,
          {
            id: attendance.id,
            kind: 'attendance',
            label: `${nameOf(preview.view.membership.userId)} · asistencia`,
            detail: input.method === 'manual' ? 'marcado manual' : 'QR',
            at: attendance.checkedInAt,
          },
        ],
  });

  return attendance;
}

/**
 * Cambio de plan.
 *
 * Upgrade: el diferencial prorrateado queda como cargo a cobrar en mostrador
 * (en la version 1 no hay tarjeta que debitar). Downgrade: se guarda como plan
 * pendiente y se aplica en la proxima renovacion, sin devoluciones.
 */
export function changePlan(
  membershipId: string,
  targetPlanId: string,
  hoy: PlainDate = today(),
): ReturnType<typeof decidePlanChange> {
  const view = viewMembership(membershipId, hoy);
  const decision = decidePlanChange({
    subscription: view.subscription,
    currentPlan: view.plan,
    targetPlan: findPlan(targetPlanId),
    today: hoy,
  });

  const subscriptions = state.subscriptions.map((s) => {
    if (s.id !== view.subscription.id) return s;
    switch (decision.kind) {
      case 'upgrade':
      case 'lateral':
        return { ...s, planId: decision.planId, pendingPlanId: null };
      case 'downgrade':
        return { ...s, pendingPlanId: decision.pendingPlanId };
      case 'no_change':
        return s;
    }
  });

  const charges =
    decision.kind === 'upgrade' && decision.chargeTodayCents > 0
      ? [
          ...state.charges,
          {
            id: asId<'charge'>(nextId('charge')),
            tenantId: view.tenant.id,
            subscriptionId: view.subscription.id,
            membershipId: view.membership.id,
            type: 'proration' as const,
            amountCents: decision.chargeTodayCents,
            // Pendiente: lo cobra el staff en mostrador.
            status: 'pending' as const,
            rail: 'cash' as const,
            culqiChargeId: null,
            errorCode: null,
            attempt: 1,
            periodStart: view.subscription.periodStart,
            periodEnd: view.subscription.nextBillingDate,
            recordedBy: null,
            createdAt: new Date(),
          },
        ]
      : state.charges;

  setState({ ...state, subscriptions, charges });
  return decision;
}

export function cancelSubscription(membershipId: string, hoy: PlainDate = today()): void {
  const view = viewMembership(membershipId, hoy);
  setState({
    ...state,
    subscriptions: state.subscriptions.map((s) =>
      s.id === view.subscription.id
        ? { ...s, status: 'canceled' as const, canceledAt: new Date() }
        : s,
    ),
  });
}

/** Sube la cola pendiente. El servidor reconcilia y tiene la ultima palabra. */
export function syncQueue(): void {
  setState({
    ...state,
    attendances: state.attendances.map((a) =>
      a.syncedAt === null ? { ...a, syncedAt: new Date() } : a,
    ),
    queue: [],
    online: true,
    lastSyncAt: new Date(),
  });
}
