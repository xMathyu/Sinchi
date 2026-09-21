/**
 * Ganancias: cuánto entró, de dónde y por qué vía.
 *
 * El rango va en la URL y no tiene defecto implícito en la api —quien pregunta
 * dice de cuándo a cuándo— pero la pantalla sí tiene que llegar con algo puesto,
 * así que el defecto vive AQUÍ: 30 días. La diferencia importa: la ruta nunca
 * devuelve un número del que no se sepa el periodo, y la pantalla nunca aparece
 * vacía pidiendo dos fechas.
 */
import Link from 'next/link';
import { TZ_LIMA, lastDays, plainDateInZone } from '@sinchi/shared';
import { PanelShell } from '../../../components/panel/Shell';
import { Empty, SectionHeader } from '../../../components/panel/Pieces';
import { RevenueChart } from '../../../components/panel/RevenueChart';
import { api } from '../../../src/panel/api';
import { requireOwner } from '../../../src/panel/session';
import {
  CHARGE_LABEL,
  RAIL_LABEL,
  SLICE_COLOR,
  formatDate,
  formatDateTime,
  formatWireDate,
  sliceLabel,
  soles,
} from '../../../src/panel/format';
import type { WireLedger, WireRevenue, WireRevenueSlice } from '../../../src/panel/types';

export const dynamic = 'force-dynamic';

const RANGOS = {
  '30d': { dias: 30, bucket: 'day' as const, label: '30 días' },
  '12m': { dias: 365, bucket: 'month' as const, label: '12 meses' },
};

type RangoId = keyof typeof RANGOS;

