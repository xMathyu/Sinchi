import { SEMAPHORE_ON_DARK, palette, radii } from '@sinchi/ui';

/**
 * Los tokens del design system, como variables CSS.
 *
 * Se generan de `@sinchi/ui` en vez de copiarse a mano, y esa es justo la razón
 * por la que ese paquete no depende de React ni de React Native: su cabecera lo
 * dice — «los mismos tokens alimentan StyleSheet en la app y CSS en el panel
 * web». Copiar los hex aquí los dejaría separarse de la app al primer retoque, y
 * entonces la landing enseñaría un producto que ya no existe.
 *
 * Van inyectados en `<head>` y no en un `.css` porque un archivo estático no
 * puede importar TypeScript: en cuanto lo escribes a mano, ya es una copia.
 *
 * Solo la paleta oscura: la app tiene dos temas y sigue al telefono
 * (decisiones §17), la landing no. Un visitante con el navegador en claro ve la
 * misma pagina oscura que todos, que es la que la marca quiere ensenar.
 */
const colors = palette('dark');

export function tokenCss(): string {
  const vars: Record<string, string> = {
    '--canvas': colors.canvas,
    '--screen': colors.screen,
    '--surface': colors.surface,
    '--surface-high': colors.surfaceHigh,
    '--avatar': colors.avatar,
    '--ink': colors.ink,
    '--text-secondary': colors.textSecondary,
    '--text-tertiary': colors.textTertiary,
    '--border': colors.border,
    '--hairline': colors.hairline,
    '--divider': colors.divider,
    '--ok': SEMAPHORE_ON_DARK.ok,
    '--warn': SEMAPHORE_ON_DARK.warn,
    '--alert': SEMAPHORE_ON_DARK.alert,
    '--bad': SEMAPHORE_ON_DARK.bad,
    '--r-md': `${radii.md}px`,
    '--r-lg': `${radii.lg}px`,
    '--r-xl': `${radii.xl}px`,
    '--r-xxl': `${radii.xxl}px`,
    '--r-pill': `${radii.pill}px`,
  };

  return `:root{${Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';')}}`;
}
