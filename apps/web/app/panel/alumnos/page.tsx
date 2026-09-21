/**
 * El padrón.
 *
 * La búsqueda va por query (`?q=`) y no por estado de cliente: así un resultado
 * es una URL que se puede guardar y recargar, el botón de atrás hace lo que
 * promete, y la página sigue funcionando mientras el JavaScript carga. Un
 * buscador que solo existe en memoria pierde lo que escribiste al refrescar.
 */
import Link from 'next/link';
import { PanelShell } from '../../../components/panel/Shell';
import { Empty, LevelChip, SectionHeader } from '../../../components/panel/Pieces';
import { api } from '../../../src/panel/api';
import { requireOwner } from '../../../src/panel/session';
import { formatDate, soles } from '../../../src/panel/format';
import type { WireRosterEntry } from '../../../src/panel/types';

export const dynamic = 'force-dynamic';

export default async function AlumnosPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly q?: string; readonly filtro?: string }>;
}) {
  const session = await requireOwner();
  const { q = '', filtro = 'todos' } = await searchParams;

  const buscando = q.trim().length > 0;
  const roster = await api<readonly WireRosterEntry[]>(
    buscando
      ? `/staff/roster/search?q=${encodeURIComponent(q.trim())}`
      : // Las bajas solo cuando se piden: el padrón de todos los días son los
        // activos, y mezclarlas obliga a leer el estado de cada fila.
        `/staff/roster${filtro === 'bajas' ? '?includeCanceled=true' : ''}`,
  );

  const filas =
    filtro === 'deuda' ? roster.filter((entry) => entry.receivable.amountCents > 0) : roster;

  const conDeuda = roster.filter((entry) => entry.receivable.amountCents > 0).length;

  return (
    <PanelShell tenantName={session.tenantName}>
      <SectionHeader
        eyebrow={`${roster.length} en el padrón · ${conDeuda} con deuda`}
        title="Alumnos"
        action={
          <Link href="/panel/alumnos/nuevo" className="panel-btn">
            + Alumno
          </Link>
        }
      />

      {/* Un `form` con method GET: escribe la query en la URL sin una línea de
          JavaScript, y el Enter del teclado hace lo que todo el mundo espera. */}
      <form
        method="GET"
        style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 18 }}
      >
        <label style={{ flexGrow: 1, minWidth: 220 }}>
          <span
            style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)' }}
          >
            Buscar por nombre o documento
          </span>
          <input
            name="q"
            type="search"
            defaultValue={q}
            placeholder="Buscar por nombre o documento"
            className="panel-input"
          />
        </label>
        {/* El filtro viaja con la búsqueda: sin esto, buscar dentro de «con
            deuda» te devolvía al padrón entero. */}
        <input type="hidden" name="filtro" value={filtro} />
        <button type="submit" className="panel-btn ghost">
          Buscar
        </button>
      </form>

      <nav
        aria-label="Filtros del padrón"
        style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}
      >
        {[
          { id: 'todos', label: 'Todos' },
          { id: 'deuda', label: 'Con deuda' },
          { id: 'bajas', label: 'Con bajas' },
        ].map((opcion) => (
          <Link
            key={opcion.id}
            href={`/panel/alumnos?filtro=${opcion.id}${buscando ? `&q=${encodeURIComponent(q)}` : ''}`}
            className="panel-chip"
            aria-current={filtro === opcion.id ? 'page' : undefined}
            style={{
              padding: '7px 14px',
              fontSize: 13,
              border: '1px solid var(--border)',
              background: filtro === opcion.id ? 'var(--surface-high)' : 'transparent',
              color: filtro === opcion.id ? 'var(--ink)' : 'var(--text-secondary)',
            }}
          >
            {opcion.label}
          </Link>
        ))}
      </nav>

      {filas.length === 0 ? (
        <Empty
          title={buscando ? 'Nadie con ese nombre ni ese documento' : 'Tu padrón está vacío'}
          body={
            buscando
              ? 'Prueba con parte del nombre, o con los primeros dígitos del DNI.'
              : 'Da de alta a tu primer alumno y aparecerá aquí con su plan y su próxima fecha de pago.'
          }
        />
      ) : (
        <div className="panel-card panel-scroll" style={{ padding: 0 }}>
          <table className="panel-table">
            <thead>
              <tr>
                <th scope="col">Alumno</th>
                <th scope="col">Plan</th>
                <th scope="col">Cupo</th>
                <th scope="col">Próximo pago</th>
                <th scope="col" className="num">
                  Debe
                </th>
                <th scope="col">Estado</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((entry) => (
                <tr key={entry.membership.id}>
                  <td>
                    <Link
                      href={`/panel/alumnos/${entry.membership.id}`}
                      style={{ display: 'flex', flexDirection: 'column', gap: 2, color: 'var(--ink)' }}
                    >
                      <span style={{ fontWeight: 600 }}>{entry.user.name}</span>
                      <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                        DNI {entry.user.documentId}
                      </span>
                    </Link>
                  </td>
                  <td style={{ color: 'var(--text-bright)' }}>{entry.plan.name}</td>
                  <td className="num" style={{ textAlign: 'left', color: 'var(--text-secondary)' }}>
                    {entry.quota.limit === null
                      ? `${entry.quota.used} · sin tope`
                      : `${entry.quota.used} / ${entry.quota.limit}`}
                  </td>
                  <td style={{ color: 'var(--text-secondary)' }}>
                    {formatDate(entry.subscription.nextBillingDate)}
                  </td>
                  <td
                    className="num"
                    style={{
                      fontWeight: 600,
                      color:
                        entry.receivable.amountCents > 0 ? 'var(--bad)' : 'var(--text-tertiary)',
                    }}
                  >
                    {entry.receivable.amountCents > 0 ? soles(entry.receivable.amountCents) : '—'}
                  </td>
                  <td>
                    {/* La palabra la escribe el dominio (`badge`), no la
                        pantalla: el mismo hecho tiene que leerse igual aquí y
                        en la puerta. */}
                    <LevelChip level={entry.level} label={entry.badge} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p style={{ margin: '14px 0 0', fontSize: 12, color: 'var(--text-tertiary)' }}>
        El padrón se ordena por quién debe, no alfabéticamente: la pregunta del mostrador es a quién
        cobrarle.
      </p>
    </PanelShell>
  );
}
