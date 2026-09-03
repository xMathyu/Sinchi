/**
 * Enlace entre el store y React.
 *
 * `useSyncExternalStore` en vez de un contexto con estado: el store es la
 * frontera con la api futura, y mantenerlo fuera de React deja el cambio a
 * peticiones reales contenido en un archivo.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useFocusEffect } from 'expo-router';
import type { TrialBooking } from '@sinchi/shared';
import {
  TZ_LIMA,
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
  fetchGym,
  fetchGyms,
  fetchRecentCheckIns,
  fetchTrialSettings,
  fetchTrials,
  type CheckInPreviewDto,
  type GymCardDto,
  type GymDetailDto,
  type PlanConUso,
  type PreciosDelLocal,
  type SaasSubscriptionDto,
  type SummaryDto,
  type TrialBookingDto,
} from './api';
import { misClasesGratis } from './trials';
import {
  bajasDelGimnasio,
  cargarDetalleAlumno,
  planesDelGimnasio,
  planesPara,
  refrescarDatos,
  resumenDelGimnasio,
  planesDelDueno,
  preciosDelLocal,
  suscripcionSinchi,
  vinculacionesPendientes,
  type Vinculacion,
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
    const delServidor = remoto?.find((entrada) => entrada.view.membership.id === membershipId);
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
        const sesion = getSessionState();
        if (sesion.status !== 'signed_in') return null;
        return (await ensureAccessCodeSecret(sesion.session.userId)) ? loadSecret() : null;
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

export interface FichaAlumno {
  readonly view: MembershipView | null;
  readonly cargando: boolean;
  readonly error: string | null;
  /**
   * Lo que se ve sale del padron en cache, sin historial.
   *
   * La pantalla lo dice en vez de mostrar un historial vacio: "no ha pagado
   * nunca" y "no pude traer sus pagos" se ven igual y significan lo contrario.
   */
  readonly parcial: boolean;
  readonly recargar: () => void;
}

/**
 * Ficha completa de un alumno del padron.
 *
 * Empieza por lo que ya hay en cache —el padron trae el semaforo, el plan y la
 * deuda— y lo completa con el historial cuando llega. Asi la pantalla se pinta
 * de inmediato y sin conexion sigue sirviendo para lo que importa en el
 * mostrador: saber si puede pasar y cuanto debe.
 */
export function useStaffMember(membershipId: string): FichaAlumno {
  const roster = useRoster();
  const [detalle, setDetalle] = useState<MembershipView | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [intento, setIntento] = useState(0);

  const enCache =
    roster.find((entrada) => entrada.view.membership.id === membershipId)?.view ?? null;

  useEffect(() => {
    let cancelado = false;
    setCargando(true);
    setError(null);

    void cargarDetalleAlumno(membershipId)
      .then((vista) => {
        if (!cancelado) setDetalle(vista);
      })
      .catch((causa: unknown) => {
        if (cancelado) return;
        setError(causa instanceof Error ? causa.message : 'No se pudo traer la ficha.');
      })
      .finally(() => {
        if (!cancelado) setCargando(false);
      });

    return () => {
      cancelado = true;
    };
    // `roster` cambia cuando se recarga el padron tras cobrar o marcar, y es
    // justo cuando esta ficha quedo vieja.
  }, [membershipId, intento, roster]);

  return {
    view: detalle ?? enCache,
    cargando,
    error,
    parcial: detalle === null && enCache !== null,
    recargar: () => setIntento((n) => n + 1),
  };
}

