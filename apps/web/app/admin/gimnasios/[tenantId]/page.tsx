/**
 * Un gimnasio, entero.
 *
 * Es la pantalla donde se responde «¿qué pasa con este local?» sin abrir la
 * consola de Neon: quién trabaja ahí, qué planes vende, cuánto cobra, qué nos
 * pagó y qué se le ha hecho desde este panel.
 *
 * El orden de la página es el orden del riesgo: primero lo que se mira, después
 * lo que se edita, y al final —separado y en rojo— lo que no tiene vuelta. Un
 * botón de eliminar al lado de uno de guardar es un accidente esperando.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { platformActionLabel, planShape, isIrreversibleAction } from '@sinchi/shared';
import { AdminShell } from '../../../../components/admin/Shell';
import { GymStatusChip, Row, SaasChip } from '../../../../components/admin/Pieces';
import {
  GymDeleteForm,
  GymEditForm,
  GymPaymentForm,
  GymSuspendForm,
} from '../../../../components/admin/GymForms';
import { Empty, SectionHeader } from '../../../../components/panel/Pieces';
import { ApiError, adminApi } from '../../../../src/admin/api';
import { requireAdmin } from '../../../../src/admin/session';
import { RAIL_LABEL, formatDateTime, soles, solesExactos } from '../../../../src/panel/format';
import type { WireAction, WireGymDetail } from '../../../../src/admin/types';
import type { PaymentRail, PlanType } from '@sinchi/shared';

export const dynamic = 'force-dynamic';

export default async function GimnasioPage({
  params,
}: {
  readonly params: Promise<{ readonly tenantId: string }>;
}) {
  const { tenantId } = await params;
  const session = await requireAdmin();

  let gym: WireGymDetail;
  try {
    gym = await adminApi<WireGymDetail>(`/admin/gyms/${tenantId}`);
  } catch (error) {
    // Un gimnasio borrado —quizá desde esta misma pantalla, hace un momento— es
    // un 404 y no una pantalla rota.
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const actions = await adminApi<readonly WireAction[]>(
    `/admin/actions?tenantId=${tenantId}&limit=30`,
  );

  return (
    <AdminShell email={session.email}>
      <SectionHeader
        eyebrow={
          <>
            <Link href="/admin/gimnasios" style={{ color: 'inherit' }}>
              ← Gimnasios
            </Link>
            {` · ${gym.slug}`}
          </>
        }
        title={gym.name}
        action={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <SaasChip status={gym.saas.status} />
            <GymStatusChip status={gym.status} />
          </div>
        }
      />

      <div className="panel-grid" style={{ marginBottom: 14 }}>
        <Stat label="alumnos activos" value={String(gym.stats.activeMembers)} />
        <Stat
          label="cobrado en 30 días"
          value={soles(gym.stats.collectedLast30Cents)}
          color="var(--ok)"
        />
        <Stat label="marcas en 30 días" value={String(gym.stats.checkInsLast30)} />
        <Stat
          label="conversaciones abiertas"
          value={String(gym.stats.openConversations)}
          color={gym.stats.openConversations > 0 ? 'var(--warn)' : undefined}
        />
      </div>

      <div className="admin-split">
        {/* La ficha */}
        <section className="panel-card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2>La cuenta</h2>
          <table className="panel-table">
            <tbody>
              <Row label="Suscripción">{gym.saas.notice}</Row>
              <Row label="Escalón">
                {gym.saas.tierLabel} · {soles(gym.saas.priceCents)}/mes
              </Row>
              <Row label="Gratis hasta">{gym.saas.freeUntil}</Row>
              <Row label="Próximo cobro">{gym.saas.nextBillingDate}</Row>
              <Row label="Puede escribir">{gym.saas.canWrite ? 'Sí' : 'No (solo lectura)'}</Row>
              <Row label="Sale en el directorio">{gym.saas.listed ? 'Sí' : 'No'}</Row>
              <Row label="Alta">{gym.createdAt.slice(0, 10)}</Row>
              <Row label="Zona horaria">{gym.timezone}</Row>
              <Row label="RUC">{gym.taxId ?? '—'}</Row>
              <Row label="Dirección">{gym.address ?? '—'}</Row>
            </tbody>
          </table>
        </section>

        {/* Quién trabaja ahí */}
        <section className="panel-card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2>El equipo del local</h2>
          {gym.staff.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
              Nadie. Un gimnasio sin staff no puede abrir la puerta: algo pasó en su alta.
            </p>
          ) : (
            <table className="panel-table">
              <tbody>
                {gym.staff.map((persona) => (
                  <tr key={persona.id}>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span style={{ fontWeight: 600 }}>{persona.name}</span>
                        <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                          {persona.email ?? persona.phone}
                        </span>
                      </div>
                    </td>
                    <td style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>
                      {persona.role === 'owner' ? 'Dueño' : 'Recepción'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h2 style={{ marginTop: 6 }}>Lo que vende</h2>
          {gym.planList.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
              Todavía no escribió ningún plan. Sin planes no puede inscribir a nadie.
            </p>
          ) : (
            <table className="panel-table">
              <tbody>
                {gym.planList.map((plan) => (
                  <tr key={plan.id}>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span style={{ fontWeight: 600 }}>{plan.name}</span>
                        <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                          {planShape({ type: plan.type as PlanType, sessionsPerWeek: null })}
                          {plan.active ? '' : ' · ya no se vende'}
                        </span>
                      </div>
                    </td>
                    <td className="num">{solesExactos(plan.priceCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      {/* Lo que nos pagó */}
      <section className="panel-card" style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2>Lo que le pagó a Sinchi</h2>
        <div className="admin-split">
          <div>
            {gym.saasCharges.length === 0 ? (
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
                Todavía nada. Está en su mes gratis o en el plan gratis.
              </p>
            ) : (
              <table className="panel-table">
                <thead>
                  <tr>
                    <th>Periodo</th>
                    <th>Medio</th>
                    <th>Operación</th>
                    <th className="num">Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {gym.saasCharges.map((charge) => (
                    <tr key={`${charge.periodStart}-${charge.createdAt}`}>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {charge.periodStart} → {charge.periodEnd}
                      </td>
                      <td>{RAIL_LABEL[charge.rail as PaymentRail] ?? charge.rail}</td>
                      <td style={{ color: 'var(--text-tertiary)' }}>{charge.reference ?? '—'}</td>
                      <td className="num">{solesExactos(charge.amountCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {gym.redemptions.length === 0 ? null : (
              <p style={{ margin: '12px 0 0', fontSize: 12.5, color: 'var(--text-tertiary)' }}>
                Canjeó{' '}
                {gym.redemptions
                  .map((r) => `${r.code} (${r.freeMonths} mes${r.freeMonths === 1 ? '' : 'es'})`)
                  .join(', ')}
                .
              </p>
            )}
          </div>

          <GymPaymentForm gym={gym} />
        </div>
      </section>

      {/* Editar */}
      <section className="panel-card" style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h2>Editar</h2>
        <GymEditForm gym={gym} />
      </section>

      {/* Suspender */}
      <section className="panel-card" style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2>{gym.status === 'suspended' ? 'Está fuera de Sinchi' : 'Sacar de Sinchi'}</h2>
        <GymSuspendForm gym={gym} />
      </section>

      {/* El registro de este gimnasio */}
      <section className="panel-card" style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2>Qué se le ha hecho desde aquí</h2>
        {actions.length === 0 ? (
          <Empty title="Nada todavía" body="Nadie ha tocado este gimnasio desde el panel." />
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
        <GymDeleteForm gym={gym} />
      </div>
    </AdminShell>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  readonly label: string;
  readonly value: string;
  // `| undefined` explícito: con `exactOptionalPropertyTypes`, pasar
  // `color={undefined}` desde una expresión condicional no es lo mismo que
  // omitir la prop, y omitirla obligaría a repartir el `<Stat>` en dos ramas.
  readonly color?: string | undefined;
}) {
  return (
    <div className="panel-card panel-stat">
      <b style={color === undefined ? undefined : { color }}>{value}</b>
      <span>{label}</span>
    </div>
  );
}
