/**
 * Texto del semaforo de acceso.
 *
 * Vive en `shared` a proposito: la app del alumno, la pantalla del staff y el
 * panel web tienen que decir exactamente lo mismo del mismo hecho. Si el
 * alumno lee "te queda 1 sesion" y el staff lee "cupo agotado", el que discute
 * en la puerta es el recepcionista.
 *
 * Los identificadores estan en ingles; el texto que se muestra, en espanol,
 * porque es el idioma del producto.
 */
import { formatPENShort } from '../money/cents.js';
import { ISO_WEEKDAYS, type IsoWeekday } from '../time/plain-date.js';
import type { AccessLevel, CheckInResult, DenialReason } from './validate.js';

/**
 * A quien se le habla.
 *
 * El mismo hecho se dice de dos formas y las dos viven aqui, no en las
 * pantallas: si cada superficie escribiera la suya, el alumno leeria una cosa y
 * el recepcionista otra del MISMO check-in, y el que discute en la puerta es el
 * recepcionista. Es la razon por la que este archivo existe.
 *
 * `staff` habla DEL alumno en tercera persona; `student` le habla A el. `action`
 * cambia con la voz porque no son las mismas acciones: el mostrador cobra y
 * confirma, el alumno paga y no confirma nada.
 */
export type AccessVoice = 'staff' | 'student';

export interface AccessMessage {
  readonly level: AccessLevel;
  /** Titular grande de la pantalla: "Puede pasar", "Cupo agotado". */
  readonly title: string;
  /** Una linea de causa: es lo que el staff lee en voz alta. */
  readonly reason: string;
  /** Detalle accionable, opcional. */
  readonly detail: string | null;
  /** Accion sugerida al staff, si la hay. */
  readonly action: string | null;
}

const WEEKDAY_NAME: Readonly<Record<IsoWeekday, string>> = {
  1: 'lunes',
  2: 'martes',
  3: 'miércoles',
  4: 'jueves',
  5: 'viernes',
  6: 'sábado',
  7: 'domingo',
};

const WEEKDAY_INITIAL: Readonly<Record<IsoWeekday, string>> = {
  1: 'L',
  2: 'M',
  3: 'M',
  4: 'J',
  5: 'V',
  6: 'S',
  7: 'D',
};

export const weekdayName = (day: IsoWeekday): string => WEEKDAY_NAME[day];
export const weekdayInitial = (day: IsoWeekday): string => WEEKDAY_INITIAL[day];
export const allWeekdays = (): readonly IsoWeekday[] => ISO_WEEKDAYS;

function listDays(days: readonly IsoWeekday[]): string {
  const names = days.map(weekdayName);
  if (names.length === 0) return 'ninguno';
  if (names.length === 1) return names[0] as string;
  return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
}

