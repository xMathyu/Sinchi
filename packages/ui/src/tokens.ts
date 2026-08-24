/**
 * Tokens del design system, extraidos del diseno `Sinchi App.dc.html`.
 *
 * El estilo es iOS-flavored en ambas plataformas (MD 3): en iOS sale nativo y
 * en Android se replica con este design system, sin componentes Material. Los
 * patrones de navegacion si se respetan por plataforma.
 *
 * El paquete no depende de React ni de React Native a proposito: los mismos
 * tokens alimentan `StyleSheet` en la app y CSS en el panel web. Los
 * componentes viven en cada superficie, los valores viven aqui.
 */

// ---------------------------------------------------------------------------
// Semaforo de acceso
// ---------------------------------------------------------------------------

/**
 * El semaforo es el lenguaje central del producto: cuatro estados y nada mas.
 * Los niveles los decide `@sinchi/shared` (`AccessLevel`); aqui solo viven sus
 * colores.
 */
export interface SemaphorePalette {
  readonly ok: string;
  readonly warn: string;
  readonly alert: string;
  readonly bad: string;
}

export const SEMAPHORE_DEFAULT: SemaphorePalette = {
  ok: '#2FD16D',
  warn: '#FFC94D',
  alert: '#FF8A3D',
  bad: '#FF4D4D',
};

/**
 * Paleta alternativa para daltonismo.
 *
 * No es un adorno de accesibilidad: en este producto el color ES la
 * informacion. Un recepcionista que no distingue verde de rojo no puede
 * operar la puerta, y el 8% de los hombres tiene alguna deficiencia al rojo-verde.
 * El texto del motivo siempre acompana al color por la misma razon.
 */
export const SEMAPHORE_COLORBLIND_SAFE: SemaphorePalette = {
  ok: '#3CB4FF',
  warn: '#FFD166',
  alert: '#C58BFF',
  bad: '#FF3B6B',
};

/** Tinta oscura legible sobre cada color del semaforo. */
export const SEMAPHORE_INK: SemaphorePalette = {
  ok: '#08260F',
  warn: '#2B1305',
  alert: '#2B1305',
  bad: '#380B0B',
};

/** Degradado de fondo para las pantallas que se tinen del color del estado. */
export const SEMAPHORE_GRADIENT: Readonly<Record<keyof SemaphorePalette, readonly [string, string]>> =
  {
    ok: ['#2FD16D', '#1FA855'],
    warn: ['#FFD873', '#E5A81F'],
    alert: ['#FF9E5C', '#E0641C'],
    bad: ['#FF6161', '#C22B2B'],
  };

// ---------------------------------------------------------------------------
// Color
// ---------------------------------------------------------------------------

export const colors = {
  /** Fondo del lienzo y de la app. */
  canvas: '#08080A',
  /** Fondo de pantalla. */
  screen: '#0E0E11',
  /** Fondo de la pantalla de escaneo, un punto mas oscuro. */
  screenScanner: '#0A0A0C',

  surface: '#17171B',
  surfaceSunken: '#131317',
  surfaceMuted: '#1A1A1F',
  surfaceRaised: '#1E1E24',
  surfaceHigh: '#22222A',
  surfaceHigher: '#26262C',
  avatar: '#2A2A32',
  chipActive: '#33333B',

  /** Blanco calido: nunca `#FFFFFF`, que sobre negro puro vibra. */
  ink: '#F4F1EA',
  /** Tinta sobre fondos claros. */
  inkOnLight: '#0A0A0B',

  textBright: '#C9C9D1',
  textStrong: '#B8B8C0',
  textSecondary: '#8A8A93',
  textTertiary: '#6E6E78',
  textFaint: '#5A5A63',
  textDisabled: '#4A4A52',

  divider: 'rgba(255,255,255,0.05)',
  hairline: 'rgba(255,255,255,0.07)',
  border: 'rgba(255,255,255,0.09)',
  borderStrong: 'rgba(255,255,255,0.12)',
  borderDashed: 'rgba(255,255,255,0.14)',

  /** Fondo del boton primario: claro sobre oscuro, como en iOS invertido. */
  actionPrimary: '#F4F1EA',
  actionPrimaryInk: '#08080A',
  actionSecondary: '#1E1E24',

  scrim: 'rgba(10,10,11,0.92)',
} as const;

/** Fondos y bordes translucidos derivados de un color del semaforo. */
export function tintedSurface(color: string, alpha = 0.12): string {
  return withAlpha(color, alpha);
}

