/**
 * Carga de una SECCION, no de la pantalla entera.
 *
 * La primera version tapaba la app completa mientras llegaba `/me`, y eso
 * convierte una espera de dos segundos en una pantalla negra: no se ve dónde
 * estás ni que la app ya arrancó. Aquí la barra de pestañas se queda puesta y
 * solo el contenido dice que está trabajando, que es lo que de verdad falta.
 *
 * El logo respira en vez de girar. Un indicador que gira mide el tiempo y hace
 * que dos segundos parezcan cinco; una marca que late ocupa el hueco sin
 * cronometrarlo. `durations.breathe` es el mismo ritmo que el diseño pide para
 * el halo del QR: la app late a una sola velocidad.
 */
import { useEffect, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';
import { durations } from '@sinchi/ui';
import { Logo, Text } from './primitives';
import { useTheme } from './theme';

export function CargandoSeccion({
  texto = 'Trayendo tus datos…',
  size = 46,
}: {
  /** Cadena vacia para el logo a secas, sin pie. */
  readonly texto?: string;
  readonly size?: number;
}) {
  const theme = useTheme();
  const latido = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const ciclo = Animated.loop(
      Animated.sequence([
        Animated.timing(latido, {
          toValue: 1,
          duration: durations.breathe / 2,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(latido, {
          toValue: 0.4,
          duration: durations.breathe / 2,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    ciclo.start();
    // Se para al desmontar: un bucle vivo sobre un componente que ya no existe
    // mantiene despierto el hilo de animaciones sin que nada se vea.
    return () => ciclo.stop();
  }, [latido]);

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.colors.screen,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
      }}
      accessibilityRole="progressbar"
      accessibilityLabel={texto}
    >
      <Animated.View style={{ opacity: latido }}>
        <Logo size={size} />
      </Animated.View>
      {texto.length === 0 ? null : (
        <Text variant="captionSmall" color={theme.colors.textTertiary}>
          {texto}
        </Text>
      )}
    </View>
  );
}
