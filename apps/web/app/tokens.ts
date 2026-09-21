import {
  SEMAPHORE_ON_DARK,
  SEMAPHORE_ON_LIGHT,
  palette,
  radii,
  type Palette,
  type SemaphorePalette,
} from '@sinchi/ui';

/**
 * Los tokens del design system, como variables CSS, en los dos temas.
 *
 * Se generan de `@sinchi/ui` en vez de copiarse a mano, y esa es justo la razón
 * por la que ese paquete no depende de React ni de React Native: su cabecera lo
 * dice — «los mismos tokens alimentan StyleSheet en la app y CSS en el panel
 * web». Copiar los hex aquí los dejaría separarse de la app al primer retoque, y
 * entonces la web enseñaría un producto que ya no existe.
 *
 * Van inyectados en `<head>` y no en un `.css` porque un archivo estático no
 * puede importar TypeScript: en cuanto lo escribes a mano, ya es una copia.
 *
 * ## Por qué ahora son dos
 *
 * Hasta aquí esto pedía `palette('dark')` y punto, y estaba razonado: la web era
 * una página de venta con una sola cara. Dejó de serlo cuando entró el panel del
 * dueño, que es una herramienta que se abre a diario — y ahí vale el mismo
 * argumento que en la app (decisiones §17): el tema no es del producto, es del
 * aparato de quien mira.
 *
 * EL ORDEN DE LAS TRES REGLAS NO ES CASUAL:
 *
 *  1. `:root` lleva el OSCURO. Es la cara de la marca y lo que ve quien no
 *     expresa preferencia ninguna — incluido un navegador viejo que no entienda
 *     `prefers-color-scheme`, que así cae en la cara correcta y no en una
 *     página a medio pintar;
 *  2. el claro entra solo si el sistema lo pide Y la persona no ha dicho lo
 *     contrario (`:not([data-theme="dark"])`);
 *  3. `[data-theme]` explícito gana siempre: es el interruptor.
 *
 * `color-scheme` va en las tres. Sin él, el navegador pinta los controles
 * nativos y la barra de scroll del tema del sistema aunque la página esté en el
 * otro: una barra blanca al lado de una página negra.
 *
 * EL SEMÁFORO CAMBIA CON EL TEMA, y no es decoración: el verde `#2FD16D` sobre
 * una tarjeta blanca da 1.9:1 y deja de ser texto. `SEMAPHORE_ON_LIGHT` son los
 * mismos cuatro matices llevados al otro extremo de la rampa, y hay una prueba
 * en `@sinchi/ui` que comprueba que los cuatro pasan 4.5:1.
 */
const vars = (colors: Palette, semaphore: SemaphorePalette, scheme: 'dark' | 'light'): string => {
  const entries: Record<string, string> = {
    'color-scheme': scheme,
    '--canvas': colors.canvas,
    '--screen': colors.screen,
    '--surface': colors.surface,
    '--surface-high': colors.surfaceHigh,
    '--avatar': colors.avatar,
    '--chip-active': colors.chipActive,
    '--ink': colors.ink,
    '--text-bright': colors.textBright,
    '--text-secondary': colors.textSecondary,
    '--text-tertiary': colors.textTertiary,
    '--border': colors.border,
    '--hairline': colors.hairline,
    '--divider': colors.divider,
    '--ok': semaphore.ok,
    '--warn': semaphore.warn,
    '--alert': semaphore.alert,
    '--bad': semaphore.bad,
  };

  return Object.entries(entries)
    .map(([k, v]) => `${k}:${v}`)
    .join(';');
};

/** Los radios no dependen del tema: se emiten una sola vez. */
const SHAPES = Object.entries({
  '--r-md': `${radii.md}px`,
  '--r-lg': `${radii.lg}px`,
  '--r-xl': `${radii.xl}px`,
  '--r-xxl': `${radii.xxl}px`,
  '--r-pill': `${radii.pill}px`,
})
  .map(([k, v]) => `${k}:${v}`)
  .join(';');

export function tokenCss(): string {
  const oscuro = vars(palette('dark'), SEMAPHORE_ON_DARK, 'dark');
  const claro = vars(palette('light'), SEMAPHORE_ON_LIGHT, 'light');

  return [
    `:root{${SHAPES};${oscuro}}`,
    `@media (prefers-color-scheme: light){:root:not([data-theme="dark"]){${claro}}}`,
    `:root[data-theme="light"]{${claro}}`,
    `:root[data-theme="dark"]{${oscuro}}`,
  ].join('');
}

/**
 * El guion que evita el parpadeo.
 *
 * Corre BLOQUEANDO, en `<head>` y antes de que se pinte nada: si la preferencia
 * guardada se aplicara desde React, quien eligió claro vería un fogonazo negro
 * en cada carga. Es el único caso donde un script bloqueante se paga con gusto,
 * y por eso es tan corto.
 *
 * Solo escribe el atributo cuando hay preferencia GUARDADA. Sin ella no toca
 * nada y manda el `@media`, que es lo correcto: seguir al sistema es el estado
 * por defecto, no una tercera opción que haya que materializar.
 *
 * El `try` no es ceremonia: en una ventana privada `localStorage` puede lanzar
 * al leerlo, y una excepción aquí —antes de pintar— deja la página en blanco.
 */
export const THEME_BOOTSTRAP = `try{var t=localStorage.getItem('sinchi.tema');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}`;
