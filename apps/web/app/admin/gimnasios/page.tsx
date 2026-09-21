/**
 * Todos los gimnasios de la red.
 *
 * Una tabla y no fichas: lo que se hace aquí es comparar —quién no paga, quién
 * creció, quién lleva dos meses sin que nadie marque— y para comparar hacen
 * falta columnas alineadas, no tarjetas bonitas una debajo de otra.
 *
 * Los suspendidos NO se esconden ni se mandan al final. Un gimnasio suspendido
 * es justo el que hay que volver a mirar: o se reactiva, o se elimina.
 */
import Link from 'next/link';
import { AdminShell } from '../../../components/admin/Shell';
import { GymStatusChip, SaasChip } from '../../../components/admin/Pieces';
import { Empty, SectionHeader } from '../../../components/panel/Pieces';
import { adminApi } from '../../../src/admin/api';
import { requireAdmin } from '../../../src/admin/session';
import { soles } from '../../../src/panel/format';
import type { WireGymRow } from '../../../src/admin/types';

export const dynamic = 'force-dynamic';

export default async function GimnasiosPage() {
  const session = await requireAdmin();
  const gyms = await adminApi<readonly WireGymRow[]>('/admin/gyms');

  const suspendidos = gyms.filter((gym) => gym.status === 'suspended').length;

  return (
    <AdminShell email={session.email}>
      <SectionHeader
        eyebrow={
          suspendidos === 0
            ? `${gyms.length} en total`
            : `${gyms.length} en total · ${suspendidos} suspendido${suspendidos === 1 ? '' : 's'}`
        }
        title="Gimnasios"
      />

      {gyms.length === 0 ? (
        <Empty
          title="Todavía no hay ningún gimnasio"
          body="Los locales se dan de alta solos desde la app. Aquí aparecen en cuanto lo hacen."
        />
      ) : (
        <div className="panel-card panel-scroll">
          <table className="panel-table">
            <thead>
              <tr>
                <th>Gimnasio</th>
                <th>Suscripción</th>
                <th className="num">Alumnos</th>
                <th className="num">Cobrado 30 d</th>
                <th className="num">Marcas 30 d</th>
                <th className="num">Próximo cobro</th>
              </tr>
            </thead>
            <tbody>
              {gyms.map((gym) => (
                <tr key={gym.id}>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <Link
                        href={`/admin/gimnasios/${gym.id}`}
                        style={{ fontWeight: 600, color: 'var(--ink)' }}
                      >
                        {gym.name}
                      </Link>
                      <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                        {gym.slug}
                      </span>
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <SaasChip status={gym.saas.status} />
                      <GymStatusChip status={gym.status} />
                      {/* Fuera del directorio sin estar suspendido: es el corte
                          por impago, y se dice porque explica por qué a ese
                          local dejaron de llegarle interesados. */}
                      {gym.saas.listed || gym.status === 'suspended' ? null : (
                        <span
                          className="panel-chip"
                          style={{
                            background: 'color-mix(in srgb, var(--warn) 14%, transparent)',
                            color: 'var(--warn)',
                          }}
                        >
                          Fuera del directorio
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="num">
                    {gym.stats.activeMembers}
                    {gym.stats.delinquentMembers === 0 ? null : (
                      <span style={{ color: 'var(--warn)', fontSize: 12 }}>
                        {' '}
                        ({gym.stats.delinquentMembers} deben)
                      </span>
                    )}
                  </td>
                  <td className="num">{soles(gym.stats.collectedLast30Cents)}</td>
                  <td className="num">{gym.stats.checkInsLast30}</td>
                  <td className="num" style={{ color: 'var(--text-secondary)' }}>
                    {gym.saas.nextBillingDate}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p
        style={{
          margin: '14px 0 0',
          fontSize: 12.5,
          lineHeight: '19px',
          color: 'var(--text-tertiary)',
          maxWidth: 620,
        }}
      >
        «Cobrado 30 d» es lo que el gimnasio le cobró a SUS alumnos, no lo que nos pagó a
        nosotros. Son treinta días hacia atrás y no el mes en curso, que es lo que dice el panel
        del dueño: dos pantallas con números parecidos y distintos es peor que dos preguntas
        distintas bien nombradas.
      </p>
    </AdminShell>
  );
}
