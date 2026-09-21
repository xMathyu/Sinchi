/**
 * Las formas que devuelve la api, tal como llegan por HTTP.
 *
 * No son los tipos de `@sinchi/shared` y esa diferencia es el motivo del
 * archivo: JSON no tiene `Date`, asi que un `createdAt` llega como cadena ISO y
 * una fecha civil llega como `{ year, month, day }`. La app los reconstruye a
 * objetos de dominio porque despues opera con ellos —calcula cupos, compara
 * semanas—; el panel los PINTA, y una capa de mapeo que solo sirve para volver
 * a serializarlos en el HTML es trabajo que se paga en cada peticion.
 *
 * Lo que si se importa de `@sinchi/shared` son las UNIONES —`ChargeType`,
 * `PaymentRail`, `AccessLevel`—, que son las que de verdad tienen que quedarse
 * pegadas al dominio: si mañana entra un medio de pago nuevo, esto tiene que
 * dejar de compilar hasta que alguien decida como se pinta.
 */
import type {
  AccessLevel,
  CheckInMethod,
  ChargeStatus,
  ChargeType,
  FadingReason,
  PaymentRail,
  PlanType,
  RoutineLevel,
  RoutineStatus,
  RoutineVisibility,
} from '@sinchi/shared';

/** Una fecha civil serializada. */
export interface WireDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

export interface WireSummary {
  readonly activeMembers: number;
  readonly delinquentMembers: number;
  readonly collectedThisMonthCents: number;
  readonly outstandingCents: number;
  readonly checkInsToday: number;
}

export interface WireRosterEntry {
  readonly membership: { readonly id: string; readonly internalAlias: string | null };
  readonly user: {
    readonly id: string;
    readonly name: string;
    readonly documentId: string;
    readonly phone: string;
    readonly email: string | null;
  };
  readonly tenant: { readonly id: string; readonly name: string; readonly slug: string };
  readonly plan: {
    readonly id: string;
    readonly name: string;
    readonly type: PlanType;
    readonly priceCents: number;
    readonly sessionsPerWeek: number | null;
  };
  readonly subscription: {
    readonly id: string;
    readonly status: string;
    readonly nextBillingDate: WireDate;
  };
  readonly quota: {
    readonly used: number;
    /** `null` en un plan ilimitado, no `0`: son cosas distintas. */
    readonly limit: number | null;
    readonly remaining: number | null;
    readonly exhausted: boolean;
  };
  readonly receivable: {
    readonly due: boolean;
    readonly amountCents: number;
    readonly periodsOwed: number;
    readonly daysPastDue: number;
  };
  readonly level: AccessLevel;
  readonly badge: string;
}

export interface WireCharge {
  readonly id: string;
  readonly type: ChargeType;
  readonly amountCents: number;
  readonly status: ChargeStatus;
  readonly rail: PaymentRail;
  readonly createdAt: string;
  readonly periodStart: WireDate | null;
  readonly periodEnd: WireDate | null;
}

export interface WireAttendance {
  readonly id: string;
  readonly checkedInAt: string;
  readonly method: CheckInMethod;
  readonly isoWeek: string;
  /** El staff dejó pasar a alguien a quien la validación rechazó. Se enseña. */
  readonly overrodeDenial: boolean;
}

export interface WireMemberDetail extends WireRosterEntry {
  readonly charges: readonly WireCharge[];
  readonly attendances: readonly WireAttendance[];
}

/** `GET /staff/checkin/recent`: una asistencia con el nombre ya puesto. */
export interface WireRecentCheckIn extends WireAttendance {
  readonly userName: string;
}

// ---------------------------------------------------------------------------
// Reportes de ingresos
// ---------------------------------------------------------------------------

export interface WireRevenuePoint {
  readonly date: WireDate;
  readonly amountCents: number;
  readonly count: number;
}