/** `#RRGGBB` -> `rgba(r,g,b,a)`. Acepta ya-rgba y lo devuelve intacto. */
export function withAlpha(color: string, alpha: number): string {
  if (!color.startsWith('#')) return color;
  const hex = color.slice(1);
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex;
  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ---------------------------------------------------------------------------
// Tipografia
// ---------------------------------------------------------------------------

/**
 * Dos familias y nada mas:
 *  - `display`: Archivo, condensada y muy pesada, con tracking negativo. Es la
 *    voz del producto (el nombre, los titulares, los montos). Viene del mundo
 *    del cartel deportivo, que es donde vive una escuela de artes marciales.
 *  - `text`: la del sistema. En iOS es SF Pro y sale nativo; en Android, Roboto.
 *    Los parrafos no necesitan personalidad, necesitan legibilidad a 12px.
 */
export const fonts = {
  display: 'Archivo',
  displayFallback: 'sans-serif',
  text: 'system',
} as const;

export const fontWeights = {
  regular: '400',
  medium: '500',
  semibold: '600',
  /** El 650 del diseno: entre semibold y bold. En RN se redondea a 700. */
  strong: '600',
  bold: '700',
  extrabold: '800',
  black: '900',
} as const;

/**
 * Escala tipografica. Los nombres describen el uso, no el tamano: el dia que
 * el titular baje a 30px no hay que renombrar nada.
 */
export const typeScale = {
  /** Titular de pantalla completa: "LUCIA FERRER" en la validacion. */
  hero: { size: 38, lineHeight: 36, letterSpacing: -1.7, family: 'display' },
  /** Titulares de tarjeta grande: montos, estados. */
  display: { size: 30, lineHeight: 32, letterSpacing: -1.05, family: 'display' },
  displaySmall: { size: 26, lineHeight: 28, letterSpacing: -0.78, family: 'display' },
  /** Titulo de pantalla. */
  title: { size: 26, lineHeight: 31, letterSpacing: -0.78, family: 'text' },
  titleSmall: { size: 20, lineHeight: 24, letterSpacing: -0.5, family: 'text' },
  /** Nombre de gimnasio en la lista, etiquetas de boton. */
  heading: { size: 17, lineHeight: 21, letterSpacing: -0.34, family: 'text' },
  body: { size: 15, lineHeight: 20, letterSpacing: -0.15, family: 'text' },
  bodySmall: { size: 14, lineHeight: 19, letterSpacing: -0.14, family: 'text' },
  caption: { size: 13, lineHeight: 17, letterSpacing: 0, family: 'text' },
  captionSmall: { size: 12, lineHeight: 16, letterSpacing: 0, family: 'text' },
  /**
   * Etiqueta en versalitas: 11px, peso 700, tracking muy abierto.
   * Es el recurso que ordena todas las pantallas del diseno.
   */
  eyebrow: { size: 11, lineHeight: 14, letterSpacing: 1.5, family: 'text' },
  micro: { size: 11.5, lineHeight: 15, letterSpacing: 0, family: 'text' },
} as const;

export type TypeToken = keyof typeof typeScale;

// ---------------------------------------------------------------------------
// Forma y espacio
// ---------------------------------------------------------------------------

/**
 * Radios generosos, escalonados por tamano del elemento: mientras mas grande
 * la superficie, mas redondeada. Es lo que hace que la interfaz se lea como
 * iOS y no como Material.
 */
export const radii = {
  xs: 9,
  sm: 12,
  md: 14,
  lg: 16,
  xl: 18,
  xxl: 22,
  xxxl: 28,
  /** Marco del telefono en las maquetas. */
  device: 46,
  pill: 999,
} as const;

/** Multiplos de 2 desde 2: la retícula del diseno es fina, no de 8pt. */
export const spacing = {
  xxs: 2,
  xs: 6,
  sm: 8,
  md: 10,
  lg: 14,
  xl: 16,
  xxl: 20,
  xxxl: 26,
  huge: 32,
} as const;

/** Margen lateral de pantalla: 20px en el diseno, constante en las 12. */
export const screenPadding = 20;

export const durations = {
  /** Respiracion del halo del QR. */
  breathe: 3200,
  /** Barrido del escaner. */
  scan: 2400,
  /** Parpadeo de los indicadores de estado. */
  blink: 1700,
  /** Deriva de la marca de agua "SINCHI". */
  drift: 26_000,
  press: 120,
} as const;

// ---------------------------------------------------------------------------
// Tema
// ---------------------------------------------------------------------------

export interface Theme {
  readonly colors: typeof colors;
  readonly semaphore: SemaphorePalette;
  readonly semaphoreInk: SemaphorePalette;
  readonly semaphoreGradient: typeof SEMAPHORE_GRADIENT;
  readonly fonts: typeof fonts;
  readonly typeScale: typeof typeScale;
  readonly radii: typeof radii;
  readonly spacing: typeof spacing;
  readonly colorBlindSafe: boolean;
}

export function makeTheme(options: { readonly colorBlindSafe?: boolean } = {}): Theme {
  const colorBlindSafe = options.colorBlindSafe ?? false;
  return {
    colors,
    semaphore: colorBlindSafe ? SEMAPHORE_COLORBLIND_SAFE : SEMAPHORE_DEFAULT,
    semaphoreInk: SEMAPHORE_INK,
    semaphoreGradient: SEMAPHORE_GRADIENT,
    fonts,
    typeScale,
    radii,
    spacing,
    colorBlindSafe,
  };
}

export const defaultTheme = makeTheme();
