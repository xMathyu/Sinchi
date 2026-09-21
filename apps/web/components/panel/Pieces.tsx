/**
 * Las piezas que se repiten en más de una pantalla del panel.
 *
 * Sin `'use client'`: son funciones que devuelven HTML y nada más, así que
 * viajan renderizadas y no cuestan JavaScript en el navegador. En cuanto una
 * necesite estado, se saca a su propio archivo de cliente en vez de marcar todo
 * el fichero — marcarlo entero arrastraría a las demás.
 */
import { semaphoreColor } from './semaphore';
import type { AccessLevel } from '@sinchi/shared';

export function Stat({
  value,
  caption,
  color,
  hint,
}: {
  readonly value: string;
  readonly caption: string;
  // `| undefined` explícito: con `exactOptionalPropertyTypes`, pasar
  // `color={undefined}` no es lo mismo que omitir la prop, y omitirla desde una
  // expresión condicional obliga a repartir el `<Stat>` en dos ramas.
  readonly color?: string | undefined;
  readonly hint?: string | undefined;
}) {
  return (
    <div className="panel-card panel-stat">
      <b style={color === undefined ? undefined : { color }}>{value}</b>
      <span>{caption}</span>
      {hint === undefined ? null : (
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{hint}</span>
      )}
    </div>
  );
}

/**
 * El semáforo de un alumno.
 *
 * Siempre con su palabra al lado, nunca el color a secas: es la mitad de la
 * decisión de accesibilidad que este producto sí conserva (decisiones §17).
 * Quien no distingue verde de rojo opera leyendo.
 */
export function LevelChip({ level, label }: { readonly level: AccessLevel; readonly label: string }) {
  const color = semaphoreColor(level);

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

export function Empty({ title, body }: { readonly title: string; readonly body: string }) {
  return (
    <div className="panel-card panel-empty">
      <strong style={{ color: 'var(--ink)', fontSize: 15 }}>{title}</strong>
      <p style={{ margin: 0, maxWidth: 420 }}>{body}</p>
    </div>
  );
}

/**
 * Un aviso con su motivo.
 *
 * Se niega a pintarse SIN mensaje, y eso no es paranoia: un `IDLE` que llegaba
 * mal al cliente dejaba un recuadro rojo vacío en la primera carga del login, con
 * su aspa y sin una palabra. Alarma sin decir de qué, que es peor que no avisar
 * — y un `=== null` en cada pantalla no protege de un `undefined`. El único sitio
 * por donde pasan todos los avisos es este, así que la comprobación vive aquí.
 */
export function Alert({ kind, children }: { readonly kind: 'bad' | 'ok'; readonly children: React.ReactNode }) {
  if (children === null || children === undefined || children === '') return null;

  return (
    <p className={`panel-alert ${kind}`} role={kind === 'bad' ? 'alert' : 'status'}>
      <strong aria-hidden>{kind === 'bad' ? '✕' : '✓'}</strong>
      <span>{children}</span>
    </p>
  );
}

export function SectionHeader({
  eyebrow,
  title,
  action,
}: {
  readonly eyebrow?: string;
  readonly title: string;
  readonly action?: React.ReactNode;
}) {
  return (
    <header
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
        gap: 16,
        flexWrap: 'wrap',
        marginBottom: 18,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {eyebrow === undefined ? null : <span className="panel-eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
      </div>
      {action}
    </header>
  );
}
