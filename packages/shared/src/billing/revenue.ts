/**
 * Cuanto entro, cuando y por que via.
 *
 * `computeReceivable` responde «cuanto me deben»; esto responde la otra mitad,
 * «cuanto cobre». Son numeros distintos y el panel los pone uno al lado del
 * otro, asi que conviene decir en voz alta donde esta la linea: aqui solo cuenta
 * el cargo `succeeded`. Un cargo `pending` es deuda —ya lo cuenta el otro lado—
 * y sumarlo aqui haria que el mismo sol apareciera dos veces, una como cobrado y
 * otra como por cobrar. Es exactamente la forma en que un dueno deja de confiar
 * en la pantalla.
 *
 * Es una funcion pura sobre una lista de cargos: la misma que corre la api para
 * servir el reporte vale en el navegador para recalcular un rango sin volver a
 * preguntar, y en la app si algun dia el dueno mira sus numeros desde el
 * telefono. Agregar dinero dos veces en dos sitios es como se llega a que el
 * panel y el mostrador digan cifras distintas del mismo mes.
 */
import { ZERO, cents, sum, type Cents } from '../money/cents.js';
import type { ChargeStatus, ChargeType, PaymentRail } from '../domain/types.js';
import {
  addDays,
  addMonthsClamped,
  compareDates,
  daysBetween,
  formatPlainDate,
  isAfter,
  plainDate,
  plainDateInZone,
  type PlainDate,
} from '../time/plain-date.js';
import type { IanaTimeZone } from '../time/zone.js';

/**
 * El grano del grafico.
 *
 * Dos y no cinco: por dia se lee un mes, por mes se lee un ano, y entre esos dos
 * no hay ninguna pregunta que el dueno de un dojo se haga. La semana se descarto
 * porque obliga a decidir si empieza lunes o domingo y a explicarlo en pantalla.
 */
export type RevenueBucket = 'day' | 'month';

/**
 * Un cargo, reducido a lo que el reporte necesita.
 *
 * No es `Charge`: no hacen falta ni el id, ni la membresia, ni el periodo, y
 * pedirlos obligaria a quien llame a cargar la fila entera. Lo que si viaja es
 * `status`, porque el filtro de «solo cobrado» se aplica AQUI y no en la
 * consulta — asi la funcion es honesta por si sola y una consulta que se olvide
 * del `where` no inventa ingresos.
 */
export interface RevenueEntry {
  /** Cuando se cobro, en instante absoluto. El bucket se decide con la zona. */
  readonly at: Date;
  readonly type: ChargeType;
  readonly rail: PaymentRail;
  readonly amountCents: Cents;
  readonly status: ChargeStatus;
}

export interface RevenueInput {
  readonly entries: readonly RevenueEntry[];
  /** Primer dia del rango, inclusive. */
  readonly from: PlainDate;
  /** Ultimo dia del rango, inclusive. */
  readonly through: PlainDate;
  readonly bucket: RevenueBucket;
  /** La del gimnasio. Ver `bucketOf`: cobrar de noche en Lima es otro dia en UTC. */
  readonly timezone: IanaTimeZone;
}

export interface RevenuePoint {
  /** Inicio del bucket: el dia, o el dia 1 del mes. */
  readonly date: PlainDate;
  readonly amountCents: Cents;
  readonly count: number;
}

/** Cuanto entro por una via (un tipo de cargo, o un medio de pago). */
export interface RevenueSlice<K extends string> {
  readonly key: K;
  readonly amountCents: Cents;
  readonly count: number;
  /** Porcentaje del total, entero y redondeado. Suma 100 salvo por el redondeo. */
  readonly share: number;
}

