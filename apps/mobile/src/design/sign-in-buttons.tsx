/**
 * Los botones de Google y de Apple, hechos como pareja.
 *
 * Van uno encima del otro y se leen como dos opciones de lo mismo, así que
 * tienen que medir lo mismo: alto, radio, letra y peso. Con el `Button` del
 * sistema de diseño no pasaba — la etiqueta de Google iba a 17 puntos semibold
 * y la de Apple a 20 medium, y saltaba a la vista que eran dos botones de dos
 * sitios distintos.
 *
 * EL QUE MANDA ES APPLE, y no por gusto. Su botón es nativo y su letra no se
 * elige: la saca del alto. Achicarla no es una opción, así que es Google el que
 * copia sus medidas.
 */
import { Pressable, StyleSheet, View } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { GoogleMark } from './google-mark';
import { Text } from './primitives';
import { useTheme } from './theme';

/**
 * Los 52 del `Button`, para que los tres botones de la pantalla vayan a un
 * mismo alto. Más bajo tampoco convenía: por debajo de ~48 el nativo redondea
 * sus esquinas casi a cápsula, por mucho `cornerRadius` que se le pase, y deja
 * de parecerse al de Google.
 */
const HEIGHT = 52;
/**
 * Medido, no calculado: a 52 de alto el nativo dibuja su título a 20 puntos
 * medium (iOS 26.5, comparando el ancho del texto píxel a píxel).
 *
 * NO es el 43 % del alto que pide la guía de Apple a un botón propio —daría
 * 22—: el nativo usa cerca de un 38 %. Si se cambia `HEIGHT`, esto se vuelve a
 * medir; a 44 sale a 16,5 y a 48 a 18.
 */
const TITLE_SIZE = 20;

/**
 * «Continuar» y no «Entrar» ni «Iniciar sesión»: es el mismo toque en «Entrar»
 * y en «Crea tu cuenta» —quien no tiene cuenta sale de ahí con una—, y es de
 * los tres títulos que Apple permite el único que no miente en ninguna de las
 * dos vistas. Google lo dice igual para que la pareja hable con un solo verbo.
 */
export function GoogleSignInButton({
  onPress,
  disabled,
}: {
  readonly onPress: () => void;
  readonly disabled: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => ({
        height: HEIGHT,
        borderRadius: theme.radii.lg,
        backgroundColor: theme.colors.actionSecondary,
        borderWidth: StyleSheet.hairlineWidth * 2,
        borderColor: theme.colors.border,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.4 : pressed ? 0.78 : 1,
      })}
    >
      {/* La «G» y el texto van centrados como una sola pieza, que es como lo
          pide Google y como arma Apple el suyo: con la marca pegada al borde
          parecen dos cosas distintas. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <GoogleMark />
        {/* Sin el tracking negativo del `heading`: Apple deja el de la letra del
            sistema, y con el apretado la palabra se ve más chica aunque mida
            lo mismo. */}
        <Text
          weight="medium"
          style={{ fontSize: TITLE_SIZE, lineHeight: TITLE_SIZE + 4, letterSpacing: 0 }}
        >
          Continuar con Google
        </Text>
      </View>
    </Pressable>
  );
}

/**
 * El botón es el NATIVO de Apple, no uno del sistema de diseño.
 *
 * La guía de Apple manda usar el suyo —su marca, su texto, sus proporciones—
 * y un botón propio con una manzana dibujada es motivo de rechazo. Lo que sí
 * se ajusta es lo que la guía deja ajustar: el radio y el alto, para que quede
 * a la par del de Google, y el color, que se invierte con el tema porque un
 * botón negro sobre fondo negro no se ve.
 */
export function AppleSignInButton({
  onPress,
  disabled,
}: {
  readonly onPress: () => void;
  readonly disabled: boolean;
}) {
  const theme = useTheme();
  return (
    <AppleAuthentication.AppleAuthenticationButton
      buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
      buttonStyle={
        theme.scheme === 'dark'
          ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
          : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
      }
      cornerRadius={theme.radii.lg}
      style={{ height: HEIGHT, width: '100%', opacity: disabled ? 0.4 : 1 }}
      // El nativo no tiene `disabled`: atenuarlo solo lo PINTA apagado. Sin
      // esto, un segundo toque mientras la api cambia el token abriría otra
      // hoja de Apple y un segundo intento encima del primero.
      onPress={disabled ? () => undefined : onPress}
    />
  );
}
