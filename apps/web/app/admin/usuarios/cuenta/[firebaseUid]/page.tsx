/**
 * Una cuenta SIN ficha: alguien que entró a la app con Google y no está en el
 * padrón de ningún gimnasio.
 *
 * Tiene menos que una ficha —ni documento, ni gimnasios, ni caja— y por eso no
 * se corrige desde aquí: sus datos son los que escribió al registrarse, y los
 * corrige ella volviendo a entrar (decisiones §15). Lo que sí se hace es
 * banearla —es la que reserva clases falsas y escribe a los gimnasios desde el
 * directorio— o eliminarla.
 *
 * Si la cuenta ya abrió una ficha, la api responde 409 con la ficha, y aquí se
 * redirige a ella: lo que se hiciera desde esta pantalla la dejaría intacta.
 */
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { platformActionLabel, isIrreversibleAction } from '@sinchi/shared';
import { AdminShell } from '../../../../../components/admin/Shell';
import { Row } from '../../../../../components/admin/Pieces';
import { PersonBanForm, PersonDeleteForm } from '../../../../../components/admin/PersonForms';
import { Empty, SectionHeader } from '../../../../../components/panel/Pieces';
import { ApiError, adminApi } from '../../../../../src/admin/api';
import { requireAdmin } from '../../../../../src/admin/session';
import { formatDateTime } from '../../../../../src/panel/format';
import type { WireAccountDetail, WireAction } from '../../../../../src/admin/types';

export const dynamic = 'force-dynamic';

export default async function CuentaPage({
  params,
}: {
  readonly params: Promise<{ readonly firebaseUid: string }>;
}) {
  const { firebaseUid } = await params;
  const session = await requireAdmin();

  let account: WireAccountDetail;
  try {
    account = await adminApi<WireAccountDetail>(`/admin/accounts/${firebaseUid}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      const userId = (error.body as { userId?: unknown } | null)?.userId;
      if (typeof userId === 'string') redirect(`/admin/usuarios/${userId}`);
    }
    if (error instanceof ApiError && (error.status === 404 || error.status === 400)) notFound();
    throw error;
  }

  const actions = await adminApi<readonly WireAction[]>(
    `/admin/actions?subject=${encodeURIComponent(firebaseUid)}&limit=30`,
  );

  return (
    <AdminShell email={session.email}>
      <SectionHeader
        eyebrow={
          <>
            <Link href="/admin/usuarios?kind=account" style={{ color: 'inherit' }}>
              ← Usuarios
            </Link>
            {' · sin ficha'}
          </>
        }
        title={account.name ?? account.email ?? 'Cuenta sin nombre'}
      />

      <section className="panel-card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2>Quién es</h2>
        <table className="panel-table">
          <tbody>
            <Row label="Correo de Google">{account.email ?? '—'}</Row>
            <Row label="Celular que dio">{account.phone ?? '—'}</Row>
            <Row label="Entró por primera vez">{account.createdAt.slice(0, 10)}</Row>
            <Row label="Reservas desde el directorio">{String(account.footprint.bookings)}</Row>
            <Row label="Conversaciones con gimnasios">{String(account.footprint.conversations)}</Row>
            <Row label="Inscripciones a eventos">{String(account.footprint.eventRegistrations)}</Row>
            <Row label="uid de Firebase">
              <code style={{ fontSize: 12 }}>{account.id}</code>
            </Row>
          </tbody>
        </table>
      </section>

      <section className="panel-card" style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2>Banear</h2>
        <PersonBanForm kind="account" id={account.id} bans={account.bans} staffOf={[]} />
      </section>

      <section className="panel-card" style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2>Qué se le ha hecho desde aquí</h2>
        {actions.length === 0 ? (
          <Empty title="Nada todavía" body="Nadie ha tocado esta cuenta desde el panel." />
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
          kind="account"
          id={account.id}
          confirmationKey={account.confirmationKey}
          staffOf={[]}
          firebaseUid={account.id}
          what="Se van sus reservas desde el directorio, sus conversaciones con los gimnasios y su cuenta."
        />
      </div>
    </AdminShell>
  );
}
