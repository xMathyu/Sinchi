/**
 * Llena el store con datos de la api.
 *
 * Hasta aquí la app era un prototipo completo pero cerrado: `store.ts` nacía de
 * `demo.ts` y **ninguna pantalla de contenido llamaba a la api**. Se podía entrar
 * con una cuenta real, quedar inscrito de verdad, y seguir viendo a Mathyu
 * Quispe y sus tres gimnasios inventados — porque las pantallas nunca
 * preguntaban.
 *
 * La forma de arreglarlo NO es reescribir las pantallas para que llamen al
 * servidor. `MembershipViewDto` y `MembershipView` son casi la misma cosa, y no
 * por casualidad: las calcula el mismo dominio de `@sinchi/shared` a los dos
 * lados. Así que basta con cambiar de dónde salen los datos crudos y dejar que
 * las vistas se sigan calculando igual.
 *
 * Eso conserva la propiedad que justifica el monorepo: el semáforo que ve el
 * alumno y el que ve recepción salen de la misma función, no de dos que se
 * parecen.
 */
import type { Attendance, Charge, Plan, Tenant } from '@sinchi/shared';
import { fetchMe, fetchMembership } from './api';
import { applyRemoteData, type RemoteData } from './store';

/**
 * Trae la identidad, la billetera y el detalle de cada membresía.
 *
 * El detalle va en una llamada por membresía y eso es a propósito: `/me/wallet`
 * devuelve la vista ya calculada, pero no los cargos ni las asistencias, y esas
 * son las que alimentan el historial y el cupo. Un alumno tiene una o dos
 * membresías —tres si entrena mucho—, así que el coste real es una petición
 * extra, no un problema de escala.
 */
export async function loadFromApi(): Promise<RemoteData> {
  const me = await fetchMe();

  const detalles = await Promise.all(
    me.wallet.map((entrada) => fetchMembership(entrada.membership.id)),
  );

  const tenants: Tenant[] = [];
  const plans: Plan[] = [];
  const charges: Charge[] = [];
  const attendances: Attendance[] = [];

  for (const detalle of detalles) {
    empujarUnico(tenants, detalle.tenant);
    empujarUnico(plans, detalle.plan);
    if (detalle.pendingPlan !== null) empujarUnico(plans, detalle.pendingPlan);
    charges.push(...detalle.charges);
    attendances.push(...detalle.attendances);
  }

  // Los planes a los que se puede cambiar tambien hacen falta: la pantalla de
  // cambio de plan los busca en el store, no los pide aparte.
  return {
    user: me.user,
    users: [me.user],
    tenants,
    memberships: detalles.map((d) => d.membership),
    subscriptions: detalles.map((d) => d.subscription),
    plans,
    charges,
    attendances,
    activeTenantId: tenants[0]?.id ?? '',
  };
}

/** Trae los datos y los deja en el store. */
export async function hydrate(): Promise<void> {
  applyRemoteData(await loadFromApi());
}

/**
 * Evita duplicados por id.
 *
 * Dos membresias del mismo gimnasio traen el mismo tenant, y dos alumnos del
 * mismo plan traen el mismo plan. Sin esto el selector de gimnasios mostraria
 * Kaizen dos veces.
 */
function empujarUnico<T extends { readonly id: string }>(lista: T[], item: T): void {
  if (!lista.some((x) => x.id === item.id)) lista.push(item);
}
