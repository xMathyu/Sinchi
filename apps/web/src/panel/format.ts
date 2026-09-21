/**
 * Formateo del panel.
 *
 * El dinero sale de `formatPEN` de `@sinchi/shared`, no de `Intl`: es la misma
 * funcion que pinta los montos en la app, y dos formateadores distintos es como
 * se llega a que el mismo cargo se lea «S/ 149.00» en el telefono y «S/ 149,00»
 * en el panel. Lo que vive aqui es lo que la app no necesita — nombres de mes
 * para un eje, el nombre en español de un tipo de cargo, un rango por defecto.
 */
import { type ChargeType, type PaymentRail, cents, formatPEN, formatPENShort } from '@sinchi/shared';
import type { WireDate } from './types';

export { formatPEN, formatPENShort };

/**
 * `S/ 1,234.50` desde el entero que llega por HTTP.
 *
 * `Cents` es un tipo marcado a propósito: en un dominio de pagos, la diferencia
 * entre soles y céntimos son dos órdenes de magnitud, y el tipo impide que un
 * `number` cualquiera se cuele como monto. JSON no conserva esa marca, así que
 * hace falta un paso explícito al cruzar la red — y este es ese paso, en un solo
 * sitio. `cents()` valida que sea entero; un decimal lanza, que es lo correcto:
 * un monto roto se ve en la primera pantalla y no en el corte de caja.
 */
export const soles = (amount: number): string => formatPENShort(cents(amount));

/** Con decimales siempre. Para un recibo o una tabla donde se suman columnas. */
export const solesExactos = (amount: number): string => formatPEN(cents(amount));

const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
] as const;

const MES_CORTO = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
] as const;

const mesDe = (date: WireDate, tabla: readonly string[]): string => tabla[date.month - 1] ?? '';

/** `14 de septiembre`. Sin año: el panel siempre mira un rango conocido. */
export const formatDate = (date: WireDate): string => `${date.day} de ${mesDe(date, MESES)}`;

/** `14 sep`. Para ejes y tablas, donde el ancho manda. */
export const formatDateShort = (date: WireDate): string => `${date.day} ${mesDe(date, MES_CORTO)}`;

/** `sep 2026`. La etiqueta de un bucket mensual. */
export const formatMonth = (date: WireDate): string => `${mesDe(date, MES_CORTO)} ${date.year}`;

export const formatWireDate = (date: WireDate): string =>
  `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;

/**
 * La hora de un instante ISO, en Lima.
 *
 * Aqui si se usa `Intl`, y la razon por la que `@sinchi/shared` no lo hace no
 * aplica: aquello corre en Hermes, donde `Intl` no esta garantizado. Esto corre
 * en Node y en un navegador de escritorio, que lo traen siempre.
 */
export const formatClock = (iso: string): string =>
  new Intl.DateTimeFormat('es-PE', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Lima',
  }).format(new Date(iso));

export const formatDateTime = (iso: string): string =>
  new Intl.DateTimeFormat('es-PE', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Lima',
  }).format(new Date(iso));

/**
 * Como se llama cada cargo para quien lo lee.
 *
 * Los nombres del negocio estan en `docs/glosario.md` y esta tabla es su lado
 * de pantalla. `proration` se dice «ajuste de plan» y no «prorrateo»: el dueño
 * de un dojo no tiene por que saber la palabra, y lo que necesita entender es
 * de donde salio ese monto raro.
 */
export const CHARGE_LABEL: Record<ChargeType, string> = {
  renewal: 'Mensualidad',
  proration: 'Ajuste de plan',
  enrollment: 'Matrícula',
  drop_in: 'Clase suelta',
  event: 'Evento',
  saas: 'Sinchi',
};

export const RAIL_LABEL: Record<PaymentRail, string> = {
  cash: 'Efectivo',
  yape: 'Yape',
  bank_transfer: 'Transferencia',
  card: 'Tarjeta',
};

/**
 * El color de cada medio de pago y de cada tipo de cargo.
 *
 * Fijo por clave y no por posicion en la lista: los desgloses se ordenan de mas
 * a menos, asi que un color por indice haria que «efectivo» cambiara de color el
 * mes en que Yape lo pasa. Un grafico cuyos colores bailan entre dos visitas no
 * se puede comparar de memoria, que es justo como se miran estas cosas.
 */
export const SLICE_COLOR: Record<string, string> = {
  renewal: 'var(--ok)',
  enrollment: '#6FA8FF',
  drop_in: '#F2C14E',
  event: '#C08BE8',
  proration: '#8A8F98',
  saas: '#8A8F98',
  cash: 'var(--ok)',
  yape: '#8B5CF6',
  bank_transfer: '#6FA8FF',
  card: '#F2C14E',
};

export const sliceLabel = (key: string): string =>
  CHARGE_LABEL[key as ChargeType] ?? RAIL_LABEL[key as PaymentRail] ?? key;
