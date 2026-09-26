/**
 * Enlace entre el store y React.
 *
 * `useSyncExternalStore` en vez de un contexto con estado: el store es la
 * frontera con la api futura, y mantenerlo fuera de React deja el cambio a
 * peticiones reales contenido en un archivo.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { ConversationStatus, ClassBooking, GymLinks } from '@sinchi/shared';
import {
  TZ_LIMA,
  awaitsEnrollment,
  encodeQrPayload,
  generateTotp,
  plainDateInZone,
  secondsUntilRotation,
  TOTP_PERIOD_SECONDS,
  type PlainDate,
  type Plan,
} from '@sinchi/shared';
import { hmacSha256, loadSecret } from './crypto';
import {
  fetchCheckInPreview,
  fetchGymThread,
  fetchInbox,
  fetchInboxUnread,
  fetchMyUnreadConversations,
  fetchGym,
  fetchGyms,
  fetchModes,
  fetchRecentCheckIns,
  fetchTrialSettings,
  fetchTrials,
  type CheckInPreviewDto,
  type GymCardDto,
  type GymDetailDto,
  type GymThreadDto,
  type InboxEntryDto,
  type PersonConversationDto,
  type PersonThreadDto,
  type BibliotecaDto,
  type EventWithSeats,
  type PlanWithUsage,
  type ScheduleWithUsage,
  type RoutineDetailDto,
  type PlazaDto,
  type GymPricing,
  type GymLocation,
  type SaasSubscriptionDto,
  type StaffPostDto,
  type SummaryDto,
  type ClassBookingDto,
  fetchMemberLinkState,
  type LinkRequestDto,
  type MemberLinkStateDto,
} from './api';
import { myBookings } from './trials';
import { myConversations, threadWith } from './chat';
import { myLinkRequests } from './link-requests';
import {
  gymDeletions,
  loadStudentDetail,
  gymPlans,
  plansFor,
  refreshDetails,
  gymSummary,
  ownerPlans,
  ownerSchedules,
  gymPricing,
  gymLocation,
  gymLogo,
  gymLinks,
  gymEvents,
  gymEvent,
  eventSeats,
  gymLibrary,
  myGymLibrary,
  gymRoutine,
  myGymRoutine,
  publicRoutine,
  sinchiSubscription,
} from './actions';
import { ensureAccessCodeSecret } from './auth';
import { getSessionState } from './session';
import {
  getState,
  previewCheckIn,
  subscribe,
  viewMembership,
  viewRoster,
  viewWallet,
  type CheckInPreview,
  type MembershipView,
  type RosterEntry,
  type ScanVerdict,
  type State,
} from './store';

export function useStore<T>(selector: (state: State) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(getState()),
    () => selector(getState()),
  );
}

/** Fecha de hoy en Lima, refrescada al cruzar la medianoche. */
export function useToday(): PlainDate {
  const [value, setValue] = useState(() => plainDateInZone(new Date(), TZ_LIMA));

  useEffect(() => {
    // Un minuto es suficiente: el corte de dia no necesita precision de segundos
    // y un temporizador por minuto no despierta la CPU de forma notable.
    const timer = setInterval(() => {
      const next = plainDateInZone(new Date(), TZ_LIMA);
      setValue((current) =>
        current.year === next.year && current.month === next.month && current.day === next.day
          ? current
          : next,
      );
    }, 60_000);
    return () => clearInterval(timer);
  }, []);

  return value;
}

export function useWallet(): readonly MembershipView[] {
  const today = useToday();
  const version = useStore((s) => s.charges.length + s.attendances.length + s.subscriptions.length);
  return useMemo(() => viewWallet(today), [today, version]);
}

export function useMembership(membershipId: string): MembershipView {
  const today = useToday();
  const remoto = useStore((s) => s.remoteRoster);
  const version = useStore((s) => s.charges.length + s.attendances.length + s.subscriptions.length);
  return useMemo(() => {
    // Con padron del servidor la membresia no esta en `state.memberships`, y
    // `viewMembership` lanzaba "Membresia ... no encontrada" — que es como se
    // caia la pantalla de cobro al abrirla desde el padron.
    const delServidor = remoto?.find((entry) => entry.view.membership.id === membershipId);
    if (delServidor !== undefined) return delServidor.view;
    return viewMembership(membershipId, today);
  }, [membershipId, remoto, today, version]);
}

/**
 * Acepta `null` para que las pantallas puedan llamarlo antes de saber si hay
 * membresia: las reglas de hooks no admiten un `return` temprano en medio.
 */
export function useCheckInPreview(membershipId: string | null): CheckInPreview | null {
  const today = useToday();
  const version = useStore((s) => s.charges.length + s.attendances.length + s.subscriptions.length);
  const [remoto, setRemoto] = useState<CheckInPreviewDto | null>(null);

  // Voz de alumno: esta pantalla es la suya. El respaldo local tiene que decir
  // lo mismo que dice el servidor, y el servidor ya responde en su voz.
  const local = useMemo(
    () =>
      membershipId === null
        ? null
        : previewCheckIn(membershipId, today, new Date(), 'student'),
    [membershipId, today, version],
  );

  /**
   * El veredicto de verdad lo da el servidor.
   *
   * `/me/.../checkin-preview` promete en su propia documentacion que "si aqui
   * dice que puede entrar, en la puerta pasa", y la app lo calculaba en local
   * con `state.schedules` VACIO —`/me` no devuelve los horarios del gimnasio—.
   * Con la lista vacia `validateCheckIn` entiende "este local no controla
   * horarios" y dice que si a cualquier hora, mientras la puerta rechaza por
   * fuera de horario. El alumno llegaba con un "puedes entrar" en la mano.
   *
   * Se conserva el calculo local como respaldo: sin conexion es lo unico que
   * hay, y sigue acertando en lo que no depende del horario —mora y cupo—.
   */
  useEffect(() => {
    if (membershipId === null || getSessionState().status !== 'signed_in') {
      setRemoto(null);
      return;
    }
    let cancelado = false;
    void fetchCheckInPreview(membershipId)
      .then((dto) => {
        if (!cancelado) setRemoto(dto);
      })
      .catch(() => {});
    return () => {
      cancelado = true;
    };
  }, [membershipId, version]);

  if (local === null) return null;
  if (remoto === null) return local;
  return { ...local, result: remoto.result, message: remoto.message };
}

