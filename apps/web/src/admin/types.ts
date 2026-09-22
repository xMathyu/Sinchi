/**
 * Lo que devuelve `/admin`, tal como llega por HTTP.
 *
 * Mismo criterio que `src/panel/types.ts`: el panel los PINTA, así que no se
 * reconstruyen a objetos de dominio. Lo que sí se importa de `@sinchi/shared`
 * son las UNIONES —`SaasStatus`, `SaasTier`, `PlatformActionKind`— porque son
 * las que tienen que quedarse pegadas al dominio: si mañana entra un estado
 * nuevo de suscripción, esto tiene que dejar de compilar hasta que alguien
 * decida cómo se pinta.
 *
 * Las fechas llegan como ISO y las fechas civiles como `YYYY-MM-DD`: son las dos
 * formas que la api ya usaba, y no se inventa una tercera aquí.
 */
import type { PlatformActionKind, SaasStatus, SaasTier } from '@sinchi/shared';

export interface WireGymStats {
  readonly activeMembers: number;
  readonly staffCount: number;
  readonly delinquentMembers: number;
  readonly collectedLast30Cents: number;
  readonly checkInsLast30: number;
  readonly plans: number;
  readonly routines: number;
  readonly bookings: number;
  readonly openConversations: number;
}

export interface WireGymSaas {
  readonly status: SaasStatus;
  readonly tier: SaasTier;
  readonly tierLabel: string;
  readonly priceCents: number;
  readonly freeUntil: string;
  readonly nextBillingDate: string;
  readonly canWrite: boolean;
  readonly listed: boolean;
  readonly notice: string;
}

export interface WireGymRow {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly status: 'active' | 'suspended';
  readonly suspendedAt: string | null;
  readonly suspendedReason: string | null;
  readonly address: string | null;
  readonly timezone: string;
  readonly createdAt: string;
  readonly saas: WireGymSaas;
  readonly stats: WireGymStats;
}

export interface WireGymDetail extends WireGymRow {
  readonly taxId: string | null;
  readonly graceDays: number;
  readonly dropInPriceCents: number | null;
  readonly enrollmentFeeCents: number;
  readonly trialClassEnabled: boolean;
  readonly trialClassPriceCents: number;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly staff: readonly {
    readonly id: string;
    readonly role: string;
    readonly name: string;
    readonly email: string | null;
    readonly phone: string;
  }[];
  readonly planList: readonly {
    readonly id: string;
    readonly name: string;
    readonly type: string;
    readonly priceCents: number;
    readonly active: boolean;
  }[];
  readonly saasCharges: readonly {
    readonly amountCents: number;
    readonly rail: string;
    readonly reference: string | null;
    readonly periodStart: string;
    readonly periodEnd: string;
    readonly createdAt: string;
  }[];
  readonly redemptions: readonly {
    readonly code: string;
    readonly freeMonths: number;
    readonly createdAt: string;
  }[];
}

export interface WireOverview {
  readonly gyms: {
    readonly total: number;
    readonly active: number;
    readonly suspended: number;
    readonly newLast30: number;
  };
  readonly saas: {
    readonly free: number;
    readonly trialing: number;
    readonly active: number;
    readonly inGrace: number;
    readonly readOnly: number;
    readonly canceled: number;
    readonly monthlyRunRateCents: number;
    readonly collectedLast30Cents: number;
  };
  readonly people: {
    readonly users: number;
    readonly unlinkedAccounts: number;
    readonly admins: number;
  };
  readonly network: {
    readonly activeMembers: number;
    readonly checkInsLast30: number;
    readonly collectedLast30Cents: number;
  };
}

export interface WirePromo {
  readonly id: string;
  readonly code: string;
  readonly freeMonths: number;
  readonly maxRedemptions: number | null;
  readonly redeemedCount: number;
  readonly expiresOn: string | null;
  readonly active: boolean;
  readonly note: string | null;
  readonly createdAt: string;
  readonly redemptions: readonly {
    readonly tenantName: string;
    readonly tenantSlug: string;
    readonly createdAt: string;
  }[];
}

export interface WireAdmin {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
  readonly hasSignedIn: boolean;
  readonly lastSeenAt: string | null;
  readonly invitedByEmail: string | null;
  readonly revokedAt: string | null;
  readonly createdAt: string;
}

export interface WireAction {
  readonly id: string;
  /**
   * Llega como texto libre desde la base y se pinta con
   * `platformActionLabel`. Se tipa como la unión porque lo que escribe esa
   * columna es siempre un `PlatformActionKind`: si algún día no lo fuera, el
   * problema está en quien escribe, no en quien pinta.
   */
  readonly action: PlatformActionKind;
  readonly adminEmail: string;
  readonly tenantId: string | null;
  readonly subject: string | null;
  readonly reason: string | null;
  readonly detail: unknown;
  readonly createdAt: string;
}

// ---------------------------------------------------------------------------
// Personas
// ---------------------------------------------------------------------------

/** Con ficha (`users`) o sin ella (una cuenta de Google que no está en ningún padrón). */
export type WirePersonKind = 'identity' | 'account';

export interface WirePersonRow {
  readonly kind: WirePersonKind;
  /** `users.id` con ficha; el uid de Firebase sin ella. */
  readonly id: string;
  readonly name: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly documentId: string | null;
  readonly hasApp: boolean;
  readonly createdAt: string;
  readonly banned: boolean;
  readonly deletionRequestedAt: string | null;
}

export interface WirePeoplePage {
  readonly rows: readonly WirePersonRow[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

export interface WireBan {
  readonly id: string;
  readonly reason: string;
  readonly bannedByEmail: string;
  readonly createdAt: string;
  readonly liftedAt: string | null;
  readonly liftedByEmail: string | null;
}

export interface WireFootprint {
  readonly bookings: number;
  readonly conversations: number;
  readonly eventRegistrations: number;
}

export interface WireIdentityDetail {
  readonly kind: 'identity';
  readonly id: string;
  readonly name: string;
  readonly email: string | null;
  readonly phone: string;
  readonly documentId: string;
  readonly firebaseUid: string | null;
  readonly createdAt: string;
  readonly memberships: readonly {
    readonly id: string;
    readonly tenantId: string;
    readonly tenantName: string;
    readonly status: string;
    readonly since: string;
    readonly checkIns: number;
    readonly lastCheckInAt: string | null;
  }[];
  readonly staff: readonly {
    readonly tenantId: string;
    readonly tenantName: string;
    readonly role: string;
  }[];
  readonly footprint: WireFootprint;
  readonly bans: readonly WireBan[];
  readonly deletionRequests: readonly {
    readonly status: string;
    readonly requestedAt: string;
    readonly resolvedAt: string | null;
    readonly reason: string | null;
    readonly daysLeft: number | null;
  }[];
  readonly confirmationKey: string;
}

export interface WireAccountDetail {
  readonly kind: 'account';
  readonly id: string;
  readonly name: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly createdAt: string;
  readonly footprint: WireFootprint;
  readonly bans: readonly WireBan[];
  readonly confirmationKey: string;
}

export interface WirePendingDeletion {
  readonly userId: string;
  readonly name: string;
  readonly email: string | null;
  readonly requestedAt: string;
  readonly reason: string | null;
  /** Negativo = la promesa de 30 días ya se rompió. */
  readonly daysLeft: number;
}

export interface WireDeletionOutcome {
  readonly memberships: number;
  readonly chargesAnonymized: number;
  readonly bookings: number;
  readonly conversations: number;
  readonly eventRegistrations: number;
  readonly firebase: 'deleted' | 'not_found' | 'unavailable' | null;
}
