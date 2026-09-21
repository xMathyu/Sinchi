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

/**
 * El semaforo sobre superficies OSCURAS: brillante, que es como se lee de lejos.
 *
 * Es tambien el del degradado de las pantallas tenidas, en los dos temas.
 */
export const SEMAPHORE_ON_DARK: SemaphorePalette = {
  ok: '#2FD16D',
  warn: '#FFC94D',
  alert: '#FF8A3D',
  bad: '#FF4D4D',
};

/**
 * El semaforo sobre superficies CLARAS.
 *
 * No es el mismo color con otro nombre: el verde de arriba sobre una tarjeta
 * blanca da 1.9:1 y deja de ser texto. Estos cuatro son los mismos cuatro
 * matices llevados al otro extremo de la rampa —verde, ambar, naranja, rojo— y
 * todos pasan 4.5:1 sobre TODAS las superficies del tema. Cambia el tono, no
 * el significado: el ok sigue siendo verde y el bad sigue siendo rojo, porque
 * eso es lo que el recepcionista ya aprendio a leer.
 *
 * DECIA «sobre la superficie mas clara», y era exacto para lo que entonces
 * habia: la app nunca pone el semaforo sobre el fondo de pagina, siempre sobre
 * una tarjeta. La web si —su color de enlace es `--ok` sobre el fondo de la
 * pagina— y ahi el verde daba 4.23:1.
 *
 * Ahora se miden contra `surfaceHigher`, que es la mas OSCURA de las nueve del
 * tema claro y por tanto la peor. La primera correccion apunto a `canvas`, que
 * es la que tenia delante, y la prueba ampliada la cazo a los dos minutos: hay
 * una superficie todavia mas oscura. Medir contra la peor es lo que impide que
 * el siguiente retoque repita esto.
 *
 * Bajaron entre un 7 y un 13%. Es imperceptible como tono —el ok sigue siendo
 * verde y el bad rojo, que es lo que el recepcionista ya aprendio a leer— y a
 * cambio la tinta clara que va ENCIMA gana contraste, no lo pierde.
 */
export const SEMAPHORE_ON_LIGHT: SemaphorePalette = {
  ok: '#0C6B38',
  warn: '#815300',
  alert: '#9C4010',
  bad: '#B51F1F',
};

/** Tinta oscura legible sobre el semaforo brillante (tema oscuro y degradados). */
export const SEMAPHORE_INK_ON_DARK: SemaphorePalette = {
  ok: '#08260F',
  warn: '#2B1305',
  alert: '#2B1305',
  bad: '#380B0B',
};

/** Tinta clara legible sobre el semaforo oscuro del tema claro. */
export const SEMAPHORE_INK_ON_LIGHT: SemaphorePalette = {
  ok: '#F2FBF5',
  warn: '#FDF7EC',
  alert: '#FDF3EC',
  bad: '#FDF0F0',
};

/** Degradado de fondo para las pantallas que se tinen del color del estado. */
export const SEMAPHORE_GRADIENT: Readonly<Record<keyof SemaphorePalette, readonly [string, string]>> =
  {
    ok: ['#2FD16D', '#1FA855'],
    warn: ['#FFD873', '#E5A81F'],
    alert: ['#FF9E5C', '#E0641C'],
    bad: ['#FF6161', '#C22B2B'],
  };

/**
 * El blanco calido de las pantallas tenidas, que no sigue al tema.
 *
 * El resultado de la puerta y el QR del alumno se pintan del color del estado en
 * los DOS temas, y no por descuido: ese color se lee a un metro y es lo que el
 * recepcionista mira antes que ninguna letra. Dentro de esas pantallas hay
 * bloques oscuros —la tarjeta del motivo, la pastilla del veredicto— y su texto
 * tiene que ser claro aunque el telefono este en modo claro. Tomarlo de
 * `colors.ink` es lo que lo volvia negro sobre negro.
 */
export const TINTED_PAPER = '#F4F1EA';

// ---------------------------------------------------------------------------
// Color
// ---------------------------------------------------------------------------

/**
 * Los dos temas de la app.
 *
 * La app nacio oscura y esa sigue siendo su cara: un dojo se entrena de noche y
 * el telefono se saca en la puerta. Pero el tema no es del producto, es del
 * TELEFONO — quien lo tiene en claro todo el dia abre Sinchi y le pega una
 * pantalla negra— asi que hay dos paletas con las mismas llaves y la pantalla
 * nunca elige una: elige el token, y el tema decide el hex.
 */
export type ColorScheme = 'light' | 'dark';

/**
 * El juego de tokens, que es identico en los dos temas.
 *
 * Se declara como interfaz y no se infiere de la paleta oscura a proposito: es
 * lo que obliga a que agregar un token ahi rompa la compilacion del tema claro
 * hasta que tambien tenga valor. Sin eso, la paleta clara se queda atras a la
 * primera prisa y el fallo no se ve hasta que alguien mira la app de dia.
 */