export function useRoster(): readonly RosterEntry[] {
  const today = useToday();
  const remoto = useStore((s) => s.remoteRoster);
  const version = useStore((s) => s.charges.length + s.attendances.length + s.subscriptions.length);
  // Con sesion de staff manda lo que dijo el servidor; sin ella se calcula
  // sobre los datos locales, que es lo que sostiene el modo demostracion.
  return useMemo(() => remoto ?? viewRoster(today), [remoto, today, version]);
}

// ---------------------------------------------------------------------------
// Codigo de acceso
// ---------------------------------------------------------------------------

export interface AccessCode {
  readonly code: string;
  readonly payload: string;
  /** Segundos que le quedan a la ventana. Alimenta el anillo de la pantalla. */
  readonly secondsLeft: number;
  readonly periodSeconds: number;
  readonly ready: boolean;
  /**
   * `true` cuando no hay secreto guardado y hay que vincular el dispositivo.
   *
   * Se distingue de `ready: false` a proposito: uno es "espera un momento" y el
   * otro es "hay que hacer algo". Sin la diferencia, la pantalla del QR se queda
   * cargando para siempre y nadie sabe por que.
   */
  readonly needsLink: boolean;
}

/**
 * Codigo TOTP del alumno, rotando cada 30 segundos.
 *
 * Se genera EN EL DISPOSITIVO a partir del secreto guardado en el llavero, asi
 * que funciona sin internet (MD 4.6). Un QR estatico circularia por WhatsApp en
 * una semana y se perderia el control de aforo.
 */
