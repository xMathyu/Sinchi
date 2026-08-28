/**
 * Enlace entre el store y React.
 *
 * `useSyncExternalStore` en vez de un contexto con estado: el store es la
 * frontera con la api futura, y mantenerlo fuera de React deja el cambio a
 * peticiones reales contenido en un archivo.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  TZ_LIMA,
  encodeQrPayload,
  generateTotp,
  plainDateInZone,
  secondsUntilRotation,
  TOTP_PERIOD_SECONDS,
  type PlainDate,
} from '@sinchi/shared';
import { hmacSha256, loadSecret } from './crypto';
import { fetchRecentCheckIns } from './api';
import { cargarDetalleAlumno } from './actions';
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
  return useMemo(
    () => (membershipId === null ? null : previewCheckIn(membershipId, today)),
    [membershipId, today, version],
  );
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
    void loadSecret().then((value) => {
      if (cancelled) return;
      setSecret(value);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
