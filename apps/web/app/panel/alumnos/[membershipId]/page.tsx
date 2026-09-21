/**
 * La ficha de un alumno: lo que debe, lo que pagó y cuándo viene.
 *
 * Es la pantalla desde la que se cobra, así que lo primero que se ve es cuánto
 * debe y el formulario para cobrarlo. El historial va debajo: se consulta cuando
 * alguien discute un pago, no cada vez que se abre la ficha.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PanelShell } from '../../../../components/panel/Shell';
import { LevelChip, SectionHeader } from '../../../../components/panel/Pieces';
import { CobrarForm } from '../../../../components/panel/CobrarForm';
import { ApiError, api } from '../../../../src/panel/api';
import { requireOwner } from '../../../../src/panel/session';
import {
  CHARGE_LABEL,
  RAIL_LABEL,
  formatDate,
  formatDateTime,
  soles,
} from '../../../../src/panel/format';
import type { WireMemberDetail } from '../../../../src/panel/types';

export const dynamic = 'force-dynamic';

export default async function AlumnoPage({
  params,
}: {
  readonly params: Promise<{ readonly membershipId: string }>;
}) {
  const session = await requireOwner();
  const { membershipId } = await params;

  let detalle: WireMemberDetail;
  try {
    detalle = await api<WireMemberDetail>(`/staff/members/${membershipId}`);
  } catch (error) {
    // Un 404 de la api es un 404 de la página, no una pantalla de error roja:
    // llegar aquí con un id viejo es lo normal después de una baja.
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const { user, plan, receivable, subscription, quota, charges, attendances } = detalle;
  const pagados = charges.filter((charge) => charge.status === 'succeeded');

  return (
    <PanelShell tenantName={session.tenantName}>
      <Link
        href="/panel/alumnos"
        style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}
      >
        ← Alumnos
      </Link>

      <div style={{ height: 14 }} />

      <SectionHeader
        title={user.name}
        action={
          <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
            <span className="panel-btn ghost" style={{ cursor: 'default' }}>
              DNI {user.documentId}
            </span>
            <span className="panel-btn ghost" style={{ cursor: 'default' }}>
              {user.phone}
            </span>
          </div>
        }
      />

      <div style={{ display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap', marginBottom: 18 }}>
        <LevelChip level={detalle.level} label={detalle.badge} />
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          {plan.name} · {soles(plan.priceCents)} al mes · próximo pago{' '}
          {formatDate(subscription.nextBillingDate)}
        </span>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(280px, 340px)',
          gap: 14,
          alignItems: 'start',
        }}
        className="alumno-grid"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          <CobrarForm
            membershipId={membershipId}
            debeCents={receivable.amountCents}
            periodosDebidos={receivable.periodsOwed}
            mensualidadCents={plan.priceCents}
          />

          <section className="panel-card panel-scroll" style={{ padding: 0 }}>
            <div style={{ padding: '16px 18px 13px', borderBottom: '1px solid var(--hairline)' }}>
              <h2>Historial de pagos</h2>
            </div>
            {pagados.length === 0 ? (
              <p style={{ margin: 0, padding: '28px 18px', fontSize: 14, color: 'var(--text-secondary)' }}>
                Todavía no se le ha cobrado nada.
              </p>
            ) : (
              <table className="panel-table">
                <thead>
                  <tr>
                    <th scope="col">Cuándo</th>
                    <th scope="col">Concepto</th>
                    <th scope="col">Medio</th>
                    <th scope="col" className="num">
                      Monto
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pagados.map((charge) => (
                    <tr key={charge.id}>
                      <td style={{ color: 'var(--text-secondary)' }}>
                        {formatDateTime(charge.createdAt)}
                      </td>
                      <td style={{ fontWeight: 600 }}>{CHARGE_LABEL[charge.type]}</td>
                      <td style={{ color: 'var(--text-bright)' }}>{RAIL_LABEL[charge.rail]}</td>
                      <td className="num" style={{ fontWeight: 600 }}>
                        {soles(charge.amountCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <section className="panel-card" style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
            <h2>Su cupo de esta semana</h2>
            {quota.limit === null ? (
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
                Plan ilimitado: vino {quota.used}{' '}
                {quota.used === 1 ? 'vez' : 'veces'} esta semana y no tiene tope.
              </p>
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-secondary)' }}>
                  <span>Sesiones usadas</span>
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {quota.used} de {quota.limit}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 4 }} aria-hidden>
                  {Array.from({ length: quota.limit }, (_, i) => (
                    <i
                      key={i}
                      style={{
                        flex: 1,
                        height: 6,
                        borderRadius: 3,
                        background: i < quota.used ? 'var(--ok)' : 'var(--border)',
                      }}
                    />
                  ))}
                </div>
              </>
            )}
          </section>

          <section className="panel-card" style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <h2>Asistencia</h2>
              <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>últimas 8</span>
            </div>
            {attendances.length === 0 ? (
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
                Se inscribió pero todavía no ha marcado ninguna vez.
              </p>
            ) : (
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 7 }}>
                {attendances.slice(0, 8).map((marca) => (
                  <li
                    key={marca.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '9px 11px',
                      borderRadius: 'var(--r-md)',
                      background: 'var(--surface-high)',
                      fontSize: 13,
                    }}
                  >
                    <span style={{ flexGrow: 1 }}>{formatDateTime(marca.checkedInAt)}</span>
                    {/* `overrodeDenial` se enseña a propósito: es el rastro de
                        cuántas excepciones hace cada recepcionista, y un flag de
                        auditoría que solo vive en la base no audita nada. */}
                    {marca.overrodeDenial ? (
                      <span style={{ fontSize: 11, color: 'var(--warn)', fontWeight: 700 }}>
                        excepción
                      </span>
                    ) : null}
                    {marca.method === 'manual' ? (
                      <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>a mano</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </PanelShell>
  );
}