export function useAccessCode(): AccessCode {
  const userId = useStore((s) => s.user.id);
  const [secret, setSecret] = useState<Uint8Array | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [tick, setTick] = useState(() => new Date());

  useEffect(() => {
    let cancelled = false;

    // Se pide el secreto y, si no está, se siembra. La siembra vivía en
    // `auth.ts` sin que nadie la llamara: el llavero se quedaba vacío y esta
    // pantalla pedía vincular el dispositivo para siempre.
    void loadSecret()
      .then(async (value) => {
        if (value !== null) return value;
        const session = getSessionState();
        if (session.status !== 'signed_in') return null;
        return (await ensureAccessCodeSecret(session.session.userId)) ? loadSecret() : null;
      })
      .then((value) => {
        if (cancelled) return;
        setSecret(value);
        setLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    const timer = setInterval(() => setTick(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const code = useMemo(() => {
    if (secret === null) return null;
    return generateTotp(secret, tick, hmacSha256);
  }, [secret, tick]);

  return {
    code: code ?? '········',
    payload: code === null ? '' : encodeQrPayload({ subject: 'user', id: userId, code }),
    secondsLeft: secondsUntilRotation(tick),
    periodSeconds: TOTP_PERIOD_SECONDS,
    ready: code !== null,
    needsLink: loaded && secret === null,
  };
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

/** Lo que el servidor dijo del ultimo QR, si es de este alumno. */
export function useScanVerdict(membershipId: string): ScanVerdict | null {
  const verdict = useStore((s) => s.scanVerdict);
  return verdict !== null && verdict.membershipId === membershipId ? verdict : null;
}

export interface StudentRecord {
  readonly view: MembershipView | null;
  readonly loading: boolean;
  readonly error: string | null;
  /**
   * Lo que se ve sale del padron en cache, sin historial.
   *
   * La pantalla lo dice en vez de mostrar un historial vacio: "no ha pagado
   * nunca" y "no pude traer sus pagos" se ven igual y significan lo contrario.
   */
  readonly parcial: boolean;
  readonly reload: () => void;
}

/**
 * Ficha completa de un alumno del padron.
 *
 * Empieza por lo que ya hay en cache —el padron trae el semaforo, el plan y la
 * deuda— y lo completa con el historial cuando llega. Asi la pantalla se pinta
 * de inmediato y sin conexion sigue sirviendo para lo que importa en el
 * mostrador: saber si puede pasar y cuanto debe.
 */
export function useStaffMember(membershipId: string): StudentRecord {
  const roster = useRoster();
  const [detail, setDetail] = useState<MembershipView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const enCache =
    roster.find((entry) => entry.view.membership.id === membershipId)?.view ?? null;

  useEffect(() => {
    let cancelado = false;
    setLoading(true);
    setError(null);

    void loadStudentDetail(membershipId)
      .then((vista) => {
        if (!cancelado) setDetail(vista);
      })
      .catch((causa: unknown) => {
        if (cancelado) return;
        setError(causa instanceof Error ? causa.message : 'No se pudo traer la ficha.');
      })
      .finally(() => {
        if (!cancelado) setLoading(false);
      });

    return () => {
      cancelado = true;
    };
    // `roster` cambia cuando se recarga el padron tras cobrar o marcar, y es
    // justo cuando esta ficha quedo vieja.
  }, [membershipId, attempt, roster]);

  return {
    view: detail ?? enCache,
    loading,
    error,
    parcial: detail === null && enCache !== null,
    reload: () => setAttempt((n) => n + 1),
  };
}

export interface RecentCheckIn {
  readonly id: string;
  readonly name: string;
  readonly at: Date;
  readonly manual: boolean;
}

/**
 * "Ultimos marcados" de la puerta.
 *
 * Sale del servidor porque la lista es del LOCAL, no de esta sesion: el equipo
 * del mostrador se enciende a mitad del dia y las asistencias de la manana no
 * estan en su memoria. Sin conexion cae a lo que si tenga en cache, que en un
 * turno ya empezado es lo que se marco desde este aparato.
 */
export function useRecentCheckIns(): readonly RecentCheckIn[] {
  const roster = useRoster();
  const staff = useStore((s) => s.staff);
  const attendances = useStore((s) => s.attendances);
  const [remotos, setRemotos] = useState<readonly RecentCheckIn[] | null>(null);

  useEffect(() => {
    if (getSessionState().status !== 'signed_in') return;

    let cancelado = false;
    void fetchRecentCheckIns()
      .then((rows) => {
        if (cancelado) return;
        setRemotos(
          rows.map((row) => ({
            id: row.id,
            name: row.userName,
            at: row.checkedInAt,
            manual: row.method === 'manual',
          })),
        );
      })
      // Sin red se conserva lo ultimo que se pudo traer: una lista vieja dice
      // mas que una vacia.
      .catch(() => {});

    return () => {
      cancelado = true;
    };
  }, [roster]);

  const gyms = useMemo(
    () =>
      attendances
        .filter((a) => a.tenantId === staff.tenantId)
        .slice()
        .sort((a, b) => b.checkedInAt.getTime() - a.checkedInAt.getTime())
        .map((a) => ({
          id: a.id,
          name:
            roster.find((e) => e.view.membership.id === a.membershipId)?.user.name ?? 'Alumno',
          at: a.checkedInAt,
          manual: a.method === 'manual',
        })),
    [attendances, staff.tenantId, roster],
  );

  return remotos ?? gyms;
}

/**
 * Planes a los que esta membresía puede cambiar.
 *
 * Se piden a la api. `state.plans` solo contiene el plan actual del alumno y su
 * plan pendiente —es lo único que `/me` devuelve—, así que la pantalla de cambio
 * de plan filtraba esa lista, se quedaba sin opciones y no ofrecía ninguna. El
 * comentario de `hydrate.ts` decía que los planes hacían falta; el código nunca
 * llegó a pedirlos.
 */
export function usePlansFor(membershipId: string): {
  readonly plans: readonly Plan[];
  readonly loading: boolean;
  readonly error: string | null;
} {
  const [plans, setPlans] = useState<readonly Plan[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const gyms = useStore((s) => s.plans);

  useEffect(() => {
    let cancelado = false;
    setLoading(true);
    setError(null);

    void plansFor(membershipId)
      .then((list) => {
        if (!cancelado) setPlans(list);
      })
      .catch((causa: unknown) => {
        if (!cancelado) {
          setError(causa instanceof Error ? causa.message : 'No se pudieron traer los planes.');
        }
      })
      .finally(() => {
        if (!cancelado) setLoading(false);
      });

    return () => {
      cancelado = true;
    };
  }, [membershipId]);

  return { plans: plans ?? gyms, loading, error };
}

/**
 * En qué locales trabaja quien tiene la sesión abierta.
 *
 * No sale del token —ahí viaja UNO, el de esta sesión— así que hay que
 * preguntarlo. Existe para que el padrón pueda decir cuál está enseñando: con
 * dos locales, una pantalla que solo dice «23 alumnos» no dice de quién, y las
 * cifras de «Este mes» del local equivocado se leen igual de bien que las del
 * bueno.
 *
 * Falla en silencio a propósito. Es un rótulo, no una función: quien tiene un
 * solo local no pierde nada si la consulta no vuelve, y quien tiene dos ya sabe
 * cambiarse desde Ajustes.
 */
export function useMyGyms(): readonly StaffPostDto[] {
  const [gyms, setGyms] = useState<readonly StaffPostDto[]>([]);

  useEffect(() => {
    let cancelado = false;
    void fetchModes().then(
      (modes) => {
        if (!cancelado) setGyms(modes.staff);
      },
      () => {
        // Sin respuesta, el padrón se pinta como siempre.
      },
    );
    return () => {
      cancelado = true;
    };
  }, []);

  return gyms;
}

/**
 * Los gimnasios que la agregaron y esperan su respuesta.
 *
 * Con o sin ficha: a quien no tiene ninguna le llegan por el QR que mostró o por
 * su celular, y a quien ya entrena en un local, del siguiente que la inscribe.
 */
export function useLinkRequests(): Carga<readonly LinkRequestDto[]> {
  return useCargaRemota<readonly LinkRequestDto[]>(
    myLinkRequests,
    [],
    'No se pudieron traer tus solicitudes.',
  );
}

/** Si la persona de esta ficha la tiene en su app, para el mostrador. */
export function useMemberLinkState(membershipId: string): Carga<MemberLinkStateDto | null> {
  const request = useCallback(() => fetchMemberLinkState(membershipId), [membershipId]);
  return useCargaRemota<MemberLinkStateDto | null>(
    request,
    null,
    'No se pudo saber si la tiene en su app.',
  );
}

/**
 * La suscripción del gimnasio a Sinchi, para el dueño.
 *
 * Se pide UNA vez al montar y no cuando cambia el padrón: la cuenta atrás del
 * mes gratis avanza en días, no en cobros. Colgarla del padrón la volvería a
 * pedir en cada alta y cada pago para ver el mismo número.
 */
export function useSinchiSubscription(): {
  readonly subscription: SaasSubscriptionDto | null;
  readonly reload: () => void;
} {
  const [subscription, setSubscription] = useState<SaasSubscriptionDto | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelado = false;
    void sinchiSubscription()
      .then((fetched) => {
        if (!cancelado) setSubscription(fetched);
      })
      .catch(() => {});
    return () => {
      cancelado = true;
    };
  }, [attempt]);

  // Canjear un código mueve la fecha: sin volver a pedirla, la franja seguiría
  // diciendo los días de antes justo cuando el dueño acaba de ganar un mes.
  return { subscription, reload: () => setAttempt((n) => n + 1) };
}

/** Resumen del local para el dueño. `null` cuando no es el dueño o aún no llegó. */
export function useOwnerSummary(): SummaryDto | null {
  const roster = useRoster();
  const [summary, setSummary] = useState<SummaryDto | null>(null);

  useEffect(() => {
    let cancelado = false;
    // Se recalcula cuando cambia el padrón, que es justo cuando alguien cobró o
    // marcó: pedirlo en un temporizador movería los números sin motivo.
    void gymSummary()
      .then((fetched) => {
        if (!cancelado) setSummary(fetched);
      })
      .catch(() => {});
    return () => {
      cancelado = true;
    };
  }, [roster]);

  return summary;
}

/**
 * Los planes del dueño, con lo que hace falta para decidir sobre ellos.
 *
 * `reload` no es opcional aquí: esta pantalla es la única desde la que se
 * escriben, así que después de guardar hay que volver a pedirlos o la lista
 * enseña lo de antes justo donde el dueño acaba de cambiar algo.
 */
/**
 * Los horarios del local, con sus avisos.
 *
 * Mismo molde que `useOwnerPlans`, y por la misma razon: se abre desde un
 * enlace y no viene con el padron, asi que se pide al montar y se recarga
 * despues de cada escritura.
 */
export function useOwnerSchedules(): {
  readonly schedules: readonly ScheduleWithUsage[] | null;
  readonly error: string | null;
  readonly loading: boolean;
  readonly reload: () => void;
} {
  const [schedules, setSchedules] = useState<readonly ScheduleWithUsage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  /**
   * Al enfocar, no solo al montar. Ver `useOwnerPlans`: mismo fallo exacto.
   *
   * El editor de un bloque hace `reload()` y `router.back()` —al guardar, al
   * archivar y al borrar—, y ese `reload` era el de SU instancia del hook. La
   * lista de debajo nunca se desmonta mientras el editor esta encima, asi que
   * volvia a verse igual que antes: el horario recien escrito no aparecia.
   */
  useFocusEffect(
    useCallback(() => {
      let cancelado = false;
      setError(null);
      void ownerSchedules()
        .then((fetched) => {
          if (!cancelado) setSchedules(fetched);
        })
        .catch((e: unknown) => {
          if (!cancelado) {
            setError(e instanceof Error ? e.message : 'No se pudieron traer tus horarios.');
          }
        });
      return () => {
        cancelado = true;
      };
    }, [attempt]),
  );

  return {
    schedules,
    error,
    loading: schedules === null && error === null,
    reload: () => setAttempt((n) => n + 1),
  };
}

export function useOwnerPlans(): {
  readonly plans: readonly PlanWithUsage[] | null;
  readonly error: string | null;
  readonly loading: boolean;
  readonly reload: () => void;
} {
  const [ownerPlanList, setOwnerPlanList] = useState<readonly PlanWithUsage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  /**
   * Al ENFOCAR, y no solo al montar. Aqui vivia un fallo reportado.
   *
   * «Puse el precio y cuántas veces por semana, le di a guardar y no se guardó:
   * salía como si no la hubiera creado». La tarifa SI se guardaba —se comprobo
   * en la base— y lo que mentia era esta lista.
   *
   * El motivo es que este hook guarda su estado POR COMPONENTE. El editor
   * (`plans/[planId]`) llama a `reload()` antes de `router.back()`, pero ese
   * `reload` es el de su propia instancia: la lista de debajo tiene la suya, no
   * se desmonta nunca mientras el editor esta encima, y por tanto no volvia a
   * preguntar. El dueno veia exactamente lo mismo que antes de escribir.
   *
   * `useFocusEffect` es lo que ya hacian `useEvents` y `useBiblioteca`, y este
   * se quedo sin ello. Volver a una pantalla es el momento en que sus datos
   * pueden haber cambiado — casi siempre porque los cambio uno mismo.
   */
  useFocusEffect(
    useCallback(() => {
      let cancelado = false;
      setError(null);
      void ownerPlans()
        .then((fetched) => {
          if (!cancelado) setOwnerPlanList(fetched);
        })
        .catch((e: unknown) => {
          if (!cancelado) {
            setError(e instanceof Error ? e.message : 'No se pudieron traer tus planes.');
          }
        });
      return () => {
        cancelado = true;
      };
    }, [attempt]),
  );

  return {
    plans: ownerPlanList,
    error,
    loading: ownerPlanList === null && error === null,
    reload: () => setAttempt((n) => n + 1),
  };
}

/**
 * Los eventos del local.
 *
 * `drafts` solo lo pide el dueño: a recepción un evento sin publicar le ensucia
 * la lista de a quién espera, y la api se lo filtra igual.
 */
export function useEvents(options: { readonly past?: boolean; readonly drafts?: boolean } = {}): {
  readonly events: readonly EventWithSeats[] | null;
  readonly error: string | null;
  readonly loading: boolean;
  readonly reload: () => void;
} {
  const { past = false, drafts = false } = options;
  const [events, setEvents] = useState<readonly EventWithSeats[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelado = false;
    setError(null);
    void gymEvents({ past, drafts })
      .then((fetched) => {
        if (!cancelado) setEvents(fetched);
      })
      .catch((e: unknown) => {
        if (!cancelado) {
          setError(e instanceof Error ? e.message : 'No se pudieron traer los eventos.');
        }
      });
    return () => {
      cancelado = true;
    };
  }, [past, drafts, attempt]);

  /**
   * Y se vuelve a pedir al enfocar la pantalla.
   *
   * Sin esto la lista enseña lo de la primera vez: el dueño publica un evento
   * desde el editor, recepción inscribe a alguien desde otro equipo, y quien
   * vuelve a esta pantalla ve el mundo de hace media hora. El cupo de un
   * seminario es justo el dato que no puede estar viejo.
   */
  useFocusEffect(
    useCallback(() => {
      setAttempt((n) => n + 1);
    }, []),
  );

  return {
    events,
    error,
    loading: events === null && error === null,
    reload: () => setAttempt((n) => n + 1),
  };
}

/** Un evento con su lista de inscritos: es la pantalla del día del seminario. */
export function useEvent(eventId: string): {
  readonly event: EventWithSeats | null;
  readonly plazas: readonly PlazaDto[];
  readonly error: string | null;
  readonly loading: boolean;
  readonly reload: () => void;
} {
  const [event, setEvent] = useState<EventWithSeats | null>(null);
  const [plazas, setPlazas] = useState<readonly PlazaDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelado = false;
    setError(null);
    // Las dos a la vez: la cabecera sin la lista, o al revés, deja la pantalla
    // media hecha durante un salto perceptible.
    void Promise.all([gymEvent(eventId), eventSeats(eventId)])
      .then(([uno, list]) => {
        if (cancelado) return;
        setEvent(uno);
        setPlazas(list);
      })
      .catch((e: unknown) => {
        if (!cancelado) {
          setError(e instanceof Error ? e.message : 'No se pudo traer el evento.');
        }
      });
    return () => {
      cancelado = true;
    };
  }, [eventId, attempt]);

  // Es la pantalla que el mostrador tiene abierta mientras entra la gente: si
  // alguien reservó desde el directorio hace un minuto, tiene que aparecer.
  useFocusEffect(
    useCallback(() => {
      setAttempt((n) => n + 1);
    }, []),
  );

  return {
    event,
    plazas,
    error,
    loading: event === null && error === null,
    reload: () => setAttempt((n) => n + 1),
  };
}


/**
 * La biblioteca de rutinas.
 *
 * Un solo hook para los tres publicos —el mostrador, el alumno y quien la abre
 * desde el directorio— porque es la MISMA lista mirada por tres ojos, y quien
 * decide que sale de ella es la api. Tener tres hooks es como uno se queda sin
 * el filtro el dia que la regla cambie.
 *
 * `membershipId` elige la fuente: con el, la del gimnasio donde entrena el
 * alumno; sin el, la del local en el que trabaja quien tiene la sesion.
 */
export function useBiblioteca(membershipId?: string): {
  readonly biblioteca: BibliotecaDto | null;
  readonly error: string | null;
  readonly loading: boolean;
  readonly reload: () => void;
} {
  const [biblioteca, setBiblioteca] = useState<BibliotecaDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelado = false;
    setError(null);
    const request =
      membershipId === undefined
        ? gymLibrary()
        : myGymLibrary(membershipId);

    void request
      .then((fetched) => {
        if (!cancelado) setBiblioteca(fetched);
      })
      .catch((e: unknown) => {
        if (!cancelado) {
          setError(e instanceof Error ? e.message : 'No se pudieron traer las rutinas.');
        }
      });
    return () => {
      cancelado = true;
    };
  }, [membershipId, attempt]);

  /**
   * Y se vuelve a pedir al enfocar.
   *
   * El dueno publica una rutina desde el editor y vuelve a la lista: sin esto se
   * encuentra el mundo de antes de haberla escrito, y da por hecho que no se
   * guardo.
   */
  useFocusEffect(
    useCallback(() => {
      setAttempt((n) => n + 1);
    }, []),
  );

  return {
    biblioteca,
    error,
    loading: biblioteca === null && error === null,
    reload: () => setAttempt((n) => n + 1),
  };
}

/**
 * Una rutina, desde donde sea que se la esté mirando.
 *
 * `slug` gana sobre `membershipId`: quien abre la ficha de OTRO gimnasio desde
 * el directorio la mira como visitante aunque tenga membresías en la app, y
 * mezclar las dos fuentes le enseñaría el contenido de alumnos del local
 * equivocado.
 *
 * El resultado puede venir cerrado (`unlocked: false`), y eso NO es un error: es
 * la pantalla que le vende la mensualidad a quien está mirando algo que quiere.
 */
export function useRoutine(
  routineId: string,
  origen: { readonly membershipId?: string; readonly slug?: string } = {},
): {
  readonly routine: RoutineDetailDto | null;
  readonly error: string | null;
  readonly loading: boolean;
  readonly reload: () => void;
} {
  const { membershipId, slug } = origen;
  const [routine, setRoutine] = useState<RoutineDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // Sin id no hay nada que pedir: es la pantalla de crear una rutina nueva,
    // que usa este mismo hook para no mantener dos formularios.
    if (routineId.length === 0) return;

    let cancelado = false;
    setError(null);
    const request =
      slug !== undefined
        ? publicRoutine(slug, routineId)
        : membershipId !== undefined
          ? myGymRoutine(membershipId, routineId)
          : gymRoutine(routineId);

    void request
      .then((fetched) => {
        if (!cancelado) setRoutine(fetched);
      })
      .catch((e: unknown) => {
        if (!cancelado) {
          setError(e instanceof Error ? e.message : 'No se pudo traer la rutina.');
        }
      });
    return () => {
      cancelado = true;
    };
  }, [routineId, membershipId, slug, attempt]);

  return {
    routine,
    error,
    loading: routineId.length > 0 && routine === null && error === null,
    reload: () => setAttempt((n) => n + 1),
  };
}

