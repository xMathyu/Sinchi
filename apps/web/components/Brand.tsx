/** La geometría de la marca. SVG y no imagen: escala y se recolorea. */
export function Logo({ size = 28, color = 'var(--ink)' }: { readonly size?: number; readonly color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" style={{ flex: 'none' }} aria-hidden>
      <path d="M32 6 L54 52 L32 41 L10 52 Z" fill={color} />
      <path d="M32 41 L32 24" stroke="var(--canvas)" strokeWidth={5} />
    </svg>
  );
}

/**
 * Marco de teléfono.
 *
 * Sin barra de estado dibujada: en un móvil real la pinta el sistema encima, y
 * una falsa se ve doblada.
 */
export function Phone({
  children,
  background = 'var(--screen)',
  className,
}: {
  readonly children: React.ReactNode;
  readonly background?: string;
  /** Para que quien lo coloca decida si flota, si hace paralaje o si no se mueve. */
  readonly className?: string;
}) {
  return (
    <div
      className={className === undefined ? 'phone-shell' : `phone-shell ${className}`}
      style={{
        width: 258,
        flex: 'none',
        borderRadius: 34,
        border: '8px solid var(--surface-high)',
        background,
        overflow: 'hidden',
      }}
    >
      {children}
    </div>
  );
}
