/**
 * Reloj.
 *
 * Inyectable a propósito: todo lo que decide dinero o acceso depende de "hoy", y
 * un dominio que lee `new Date()` por su cuenta no se puede probar ni auditar.
 * En producción hay una sola implementación; en los tests se fija la fecha.
 *
 * La fecha civil se evalúa siempre en la zona del gimnasio, no del servidor: un
 * servidor en UTC cree que ya es mañana desde las 19:00 de Lima, que es la hora
 * de mayor asistencia de un dojo.
 */
import { Injectable } from '@nestjs/common';
import {
  localTimeInZone,
  plainDateInZone,
  type IanaTimeZone,
  type LocalTime,
  type PlainDate,
} from '@sinchi/shared';

@Injectable()
export class Clock {
  now(): Date {
    return new Date();
  }

  today(timezone: IanaTimeZone): PlainDate {
    return plainDateInZone(this.now(), timezone);
  }

  timeOfDay(timezone: IanaTimeZone): LocalTime {
    return localTimeInZone(this.now(), timezone);
  }
}

/** Reloj congelado, para tests. */
export class FixedClock extends Clock {
  constructor(private readonly instant: Date) {
    super();
  }

  override now(): Date {
    return this.instant;
  }
}
