/**
 * Contenedores de pantalla.
 *
 * Dos formas, las mismas del diseno:
 *  - `Screen`: fondo oscuro, contenido sobre superficies.
 *  - `TintedScreen`: la pantalla entera se tine del color del semaforo. Es el
 *    recurso de la puerta: el resultado se lee de lejos, antes de leer texto.
 */
import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { screenPadding, WATERMARK_TILES, WORDMARK_TRACKING_RATIO } from '@sinchi/ui';
import { Text } from './primitives';
import { useTheme } from './theme';

export function Screen({
  children,
  scroll = false,
  padded = true,
  background,
  style,
}: {
  readonly children: ReactNode;
  readonly scroll?: boolean;
  readonly padded?: boolean;
  readonly background?: string;
  readonly style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const frame: StyleProp<ViewStyle> = [
    styles.fill,
    { backgroundColor: background ?? theme.colors.screen, paddingTop: insets.top },
  ];
  const inner: StyleProp<ViewStyle> = [
    padded ? { paddingHorizontal: screenPadding } : null,
    { paddingBottom: insets.bottom + 16 },
    style,
  ];

  if (scroll) {
    return (
      <View style={frame}>
        <ScrollView
          contentContainerStyle={inner}
          showsVerticalScrollIndicator={false}
          // El rebote de iOS se mantiene; en Android el overscroll nativo
          // tampoco se toca. Los patrones de plataforma se respetan (MD 3).
          {...tecladoEnScroll}
        >
          {children}
        </ScrollView>
      </View>
    );
  }

  // Sin scroll el contenido no se puede correr, asi que el hueco lo abre el
  // propio contenedor. `height` y no `padding`: aqui dentro hay pantallas cuyo
  // hijo es un `FlatList` con `flex: 1` —el padron— y con `padding` la lista se
  // queda del alto de siempre y el teclado le tapa las ultimas filas.
  return (
    <KeyboardAvoidingView
      style={[frame, inner]}
      behavior={Platform.OS === 'ios' ? 'height' : undefined}
    >
      {children}
    </KeyboardAvoidingView>
  );
}

/**
 * Que el teclado no tape lo que se esta escribiendo.
 *
 * Era el mismo fallo en TODA la app —el celular y el codigo de promocion del
 * alta, la hora de una clase, el monto de un cobro— porque todas esas pantallas
 * son este `ScrollView`, y un `ScrollView` pelado no sabe que el teclado existe:
 * ocupa media pantalla por encima y el campo enfocado se queda debajo.
 *
 *  · `automaticallyAdjustKeyboardInsets` es la pieza de iOS: mete el alto del
 *    teclado como inset del scroll, y UIKit sube solo el campo enfocado. En
 *    Android no hace nada y no hace falta —`adjustResize`, que es lo que Expo
 *    deja puesto, encoge la ventana entera;
 *  · `keyboardShouldPersistTaps` arregla el segundo medio bug, el que se
 *    confunde con "el boton no responde": con el teclado abierto, el primer
 *    toque en «Crear mi gimnasio» solo lo cerraba y habia que tocar dos veces.
 *    `handled` deja que el boton se lleve el toque y cierra el teclado si el
 *    toque no era de nadie;
 *  · `interactive` es el gesto de iOS de bajar el teclado arrastrandolo, que es
 *    como se espera salir de un formulario largo.
 */
const tecladoEnScroll = {
  automaticallyAdjustKeyboardInsets: true,
  keyboardShouldPersistTaps: 'handled',
  keyboardDismissMode: Platform.OS === 'ios' ? 'interactive' : 'on-drag',
} as const;

/**
 * Pantalla tenida con el degradado del estado, con la marca de agua "SINCHI"
 * derivando de fondo.
 */
export function TintedScreen({
  gradient,
  ink,
  watermark,
  /**
   * Fuerza de la marca de agua.
   *
   * En la pantalla de resultado se lee de lejos y aguanta el 0.08 del diseno.
   * Detras del QR del alumno compite con lo unico que hay que mirar, asi que
   * ahi se baja: la marca no tiene que ganarle al codigo.
   */
  watermarkOpacity,
  children,
}: {
  readonly gradient: readonly [string, string];
  readonly ink: string;
  readonly watermark?: string;
  readonly watermarkOpacity?: number;
  readonly children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.fill}>
      <LinearGradient
        colors={[gradient[0], gradient[1]]}
        start={{ x: 0.15, y: 0 }}
        end={{ x: 0.85, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {watermark === undefined ? null : (
        <Watermark label={watermark} ink={ink} opacity={watermarkOpacity} />
      )}
      <View
        style={[
          styles.fill,
          {
            paddingTop: insets.top + 8,
            paddingBottom: insets.bottom + 16,
            paddingHorizontal: 24,
          },
        ]}
      >
        {children}
      </View>
    </View>
  );
}

/**
 * Rejilla de la palabra marca, rotada y muy tenue.
 *
 * Estatica a proposito: el diseno la anima, pero una animacion infinita detras
 * de la pantalla que mas se usa en la puerta gasta bateria todo el turno.
 */
function Watermark({
  label,
  ink,
  opacity = 0.08,
}: {
  readonly label: string;
  readonly ink: string;
  readonly opacity?: number;
}) {
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.watermarkClip]}>
      <View style={styles.watermarkGrid}>
        {Array.from({ length: WATERMARK_TILES }, (_, index) => (
          <WatermarkTile key={index} label={label} ink={ink} opacity={opacity} />
        ))}
      </View>
    </View>
  );
}

function WatermarkTile({
  label,
  ink,
  opacity,
}: {
  readonly label: string;
  readonly ink: string;
  readonly opacity: number;
}) {
  return (
    <Text
      variant="hero"
      weight="black"
      color={ink}
      style={{
        opacity,
        paddingHorizontal: 18,
        paddingVertical: 26,
        letterSpacing: 52 * WORDMARK_TRACKING_RATIO,
      }}
    >
      {label}
    </Text>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  watermarkClip: { overflow: 'hidden' },
  watermarkGrid: {
    position: 'absolute',
    top: '-30%',
    left: '-30%',
    width: '180%',
    height: '180%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    transform: [{ rotate: '-18deg' }],
  },
});
