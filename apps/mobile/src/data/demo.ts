/**
 * Datos de demostracion.
 *
 * Reproducen los tres gimnasios del diseno y el padron que ve el staff. No son
 * un JSON inventado: son entidades del dominio, y las pantallas los pasan por
 * las mismas funciones puras de `@sinchi/shared` que usara la api. Asi lo que
 * se ve en pantalla ya esta validado por los tests.
 *
 * Las fechas son relativas a hoy para que los estados (al dia, ultima sesion,
 * mora) se mantengan sin importar cuando se abra la app.
 */
import {
  TZ_LIMA,
  addDays,
  asId,
  fromSoles,
  isoWeekOf,
  plainDateInZone,
  type Attendance,
  type Charge,
  type ClassSchedule,
  type Membership,
  type Plan,
  type PlainDate,
  type Staff,
  type Subscription,
  type Tenant,
  type User,
} from '@sinchi/shared';

export const today = (): PlainDate => plainDateInZone(new Date(), TZ_LIMA);

export interface DemoData {
  readonly user: User;
  readonly staff: Staff;
  readonly users: readonly User[];
  readonly tenants: readonly Tenant[];
  readonly memberships: readonly Membership[];
  readonly plans: readonly Plan[];
  readonly subscriptions: readonly Subscription[];
  readonly charges: readonly Charge[];
  readonly attendances: readonly Attendance[];
  readonly schedules: readonly ClassSchedule[];
}

const tenant = (
  id: string,
  name: string,
  overrides: Partial<Tenant> = {},
): Tenant => ({
  id: asId(id),
  name,
  taxId: '20512345678',
  slug: id,
  timezone: TZ_LIMA,
  saasTier: 'up_to_60',
  graceDays: 5,
  billingDatePolicy: { mode: 'anniversary' },
  quotaOverflowPolicy: 'block',
  dropInPriceCents: fromSoles(25),
  status: 'active',
  ...overrides,
});

const plan = (
  id: string,
  tenantId: string,
  name: string,
  priceSoles: number,
  rest: Pick<Plan, 'type' | 'sessionsPerWeek' | 'allowedDays'>,
): Plan => ({
  id: asId(id),
  tenantId: asId(tenantId),
  name,
  priceCents: fromSoles(priceSoles),
  active: true,
  ...rest,
});

const UNLIMITED = { type: 'unlimited', sessionsPerWeek: null, allowedDays: null } as const;
const weekly = (n: number) =>
  ({ type: 'sessions_per_week', sessionsPerWeek: n, allowedDays: null }) as const;

const user = (id: string, name: string, documentId: string, phone: string): User => ({
  id: asId(id),
  name,
  documentId,
  email: null,
  phone,
  photoUrl: null,
  createdAt: new Date('2024-03-01T12:00:00Z'),
});

const membership = (id: string, userId: string, tenantId: string): Membership => ({
  id: asId(id),
  userId: asId(userId),
  tenantId: asId(tenantId),
  internalAlias: null,
  status: 'active',
});

function subscription(
  id: string,
  tenantId: string,
  membershipId: string,
  planId: string,
  nextBillingDate: PlainDate,
  status: Subscription['status'],
): Subscription {
  return {
    id: asId(id),
    tenantId: asId(tenantId),
    membershipId: asId(membershipId),
    planId: asId(planId),
    pendingPlanId: null,
    status,
    startDate: addDays(nextBillingDate, -180),
    periodStart: addDays(nextBillingDate, -31),
    nextBillingDate,
    canceledAt: null,
  };
}

function attendance(
  id: string,
  tenantId: string,
  membershipId: string,
  subscriptionId: string,
  date: PlainDate,
  hour: string,
  overrides: Partial<Attendance> = {},
): Attendance {
  return {
    id: asId(id),
    tenantId: asId(tenantId),
    membershipId: asId(membershipId),
    subscriptionId: asId(subscriptionId),
    classScheduleId: null,
    checkedInAt: new Date(
      `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}T${hour}:00-05:00`,
    ),
    isoWeek: isoWeekOf(date).key,
    method: 'qr',
    deviceId: null,
    recordedBy: null,
    overrodeDenial: false,
    syncedAt: new Date(),
    ...overrides,
  };
}