export interface WireRevenueSlice {
  readonly key: string;
  readonly amountCents: number;
  readonly count: number;
  readonly share: number;
}

export interface WireRevenue {
  readonly report: {
    readonly totalCents: number;
    readonly count: number;
    readonly series: readonly WireRevenuePoint[];
    readonly byType: readonly WireRevenueSlice[];
    readonly byRail: readonly WireRevenueSlice[];
    readonly best: WireRevenuePoint | null;
  };
  readonly previous: { readonly deltaCents: number; readonly percent: number | null };
  readonly from: WireDate;
  readonly through: WireDate;
  readonly bucket: 'day' | 'month';
}

export interface WireLedger {
  readonly total: number;
  readonly rows: readonly {
    readonly charge: WireCharge;
    readonly memberName: string | null;
    readonly recordedByName: string | null;
  }[];
}

// ---------------------------------------------------------------------------
// Quién viene y quién se está yendo
// ---------------------------------------------------------------------------

export interface WireRegular {
  readonly membershipId: string;
  readonly name: string;
  readonly checkIns: number;
  readonly lastVisit: WireDate | null;
  readonly perWeek: number;
  /** `null` en un plan ilimitado: no hay cupo contra el que medir. */
  readonly quotaUse: number | null;
}

export interface WireFading {
  readonly membershipId: string;
  readonly name: string;
  /** El motivo, no un «en riesgo»: decide qué se le escribe a la persona. */
  readonly reason: FadingReason;
  readonly daysAway: number;
  readonly checkIns: number;
  readonly lastVisit: WireDate | null;
}

export interface WireRanking {
  readonly regulars: readonly WireRegular[];
  readonly fading: readonly WireFading[];
  readonly totalCheckIns: number;
  readonly activeMembers: number;
  readonly absentMembers: number;
  readonly from: WireDate;
  readonly through: WireDate;
}

// ---------------------------------------------------------------------------
// Materiales de clase
// ---------------------------------------------------------------------------

export interface WireRoutine {
  readonly id: string;
  readonly title: string;
  readonly summary: string | null;
  readonly videoUrl: string | null;
  readonly videoAssetId: string | null;
  readonly level: RoutineLevel | null;
  readonly visibility: RoutineVisibility;
  readonly status: RoutineStatus;
  readonly updatedAt: string;
}

/**
 * La rutina con lo que la lista necesita alrededor.
 *
 * La api la devuelve asi —envuelta, no aplanada— y se respeta: `coverVideoUrl`
 * es una decision suya (el enlace de la rutina, o el del primer paso que tenga
 * uno) y aplanarla aqui invitaria a recalcularla en la pantalla.
 */
export interface WireRoutineCard {
  readonly routine: WireRoutine;
  readonly itemCount: number;
  /** `null` cuando el video es un archivo subido: no hay miniatura que sacar. */
  readonly coverVideoUrl: string | null;
  readonly hasVideo: boolean;
}

export interface WireRoutineItem {
  readonly id: string;
  readonly title: string;
  readonly instructions: string | null;
  readonly videoUrl: string | null;
  readonly position: number;
  /** «4 series de 12», «5 minutos de uchikomi». Texto libre a propósito. */
  readonly prescription: string | null;
  readonly videoAssetId: string | null;
}

/**
 * `GET /staff/routines/:id`. Union discriminada, y con `unlocked: false` la api
 * responde 200 con un anzuelo sin videos — pero eso es para la calle. Al dueño
 * de su propio local le llega siempre `unlocked: true`.
 */
export type WireRoutineView =
  | { readonly unlocked: true; readonly card: WireRoutineCard; readonly items: readonly WireRoutineItem[] }
  | { readonly unlocked: false; readonly reason: { readonly code: string } };

export interface WirePlan {
  readonly id: string;
  readonly name: string;
  readonly type: PlanType;
  readonly priceCents: number;
  readonly sessionsPerWeek: number | null;
  readonly enrollmentFeeCents: number;
}
