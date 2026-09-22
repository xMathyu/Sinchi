/**
 * La ficha de una persona, entera.
 *
 * Responde «¿quién es y qué hace en Sinchi?» sin abrir la base: en qué
 * gimnasios está y si viene a entrenar, dónde trabaja, qué dejó en el
 * directorio, si pidió la baja, si estuvo baneada y qué se le ha hecho desde
 * este panel.
 *
 * El orden es el del riesgo, igual que en un gimnasio: primero lo que se mira,
 * después corregir, banear —que se deshace— y al final, en rojo y separado,
 * eliminar, que no.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { platformActionLabel, isIrreversibleAction } from '@sinchi/shared';
import { AdminShell } from '../../../../components/admin/Shell';
import { Row } from '../../../../components/admin/Pieces';
import {
  PersonBanForm,
  PersonDeleteForm,
  PersonEditForm,
} from '../../../../components/admin/PersonForms';
import { Empty, SectionHeader } from '../../../../components/panel/Pieces';
import { ApiError, adminApi } from '../../../../src/admin/api';
import { requireAdmin } from '../../../../src/admin/session';
import { formatDateTime } from '../../../../src/panel/format';
import type { WireAction, WireIdentityDetail } from '../../../../src/admin/types';

export const dynamic = 'force-dynamic';

export default async function PersonaPage({
  params,
}: {
  readonly params: Promise<{ readonly userId: string }>;
}) {
  const { userId } = await params;
  const session = await requireAdmin();

  let person: WireIdentityDetail;
  try {
    person = await adminApi<WireIdentityDetail>(`/admin/people/${userId}`);
  } catch (error) {
    // Eliminada —quizá desde esta misma pantalla— o un id que no es uuid.
    if (error instanceof ApiError && (error.status === 404 || error.status === 400)) notFound();
    throw error;
  }

  const actions = await adminApi<readonly WireAction[]>(
    `/admin/actions?subject=${userId}&limit=30`,
  );
  const pendiente = person.deletionRequests.find((request) => request.status === 'pending');

  return (
    <AdminShell email={session.email}>
      <SectionHeader
        eyebrow={
          <>
            <Link href="/admin/usuarios" style={{ color: 'inherit' }}>
              ← Usuarios
            </Link>
            {' · con ficha'}
          </>
        }
        title={person.name}
      />

      {pendiente === undefined ? null : (
        <p className="panel-alert bad" role="status" style={{ marginBottom: 14 }}>
          <strong aria-hidden>!</strong>
          <span>
            Pidió la baja el {pendiente.requestedAt.slice(0, 10)}
            {pendiente.reason === null ? '' : ` («${pendiente.reason}»)`}.{' '}
            {pendiente.daysLeft !== null && pendiente.daysLeft < 0
              ? `El plazo de 30 días venció hace ${-pendiente.daysLeft} días.`
              : `Quedan ${pendiente.daysLeft ?? 30} días del plazo prometido.`}{' '}
            Se ejecuta abajo, en «Eliminar esta cuenta».
          </span>
        </p>
      )}

      <div className="admin-split">
        <section className="panel-card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2>Quién es</h2>
          <table className="panel-table">
            <tbody>
              <Row label="Documento">{person.documentId}</Row>
              <Row label="Celular">{person.phone}</Row>
              <Row label="Correo">{person.email ?? '—'}</Row>
              <Row label="Tiene la app">{person.firebaseUid === null ? 'No, nunca entró' : 'Sí'}</Row>
              <Row label="En Sinchi desde">{person.createdAt.slice(0, 10)}</Row>
              <Row label="Reservas desde el directorio">{String(person.footprint.bookings)}</Row>
              <Row label="Conversaciones con gimnasios">{String(person.footprint.conversations)}</Row>
              <Row label="Inscripciones a eventos">{String(person.footprint.eventRegistrations)}</Row>
            </tbody>
          </table>
        </section>

        <section className="panel-card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2>Sus gimnasios</h2>
          {person.memberships.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
              No está en el padrón de ningún gimnasio.
            </p>
          ) : (
            <table className="panel-table">
              <tbody>
                {person.memberships.map((membership) => (
                  <tr key={membership.id}>
                    <td>
                      <Link
                        href={`/admin/gimnasios/${membership.tenantId}`}
                        style={{ fontWeight: 600, color: 'var(--ink)' }}
                      >
                        {membership.tenantName}
                      </Link>
                      <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                        desde {membership.since.slice(0, 10)}
                      </div>
                    </td>
                    <td className="num" style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                      {membership.checkIns} marca{membership.checkIns === 1 ? '' : 's'}
                      <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                        {membership.lastCheckInAt === null
                          ? 'nunca vino'
                          : `la última ${formatDateTime(membership.lastCheckInAt)}`}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {person.staff.length === 0 ? null : (
            <>
              <h2 style={{ marginTop: 6 }}>Trabaja en</h2>
              <table className="panel-table">
                <tbody>
                  {person.staff.map((post) => (
                    <tr key={post.tenantId}>
                      <td>
                        <Link
                          href={`/admin/gimnasios/${post.tenantId}`}
                          style={{ fontWeight: 600, color: 'var(--ink)' }}
                        >
                          {post.tenantName}
                        </Link>
                      </td>
                      <td style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>
                        {post.role === 'owner' ? 'Dueño' : 'Recepción'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>
      </div>

      <section className="panel-card" style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h2>Corregir sus datos</h2>
        <PersonEditForm person={person} />
      </section>

      <section className="panel-card" style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2>Banear</h2>
        <PersonBanForm
          kind="identity"
          id={person.id}
          bans={person.bans}
          staffOf={person.staff.map((post) => post.tenantName)}
        />
      </section>

      <section className="panel-card" style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2>Qué se le ha hecho desde aquí</h2>
        {actions.length === 0 ? (
          <Empty title="Nada todavía" body="Nadie ha tocado a esta persona desde el panel." />
        ) : (
          <ul className="admin-log">
            {actions.map((action) => (
              <li key={action.id} data-irreversible={isIrreversibleAction(action.action)}>
                <span style={{ color: 'var(--text-secondary)' }}>{action.adminEmail}</span>
                <strong style={{ fontWeight: 600 }}>{platformActionLabel(action.action)}</strong>
                {action.reason === null ? null : (
                  <span style={{ color: 'var(--text-tertiary)' }}>«{action.reason}»</span>
                )}
                <time dateTime={action.createdAt}>{formatDateTime(action.createdAt)}</time>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div style={{ marginTop: 22 }}>
        <PersonDeleteForm
          kind="identity"
          id={person.id}
          confirmationKey={person.confirmationKey}
          staffOf={person.staff.map((post) => post.tenantName)}
          firebaseUid={person.firebaseUid}
          what={`Se van su ficha en ${person.memberships.length} gimnasio${person.memberships.length === 1 ? '' : 's'}, su historial de asistencias, sus reservas, sus conversaciones y su cuenta. Se quedan sus pagos en la caja de cada gimnasio, sin su nombre.`}
        />
      </div>
    </AdminShell>
  );
}