export interface Palette {
  /** Fondo del lienzo y de la app. */
  readonly canvas: string;
  /** Fondo de pantalla. */
  readonly screen: string;
  /** Fondo de la pantalla de la puerta, un punto mas hondo que el de pantalla. */
  readonly screenScanner: string;

  readonly surface: string;
  readonly surfaceSunken: string;
  readonly surfaceMuted: string;
  readonly surfaceRaised: string;
  readonly surfaceHigh: string;
  readonly surfaceHigher: string;
  readonly avatar: string;
  readonly chipActive: string;

  /** La tinta del tema: el texto por defecto y el color de la marca. */
  readonly ink: string;
  /** Tinta sobre fondos claros FIJOS —el parche blanco del QR—, no sobre el tema. */
  readonly inkOnLight: string;

  readonly textBright: string;
  readonly textStrong: string;
  readonly textSecondary: string;
  readonly textTertiary: string;
  readonly textFaint: string;
  readonly textPlaceholder: string;
  readonly textDisabled: string;

  readonly divider: string;
  readonly hairline: string;
  readonly border: string;
  readonly borderStrong: string;
  readonly borderDashed: string;

  readonly actionPrimary: string;
  readonly actionPrimaryInk: string;
  readonly actionSecondary: string;
  /** La perilla de un interruptor. Blanca en los dos temas, como en iOS. */
  readonly controlThumb: string;

  readonly scrim: string;
}

export const COLORS_DARK: Palette = {
  canvas: '#08080A',
  screen: '#0E0E11',
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
  inkOnLight: '#0A0A0B',

  textBright: '#C9C9D1',
  textStrong: '#B8B8C0',

  /**
   * Los tres tonos legibles, y no hay mas.
   *
   * La rampa tenia seis escalones bajo `ink` y los tres de abajo no llegaban a
   * AA sobre las propias superficies del sistema: `textTertiary` daba 3.54:1,
   * `textFaint` 2.62:1 y el placeholder de los campos 2.20:1. En una app que se
   * usa de pie, en el mostrador y con la luz de un gimnasio, eso no es un matiz
   * de jerarquia: es texto que no se lee.
   *
   * `#8C8C95` es el suelo — el gris mas oscuro que pasa 4.5:1 sobre las siete
   * superficies, incluida `surfaceHigher`. Debajo de ahi no hay escalon que
   * ganar, asi que la jerarquia por debajo del secundario se hace con tamano y
   * peso, no con mas gris.
   */
  textSecondary: '#9C9CA6',
  textTertiary: '#8C8C95',
  textFaint: '#8C8C95',
  /** Texto de sugerencia de un campo vacio. Es una instruccion: tiene que leerse. */
  textPlaceholder: '#8C8C95',
  /**
   * Solo para controles inactivos —un dia que el plan no habilita, un metodo de
   * pago que no aplica—. Aqui el contraste bajo ES la senal, y por eso este es
   * el unico tono que se queda por debajo de AA a proposito.
   */
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
  controlThumb: '#F4F1EA',

  scrim: 'rgba(10,10,11,0.92)',
};

/**
 * El mismo sistema con la rampa dada vuelta.
 *
 * Dos cosas que no son un espejo mecanico y conviene saber:
 *
 *  - la elevacion se invierte. En oscuro una tarjeta se levanta ACLARANDOSE
 *    (`surfaceRaised` > `surface`); en claro se levanta hasta el blanco y lo
 *    que se hunde es lo que se oscurece (`surfaceSunken`). Por eso los hex no
 *    van en el mismo orden;
 *  - el papel es calido, del mismo modo que la tinta oscura lo es. Un gris
 *    neutro al lado del `#F4F1EA` de la marca se lee azulado.
 *
 * El suelo de texto es `#5A5A63` por la misma cuenta que arriba: es el gris mas
 * CLARO que pasa 4.5:1 sobre `surfaceHigher`, la superficie mas oscura del tema.
 * La prueba de `semaphore.test.ts` lo comprueba sobre las nueve superficies, y
 * ya salvo un ajuste del papel que lo habia dejado en 4.43:1.
 */
