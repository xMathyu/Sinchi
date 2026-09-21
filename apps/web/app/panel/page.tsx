/**
 * La portada del panel: el día, la plata y la gente.
 *
 * Server Component, así que los datos llegan pintados y el navegador no carga
 * ningún cliente de api. Las cuatro peticiones van en paralelo con
 * `Promise.all`: en serie serían cuatro viajes a Cloud Run sumados, y el
 * primero paga además el arranque en frío (~400 ms) más el despertar de Neon
 * (~700 ms).
 */
import Link from 'next/link';
import { TZ_LIMA, lastDays, plainDateInZone } from '@sinchi/shared';
import { PanelShell } from '../../components/panel/Shell';
import { Empty, SectionHeader, Stat } from '../../components/panel/Pieces';
import { api } from '../../src/panel/api';
import { requireOwner } from '../../src/panel/session';
import { formatClock, formatWireDate, soles } from '../../src/panel/format';
import type {
  WireRanking,
  WireRecentCheckIn,
  WireRosterEntry,
  WireSummary,
} from '../../src/panel/types';

export const dynamic = 'force-dynamic';

/** Cuánto mira atrás el ranking de la portada. Cuatro semanas es un mes de dojo. */
const VENTANA_DIAS = 28;

export default async function InicioPage() {
  const session = await requireOwner();

  const hoy = plainDateInZone(new Date(), TZ_LIMA);
  const rango = lastDays(hoy, VENTANA_DIAS);
  const query = `from=${formatWireDate(rango.from)}&through=${formatWireDate(rango.through)}`;

  const [summary, recientes, roster, ranking] = await Promise.all([
    api<WireSummary>('/staff/summary'),
    api<readonly WireRecentCheckIn[]>('/staff/checkin/recent'),
    api<readonly WireRosterEntry[]>('/staff/roster'),
    api<WireRanking>(`/staff/reports/attendance?${query}&limit=5`),
  ]);

  // El padrón viene ordenado por quién debe, así que los morosos son el principio
  // de la lista: no hace falta una consulta aparte ni volver a ordenar.
  const deudores = roster.filter((entry) => entry.receivable.amountCents > 0).slice(0, 5);

  return (
    <PanelShell tenantName={session.tenantName}>
      <SectionHeader
        eyebrow={`${summary.activeMembers} activos · ${summary.delinquentMembers} con deuda`}
        title="Hoy en tu local"
        action={
          <Link href="/panel/alumnos/nuevo" className="panel-btn">
            + Alumno
          </Link>
        }
      />

      <div className="panel-grid" style={{ marginBottom: 14 }}>
        <Stat
          value={soles(summary.collectedThisMonthCents)}
          caption="cobrado este mes"
          color="var(--ok)"
        />
        <Stat
          value={soles(summary.outstandingCents)}
          caption="por cobrar"
          color={summary.outstandingCents > 0 ? 'var(--warn)' : undefined}
          hint={`${summary.delinquentMembers} alumnos deben`}
        />
        <Stat value={String(summary.activeMembers)} caption="alumnos activos" />
        <Stat value={String(summary.checkInsToday)} caption="marcaron hoy" />
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: 14,
          alignItems: 'start',
        }}
      >
        {/* Quién vino hoy */}
        <section className="panel-card" style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <h2>Quién vino hoy</h2>
            <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>últimas 18 h</span>
          </div>

          {recientes.length === 0 ? (
            <Empty
              title="Nadie ha marcado todavía"
              body="Aquí van apareciendo los alumnos conforme entran, con su hora y si se les marcó a mano."
            />
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 7 }}>
              {recientes.slice(0, 8).map((marca) => (
                <li
                  key={marca.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 11,
                    padding: '10px 12px',
                    borderRadius: 'var(--r-md)',
                    background: 'var(--surface-high)',
                  }}
                >
                  <span aria-hidden className="panel-dot" style={{ background: 'var(--ok)' }} />
                  <span style={{ flexGrow: 1, fontSize: 14, fontWeight: 600 }}>
                    {marca.userName}
                    {marca.method === 'manual' ? (
                      <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}> · a mano</span>
                    ) : null}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-tertiary)', fontVariantNumeric: 'tabular-nums' }}>
                    {formatClock(marca.checkedInAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* A quién cobrarle */}
        <section className="panel-card" style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <h2>A quién cobrarle</h2>
            <Link href="/panel/alumnos" style={{ fontSize: 12, fontWeight: 600 }}>
              Ver todos
            </Link>
          </div>

          {deudores.length === 0 ? (
            <Empty title="Nadie debe nada" body="Todo el padrón está al día. Disfrútalo." />
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 7 }}>
              {deudores.map((entry) => (
                <li key={entry.membership.id}>
                  <Link
                    href={`/panel/alumnos/${entry.membership.id}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 11,
                      padding: '10px 12px',
                      borderRadius: 'var(--r-md)',
                      background: 'var(--surface-high)',
                      color: 'var(--ink)',
                    }}
                  >
                    <span style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                      <span style={{ fontSize: 14, fontWeight: 600 }}>{entry.user.name}</span>
                      <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                        {entry.receivable.daysPastDue > 0
                          ? `${entry.receivable.daysPastDue} días de mora`
                          : 'vence pronto'}
                      </span>
                    </span>
                    <span style={{ fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                      {soles(entry.receivable.amountCents)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Los que más vienen */}
        <section className="panel-card" style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <h2>Los que más vienen</h2>
            <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{VENTANA_DIAS} días</span>
          </div>

          {ranking.regulars.length === 0 ? (
            <Empty
              title="Todavía no hay asistencias"
              body="En cuanto tu gente empiece a marcar, aquí sale quién viene más."
            />
          ) : (
            <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 7 }}>
              {ranking.regulars.map((alumno, i) => (
                <li key={alumno.membershipId}>
                  <Link
                    href={`/panel/alumnos/${alumno.membershipId}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 11,
                      padding: '10px 12px',
                      borderRadius: 'var(--r-md)',
                      background: 'var(--surface-high)',
                      color: 'var(--ink)',
                    }}
                  >
                    <span
                      aria-hidden
                      style={{
                        width: 22,
                        fontSize: 13,
                        fontWeight: 800,
                        fontVariantNumeric: 'tabular-nums',
                        color: i === 0 ? 'var(--ok)' : 'var(--text-tertiary)',
                      }}
                    >
                      {i + 1}
                    </span>
                    <span style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                      <span style={{ fontSize: 14, fontWeight: 600 }}>{alumno.name}</span>
                      <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                        {alumno.perWeek} por semana
                        {/* El uso del cupo hace comparable a quien tiene plan de
                            2x con quien tiene ilimitado. En ilimitado no hay
                            cupo, así que no se inventa uno. */}
                        {alumno.quotaUse === null
                          ? ' · plan ilimitado'
                          : ` · ${Math.round(alumno.quotaUse * 100)}% de su plan`}
                      </span>
                    </span>
                    <span style={{ fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                      {alumno.checkIns}
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* Los que dejaron de venir */}
        <section className="panel-card" style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <h2>Los que se están yendo</h2>
            <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>por ausencia</span>
          </div>

          {ranking.fading.length === 0 ? (
            <Empty
              title="Nadie se está perdiendo"
              body="Todo el mundo ha venido hace poco. Aquí aparecen los que llevan más de diez días sin pisar el local."
            />
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 7 }}>
              {ranking.fading.map((alumno) => (
                <li key={alumno.membershipId}>
                  <Link
                    href={`/panel/alumnos/${alumno.membershipId}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 11,
                      padding: '10px 12px',
                      borderRadius: 'var(--r-md)',
                      background: 'var(--surface-high)',
                      color: 'var(--ink)',
                    }}
                  >
                    <span style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                      <span style={{ fontSize: 14, fontWeight: 600 }}>{alumno.name}</span>
                      {/* El motivo, no un «en riesgo»: al que nunca vino le falló
                          el alta y al que dejó de venir le pasó algo después. Son
                          dos llamadas distintas. */}
                      <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                        {alumno.reason === 'never_came'
                          ? 'se inscribió y nunca vino'
                          : `${alumno.daysAway} días sin venir`}
                      </span>
                    </span>
                    <span
                      className="panel-chip"
                      style={{
                        background:
                          alumno.reason === 'never_came'
                            ? 'rgba(255,77,77,.14)'
                            : 'rgba(255,201,77,.14)',
                        color: alumno.reason === 'never_came' ? 'var(--bad)' : 'var(--warn)',
                      }}
                    >
                      {alumno.reason === 'never_came' ? 'Nunca vino' : `${alumno.daysAway} d`}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          <p style={{ margin: 0, paddingTop: 4, borderTop: '1px solid var(--divider)', fontSize: 12, lineHeight: '18px', color: 'var(--text-tertiary)' }}>
            No es «los que menos vinieron»: quien se inscribió esta semana no está
            a la fuga, y quien tiene plan de 2x y vino 8 veces usó su plan entero.
            Esta lista ordena por días sin aparecer.
          </p>
        </section>
      </div>
    </PanelShell>
  );
}
