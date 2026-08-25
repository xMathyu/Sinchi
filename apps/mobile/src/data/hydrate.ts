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
import { asId, type Attendance, type Charge, type Plan, type Tenant } from '@sinchi/shared';
import { fetchMe, fetchMembership, fetchRoster } from './api';
import { applyRemoteData, applyRemoteRoster, type RemoteData } from './store';

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

/**
 * Carga el padron para una sesion de staff.
 *
 * No pasa por `loadFromApi`: `/me` es la billetera de quien mira, y un
 * recepcionista no tiene membresia en el gimnasio donde trabaja. Pedirsela
 * devolveria una lista vacia y la pantalla del padron quedaria en blanco sin que
 * nada explicara por que.
 *
 * Se piden las dos cosas en paralelo: el padron es lo que se pinta, y `/me` solo
 * aporta el nombre de quien esta de turno para la cabecera. Encadenarlas haria
 * esperar el padron por un dato decorativo.
 */
export async function hydrateStaff(session: {
  readonly userId: string;
  readonly tenantId: string | null;
  readonly role: 'front_desk' | 'owner';
}): Promise<void> {
  const [roster, me] = await Promise.all([fetchRoster(), fetchMe()]);

  applyRemoteRoster(
    roster.map((entrada) => ({
      user: entrada.user,
      // Sin cargos ni asistencias: el padron muestra el semaforo, que el
      // servidor ya calculo. El historial se pide al abrir cada alumno.
      view: { ...entrada, attendances: [], charges: [] },
    })),
    {
      // El token lleva `staffId` firmado pero la api no lo devuelve al cliente,
      // y aqui no hace falta: solo lo usaria el registro local de la
      // demostracion. Se deja vacio en vez de inventar un id que parezca real.
      id: asId(''),
      tenantId: asId(session.tenantId ?? ''),
      userId: asId(session.userId),
      role: session.role,
      displayName: me.user.name,
    },
  );
}