export interface RevenueReport {
  readonly totalCents: Cents;
  /** Cuantos cobros, no cuantos alumnos: la misma persona puede pagar dos veces. */
  readonly count: number;
  /** Un punto por bucket, incluidos los vacios. Ver `emptyBuckets`. */
  readonly series: readonly RevenuePoint[];
  readonly byType: readonly RevenueSlice<ChargeType>[];
  readonly byRail: readonly RevenueSlice<PaymentRail>[];
  /** El bucket con mas dinero. `null` si no entro nada en todo el rango. */
  readonly best: RevenuePoint | null;
}

/**
 * A que dia pertenece un cobro.
 *
 * En la zona del gimnasio y no en UTC, y esto no es purismo. Lima es UTC−5: la
 * mensualidad que se cobra a las 8 de la noche del 31 se guarda como la 1 de la
 * madrugada del 1 en UTC. Agrupando por UTC, la caja de la noche —que en un dojo
 * es cuando entrena casi todo el mundo y por tanto cuando se cobra— se va al dia
 * siguiente, y al mes siguiente si el dia era 31. El dueno que cuenta el efectivo
 * al cerrar encuentra un numero que no le cuadra, y tiene razon el.
 */
function bucketOf(at: Date, bucket: RevenueBucket, timezone: IanaTimeZone): PlainDate {
  const day = plainDateInZone(at, timezone);
  return bucket === 'day' ? day : plainDate(day.year, day.month, 1);
}

/** El siguiente bucket. Es lo unico que cambia entre recorrer dias y meses. */
function nextBucket(date: PlainDate, bucket: RevenueBucket): PlainDate {
  return bucket === 'day' ? addDays(date, 1) : addMonthsClamped(date, 1);
}

/**
 * Todos los buckets del rango, incluidos los que no facturaron nada.
 *
 * Es la decision menos obvia del archivo y la que mas se nota en pantalla. Lo
 * barato es devolver solo los dias con cobros, y entonces un gimnasio que cobro
 * lunes, miercoles y viernes sale como tres puntos seguidos: el grafico dibuja
 * una semana constante y esconde que el martes y el jueves no entro un sol. El
 * hueco ES el dato — es lo que hace visible el mes en que la cosa se cayo.
 *
 * El coste esta acotado: un ano por dia son 365 puntos, y por mes son 12.
 */
function emptyBuckets(
  from: PlainDate,
  through: PlainDate,
  bucket: RevenueBucket,
): readonly PlainDate[] {
  const first = bucket === 'day' ? from : plainDate(from.year, from.month, 1);
  const out: PlainDate[] = [];

  for (let cursor = first; !isAfter(cursor, through); cursor = nextBucket(cursor, bucket)) {
    out.push(cursor);
  }
  return out;
}

/**
 * Agrupa por una clave y ordena de mas a menos.
 *
 * De mas a menos y no por el orden del enum: lo que el dueno quiere saber de un
 * vistazo es por donde entra su plata, y eso es la primera fila. Un orden fijo
 * obliga a leer las cuatro para encontrarla.
 *
 * Solo salen las claves con movimiento. Una fila «tarjeta: S/ 0» en un gimnasio
 * que solo cobra en efectivo y Yape es ruido que hay que leer cada vez para
 * descartarla.
 */
function sliceBy<K extends string>(
  entries: readonly RevenueEntry[],
  keyOf: (entry: RevenueEntry) => K,
  totalCents: Cents,
): readonly RevenueSlice<K>[] {
  const buckets = new Map<K, { amount: number; count: number }>();

  for (const entry of entries) {
    const key = keyOf(entry);
    const current = buckets.get(key) ?? { amount: 0, count: 0 };
    buckets.set(key, { amount: current.amount + entry.amountCents, count: current.count + 1 });
  }

  return [...buckets.entries()]
    .map(([key, value]) => ({
      key,
      amountCents: cents(value.amount),
      count: value.count,
      // Contra el total y no contra la suma del grupo: los dos desgloses miden
      // el MISMO dinero partido de dos formas, asi que los dos tienen que sumar
      // 100 sobre la misma base o dejan de ser comparables entre si.
      share: totalCents === 0 ? 0 : Math.round((value.amount * 100) / totalCents),
    }))
    .sort((a, b) => b.amountCents - a.amountCents || a.key.localeCompare(b.key));
}

