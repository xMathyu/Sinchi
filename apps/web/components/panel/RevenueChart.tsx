/**
 * El gráfico de ingresos: barras en CSS, sin librería.
 *
 * Una serie de un año son 365 valores de UNA dimensión. Traer Recharts —y con él
 * React al navegador, en un panel que por lo demás es HTML servido— para dibujar
 * rectángulos es un peaje que nadie cobra. Esto se renderiza en el servidor y
 * llega pintado.
 *
 * Server Component a propósito, y eso fija una consecuencia: no hay tooltip
 * interactivo. Cada barra lleva su `title`, que el navegador enseña al pasar por
 * encima y los lectores de pantalla anuncian. Es menos vistoso que un tooltip
 * propio y no cuesta un solo kilobyte de JavaScript; el dato exacto, además, ya
 * está en la tabla de abajo.
 */
import { formatDate, formatMonth, soles } from '../../src/panel/format';
import type { WireRevenuePoint } from '../../src/panel/types';

export function RevenueChart({
  series,
  bucket,
}: {
  readonly series: readonly WireRevenuePoint[];
  readonly bucket: 'day' | 'month';
}) {
  if (series.length === 0) return null;

  const tope = Math.max(...series.map((point) => point.amountCents));
  const etiquetar = bucket === 'day' ? formatDate : formatMonth;

  // Cuatro marcas de eje repartidas: con 365 barras, una etiqueta por barra es
  // ilegible, y sin ninguna el gráfico no dice de cuándo a cuándo va.
  const marcas = [0, Math.floor(series.length / 3), Math.floor((series.length * 2) / 3), series.length - 1]
    .filter((i, pos, todas) => todas.indexOf(i) === pos)
    .map((i) => series[i])
    .filter((point): point is WireRevenuePoint => point !== undefined);

  return (
    <div>
      <div className="panel-chart" role="img" aria-label={resumen(series, bucket)}>
        {series.map((point) => {
          const vacio = point.count === 0;
          return (
            <div
              key={`${point.date.year}-${point.date.month}-${point.date.day}`}
              className="panel-bar"
              data-empty={vacio}
              title={`${etiquetar(point.date)} · ${vacio ? 'sin cobros' : soles(point.amountCents)}`}
            >
              <i
                style={{
                  // El día en cero se dibuja como una línea gris, no como nada:
                  // el hueco es el dato. Y un día con cobros nunca es invisible
                  // —lo garantiza el `min-height` del CSS— porque S/ 5 al lado de
                  // S/ 5,000 son cero píxeles y se leería como un día muerto.
                  height: tope === 0 ? '2px' : `${Math.round((point.amountCents / tope) * 100)}%`,
                }}
              />
            </div>
          );
        })}
      </div>

      <div className="panel-axis">
        {marcas.map((point) => (
          <span key={`${point.date.year}-${point.date.month}-${point.date.day}`}>
            {etiquetar(point.date)}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Lo que oye quien no ve el gráfico.
 *
 * Un `role="img"` sin `aria-label` es un agujero: el lector anuncia «imagen» y
 * nada más. Aquí se resume lo que la forma dice —el periodo, el total y el pico—
 * que es lo que alguien mirando sacaría de un vistazo.
 */
function resumen(series: readonly WireRevenuePoint[], bucket: 'day' | 'month'): string {
  const etiquetar = bucket === 'day' ? formatDate : formatMonth;
  const total = series.reduce((sum, point) => sum + point.amountCents, 0);
  const pico = series.reduce<WireRevenuePoint | null>(
    (top, point) => (point.count > 0 && (top === null || point.amountCents > top.amountCents) ? point : top),
    null,
  );
  const unidad = bucket === 'day' ? 'días' : 'meses';

  const primero = series[0];
  const ultimo = series[series.length - 1];
  const periodo =
    primero === undefined || ultimo === undefined
      ? ''
      : ` de ${etiquetar(primero.date)} a ${etiquetar(ultimo.date)}`;

  return pico === null
    ? `Sin cobros en los últimos ${series.length} ${unidad}${periodo}.`
    : `Ingresos por ${unidad}${periodo}: ${soles(total)} en total, con el pico en ${etiquetar(pico.date)} con ${soles(pico.amountCents)}.`;
}