/** Lo que el local cobra aparte de los planes. */
export function useGymPricing(): {
  readonly pricing: GymPricing | null;
  readonly error: string | null;
  readonly reload: () => void;
} {
  const [pricing, setPricing] = useState<GymPricing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelado = false;
    setError(null);
    void gymPricing()
      .then((fetched) => {
        if (!cancelado) setPricing(fetched);
      })
      .catch((e: unknown) => {
        if (!cancelado) setError(e instanceof Error ? e.message : 'No se pudo traer lo que cobras.');
      });
    return () => {
      cancelado = true;
    };
  }, [attempt]);

  return { pricing, error, reload: () => setAttempt((n) => n + 1) };
}

/** Dónde queda el local, como lo lee su dueño para corregirlo. */
export function useGymLocation(): {
  readonly location: GymLocation | null;
  readonly error: string | null;
  readonly reload: () => void;
} {
  const [location, setLocation] = useState<GymLocation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelado = false;
    setError(null);
    void gymLocation()
      .then((fetched) => {
        if (!cancelado) setLocation(fetched);
      })
      .catch((e: unknown) => {
        if (!cancelado) {
          setError(e instanceof Error ? e.message : 'No se pudo traer la dirección.');
        }
      });
    return () => {
      cancelado = true;
    };
  }, [attempt]);

  return { location, error, reload: () => setAttempt((n) => n + 1) };
}

