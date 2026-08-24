/**
 * Foto del alumno.
 *
 * No es decorativa: en el modo "staff escanea" es lo unico que impide que un
 * alumno le pase el celular a un amigo en la puerta (MD 4.6). Cuando no hay
 * foto cargada se muestran las iniciales, pero con un aviso visible, porque una
 * membresia sin foto es un agujero de control que el gimnasio deberia cerrar.
 */
import { Image, View } from 'react-native';
import { Text } from './primitives';
import { useTheme } from './theme';
import { initials } from '../lib/format';

export function PhotoCircle({
  name,
  photoUrl,
  size = 112,
  ringColor,
  ringWidth = 6,
}: {
  readonly name: string;
  readonly photoUrl: string | null;
  readonly size?: number;
  readonly ringColor?: string;
  readonly ringWidth?: number;
}) {
  const theme = useTheme();

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: ringColor === undefined ? 0 : ringWidth,
        borderColor: ringColor,
        backgroundColor: theme.colors.avatar,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {photoUrl === null ? (
        <Text
          variant="display"
          weight="black"
          color={theme.colors.textStrong}
          style={{ fontSize: size * 0.32, lineHeight: size * 0.36 }}
        >
          {initials(name)}
        </Text>
      ) : (
        <Image
          source={{ uri: photoUrl }}
          accessibilityLabel={`Foto de ${name}`}
          style={{ width: '100%', height: '100%' }}
        />
      )}
    </View>
  );
}