export const COLORS_LIGHT: Palette = {
  /**
   * El papel va cuatro escalones por debajo del blanco, y eso no es gusto: con
   * el lienzo casi blanco, una tarjeta blanca sobre el se apoya en el filete y
   * en nada mas — en la bienvenida, que son tres tarjetas sueltas sin barra de
   * color, desaparecian. En oscuro el mismo salto se ve porque el ojo separa
   * mejor dos negros que dos blancos.
   */
  canvas: '#E9E6DE',
  screen: '#F2EFE8',
  /**
   * La puerta tambien se aclara. Se penso en dejarla oscura siempre —es la
   * pantalla de la camara— pero la camara la abre `scan`, no esta: aqui solo
   * hay una lista de marcados, y dejarla negra en medio de una app clara se lee
   * como que se colgo.
   */
  screenScanner: '#E6E2DA',

  surface: '#FCFBF8',
  surfaceSunken: '#E7E3DB',
  surfaceMuted: '#EDEAE2',
  surfaceRaised: '#FFFFFF',
  surfaceHigh: '#E1DDD4',
  surfaceHigher: '#DBD6CC',
  avatar: '#D9D4CA',
  chipActive: '#FFFFFF',

  /** Carbon calido: nunca `#000000`, por lo mismo que arriba nunca es blanco puro. */
  ink: '#1B1A17',
  inkOnLight: '#0A0A0B',

  textBright: '#2C2C34',
  textStrong: '#38383F',
  textSecondary: '#46464F',
  textTertiary: '#5A5A63',
  textFaint: '#5A5A63',
  textPlaceholder: '#5A5A63',
  textDisabled: '#B0ACA3',

  divider: 'rgba(12,12,16,0.06)',
  hairline: 'rgba(12,12,16,0.09)',
  border: 'rgba(12,12,16,0.12)',
  borderStrong: 'rgba(12,12,16,0.16)',
  borderDashed: 'rgba(12,12,16,0.20)',

  /** Sigue invertido, que es lo que lo hace el bloque de mas contraste. */
  actionPrimary: '#1B1A17',
  actionPrimaryInk: '#F7F5F0',
  actionSecondary: '#FFFFFF',
  controlThumb: '#FFFFFF',

  scrim: 'rgba(242,239,232,0.92)',
};

export const palette = (scheme: ColorScheme): Palette =>
  scheme === 'light' ? COLORS_LIGHT : COLORS_DARK;

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

/**
 * Mezcla dos colores en sRGB. `amount` es cuanto del segundo entra.
 *
 * Existe por un caso concreto: el texto secundario de una tarjeta tenida del
 * color del estado. Estaba escrito a mano —`#A9C9B4`, `#D9CFA8`, `#C4BB98`,
 * ocho hex repartidos por las pantallas— y cada uno era el gris del tema tirado
 * un poco hacia su color. Escritos a mano solo valian para el tema oscuro: en
 * claro eran texto pastel sobre papel. Calculados, salen del gris del tema que
 * toque y siguen siendo el mismo gesto.
 */
export function mix(from: string, to: string, amount: number): string {
  const a = channels(from);
  const b = channels(to);
  if (a === null || b === null) return from;
  const blend = (start: number, end: number): string =>
    Math.round(start + (end - start) * amount)
      .toString(16)
      .padStart(2, '0');
  return `#${blend(a[0], b[0])}${blend(a[1], b[1])}${blend(a[2], b[2])}`;
}

function channels(color: string): readonly [number, number, number] | null {
  if (!color.startsWith('#')) return null;
  const hex = color.slice(1);
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex;
  if (full.length !== 6) return null;
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ];
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

/** Multiplos de 2 desde 2: la reticula del diseno es fina, no de 8pt. */
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
  /** Cual de los dos temas esta puesto. Lo consultan el teclado y la barra de estado. */
  readonly scheme: ColorScheme;
  readonly colors: Palette;
  readonly semaphore: SemaphorePalette;
  readonly semaphoreInk: SemaphorePalette;
  readonly semaphoreGradient: typeof SEMAPHORE_GRADIENT;
  /** Tinta sobre el degradado, que es brillante en los dos temas. */
  readonly semaphoreGradientInk: SemaphorePalette;
  readonly fonts: typeof fonts;
  readonly typeScale: typeof typeScale;
  readonly radii: typeof radii;
  readonly spacing: typeof spacing;
}

export function makeTheme(options: { readonly scheme?: ColorScheme } = {}): Theme {
  const scheme = options.scheme ?? 'dark';
  const light = scheme === 'light';
  return {
    scheme,
    colors: palette(scheme),
    semaphore: light ? SEMAPHORE_ON_LIGHT : SEMAPHORE_ON_DARK,
    semaphoreInk: light ? SEMAPHORE_INK_ON_LIGHT : SEMAPHORE_INK_ON_DARK,
    semaphoreGradient: SEMAPHORE_GRADIENT,
    semaphoreGradientInk: SEMAPHORE_INK_ON_DARK,
    fonts,
    typeScale,
    radii,
    spacing,
  };
}

/** El tema de arranque, y el que usa la landing: oscuro, la cara de la marca. */
export const defaultTheme = makeTheme();
