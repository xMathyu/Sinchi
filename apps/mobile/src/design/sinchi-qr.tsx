/**
 * Un QR de Sinchi: la matriz y el logo encima, al centro.
 *
 * Vive aquí y no dentro de cada pantalla porque hay dos QR —el del alumno, que
 * abre la puerta, y el de la cuenta sin ficha, con el que la inscriben— y el
 * segundo nació sin logo por estar escrito aparte. Quien los mira tiene que
 * reconocerlos como la misma cosa de la misma app; dos copias se separan en
 * cuanto una recibe un arreglo y la otra no.
 *
 * El logo tapa parte de la matriz, y por eso el nivel de corrección es Q: aun
 * así se lee a la primera con la cámara de un celular viejo.
 */
import { View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import Svg, { Path } from 'react-native-svg';
import { LOGO_BAR_PATH, LOGO_BAR_WIDTH, LOGO_OUTLINE_PATH, LOGO_VIEWBOX } from '@sinchi/ui';
import { Text } from './primitives';
import { useTheme } from './theme';

export function SinchiQrCode({
  value,
  size,
  placeholder = 'Preparando tu código…',
}: {
  /** `null` mientras no hay nada que codificar: se enseña `placeholder`. */
  readonly value: string | null;
  readonly size: number;
  readonly placeholder?: string;
}) {
  const theme = useTheme();

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {value === null ? (
        <Text variant="caption" color="#7A7A83">
          {placeholder}
        </Text>
      ) : (
        <QRCode
          value={value}
          size={size}
          backgroundColor="#FFFFFF"
          color={theme.colors.inkOnLight}
          ecl="Q"
        />
      )}
      <View
        style={{
          position: 'absolute',
          width: 52,
          height: 52,
          borderRadius: theme.radii.md,
          backgroundColor: '#FFFFFF',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Svg width={30} height={30} viewBox={LOGO_VIEWBOX}>
          <Path d={LOGO_OUTLINE_PATH} fill={theme.colors.inkOnLight} />
          <Path d={LOGO_BAR_PATH} stroke="#FFFFFF" strokeWidth={LOGO_BAR_WIDTH} />
        </Svg>
      </View>
    </View>
  );
}
