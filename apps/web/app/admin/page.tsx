/**
 * El resumen de la red.
 *
 * Es la pantalla que responde «¿cómo va Sinchi?» de un vistazo: cuántos locales
 * hay, cuántos pagan, cuánto entraría si todos pagaran hoy, y qué se ha tocado
 * desde aquí últimamente.
 *
 * Server Component: los datos llegan pintados y el navegador no carga ningún
 * cliente de api. Las dos peticiones van en paralelo — en serie serían dos
 * viajes a Cloud Run sumados, y el primero paga además el arranque en frío.
 */
import Link from 'next/link';
import { platformActionLabel, isIrreversibleAction } from '@sinchi/shared';
import { AdminShell } from '../../components/admin/Shell';
import { Empty, SectionHeader, Stat } from '../../components/panel/Pieces';
import { adminApi } from '../../src/admin/api';
import { requireAdmin } from '../../src/admin/session';
import { formatDateTime, soles } from '../../src/panel/format';
import type { WireAction, WireOverview } from '../../src/admin/types';

export const dynamic = 'force-dynamic';

export default async function ResumenPage() {
  const session = await requireAdmin();

  const [overview, actions] = await Promise.all([
    adminApi<WireOverview>('/admin/overview'),
    adminApi<readonly WireAction[]>('/admin/actions?limit=15'),
  ]);

  /**
   * Los que pagan de verdad. El escalón gratis y el mes de regalo no cuentan:
   * son locales sostenidos, no clientes, y mezclarlos es cómo se acaba creyendo
   * que el negocio va mejor de lo que va.
   */
  const pagando = overview.saas.active;

  return (
    <AdminShell email={session.email}>
      <SectionHeader
        eyebrow={`${overview.gyms.total} gimnasios · ${overview.people.admins} con acceso al panel`}
        title="La red"
        action={
          <Link href="/admin/gimnasios" className="panel-btn ghost">
            Ver gimnasios
          </Link>
        }
      />

      <div className="panel-grid" style={{ marginBottom: 14 }}>
        <Stat
          value={String(overview.gyms.active)}
          caption="gimnasios activos"
          hint={
            overview.gyms.suspended === 0
              ? 'ninguno suspendido'
              : `${overview.gyms.suspended} suspendido${overview.gyms.suspended === 1 ? '' : 's'}`
          }
          color={overview.gyms.suspended > 0 ? 'var(--warn)' : undefined}
        />
        <Stat
          value={soles(overview.saas.monthlyRunRateCents)}
          caption="al mes si todos pagaran"
          hint={`${pagando} pagando hoy`}
          color="var(--ok)"
        />
        <Stat
          value={soles(overview.saas.collectedLast30Cents)}
          caption="cobrado en 30 días"
          hint="lo que los gimnasios le pagaron a Sinchi"
        />
        <Stat value={String(overview.network.activeMembers)} caption="alumnos en la red" />
      </div>

      <div className="admin-split">
        {/* Cómo está cada gimnasio con su suscripción */}
        <section className="panel-card" style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
          <h2>Suscripciones a Sinchi</h2>

          <table className="panel-table">
            <tbody>
              {[
                { label: 'Plan gratis (hasta 10 alumnos)', value: overview.saas.free },
                { label: 'En su mes gratis', value: overview.saas.trialing },
                { label: 'Al día', value: overview.saas.active, color: 'var(--ok)' },
                { label: 'En gracia', value: overview.saas.inGrace, color: 'var(--warn)' },
                { label: 'En solo lectura', value: overview.saas.readOnly, color: 'var(--bad)' },
                { label: 'Cancelados', value: overview.saas.canceled },
              ].map((fila) => (
                <tr key={fila.label}>
                  <td style={{ color: 'var(--text-secondary)' }}>{fila.label}</td>
                  <td className="num" style={fila.color === undefined ? undefined : { color: fila.color }}>
                    <b>{fila.value}</b>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <p style={{ margin: 0, fontSize: 12.5, lineHeight: '19px', color: 'var(--text-tertiary)' }}>
            Un gimnasio en solo lectura sigue marcando la puerta: no se le corta a sus alumnos.
            Lo que pierde es dar de alta, cobrar y salir en el directorio.
          </p>
        </section>

        {/* La gente */}
        <section className="panel-card" style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
          <h2>Gente</h2>

          <table className="panel-table">
            <tbody>
              <tr>
                <td style={{ color: 'var(--text-secondary)' }}>Identidades con ficha</td>
                <td className="num">
                  <b>{overview.people.users}</b>
                </td>
              </tr>
              <tr>
                <td style={{ color: 'var(--text-secondary)' }}>Cuentas sin ficha todavía</td>
                <td className="num">
                  <b>{overview.people.unlinkedAccounts}</b>
                </td>
              </tr>
              <tr>
                <td style={{ color: 'var(--text-secondary)' }}>Marcaron en 30 días</td>
                <td className="num">
                  <b>{overview.network.checkInsLast30}</b>
                </td>
              </tr>
              <tr>
                <td style={{ color: 'var(--text-secondary)' }}>Cobrado por los gimnasios (30 días)</td>
                <td className="num">
                  <b>{soles(overview.network.collectedLast30Cents)}</b>
                </td>
              </tr>
              <tr>
                <td style={{ color: 'var(--text-secondary)' }}>Gimnasios nuevos (30 días)</td>
                <td className="num">
                  <b>{overview.gyms.newLast30}</b>
                </td>
              </tr>
            </tbody>
          </table>

          <p style={{ margin: 0, fontSize: 12.5, lineHeight: '19px', color: 'var(--text-tertiary)' }}>
            «Cuentas sin ficha» son personas que se registraron en la app y todavía no entrenan en
            ningún lado: es el embudo del directorio.
          </p>
        </section>
      </div>

      {/* El registro */}
      <section className="panel-card" style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 13 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h2>Lo último que se hizo desde aquí</h2>
          <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>últimos 15</span>
        </div>

        {actions.length === 0 ? (
          <Empty
            title="Todavía no se ha tocado nada"
            body="Cada edición, suspensión y código creado desde este panel queda anotado con quién lo hizo."
          />
        ) : (
          <ul className="admin-log">
            {actions.map((action) => (
              <li key={action.id} data-irreversible={isIrreversibleAction(action.action)}>
                <span style={{ color: 'var(--text-secondary)' }}>{action.adminEmail}</span>
                <strong style={{ fontWeight: 600 }}>{platformActionLabel(action.action)}</strong>
                {action.subject === null ? null : (
                  <span style={{ color: 'var(--text-secondary)' }}>
                    {action.tenantId === null ? (
                      action.subject
                    ) : (
                      <Link href={`/admin/gimnasios/${action.tenantId}`} style={{ color: 'inherit' }}>
                        {action.subject}
                      </Link>
                    )}
                  </span>
                )}
                <time dateTime={action.createdAt}>{formatDateTime(action.createdAt)}</time>
              </li>
            ))}
          </ul>
        )}
      </section>
    </AdminShell>
  );
}
