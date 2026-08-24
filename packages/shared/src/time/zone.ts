/**
 * Resolucion de offset de zona horaria sin dependencias.
 *
 * Por que no `Intl` a secas: este paquete lo consume tambien la app Expo, y
 * Hermes no garantiza `Intl` en toda version de Android. Las zonas que el
 * producto usa a diario se resuelven con una tabla de offset fijo; cualquier
 * otra cae a `Intl` cuando el runtime lo trae.
 */

export type IanaTimeZone = string;

/** Zona horaria de referencia del producto (MD 4.1). */
export const TZ_LIMA = 'America/Lima';

/**
 * Zonas de offset fijo, en minutos respecto de UTC.
 *
 * Peru no aplica horario de verano: esta en UTC-5 de forma permanente desde
 * 1994-04-01 (los ensayos de DST fueron 1986-1987 y 1990-1994). Para fechas
 * operativas del producto, -300 es exacto.
 */
const FIXED_OFFSETS: Readonly<Record<string, number>> = {
  'America/Lima': -300,
  UTC: 0,
  'Etc/UTC': 0,
  'Etc/GMT': 0,
};

function offsetViaIntl(tz: IanaTimeZone, instant: Date): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts: Record<string, number> = {};
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }

  const asUtc = Date.UTC(
    parts.year ?? 0,
    (parts.month ?? 1) - 1,
    parts.day ?? 1,
    (parts.hour ?? 0) % 24,
    parts.minute ?? 0,
    parts.second ?? 0,
  );

  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/**
 * Minutos de offset respecto de UTC para `tz` en el instante dado.
 * Negativo al oeste de Greenwich (Lima = -300).
 */
export function offsetMinutes(tz: IanaTimeZone, instant: Date): number {
  const fixed = FIXED_OFFSETS[tz];
  if (fixed !== undefined) return fixed;

  if (typeof Intl === 'undefined' || typeof Intl.DateTimeFormat !== 'function') {
    throw new Error(
      `Zona horaria "${tz}" no esta en la tabla de offsets fijos y este runtime no expone Intl.`,
    );
  }
  return offsetViaIntl(tz, instant);
}