/** El logo del local, como lo ve su dueño para cambiarlo. `undefined` = cargando. */
export function useGymLogo(): {
  readonly logoId: string | null | undefined;
  readonly error: string | null;
  readonly reload: () => void;
} {
  const [logoId, setLogoId] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelado = false;
    setError(null);
    void gymLogo()
      .then((fetched) => {
        if (!cancelado) setLogoId(fetched.logoId);
      })
      .catch((e: unknown) => {
        if (!cancelado) {
          setError(e instanceof Error ? e.message : 'No se pudo traer el logo.');
        }
      });
    return () => {
      cancelado = true;
    };
  }, [attempt]);

  return { logoId, error, reload: () => setAttempt((n) => n + 1) };
}

/** La web y las redes del local, como las ve su dueño para cambiarlas. */
export function useGymLinks(): {
  readonly links: GymLinks | null;
  readonly error: string | null;
  readonly reload: () => void;
} {
  const [links, setLinks] = useState<GymLinks | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelado = false;
    setError(null);
    void gymLinks()
      .then((fetched) => {
        if (!cancelado) setLinks(fetched);
      })
      .catch((e: unknown) => {
        if (!cancelado) {
          setError(e instanceof Error ? e.message : 'No se pudieron traer tus redes.');
        }
      });
    return () => {
      cancelado = true;
    };
  }, [attempt]);

  return { links, error, reload: () => setAttempt((n) => n + 1) };
}

