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

function denialMessage(reason: DenialReason): AccessMessage {
  switch (reason.code) {
    case 'no_subscription':
      return {
        level: 'blocked',
        title: 'Sin suscripción activa',
        reason: 'Este alumno no tiene una suscripción vigente en este local.',
        detail: 'Registra una suscripción o cobra una clase suelta.',
        action: 'Registrar suscripción',
      };

    case 'delinquent': {
      const debt = reason.debtCents === null ? null : formatPENShort(reason.debtCents);
      return {
        level: 'blocked',
        title: reason.daysPastDue > 0 ? `Mora de ${reason.daysPastDue} días` : 'Acceso suspendido',
        reason: debt === null ? 'Suscripción suspendida por mora.' : `Deuda de ${debt}.`,
        detail: 'Venció el periodo de gracia. Al cobrar, el acceso se libera al instante.',
        action: debt === null ? 'Cobrar en mostrador' : `Cobrar ${debt} en mostrador`,
      };
    }

    case 'day_not_allowed':
      return {
        level: 'alert',
        title: 'Hoy no es su día',
        reason: `Sus días son ${listDays(reason.allowedDays)}.`,
        detail: `Hoy es ${weekdayName(reason.todayIs)}. Recepción puede cambiar los días fijos.`,
        action: null,
      };

    case 'quota_exhausted': {
      const price =
        reason.dropInPriceCents === null ? null : formatPENShort(reason.dropInPriceCents);
      return {
        level: 'alert',
        title: 'Cupo semanal agotado',
        reason: `${reason.used} de ${reason.limit} sesiones usadas esta semana.`,
        detail: reason.offerDropIn
          ? 'Está al día. Puede entrar comprando una clase suelta o volver el lunes.'
          : 'Está al día, pero ya no le quedan sesiones. El cupo se reinicia el lunes.',
        action: reason.offerDropIn
          ? price === null
            ? 'Cobrar clase suelta'
            : `Cobrar clase suelta ${price}`
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
        detail: 'Puedes marcar manualmente si el gimnasio autoriza el ingreso.',
        action: 'Marcar manual',
      };
  }
}

export function accessMessage(result: CheckInResult): AccessMessage {
  if (!result.allowed) return denialMessage(result.reason);

  if (result.warning?.code === 'in_grace') {
    const days = result.warning.graceDaysLeft;
    return {
      level: 'warn',
      title: 'Puede pasar, pero debe',
      reason:
        days === 1
          ? 'Periodo de gracia: le queda 1 día.'
          : `Periodo de gracia: le quedan ${days} días.`,
      detail: 'Al vencer la gracia, el escáner deja de validar su QR.',
      action: 'Cobrar en mostrador',
    };
  }

  if (result.warning?.code === 'last_session') {
    return {
      level: 'warn',
      title: 'Le queda 1 sesión',
      reason: `${result.quota.used} de ${result.quota.limit} sesiones usadas esta semana.`,
      detail: 'El cupo se reinicia el lunes. Las sesiones no usadas no se acumulan.',
      action: 'Confirmar ingreso',
    };
  }

  return {
    level: 'ok',
    title: 'Puede pasar',
    reason: 'Suscripción al día.',
    detail:
      result.quota.limit === null
        ? 'Sin límite de sesiones.'
        : `${result.quota.remaining} de ${result.quota.limit} sesiones disponibles esta semana.`,
    action: 'Confirmar ingreso',
  };
}
