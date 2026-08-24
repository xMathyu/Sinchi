/**
 * Layout raiz.
 *
 * La navegacion es un Stack: las pantallas de detalle (cobrar, pagar, resultado
 * del escaneo) se presentan encima de las pestanas. Los patrones de cada
 * plataforma se respetan (MD 3): el gesto de volver de iOS y el boton atras de
 * Android los maneja el Stack nativo, no una barra dibujada por nosotros.
 */
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { colors } from '@sinchi/ui';
import { DISPLAY_FONTS } from '../src/design/fonts';
import { ThemeProvider } from '../src/design/theme';

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(DISPLAY_FONTS);

  useEffect(() => {
    if (fontError !== null) {
      // La app funciona sin Archivo: los titulares caen a la fuente del
      // sistema. Se registra, pero no se bloquea la puerta por una fuente.
      console.warn('No se pudo cargar Archivo:', fontError.message);
    }
  }, [fontError]);

  if (!fontsLoaded && fontError === null) {
    return <View style={styles.splash} />;
  }

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            animation: 'slide_from_right',
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="student" />
          <Stack.Screen name="staff" />
          <Stack.Screen name="pay/[membershipId]" options={{ presentation: 'modal' }} />
          <Stack.Screen name="plan-change/[membershipId]" options={{ presentation: 'modal' }} />
          <Stack.Screen name="charge/[membershipId]" options={{ presentation: 'modal' }} />
          <Stack.Screen
            name="result/[membershipId]"
            options={{ presentation: 'fullScreenModal', animation: 'fade' }}
          />
          <Stack.Screen name="settings" options={{ presentation: 'modal' }} />
        </Stack>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, backgroundColor: colors.canvas },
});
