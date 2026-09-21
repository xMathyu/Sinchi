/**
 * Quién puede entrar aquí.
 *
 * La lista enseña también a los que ya no tienen acceso, apagados. No es
 * nostalgia: el registro de acciones apunta a esas filas, así que quien lea «lo
 * suspendió fulano» dentro de un año tiene que poder ver quién era fulano.
 */
import { AdminShell } from '../../../components/admin/Shell';
import { InviteForm, RevokeButton } from '../../../components/admin/TeamForms';
import { SectionHeader } from '../../../components/panel/Pieces';
import { adminApi } from '../../../src/admin/api';
import { requireAdmin } from '../../../src/admin/session';
import { formatDateTime } from '../../../src/panel/format';
import type { WireAdmin } from '../../../src/admin/types';

export const dynamic = 'force-dynamic';

export default async function EquipoPage() {
  const session = await requireAdmin();
  const admins = await adminApi<readonly WireAdmin[]>('/admin/admins');

  const vivos = admins.filter((admin) => admin.revokedAt === null);

  return (
    <AdminShell email={session.email}>
      <SectionHeader
        eyebrow={`${vivos.length} con acceso · ${admins.length - vivos.length} retirado${
          admins.length - vivos.length === 1 ? '' : 's'
        }`}
        title="Quién administra Sinchi"
      />

      <div className="admin-split">
        <InviteForm />

        <div className="panel-card panel-scroll">
          <table className="panel-table">
            <thead>
              <tr>
                <th>Persona</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {admins.map((admin) => (
                <tr key={admin.id} style={{ opacity: admin.revokedAt === null ? 1 : 0.6 }}>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <span style={{ fontWeight: 600 }}>
                        {admin.name ?? admin.email}
                        {admin.id === session.adminId ? (
                          <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}> · tú</span>
                        ) : null}
                      </span>
                      {admin.name === null ? null : (
                        <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                          {admin.email}
                        </span>
                      )}
                      {admin.invitedByEmail === null ? null : (
                        <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                          lo invitó {admin.invitedByEmail}
                        </span>
                      )}
                    </div>
                  </td>
                  <td>
                    {admin.revokedAt !== null ? (
                      <span style={{ fontSize: 13, color: 'var(--bad)' }}>
                        Acceso retirado el {admin.revokedAt.slice(0, 10)}
                      </span>
                    ) : admin.hasSignedIn ? (
                      <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                        {admin.lastSeenAt === null
                          ? 'Con acceso'
                          : `Entró ${formatDateTime(admin.lastSeenAt)}`}
                      </span>
                    ) : (
                      <span style={{ fontSize: 13, color: 'var(--warn)' }}>
                        Invitado, todavía no entra
                      </span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {admin.revokedAt !== null ? null : (
                      <RevokeButton
                        adminId={admin.id}
                        actingAdminId={session.adminId}
                        liveCount={vivos.length}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p
        style={{
          margin: '14px 0 0',
          fontSize: 12.5,
          lineHeight: '19px',
          color: 'var(--text-tertiary)',
          maxWidth: 620,
        }}
      >
        Quitarle el acceso a alguien corta también la sesión que tenga abierta ahora mismo: cada
        petición del panel vuelve a comprobar que siga vigente. Nadie puede quitarse su propio
        acceso ni dejar el panel sin ningún administrador — de eso último solo se sale escribiendo
        SQL contra la base.
      </p>
    </AdminShell>
  );
}
