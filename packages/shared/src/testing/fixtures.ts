/**
 * Constructores para tests y para el modo demo de la app.
 *
 * No es codigo de produccion, pero si es codigo compartido: la app usa estos
 * mismos fixtures como datos de demostracion mientras la api no existe, y asi
 * lo que se ve en pantalla sale del dominio real y no de un JSON inventado.
 */
import { fromSoles, type Cents } from '../money/cents.js';
import { plainDate, type IsoWeekday, type PlainDate } from '../time/plain-date.js';
import { isoWeekOf } from '../time/iso-week.js';
import {
  asId,
  type Attendance,
  type ClassSchedule,
  type Membership,
  type Plan,
  type Subscription,
  type Tenant,
  type User,
} from '../domain/types.js';
import { TZ_LIMA } from '../time/zone.js';

export function makeTenant(overrides: Partial<Tenant> = {}): Tenant {
  return {
    id: asId('tenant-1'),
    name: 'Dojo Shotokan Miraflores',
    taxId: '20512345678',
    slug: 'dojo-shotokan',
    timezone: TZ_LIMA,
    saasTier: 'up_to_60',
    graceDays: 5,
    billingDatePolicy: { mode: 'anniversary' },
    quotaOverflowPolicy: 'offer_drop_in',
    dropInPriceCents: fromSoles(25),
    status: 'active',
    ...overrides,
  };
}

export function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: asId('user-1'),
    name: 'Mathyu Quispe',
    documentId: '71448902',
    email: 'mathyu@example.pe',
    phone: '+51987654321',
    photoUrl: null,
    createdAt: new Date('2025-01-15T14:00:00Z'),
    ...overrides,
  };
}

export function makeMembership(overrides: Partial<Membership> = {}): Membership {
  return {
    id: asId('membership-1'),
    userId: asId('user-1'),
    tenantId: asId('tenant-1'),
    internalAlias: null,
    status: 'active',
    ...overrides,
  };
}

export function makeUnlimitedPlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: asId('plan-unlimited'),
    tenantId: asId('tenant-1'),
    name: 'Ilimitado',
    type: 'unlimited',
    sessionsPerWeek: null,
    allowedDays: null,
    priceCents: fromSoles(180),
    active: true,
    ...overrides,
  };
}

export function makeWeeklyPlan(sessionsPerWeek: number, overrides: Partial<Plan> = {}): Plan {
  return {
    id: asId(`plan-${sessionsPerWeek}x`),
    tenantId: asId('tenant-1'),
    name: `${sessionsPerWeek}x por semana`,
    type: 'sessions_per_week',
    sessionsPerWeek,
    allowedDays: null,
    priceCents: fromSoles(sessionsPerWeek === 2 ? 120 : 150),
    active: true,
    ...overrides,
  };
}

export function makeFixedDaysPlan(
  allowedDays: readonly IsoWeekday[],
  overrides: Partial<Plan> = {},
): Plan {
  return {
    id: asId('plan-fixed'),
    tenantId: asId('tenant-1'),
    name: 'Días fijos',
    type: 'fixed_days',
    sessionsPerWeek: null,
    allowedDays,
    priceCents: fromSoles(110),
    active: true,
    ...overrides,
  };
}

/**
 * Clase suelta: se paga cada vez que se entrena.
 *
 * `priceCents` es lo que cuesta UNA clase, no un mes. Los S/ 25 son el precio
 * corriente de una clase suelta en un dojo de Lima.
 */
export function makeDropInPlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: asId('plan-drop-in'),
    tenantId: asId('tenant-1'),
    name: 'Clase suelta',
    type: 'drop_in',
    sessionsPerWeek: null,
    allowedDays: null,
    priceCents: fromSoles(25),
    active: true,
    ...overrides,
  };
}

export function makeSubscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: asId('subscription-1'),
    tenantId: asId('tenant-1'),
    membershipId: asId('membership-1'),
    planId: asId('plan-3x'),
    pendingPlanId: null,
    status: 'active',
    startDate: plainDate(2026, 1, 12),
    periodStart: plainDate(2026, 8, 12),
    nextBillingDate: plainDate(2026, 9, 12),
    canceledAt: null,
    ...overrides,
  };
}

export function makeSchedule(
  weekday: IsoWeekday,
  startTime: string,
  endTime: string,
  overrides: Partial<ClassSchedule> = {},
): ClassSchedule {
  return {
    id: asId(`schedule-${weekday}-${startTime}`),
    tenantId: asId('tenant-1'),
    name: 'No-Gi',
    weekday,
    startTime,
    endTime,
    capacity: 24,
    instructor: 'Prof. Ramos',
    ...overrides,
  };
}

/** `n` asistencias en la semana ISO de `date`. Es lo que consume el cupo. */
export function makeAttendances(date: PlainDate, count: number): readonly Attendance[] {
  const week = isoWeekOf(date).key;
  return Array.from({ length: count }, (_, i) => ({
    id: asId(`attendance-${i}`),
    tenantId: asId('tenant-1'),
    membershipId: asId('membership-1'),
    subscriptionId: asId('subscription-1'),
    classScheduleId: null,
    checkedInAt: new Date('2026-08-19T00:00:00Z'),
    isoWeek: week,
    method: 'qr' as const,
    deviceId: null,
    recordedBy: null,
    overrodeDenial: false,
    syncedAt: null,
  }));
}

export const soles = (amount: number): Cents => fromSoles(amount);
