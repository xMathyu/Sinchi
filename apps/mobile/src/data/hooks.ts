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
  const version = useStore((s) => s.charges.length + s.attendances.length + s.subscriptions.length);
  return useMemo(() => viewMembership(membershipId, today), [membershipId, today, version]);
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
