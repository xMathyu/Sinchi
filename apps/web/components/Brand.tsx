import { LOGO_BAR_PATH, LOGO_BAR_WIDTH, LOGO_OUTLINE_PATH, LOGO_VIEWBOX } from '@sinchi/ui';

/**
 * La marca.
 *
 * La geometría se IMPORTA de `@sinchi/ui`, no se dibuja aquí: es la misma punta
 * de lanza que renderiza el componente `Logo` de la app y de la que sale el
 * icono. Antes estaba copiada a ojo —un chevron distinto, con la barra en
 * vertical en vez de cruzada— y se notaba al poner la web al lado del teléfono.
 *
 * La barra va del color del FONDO, no de la marca: es una muesca que atraviesa
 * la punta, no una línea encima. Por eso quien lo coloca dice sobre qué está.
 */
export function Logo({
  size = 30,
  color = 'var(--ink)',
  barColor = 'var(--canvas)',
}: {
  readonly size?: number;
  readonly color?: string;
  readonly barColor?: string;
}) {
  return (
    <svg width={size} height={size} viewBox={LOGO_VIEWBOX} fill="none" style={{ flex: 'none' }} aria-hidden>
      <path d={LOGO_OUTLINE_PATH} fill={color} />
      <path d={LOGO_BAR_PATH} stroke={barColor} strokeWidth={LOGO_BAR_WIDTH} />
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