export default async function GananciasPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly rango?: string }>;
}) {
  const session = await requireOwner();
  const { rango: pedido } = await searchParams;
  const rangoId: RangoId = pedido === '12m' ? '12m' : '30d';
  const rango = RANGOS[rangoId];

  const hoy = plainDateInZone(new Date(), TZ_LIMA);
  const { from, through } = lastDays(hoy, rango.dias);
  const query = `from=${formatWireDate(from)}&through=${formatWireDate(through)}`;

  const [ingresos, ledger] = await Promise.all([
    api<WireRevenue>(`/staff/reports/revenue?${query}&bucket=${rango.bucket}`),
    api<WireLedger>(`/staff/reports/charges?${query}&limit=25`),
  ]);

  const { report, previous } = ingresos;

  return (
    <PanelShell tenantName={session.tenantName}>
      <SectionHeader
        eyebrow={`${formatDate(from)} — ${formatDate(through)}`}
        title="Ganancias"
        action={
          <nav aria-label="Rango" style={{ display: 'flex', gap: 3, padding: 3, borderRadius: 'var(--r-pill)', border: '1px solid var(--border)', background: 'var(--surface)' }}>
            {(Object.keys(RANGOS) as RangoId[]).map((id) => (
              <Link
                key={id}
                href={`/panel/ganancias?rango=${id}`}
                aria-current={id === rangoId ? 'page' : undefined}
                style={{
                  padding: '7px 15px',
                  borderRadius: 'var(--r-pill)',
                  fontSize: 13,
                  fontWeight: 600,
                  background: id === rangoId ? 'var(--chip-active)' : 'transparent',
                  color: id === rangoId ? 'var(--ink)' : 'var(--text-secondary)',
                }}
              >
                {RANGOS[id].label}
              </Link>
            ))}
          </nav>
        }
      />

      <section className="panel-card" style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Cobrado en el rango</span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 11, flexWrap: 'wrap' }}>
              <b className="display" style={{ fontSize: 42, lineHeight: 1 }}>
                {soles(report.totalCents)}
              </b>
              <Delta percent={previous.percent} deltaCents={previous.deltaCents} />
            </div>
            <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
              {report.count} {report.count === 1 ? 'cobro' : 'cobros'}
              {/* `null` cuando no hay con qué comparar: es el primer periodo del
                  gimnasio, y un 0% o un 100% serían dos mentiras distintas. */}
              {previous.percent === null
                ? ' · sin periodo anterior con el que comparar'
                : ` · el periodo anterior fue ${soles(report.totalCents - previous.deltaCents)}`}
            </span>
          </div>

          {report.best === null ? null : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, textAlign: 'right' }}>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                {rango.bucket === 'day' ? 'Mejor día' : 'Mejor mes'}
              </span>
              <b className="display" style={{ fontSize: 19 }}>
                {formatDate(report.best.date)} · {soles(report.best.amountCents)}
              </b>
              <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                {report.best.count} {report.best.count === 1 ? 'cobro' : 'cobros'}
              </span>
            </div>
          )}
        </div>

        <RevenueChart series={report.series} bucket={ingresos.bucket} />
      </section>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: 14,
          marginBottom: 14,
        }}
      >
        <Desglose titulo="Por concepto" slices={report.byType} etiqueta={(k) => CHARGE_LABEL[k as keyof typeof CHARGE_LABEL] ?? k} />
        <Desglose titulo="Por medio de pago" slices={report.byRail} etiqueta={(k) => RAIL_LABEL[k as keyof typeof RAIL_LABEL] ?? k} />
      </div>

      <section className="panel-card panel-scroll" style={{ padding: 0 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            padding: '16px 18px 13px',
            borderBottom: '1px solid var(--hairline)',
          }}
        >
          <h2>Cobro a cobro</h2>
          <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
            {ledger.total} en el rango · mostrando {ledger.rows.length}
          </span>
        </div>

        {ledger.rows.length === 0 ? (
          <div style={{ padding: 18 }}>
            <Empty
              title="No entró nada en este rango"
              body="En cuanto cobres una mensualidad o una clase suelta, aparece aquí con quién pagó y quién lo registró."
            />
          </div>
        ) : (
          <table className="panel-table">
            <thead>
              <tr>
                <th scope="col">Cuándo</th>
                <th scope="col">Quién pagó</th>
                <th scope="col">Concepto</th>
                <th scope="col">Medio</th>
                <th scope="col">Lo registró</th>
                <th scope="col" className="num">
                  Monto
                </th>
              </tr>
            </thead>
            <tbody>
              {ledger.rows.map((fila) => (
                <tr key={fila.charge.id}>
                  <td style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                    {formatDateTime(fila.charge.createdAt)}
                  </td>
                  {/* Sin ficha detrás: una clase suelta o un evento los paga
                      también quien no entrena aquí, y esa plata es del gimnasio
                      igual. */}
                  <td
                    style={{
                      fontWeight: 600,
                      color: fila.memberName === null ? 'var(--text-tertiary)' : 'var(--ink)',
                    }}
                  >
                    {fila.memberName ?? 'Sin ficha'}
                  </td>
                  <td style={{ color: 'var(--text-bright)' }}>{CHARGE_LABEL[fila.charge.type]}</td>
                  <td style={{ color: 'var(--text-bright)' }}>{RAIL_LABEL[fila.charge.rail]}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{fila.recordedByName ?? '—'}</td>
                  <td className="num" style={{ fontWeight: 600 }}>
                    {soles(fila.charge.amountCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </PanelShell>
  );
}

/** El cambio contra el periodo anterior, o nada cuando no hay con qué comparar. */
function Delta({
  percent,
  deltaCents,
}: {
  readonly percent: number | null;
  readonly deltaCents: number;
}) {
  if (percent === null) return null;

  const sube = deltaCents >= 0;
  const color = sube ? 'var(--ok)' : 'var(--bad)';

  return (
    <span
      className="panel-chip"
      style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}
    >
      <span aria-hidden>{sube ? '↑' : '↓'}</span>
      {Math.abs(percent)}%
    </span>
  );
}

/**
 * Un desglose: la barra de reparto y sus filas.
 *
 * Barra apilada y no una torta: lo que se compara es proporción sobre un total,
 * y de tres o cuatro trozos el ojo lee mejor longitudes que ángulos.
 */
function Desglose({
  titulo,
  slices,
  etiqueta,
}: {
  readonly titulo: string;
  readonly slices: readonly WireRevenueSlice[];
  readonly etiqueta: (key: string) => string;
}) {
  return (
    <section className="panel-card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <h2>{titulo}</h2>

      {slices.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
          No hay cobros en este rango.
        </p>
      ) : (
        <>
          <div className="panel-split" aria-hidden>
            {slices.map((slice) => (
              <i
                key={slice.key}
                style={{ width: `${slice.share}%`, background: SLICE_COLOR[slice.key] ?? 'var(--ok)' }}
              />
            ))}
          </div>

          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 9 }}>
            {slices.map((slice) => (
              <li key={slice.key} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                <i
                  aria-hidden
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: 3,
                    background: SLICE_COLOR[slice.key] ?? 'var(--ok)',
                    flex: 'none',
                  }}
                />
                <span style={{ flexGrow: 1 }}>{etiqueta(slice.key) || sliceLabel(slice.key)}</span>
                <span style={{ color: 'var(--text-tertiary)', fontVariantNumeric: 'tabular-nums' }}>
                  {slice.share}%
                </span>
                <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', minWidth: 78, textAlign: 'right' }}>
                  {soles(slice.amountCents)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