export interface MarcadoReciente {
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
export function useRecentCheckIns(): readonly MarcadoReciente[] {
  const roster = useRoster();
  const staff = useStore((s) => s.staff);
  const attendances = useStore((s) => s.attendances);
  const [remotos, setRemotos] = useState<readonly MarcadoReciente[] | null>(null);

  useEffect(() => {
    if (getSessionState().status !== 'signed_in') return;

    let cancelado = false;
    void fetchRecentCheckIns()
      .then((filas) => {
        if (cancelado) return;
        setRemotos(
          filas.map((fila) => ({
            id: fila.id,
            name: fila.userName,
            at: fila.checkedInAt,
            manual: fila.method === 'manual',
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

  const locales = useMemo(
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

  return remotos ?? locales;
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
  readonly cargando: boolean;
  readonly error: string | null;
} {
  const [plans, setPlans] = useState<readonly Plan[] | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const locales = useStore((s) => s.plans);

  useEffect(() => {
    let cancelado = false;
    setCargando(true);
    setError(null);

    void planesPara(membershipId)
      .then((lista) => {
        if (!cancelado) setPlans(lista);
      })
      .catch((causa: unknown) => {
        if (!cancelado) {
          setError(causa instanceof Error ? causa.message : 'No se pudieron traer los planes.');
        }
      })
      .finally(() => {
        if (!cancelado) setCargando(false);
      });

    return () => {
      cancelado = true;
    };
  }, [membershipId]);

  return { plans: plans ?? locales, cargando, error };
}

/**
 * Códigos de vinculación vigentes, con recarga manual.
 *
 * No se refresca solo: el código dura diez minutos y quien mira esta pantalla
 * tiene al alumno enfrente enseñándole la pantalla. Un temporizador que recarga
 * cada pocos segundos movería la lista bajo el dedo justo al tocarla.
 */
export function useClaims(): {
  readonly claims: readonly Vinculacion[];
  readonly cargando: boolean;
  readonly error: string | null;
  readonly recargar: () => void;
} {
  const [claims, setClaims] = useState<readonly Vinculacion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    let cancelado = false;
    setCargando(true);
    setError(null);

    void vinculacionesPendientes()
      .then((lista) => {
        if (!cancelado) setClaims(lista);
      })
      .catch((causa: unknown) => {
        if (!cancelado) {
          setError(causa instanceof Error ? causa.message : 'No se pudieron traer los códigos.');
        }
      })
      .finally(() => {
        if (!cancelado) setCargando(false);
      });

    return () => {
      cancelado = true;
    };
  }, [intento]);

  return { claims, cargando, error, recargar: () => setIntento((n) => n + 1) };
}

/**
 * La suscripción del gimnasio a Sinchi, para el dueño.
 *
 * Se pide UNA vez al montar y no cuando cambia el padrón: la cuenta atrás del
 * mes gratis avanza en días, no en cobros. Colgarla del padrón la volvería a
 * pedir en cada alta y cada pago para ver el mismo número.
 */
export function useSuscripcionSinchi(): {
  readonly suscripcion: SaasSubscriptionDto | null;
  readonly recargar: () => void;
} {
  const [suscripcion, setSuscripcion] = useState<SaasSubscriptionDto | null>(null);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    let cancelado = false;
    void suscripcionSinchi()
      .then((valor) => {
        if (!cancelado) setSuscripcion(valor);
      })
      .catch(() => {});
    return () => {
      cancelado = true;
    };
  }, [intento]);

  // Canjear un código mueve la fecha: sin volver a pedirla, la franja seguiría
  // diciendo los días de antes justo cuando el dueño acaba de ganar un mes.
  return { suscripcion, recargar: () => setIntento((n) => n + 1) };
}

/** Resumen del local para el dueño. `null` cuando no es el dueño o aún no llegó. */
export function useOwnerSummary(): SummaryDto | null {
  const roster = useRoster();
  const [resumen, setResumen] = useState<SummaryDto | null>(null);

  useEffect(() => {
    let cancelado = false;
    // Se recalcula cuando cambia el padrón, que es justo cuando alguien cobró o
    // marcó: pedirlo en un temporizador movería los números sin motivo.
    void resumenDelGimnasio()
      .then((valor) => {
        if (!cancelado) setResumen(valor);
      })
      .catch(() => {});
    return () => {
      cancelado = true;
    };
  }, [roster]);

  return resumen;
}

/**
 * Los planes del dueño, con lo que hace falta para decidir sobre ellos.
 *
 * `recargar` no es opcional aquí: esta pantalla es la única desde la que se
 * escriben, así que después de guardar hay que volver a pedirlos o la lista
 * enseña lo de antes justo donde el dueño acaba de cambiar algo.
 */
export function usePlanesDelDueno(): {
  readonly planes: readonly PlanConUso[] | null;
  readonly error: string | null;
  readonly cargando: boolean;
  readonly recargar: () => void;
} {
  const [planes, setPlanes] = useState<readonly PlanConUso[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    let cancelado = false;
    setError(null);
    void planesDelDueno()
      .then((valor) => {
        if (!cancelado) setPlanes(valor);
      })
      .catch((e: unknown) => {
        if (!cancelado) setError(e instanceof Error ? e.message : 'No se pudieron traer tus planes.');
      });
    return () => {
      cancelado = true;
    };
  }, [intento]);

  return {
    planes,
    error,
    cargando: planes === null && error === null,
    recargar: () => setIntento((n) => n + 1),
  };
}

/** Lo que el local cobra aparte de los planes. */
export function usePreciosDelLocal(): {
  readonly precios: PreciosDelLocal | null;
  readonly error: string | null;
  readonly recargar: () => void;
} {
  const [precios, setPrecios] = useState<PreciosDelLocal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    let cancelado = false;
    setError(null);
    void preciosDelLocal()
      .then((valor) => {
        if (!cancelado) setPrecios(valor);
      })
      .catch((e: unknown) => {
        if (!cancelado) setError(e instanceof Error ? e.message : 'No se pudo traer lo que cobras.');
      });
    return () => {
      cancelado = true;
    };
  }, [intento]);

  return { precios, error, recargar: () => setIntento((n) => n + 1) };
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
    void refrescarDatos()
      .catch(() => {})
      .finally(() => setRefrescando(false));
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refrescarDatos().catch(() => {});
    }, []),
  );