/**
 * Refresco manual y al volver a la pantalla.
 *
 * Las dos vías hacen falta y responden a cosas distintas. Volver a la pestaña
 * cubre el caso normal —el mostrador entra al padrón después de que algo pasó
 * fuera— y el tirón hacia abajo cubre el otro: alguien está MIRANDO la lista
 * mientras cambia, y sin un gesto no tiene forma de pedirla otra vez.
 */
export function useRefresco(): {
  readonly refrescando: boolean;
  readonly refrescar: () => void;
} {
  const [refrescando, setRefrescando] = useState(false);

  const refrescar = useCallback(() => {
    setRefrescando(true);
    // El error se traga: refrescar es un extra sobre datos que ya están en
    // pantalla, y un aviso rojo por no haber podido actualizar algo que se
    // sigue viendo bien enseña a ignorar los avisos.
    void refreshDetails()
      .catch(() => {})
      .finally(() => setRefrescando(false));
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refreshDetails().catch(() => {});
    }, []),
  );

  return { refrescando, refrescar };
}

/** Quienes cancelaron y conservan ficha. Se piden solo al abrirlas. */
export function useBajas(active: boolean): {
  readonly bajas: readonly RosterEntry[];
  readonly loading: boolean;
} {
  const [bajas, setBajas] = useState<readonly RosterEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const roster = useRoster();

  useEffect(() => {
    if (!active) return;
    let cancelado = false;
    setLoading(true);
    void gymDeletions()
      .then((list) => {
        if (!cancelado) setBajas(list);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelado) setLoading(false);
      });
    return () => {
      cancelado = true;
    };
    // `roster` en las dependencias: reactivar a alguien lo saca de esta lista.
  }, [active, roster]);

  return { bajas, loading };
}

