/**
 * Las piezas del panel de Sinchi que se repiten en más de una pantalla.
 *
 * Sin `'use client'`: son funciones que devuelven HTML, así que viajan
 * renderizadas y no cuestan JavaScript en el navegador. Lo que necesita estado
 * vive en `GymForms`, `PromoForms` y `TeamForms`, que sí son de cliente.
 */
import type { SaasStatus } from '@sinchi/shared';

/**
 * Cómo se lee cada estado de la suscripción, y de qué color.
 *
 * Siempre con la palabra al lado, nunca el color a secas: es la decisión de
 * accesibilidad que este producto conserva (decisiones §17). Quien no distingue
 * verde de rojo opera leyendo — y aquí lo que se lee decide si se le corta el
 * servicio a un negocio.
 */
const SAAS: Readonly<Record<SaasStatus, { readonly label: string; readonly color: string }>> = {
  free: { label: 'Plan gratis', color: 'var(--text-secondary)' },
  trialing: { label: 'Mes gratis', color: 'var(--ok)' },
  active: { label: 'Al día', color: 'var(--ok)' },
  in_grace: { label: 'En gracia', color: 'var(--warn)' },
  read_only: { label: 'Solo lectura', color: 'var(--bad)' },
  canceled: { label: 'Cancelado', color: 'var(--text-tertiary)' },
};

export function SaasChip({ status }: { readonly status: SaasStatus }) {
  const { label, color } = SAAS[status];

  return (
    <span
      className="panel-chip"
      style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}
    >
      <i className="panel-dot" style={{ background: color }} aria-hidden />
      {label}
    </span>
  );
}

/**
 * Si el gimnasio sigue en Sinchi.
 *
 * Aparte del estado de la suscripción a propósito: son dos cosas distintas que
 * se confunden fácil. Un gimnasio puede estar «al día» y suspendido —le pagamos
 * la cuenta y lo echamos por otra cosa— y uno «en solo lectura» sigue siendo un
 * cliente al que queremos de vuelta.
 */
export function GymStatusChip({ status }: { readonly status: 'active' | 'suspended' }) {
  if (status === 'active') return null;

  return (
    <span
      className="panel-chip"
      style={{
        background: 'color-mix(in srgb, var(--bad) 16%, transparent)',
        color: 'var(--bad)',
      }}
    >
      <i className="panel-dot" style={{ background: 'var(--bad)' }} aria-hidden />
      Suspendido
    </span>
  );
}

/** Una fila de «etiqueta / valor» para las fichas de detalle. */
export function Row({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <tr>
      <td style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{label}</td>
      <td style={{ textAlign: 'right' }}>{children}</td>
    </tr>
  );
}