function denialMessage(reason: DenialReason, voice: AccessVoice): AccessMessage {
  const staff = voice === 'staff';

  switch (reason.code) {
    case 'no_subscription':
      return {
        level: 'blocked',
        title: 'Sin suscripción activa',
        reason: staff
          ? 'Este alumno no tiene una suscripción vigente en este local.'
          : 'No tienes una suscripción vigente en este gimnasio.',
        detail: staff
          ? 'Registra una suscripción o cobra una clase suelta.'
          : 'Pídela en el mostrador, o paga una clase suelta.',
        action: staff ? 'Registrar suscripción' : null,
      };

    case 'delinquent': {
      const debt = reason.debtCents === null ? null : formatPENShort(reason.debtCents);
      return {
        level: 'blocked',
        title: reason.daysPastDue > 0 ? `Mora de ${reason.daysPastDue} días` : 'Acceso suspendido',
        reason: staff
          ? debt === null
            ? 'Suscripción suspendida por mora.'
            : `Deuda de ${debt}.`
          : debt === null
            ? 'Tu suscripción está suspendida por mora.'
            : `Debes ${debt}.`,
        detail: staff
          ? 'Venció el periodo de gracia. Al cobrar, el acceso se libera al instante.'
          : 'Venció tu periodo de gracia. Al pagar, el acceso se libera al instante.',
        action: staff
          ? debt === null
            ? 'Cobrar en mostrador'
            : `Cobrar ${debt} en mostrador`
          : 'Pagar en el mostrador',
      };
    }

    case 'day_not_allowed':
      return {
        level: 'alert',
        title: staff ? 'Hoy no es su día' : 'Hoy no es tu día',
        reason: staff
          ? `Sus días son ${listDays(reason.allowedDays)}.`
          : `Tus días son ${listDays(reason.allowedDays)}.`,
        detail: staff
          ? `Hoy es ${weekdayName(reason.todayIs)}. Recepción puede cambiar los días fijos.`
          : `Hoy es ${weekdayName(reason.todayIs)}. Recepción puede cambiar tus días fijos.`,
        action: null,
      };

    case 'quota_exhausted': {
      const price =
        reason.dropInPriceCents === null ? null : formatPENShort(reason.dropInPriceCents);
      return {
        level: 'alert',
        title: 'Cupo semanal agotado',
        reason: staff
          ? `${reason.used} de ${reason.limit} sesiones usadas esta semana.`
          : `Usaste ${reason.used} de ${reason.limit} sesiones esta semana.`,
        detail: reason.offerDropIn
          ? staff
            ? 'Está al día. Puede entrar comprando una clase suelta o volver el lunes.'
            : 'Estás al día. Puedes entrar pagando una clase suelta, o volver el lunes.'
          : staff
            ? 'Está al día, pero ya no le quedan sesiones. El cupo se reinicia el lunes.'
            : 'Estás al día, pero ya no te quedan sesiones. El cupo se reinicia el lunes.',
        action: reason.offerDropIn
          ? price === null
            ? staff
              ? 'Cobrar clase suelta'
              : 'Pagar clase suelta'
            : staff
              ? `Cobrar clase suelta ${price}`
              : `Pagar clase suelta ${price}`
          : null,
      };
    }

    case 'outside_schedule':
      return {
        level: 'alert',
        title: 'Fuera de horario',
        reason:
          reason.nextClass === null
            ? `No hay clase programada a las ${reason.time}.`
            : `La próxima clase es ${reason.nextClass.name} a las ${reason.nextClass.startTime}.`,
        detail: staff
          ? 'Puedes marcar manualmente si el gimnasio autoriza el ingreso.'
          : 'Recepción puede dejarte pasar si el gimnasio lo autoriza.',
        action: staff ? 'Marcar manual' : null,
      };
  }
}

/**
 * El veredicto en palabras.
 *
 * `voice` decide a quien se le habla. Por defecto al staff, que es quien lee la
 * mayoria de estos mensajes; la app del alumno pide la suya. Las dos salen de
 * aqui para que digan lo MISMO del mismo hecho: cuando cada pantalla escribia su
 * version, el alumno leia "puedes entrar" y el staff "cupo agotado".
 */
export function accessMessage(
  result: CheckInResult,
  voice: AccessVoice = 'staff',
): AccessMessage {
  const staff = voice === 'staff';

  if (!result.allowed) return denialMessage(result.reason, voice);

  if (result.warning?.code === 'in_grace') {
    const days = result.warning.graceDaysLeft;
    const cuantos = days === 1 ? '1 día' : `${days} días`;
    return {
      level: 'warn',
      title: staff ? 'Puede pasar, pero debe' : 'Entra, pero debes',
      reason: staff
        ? `Periodo de gracia: le ${days === 1 ? 'queda' : 'quedan'} ${cuantos}.`
        : `Periodo de gracia: te ${days === 1 ? 'queda' : 'quedan'} ${cuantos}.`,
      detail: staff
        ? 'Al vencer la gracia, el escáner deja de validar su QR.'
        : 'Al vencer la gracia, el escáner deja de validar tu QR.',
      action: staff ? 'Cobrar en mostrador' : 'Pagar en el mostrador',
    };
  }

  if (result.warning?.code === 'last_session') {
    return {
      level: 'warn',
      title: staff ? 'Le queda 1 sesión' : 'Te queda 1 sesión',
      reason: staff
        ? `${result.quota.used} de ${result.quota.limit} sesiones usadas esta semana.`
        : `Usaste ${result.quota.used} de ${result.quota.limit} sesiones esta semana.`,
      detail: 'El cupo se reinicia el lunes. Las sesiones no usadas no se acumulan.',
      action: staff ? 'Confirmar ingreso' : null,
    };
  }

  return {
    level: 'ok',
    title: staff ? 'Puede pasar' : 'Puedes entrar',
    reason: staff ? 'Suscripción al día.' : 'Tu suscripción está al día.',
    detail:
      result.quota.limit === null
        ? 'Sin límite de sesiones.'
        : `${result.quota.remaining} de ${result.quota.limit} sesiones disponibles esta semana.`,
    action: staff ? 'Confirmar ingreso' : null,
  };
}