/** Planes activos del local, para el mostrador. */
export function useGymPlans(): {
  readonly plans: readonly Plan[];
  readonly loading: boolean;
} {
  /**
   * `null` hasta que contesta, y ese es el arreglo.
   *
   * Arrancaba en `[]` y devolvia solo la lista, asi que la pantalla no tenia
   * como distinguir «todavia no ha llegado» de «este gimnasio no tiene
   * tarifas»: las dos eran cero. El alta de un alumno lo pintaba como «Trayendo
   * los planes del gimnasio…», de modo que un local sin ninguna se leia como un
   * cargando eterno — y desde que el gimnasio nace sin tarifas, eso dejo de ser
   * un caso raro para ser el PRIMER dia de todos.
   *
   * Un fallo tambien termina el cargando: se deja de esperar y la pantalla
   * pinta el caso vacio, que al menos dice donde se escriben. Quedarse girando
   * para siempre es la unica salida que no sirve para nada.
   */
  const [fetched, setFetched] = useState<readonly Plan[] | null>(null);

  // Al enfocar, por lo mismo que `useOwnerPlans`: desde la reinscripcion se
  // abre Planes para escribir una tarifa, y al volver hay que verla.
  useFocusEffect(
    useCallback(() => {
      let cancelado = false;
      void gymPlans()
        .then((list) => {
          if (!cancelado) setFetched(list);
        })
        .catch(() => {
          if (!cancelado) setFetched([]);
        });
      return () => {
        cancelado = true;
      };
    }, []),
  );

  return { plans: fetched ?? [], loading: fetched === null };
}

/**
 * Por que fallo la ultima carga, y como volver a intentarlo.
 *
 * Lo consumen las pantallas vacias: sin esto, un fallo de red y una cuenta sin
 * nada se pintan igual.
 */
export function useErrorDeCarga(): {
  readonly error: string | null;
  readonly reintentar: () => void;
} {
  const error = useStore((s) => s.errorDeCarga);
  const reintentar = useCallback(() => {
    void refreshDetails().catch(() => {});
  }, []);
  return { error, reintentar };
}

// ---------------------------------------------------------------------------
// Directorio y clase gratis
// ---------------------------------------------------------------------------

/** Estado de una carga puntual contra la api. Lo comparten los tres de abajo. */
export interface Carga<T> {
  readonly details: T;
  readonly loading: boolean;
  readonly error: string | null;
  readonly reload: () => void;
}

/**
 * El directorio de gimnasios.
 *
 * Es la única pantalla de la app que **no depende de tener sesión**: quien busca
 * dojo todavía no tiene cuenta, y pedirle que se registre para mirar una lista
 * es perderlo antes de empezar.
 */
export function useGyms(): Carga<readonly GymCardDto[]> {
  return useCargaRemota<readonly GymCardDto[]>(fetchGyms, [], 'No se pudo traer la lista de gimnasios.');
}

export function useGym(slug: string): Carga<GymDetailDto | null> {
  const request = useCallback(() => fetchGym(slug), [slug]);
  return useCargaRemota<GymDetailDto | null>(request, null, 'No se pudo abrir este gimnasio.');
}

/** Las clases que la persona tiene reservadas —de cualquier tipo—, con o sin ficha. */
export function useMyBookings(): Carga<readonly ClassBookingDto[]> {
  return useCargaRemota<readonly ClassBookingDto[]>(
    myBookings,
    [],
    'No se pudieron traer tus reservas.',
  );
}

/** Quién viene desde la app. La lista del mostrador: o lo que falta, o lo que pasó. */
export function useGymBookings(pastOnly = false): Carga<readonly ClassBooking[]> {
  const request = useCallback(() => fetchTrials(pastOnly), [pastOnly]);
  return useCargaRemota<readonly ClassBooking[]>(
    request,
    [],
    'No se pudo traer la lista de reservas.',
  );
}

/**
 * Si el gimnasio ofrece la clase gratis.
 *
 * `null` mientras no se sabe: el interruptor no puede pintarse en «no» antes de
 * preguntar, porque eso le dice al dueño que su gimnasio está fuera del
 * directorio cuando a lo mejor no lo está.
 *
 * La función va a nivel de módulo y no en línea: `useCargaRemota` la lleva en
 * sus dependencias, y una flecha nueva en cada render sería un bucle de
 * peticiones.
 */
const readTrialBooking = async (): Promise<boolean | null> =>
  (await fetchTrialSettings()).trialClassEnabled;

export function useTrialClassEnabled(): Carga<boolean | null> {
  return useCargaRemota<boolean | null>(
    readTrialBooking,
    null,
    'No se pudo leer si el gimnasio ofrece clase gratis.',
  );
}

/**
 * Una carga de la api con recarga manual y al volver a la pantalla.
 *
 * Las dos vías por el mismo motivo que `useRefresco`: volver a la pestaña cubre
 * el caso normal —algo cambió fuera— y el gesto cubre el otro, alguien mirando
 * la lista mientras cambia.
 */
function useCargaRemota<T>(
  request: () => Promise<T>,
  inicial: T,
  errorMessage: string,
): Carga<T> {
  const [details, setDetails] = useState<T>(inicial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelado = false;
    setLoading(true);
    setError(null);

    void request()
      .then((fetched) => {
        if (!cancelado) setDetails(fetched);
      })
      .catch((causa: unknown) => {
        // Se conserva lo que ya había en pantalla: sin conexión, el último
        // estado conocido es mejor que una pantalla vacía.
        if (!cancelado) setError(causa instanceof Error ? causa.message : errorMessage);
      })
      .finally(() => {
        if (!cancelado) setLoading(false);
      });

    return () => {
      cancelado = true;
    };
  }, [request, attempt, errorMessage]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  // Al montar ya carga el efecto de arriba; sin este candado, entrar a la
  // pantalla dispararía dos peticiones idénticas.
  const alreadyMounted = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!alreadyMounted.current) {
        alreadyMounted.current = true;
        return;
      }
      setAttempt((n) => n + 1);
    }, []),
  );

  return { details, loading, error, reload };
}