function charge(
  id: string,
  tenantId: string,
  membershipId: string,
  subscriptionId: string,
  amountSoles: number,
  rail: Charge['rail'],
  periodStart: PlainDate,
  periodEnd: PlainDate,
): Charge {
  return {
    id: asId(id),
    tenantId: asId(tenantId),
    subscriptionId: asId(subscriptionId),
    membershipId: asId(membershipId),
    type: 'renewal',
    amountCents: fromSoles(amountSoles),
    status: 'succeeded',
    rail,
    culqiChargeId: null,
    errorCode: null,
    attempt: 1,
    periodStart,
    periodEnd,
    recordedBy: asId('staff-ana'),
    createdAt: new Date(),
  };
}

export function buildDemoData(): DemoData {
  const hoy = today();
  const semanaPasada = addDays(hoy, -7);

  // --- Gimnasios -----------------------------------------------------------
  const shotokan = tenant('dojo-shotokan', 'Dojo Shotokan Miraflores');
  const nova = tenant('nova-bjj', 'Nova BJJ Surco', {
    quotaOverflowPolicy: 'offer_drop_in',
  });
  const iron = tenant('iron-muay-thai', 'Iron Muay Thai Lince', { graceDays: 5 });

  // --- Planes --------------------------------------------------------------
  const plans: Plan[] = [
    plan('p-shotokan-unlimited', shotokan.id, 'Ilimitado', 180, UNLIMITED),
    plan('p-shotokan-3x', shotokan.id, '3x por semana', 150, weekly(3)),
    plan('p-shotokan-2x', shotokan.id, '2x por semana', 120, weekly(2)),
    plan('p-shotokan-fixed', shotokan.id, 'Lunes y miércoles', 110, {
      type: 'fixed_days',
      sessionsPerWeek: null,
      allowedDays: [1, 3],
    }),
    plan('p-nova-unlimited', nova.id, 'Ilimitado', 180, UNLIMITED),
    plan('p-nova-3x', nova.id, '3x por semana', 150, weekly(3)),
    plan('p-nova-2x', nova.id, '2x por semana', 120, weekly(2)),
    plan('p-iron-3x', iron.id, '3x por semana', 150, weekly(3)),
    plan('p-iron-2x', iron.id, '2x por semana', 120, weekly(2)),
  ];

  // --- Personas ------------------------------------------------------------
  const mathyu = user('u-mathyu', 'Mathyu Quispe', '71448902', '+51987654321');
  const ana = user('u-ana', 'Ana Ríos', '40218877', '+51987000111');
  const lucia = user('u-lucia', 'Lucía Ferrer', '46551203', '+51987111222');
  const diego = user('u-diego', 'Diego Salas', '70112334', '+51987222333');
  const julio = user('u-julio', 'Julio Salcedo', '09887210', '+51987333444');
  const rosa = user('u-rosa', 'Rosa Salazar', '45908771', '+51987444555');

  const staff: Staff = {
    id: asId('staff-ana'),
    tenantId: shotokan.id,
    userId: ana.id,
    role: 'front_desk',
    displayName: 'Ana Ríos',
  };

  // --- Membresias ----------------------------------------------------------
  // Mathyu esta en los tres gimnasios: eso es el producto (MD 5).
  const memberships: Membership[] = [
    membership('m-mathyu-shotokan', mathyu.id, shotokan.id),
    membership('m-mathyu-nova', mathyu.id, nova.id),
    membership('m-mathyu-iron', mathyu.id, iron.id),
    membership('m-lucia-shotokan', lucia.id, shotokan.id),
    membership('m-diego-shotokan', diego.id, shotokan.id),
    membership('m-julio-shotokan', julio.id, shotokan.id),
    membership('m-rosa-shotokan', rosa.id, shotokan.id),
  ];

  // --- Suscripciones -------------------------------------------------------
  const subscriptions: Subscription[] = [
    // Al dia: cobra en 11 dias.
    subscription(
      's-mathyu-shotokan',
      shotokan.id,
      'm-mathyu-shotokan',
      'p-shotokan-unlimited',
      addDays(hoy, 11),
      'active',
    ),
    // Al dia, pero con 2 de 3 sesiones usadas: le queda la ultima.
    subscription(
      's-mathyu-nova',
      nova.id,
      'm-mathyu-nova',
      'p-nova-3x',
      addDays(hoy, 20),
      'active',
    ),
    // Mora de 12 dias: vencio la gracia de 5, esta suspendida.
    subscription(
      's-mathyu-iron',
      iron.id,
      'm-mathyu-iron',
      'p-iron-2x',
      addDays(hoy, -12),
      'suspended',
    ),
    subscription(
      's-lucia',
      shotokan.id,
      'm-lucia-shotokan',
      'p-shotokan-unlimited',
      addDays(hoy, 11),
      'active',
    ),
    subscription(
      's-diego',
      shotokan.id,
      'm-diego-shotokan',
      'p-shotokan-2x',
      addDays(hoy, -12),
      'suspended',
    ),
    // Al dia pero con el cupo semanal agotado.
    subscription(
      's-julio',
      shotokan.id,
      'm-julio-shotokan',
      'p-shotokan-3x',
      addDays(hoy, 6),
      'active',
    ),
    // En periodo de gracia: debe, pero todavia entrena.
    subscription(
      's-rosa',
      shotokan.id,
      'm-rosa-shotokan',
      'p-shotokan-unlimited',
      addDays(hoy, -2),
      'in_grace',
    ),
  ];

  // --- Asistencia ----------------------------------------------------------
  const attendances: Attendance[] = [
    // Nova: 2 de 3 esta semana.
    attendance('a-1', nova.id, 'm-mathyu-nova', 's-mathyu-nova', addDays(hoy, -1), '19:00'),
    attendance('a-2', nova.id, 'm-mathyu-nova', 's-mathyu-nova', addDays(hoy, -3), '20:00', {
      method: 'manual',
      recordedBy: staff.id,
    }),
    // Nova: 3 de 3 la semana pasada.
    attendance('a-3', nova.id, 'm-mathyu-nova', 's-mathyu-nova', semanaPasada, '19:00'),
    attendance(
      'a-4',
      nova.id,
      'm-mathyu-nova',
      's-mathyu-nova',
      addDays(semanaPasada, -2),
      '19:00',
    ),
    attendance(
      'a-5',
      nova.id,
      'm-mathyu-nova',
      's-mathyu-nova',
      addDays(semanaPasada, -4),
      '19:00',
    ),
    // Shotokan, plan ilimitado.
    attendance(
      'a-6',
      shotokan.id,
      'm-mathyu-shotokan',
      's-mathyu-shotokan',
      addDays(hoy, -2),
      '07:00',
    ),
    // Julio agoto su cupo de 3.
    attendance('a-7', shotokan.id, 'm-julio-shotokan', 's-julio', addDays(hoy, -1), '19:00'),
    attendance('a-8', shotokan.id, 'm-julio-shotokan', 's-julio', addDays(hoy, -2), '19:00'),
    attendance('a-9', shotokan.id, 'm-julio-shotokan', 's-julio', addDays(hoy, -4), '19:00'),
  ];

  // --- Ledger --------------------------------------------------------------
  // En la version 1 todo cargo es un pago manual registrado por el staff.
  const charges: Charge[] = [
    charge(
      'c-1',
      shotokan.id,
      'm-mathyu-shotokan',
      's-mathyu-shotokan',
      180,
      'cash',
      addDays(hoy, -20),
      addDays(hoy, 11),
    ),
    charge(
      'c-2',
      nova.id,
      'm-mathyu-nova',
      's-mathyu-nova',
      150,
      'yape',
      addDays(hoy, -11),
      addDays(hoy, 20),
    ),
    charge(
      'c-3',
      iron.id,
      'm-mathyu-iron',
      's-mathyu-iron',
      120,
      'cash',
      addDays(hoy, -43),
      addDays(hoy, -12),
    ),
  ];

  // --- Horarios ------------------------------------------------------------
  // Se dejan cargados solo para Nova, que si controla horarios; Shotokan opera
  // con horario libre y por eso el check-in no valida clase (MD 4.3).
  const schedules: ClassSchedule[] = [
    {
      id: asId('sched-nova-lun'),
      tenantId: nova.id,
      name: 'Fundamentos',
      weekday: 1,
      startTime: '19:00',
      endTime: '20:30',
      capacity: 24,
      instructor: 'Prof. Ramos',
    },
    {
      id: asId('sched-nova-mie'),
      tenantId: nova.id,
      name: 'No-Gi',
      weekday: 3,
      startTime: '19:00',
      endTime: '20:30',
      capacity: 24,
      instructor: 'Prof. Ramos',
    },
    {
      id: asId('sched-nova-vie'),
      tenantId: nova.id,
      name: 'Sparring',
      weekday: 5,
      startTime: '19:00',
      endTime: '20:30',
      capacity: 20,
      instructor: 'Prof. Ramos',
    },
  ];

  return {
    user: mathyu,
    staff,
    users: [mathyu, ana, lucia, diego, julio, rosa],
    tenants: [shotokan, nova, iron],
    memberships,
    plans,
    subscriptions,
    charges,
    attendances,
    schedules,
  };
}