  return { refrescando, refrescar };
}

/** Quienes cancelaron y conservan ficha. Se piden solo al abrirlas. */
export function useBajas(activo: boolean): {
  readonly bajas: readonly RosterEntry[];
  readonly cargando: boolean;
} {
  const [bajas, setBajas] = useState<readonly RosterEntry[]>([]);
  const [cargando, setCargando] = useState(false);
  const roster = useRoster();

  useEffect(() => {
    if (!activo) return;
    let cancelado = false;
    setCargando(true);
    void bajasDelGimnasio()
      .then((lista) => {
        if (!cancelado) setBajas(lista);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelado) setCargando(false);
      });
    return () => {
      cancelado = true;
    };
    // `roster` en las dependencias: reactivar a alguien lo saca de esta lista.
  }, [activo, roster]);

  return { bajas, cargando };
}

/** Planes activos del local, para el mostrador. */
export function usePlanesDelGimnasio(): readonly Plan[] {
  const [planes, setPlanes] = useState<readonly Plan[]>([]);

  useEffect(() => {
    let cancelado = false;
    void planesDelGimnasio()
      .then((lista) => {
        if (!cancelado) setPlanes(lista);
      })
      .catch(() => {});
    return () => {
      cancelado = true;
    };
  }, []);

  return planes;
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
    void refrescarDatos().catch(() => {});
  }, []);
  return { error, reintentar };
}

// ---------------------------------------------------------------------------
// Directorio y clase gratis
// ---------------------------------------------------------------------------

/** Estado de una carga puntual contra la api. Lo comparten los tres de abajo. */
export interface Carga<T> {
  readonly datos: T;
  readonly cargando: boolean;
  readonly error: string | null;
  readonly recargar: () => void;
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
  const pedir = useCallback(() => fetchGym(slug), [slug]);
  return useCargaRemota<GymDetailDto | null>(pedir, null, 'No se pudo abrir este gimnasio.');
}

/** Las clases gratis que la persona tiene reservadas, con o sin ficha. */
export function useMisClasesGratis(): Carga<readonly TrialBookingDto[]> {
  return useCargaRemota<readonly TrialBookingDto[]>(
    misClasesGratis,
    [],
    'No se pudieron traer tus clases gratis.',
  );
}

/** Quién viene a probar. La lista del mostrador: o lo que falta, o lo que pasó. */
export function useClasesGratisDelGimnasio(soloPasadas = false): Carga<readonly TrialBooking[]> {
  const pedir = useCallback(() => fetchTrials(soloPasadas), [soloPasadas]);
  return useCargaRemota<readonly TrialBooking[]>(
    pedir,
    [],
    'No se pudo traer la lista de clases gratis.',
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
const leerClaseGratis = async (): Promise<boolean | null> =>
  (await fetchTrialSettings()).trialClassEnabled;

export function useOfreceClaseGratis(): Carga<boolean | null> {
  return useCargaRemota<boolean | null>(
    leerClaseGratis,
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
  pedir: () => Promise<T>,
  inicial: T,
  mensajeDeError: string,
): Carga<T> {
  const [datos, setDatos] = useState<T>(inicial);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    let cancelado = false;
    setCargando(true);
    setError(null);

    void pedir()
      .then((valor) => {
        if (!cancelado) setDatos(valor);
      })
      .catch((causa: unknown) => {
        // Se conserva lo que ya había en pantalla: sin conexión, el último
        // estado conocido es mejor que una pantalla vacía.
        if (!cancelado) setError(causa instanceof Error ? causa.message : mensajeDeError);
      })
      .finally(() => {
        if (!cancelado) setCargando(false);
      });

    return () => {
      cancelado = true;
    };
  }, [pedir, intento, mensajeDeError]);

  const recargar = useCallback(() => setIntento((n) => n + 1), []);

  // Al montar ya carga el efecto de arriba; sin este candado, entrar a la
  // pantalla dispararía dos peticiones idénticas.
  const yaMontado = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!yaMontado.current) {
        yaMontado.current = true;
        return;
      }
      setIntento((n) => n + 1);
    }, []),
  );

  return { datos, cargando, error, recargar };
}
