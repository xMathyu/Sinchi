/**
 * Los códigos de promoción.
 *
 * Un código no descuenta el precio: mueve el mes gratis hacia adelante. Por eso
 * la columna que importa no es «cuánto vale» sino cuántos usos le quedan y quién
 * los gastó — que es la pregunta que se hace cuando una campaña no cuadra.
 *
 * Hasta ahora esto era `npm run saas:promo` y no había forma de saber quién
 * canjeó qué sin abrir la base.
 */
import { isPromoExpired, parsePlainDate, plainDateInZone, promoUsesLeft, TZ_LIMA } from '@sinchi/shared';
import { AdminShell } from '../../../components/admin/Shell';
import { PromoCreateForm, PromoToggle } from '../../../components/admin/PromoForms';
import { Empty, SectionHeader } from '../../../components/panel/Pieces';
import { adminApi } from '../../../src/admin/api';
import { requireAdmin } from '../../../src/admin/session';
import type { WirePromo } from '../../../src/admin/types';

export const dynamic = 'force-dynamic';

export default async function CodigosPage() {
  const session = await requireAdmin();
  const promos = await adminApi<readonly WirePromo[]>('/admin/promos');

  const hoy = plainDateInZone(new Date(), TZ_LIMA);
  const vivos = promos.filter((promo) => promo.active).length;

  return (
    <AdminShell email={session.email}>
      <SectionHeader
        eyebrow={`${promos.length} en total · ${vivos} encendido${vivos === 1 ? '' : 's'}`}
        title="Códigos"
      />

      <div className="admin-split">
        <PromoCreateForm />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {promos.length === 0 ? (
            <Empty
              title="Todavía no hay códigos"
              body="Un código mueve el mes gratis del gimnasio hacia adelante. No descuenta el precio."
            />
          ) : (
            promos.map((promo) => {
              const quedan = promoUsesLeft(promo);
              const vencido = isPromoExpired(
                promo.expiresOn === null ? null : parsePlainDate(promo.expiresOn),
                hoy,
              );

              return (
                <section
                  key={promo.id}
                  className="panel-card"
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                    // Apagado y no escondido: el código que ya no sirve tiene
                    // que encontrarse para entender por qué alguien no pudo
                    // canjearlo.
                    opacity: promo.active && !vencido ? 1 : 0.62,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <strong style={{ fontSize: 17, letterSpacing: '0.02em' }}>{promo.code}</strong>
                      <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                        {promo.freeMonths} mes{promo.freeMonths === 1 ? '' : 'es'} gratis ·{' '}
                        {quedan === null
                          ? `${promo.redeemedCount} usos, sin tope`
                          : `${promo.redeemedCount} de ${promo.maxRedemptions} usados`}
                      </span>
                      {promo.note === null ? null : (
                        <span style={{ fontSize: 12.5, color: 'var(--text-tertiary)' }}>
                          {promo.note}
                        </span>
                      )}
                    </div>

                    <PromoToggle promoId={promo.id} active={promo.active} />
                  </div>

                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {promo.active ? null : (
                      <span className="panel-chip" style={{ background: 'var(--surface-high)', color: 'var(--text-secondary)' }}>
                        Apagado
                      </span>
                    )}
                    {!vencido ? null : (
                      <span
                        className="panel-chip"
                        style={{
                          background: 'color-mix(in srgb, var(--warn) 14%, transparent)',
                          color: 'var(--warn)',
                        }}
                      >
                        Venció el {promo.expiresOn}
                      </span>
                    )}
                    {quedan !== 0 ? null : (
                      <span
                        className="panel-chip"
                        style={{
                          background: 'color-mix(in srgb, var(--bad) 14%, transparent)',
                          color: 'var(--bad)',
                        }}
                      >
                        Agotado
                      </span>
                    )}
                  </div>

                  {promo.redemptions.length === 0 ? (
                    <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-tertiary)' }}>
                      Nadie lo ha canjeado todavía.
                    </p>
                  ) : (
                    <ul className="admin-log">
                      {promo.redemptions.map((canje) => (
                        <li key={`${canje.tenantSlug}-${canje.createdAt}`}>
                          <span>{canje.tenantName}</span>
                          <span style={{ color: 'var(--text-tertiary)' }}>{canje.tenantSlug}</span>
                          <time dateTime={canje.createdAt}>{canje.createdAt.slice(0, 10)}</time>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })
          )}
        </div>
      </div>
    </AdminShell>
  );
}