// ---------------------------------------------------------------------------
// Mensajes
// ---------------------------------------------------------------------------

/** Los hilos de la persona con gimnasios de toda la red, con o sin ficha. */
export function useMyConversations(): Carga<readonly PersonConversationDto[]> {
  return useCargaRemota<readonly PersonConversationDto[]>(
    myConversations,
    [],
    'No se pudieron traer tus mensajes.',
  );
}

/** El hilo con un gimnasio. `null` mientras carga, o sin cuenta. */
export function useThread(slug: string): Carga<PersonThreadDto | null> {
  const request = useCallback(() => threadWith(slug), [slug]);
  return useCargaRemota<PersonThreadDto | null>(
    request,
    null,
    'No se pudo abrir la conversación.',
  );
}

/** La bandeja del mostrador: lo abierto, o lo archivado. */
export function useInbox(status: ConversationStatus): Carga<readonly InboxEntryDto[]> {
  const request = useCallback(() => fetchInbox(status), [status]);
  return useCargaRemota<readonly InboxEntryDto[]>(request, [], 'No se pudo traer la bandeja.');
}

export function useGymThread(conversationId: string): Carga<GymThreadDto | null> {
  const request = useCallback(() => fetchGymThread(conversationId), [conversationId]);
  return useCargaRemota<GymThreadDto | null>(request, null, 'No se pudo abrir la conversación.');
}

/**
 * Vuelve a pedir mientras la pantalla está enfocada.
 *
 * El chat no tiene push (decisiones §12): con el hilo abierto, esto es lo que
 * hace que la respuesta aparezca sin tocar nada. Solo con la pantalla ENFOCADA —
 * un intervalo vivo detrás de otra pantalla gasta batería y datos preguntando
 * por algo que nadie está mirando.
 */
export function usePolling(reload: () => void, everyMs: number): void {
  useFocusEffect(
    useCallback(() => {
      const timer = setInterval(reload, everyMs);
      return () => clearInterval(timer);
    }, [reload, everyMs]),
  );
}

const unreadListeners = new Set<() => void>();

/**
 * Pide otra vez la insignia de mensajes.
 *
 * La llaman las pantallas que acaban de cambiar la cuenta —abrir un hilo lo marca
 * leído en el servidor—. Sin esto la insignia seguía encendida hasta la siguiente
 * vuelta del intervalo sobre una conversación que se acababa de leer.
 */
export function refreshUnreadBadge(): void {
  for (const listener of unreadListeners) listener();
}

/**
 * Cuántos hilos tienen algo sin leer, para la insignia de la pestaña.
 *
 * Al alumno se le pregunta por los suyos y al mostrador por los del local. Se
 * vuelve a pedir cada minuto, al volver a la app y cuando una pantalla avisa con
 * `refreshUnreadBadge`: sin push, es lo único que la enciende sola. En
 * demostración no pregunta nada — no hay api al otro lado.
 */
export function useUnreadConversations(side: 'student' | 'staff'): number {
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (getSessionState().status !== 'signed_in') return;
    let cancelado = false;

    const pedir = (): void => {
      void (side === 'staff' ? fetchInboxUnread() : fetchMyUnreadConversations())
        .then((out) => {
          if (!cancelado) setUnread(out.unread);
        })
        // Sin red, la insignia se queda con lo último que supo.
        .catch(() => {});
    };

    pedir();
    unreadListeners.add(pedir);
    const timer = setInterval(pedir, 60_000);
    const vuelta = AppState.addEventListener('change', (estado) => {
      if (estado === 'active') pedir();
    });

    return () => {
      cancelado = true;
      unreadListeners.delete(pedir);
      clearInterval(timer);
      vuelta.remove();
    };
  }, [side]);

  return unread;
}

const enrollmentListeners = new Set<() => void>();

/**
 * Pide otra vez la insignia de Reservas.
 *
 * La llama quien acaba de hacer la ficha de una inscripción reservada: sin esto
 * la insignia seguía en 1 hasta la siguiente vuelta del intervalo, apuntando a
 * alguien que ya estaba inscrito.
 */
export function refreshEnrollmentBadge(): void {
  for (const listener of enrollmentListeners) listener();
}

/**
 * Cuántas inscripciones reservadas desde el directorio esperan su ficha.
 *
 * Es la insignia de la pestaña Reservas. Cuenta SOLO las inscripciones, no
 * todas las reservas: una prueba se atiende el día que llega, pero la
 * inscripción es alguien que ya decidió pagar y al que conviene escribirle
 * antes —y era justo la que se perdía entre las pruebas—. Una insignia que
 * contara todo estaría siempre encendida y dejaría de leerse.
 *
 * Mismo ritmo que la de mensajes: cada minuto, al volver a la app y cuando una
 * pantalla avisa. Sin push es lo que la enciende sola.
 */
export function usePendingEnrollments(): number {
  const [pending, setPending] = useState(0);

  useEffect(() => {
    if (getSessionState().status !== 'signed_in') return;
    let cancelado = false;

    const pedir = (): void => {
      void fetchTrials()
        .then((bookings) => {
          if (!cancelado) setPending(bookings.filter(awaitsEnrollment).length);
        })
        // Sin red, la insignia se queda con lo último que supo.
        .catch(() => {});
    };

    pedir();
    enrollmentListeners.add(pedir);
    const timer = setInterval(pedir, 60_000);
    const vuelta = AppState.addEventListener('change', (estado) => {
      if (estado === 'active') pedir();
    });

    return () => {
      cancelado = true;
      enrollmentListeners.delete(pedir);
      clearInterval(timer);
      vuelta.remove();
    };
  }, []);

  return pending;
}
