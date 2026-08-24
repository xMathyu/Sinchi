/**
 * Traducción entre filas de Postgres y los tipos de `@sinchi/shared`.
 *
 * Es el único sitio donde se hacen estos casts. Los tipos del dominio están
 * marcados (`Cents`, `PlainDate`, los ids) precisamente para que un `number`
 * suelto no pueda colarse como monto: si los casts estuvieran repartidos por los
 * servicios, la marca no protegería de nada.
 */
import {
  asId,
  cents,
  formatPlainDate,
  parsePlainDate,
  type Attendance,
  type Cents,
  type Charge,
  type ClassSchedule,
  type IsoWeekday,
  type Membership,
  type Plan,
  type PlainDate,
  type Staff,
  type Subscription,
  type Tenant,
  type User,
} from '@sinchi/shared';
import type { InferSelectModel } from 'drizzle-orm';
import type * as schema from '../db/schema';

type UserRow = InferSelectModel<typeof schema.users>;
type TenantRow = InferSelectModel<typeof schema.tenants>;
type MembershipRow = InferSelectModel<typeof schema.memberships>;
type StaffRow = InferSelectModel<typeof schema.staff>;
type PlanRow = InferSelectModel<typeof schema.plans>;
type SubscriptionRow = InferSelectModel<typeof schema.subscriptions>;
type ChargeRow = InferSelectModel<typeof schema.charges>;
type ClassScheduleRow = InferSelectModel<typeof schema.classSchedules>;
type AttendanceRow = InferSelectModel<typeof schema.attendance>;

/** Columnas `date` de Postgres llegan como `YYYY-MM-DD`. */
const toDate = (value: string): PlainDate => parsePlainDate(value);
const toNullableDate = (value: string | null): PlainDate | null =>
  value === null ? null : parsePlainDate(value);

export const dateToColumn = (value: PlainDate): string => formatPlainDate(value);

/** `smallint[]` de Postgres. Se valida el rango: 1 = lunes .. 7 = domingo. */
function toWeekdays(value: number[] | null): readonly IsoWeekday[] | null {
  if (value === null) return null;
  return value.map((day) => {
    if (!Number.isInteger(day) || day < 1 || day > 7) {
      throw new Error(`Día ISO inválido en la base: ${day}. Debe estar entre 1 y 7.`);
    }
    return day as IsoWeekday;
  });
}

export const toCents = (value: number): Cents => cents(value);

export function toUser(row: UserRow): User {
  return {
    id: asId(row.id),
    name: row.name,
    documentId: row.documentId,
    email: row.email,
    phone: row.phone,
    photoUrl: row.photoUrl,
    createdAt: row.createdAt,
  };
}

export function toTenant(row: TenantRow): Tenant {
  return {
    id: asId(row.id),
    name: row.name,
    taxId: row.taxId,
    slug: row.slug,
    timezone: row.timezone,
    saasTier: row.saasTier,
    graceDays: row.graceDays,
    billingDatePolicy:
      row.billingMode === 'fixed_day'
        ? { mode: 'fixed_day', dayOfMonth: row.billingDayOfMonth ?? 1 }
        : { mode: 'anniversary' },
    quotaOverflowPolicy: row.quotaOverflowPolicy,
    dropInPriceCents: row.dropInPriceCents === null ? null : toCents(row.dropInPriceCents),
    status: row.status,
  };
}

export function toMembership(row: MembershipRow): Membership {
  return {
    id: asId(row.id),
    userId: asId(row.userId),
    tenantId: asId(row.tenantId),
    internalAlias: row.internalAlias,
    status: row.status,
  };
}

export function toStaff(row: StaffRow): Staff {
  return {
    id: asId(row.id),
    tenantId: asId(row.tenantId),
    userId: asId(row.userId),
    role: row.role,
    displayName: row.displayName,
  };
}

export function toPlan(row: PlanRow): Plan {
  return {
    id: asId(row.id),
    tenantId: asId(row.tenantId),
    name: row.name,
    type: row.type,
    sessionsPerWeek: row.sessionsPerWeek,
    allowedDays: toWeekdays(row.allowedDays),
    priceCents: toCents(row.priceCents),
    active: row.active,
  };
}

export function toSubscription(row: SubscriptionRow): Subscription {
  return {
    id: asId(row.id),
    tenantId: asId(row.tenantId),
    membershipId: asId(row.membershipId),
    planId: asId(row.planId),
    pendingPlanId: row.pendingPlanId === null ? null : asId(row.pendingPlanId),
    status: row.status,
    startDate: toDate(row.startDate),
    periodStart: toDate(row.periodStart),
    nextBillingDate: toDate(row.nextBillingDate),
    canceledAt: row.canceledAt,
  };
}

export function toCharge(row: ChargeRow): Charge {
  return {
    id: asId(row.id),
    tenantId: asId(row.tenantId),
    subscriptionId: row.subscriptionId === null ? null : asId(row.subscriptionId),
    membershipId: asId(row.membershipId),
    type: row.type,
    amountCents: toCents(row.amountCents),
    status: row.status,
    rail: row.rail,
    culqiChargeId: row.culqiChargeId,
    errorCode: row.errorCode,
    attempt: row.attempt,
    periodStart: toNullableDate(row.periodStart),
    periodEnd: toNullableDate(row.periodEnd),
    recordedBy: row.recordedBy === null ? null : asId(row.recordedBy),
    createdAt: row.createdAt,
  };
}

export function toClassSchedule(row: ClassScheduleRow): ClassSchedule {
  const weekday = row.weekday;
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) {
    throw new Error(`Día ISO inválido en class_schedules: ${weekday}.`);
  }
  return {
    id: asId(row.id),
    tenantId: asId(row.tenantId),
    name: row.name,
    weekday: weekday as IsoWeekday,
    startTime: row.startTime,
    endTime: row.endTime,
    capacity: row.capacity,
    instructor: row.instructor,
  };
}

export function toAttendance(row: AttendanceRow): Attendance {
  return {
    id: asId(row.id),
    tenantId: asId(row.tenantId),
    membershipId: asId(row.membershipId),
    subscriptionId: asId(row.subscriptionId),
    classScheduleId: row.classScheduleId === null ? null : asId(row.classScheduleId),
    checkedInAt: row.checkedInAt,
    isoWeek: row.isoWeek,
    method: row.method,
    deviceId: row.deviceId === null ? null : asId(row.deviceId),
    recordedBy: row.recordedBy === null ? null : asId(row.recordedBy),
    overrodeDenial: row.overrodeDenial,
    syncedAt: row.syncedAt,
  };
}
