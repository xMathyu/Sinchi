/**
 * Lo que devuelve `POST /gyms/signup`, tal como viaja.
 *
 * Es `SignUpGymResult` de la api (`onboarding.service.ts`) ya serializado:
 * `freeUntil` llega como `YYYY-MM-DD` y la sesión es la misma que emite
 * `/auth/google`, que es lo que permite dejar al dueño dentro del panel sin
 * volver a pedirle nada.
 */
import type { PromoDenial } from '@sinchi/shared';

export interface WireSignUpGym {
  readonly tenantId: string;
  readonly slug: string;
  readonly name: string;
  readonly freeUntil: string;
  readonly promo:
    | { readonly applied: true; readonly freeMonths: number }
    | { readonly applied: false; readonly reason: PromoDenial }
    | null;
  readonly session: {
    readonly accessToken: string;
    readonly expiresInSeconds: number;
    readonly role: 'owner' | 'front_desk' | 'student';
    readonly userId: string;
    readonly tenantId: string | null;
  };
}