/**
 * El reporte de ingresos de un rango.
 *
 * Acepta la lista entera y filtra dentro: ni el rango ni el estado se confian a
 * la consulta. Es lo que permite que la api pida «los cargos de este gimnasio»
 * sin mas y que el recorte —que es donde esta la regla de negocio— viva en un
 * solo sitio con pruebas.
 */
export function computeRevenue(input: RevenueInput): RevenueReport {
  const { entries, from, through, bucket, timezone } = input;

  const counted = entries.filter((entry) => {
    // Solo lo cobrado. La cabecera del archivo explica por que un `pending` no
    // es un ingreso sino la deuda que ya cuenta el otro lado del panel.
    if (entry.status !== 'succeeded') return false;
    const day = plainDateInZone(entry.at, timezone);
    return compareDates(day, from) >= 0 && compareDates(day, through) <= 0;
  });

  const totalCents = sum(...counted.map((entry) => entry.amountCents));

  const byBucket = new Map<string, { amount: number; count: number }>();
  for (const entry of counted) {
    const key = formatPlainDate(bucketOf(entry.at, bucket, timezone));
    const current = byBucket.get(key) ?? { amount: 0, count: 0 };
    byBucket.set(key, { amount: current.amount + entry.amountCents, count: current.count + 1 });
  }

  const series = emptyBuckets(from, through, bucket).map((date) => {
    const found = byBucket.get(formatPlainDate(date)) ?? { amount: 0, count: 0 };
    return { date, amountCents: cents(found.amount), count: found.count };
  });

  // `reduce` y no un `sort`: el mejor bucket es uno solo y ordenar 365 puntos
  // para leer el primero desordena la serie que acabamos de construir.
  const best = series.reduce<RevenuePoint | null>(
    (top, point) =>
      point.count > 0 && (top === null || point.amountCents > top.amountCents) ? point : top,
    null,
  );

  return {
    totalCents,
    count: counted.length,
    series,
    byType: sliceBy(counted, (entry) => entry.type, totalCents),
    byRail: sliceBy(counted, (entry) => entry.rail, totalCents),
    best,
  };
}

/**
 * Cuanto cambio contra el periodo anterior.
 *
 * Un total suelto no dice nada: «S/ 4,200 este mes» solo significa algo al lado
 * de lo que fue el mes pasado. Devuelve `null` cuando no hay con que comparar
 * —el primer mes del gimnasio— en vez de un 0% o un 100%, que son dos mentiras
 * distintas sobre lo mismo: que no se sabe.
 */
export function compareRevenue(
  currentCents: Cents,
  previousCents: Cents,
): { readonly deltaCents: Cents; readonly percent: number | null } {
  const deltaCents = cents(currentCents - previousCents);
  return {
    deltaCents,
    percent: previousCents === 0 ? null : Math.round((deltaCents * 100) / previousCents),
  };
}

/**
 * El rango inmediatamente anterior, del mismo tamano.
 *
 * Del mismo tamano y pegado, que es lo que hace justa la comparacion: comparar
 * los 30 dias que van contra «el mes pasado natural» mezcla periodos de 28 y 31
 * dias y regala o quita hasta tres dias de caja.
 */
export function previousRange(
  from: PlainDate,
  through: PlainDate,
): { readonly from: PlainDate; readonly through: PlainDate } {
  // `+ 1` porque el rango incluye los dos extremos: del 1 al 31 son 31 dias, no 30.
  const span = Math.max(1, daysBetween(from, through) + 1);
  return { from: addDays(from, -span), through: addDays(through, -span) };
}

/** El total en cero, para pintar el panel de un gimnasio que aun no cobro nada. */
export const EMPTY_REVENUE: RevenueReport = {
  totalCents: ZERO,
  count: 0,
  series: [],
  byType: [],
  byRail: [],
  best: null,
};
