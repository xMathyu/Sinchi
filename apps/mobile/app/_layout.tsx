/**
 * Layout raiz.
 *
 * Hace dos cosas: monta la navegacion y decide QUE se ve segun la sesion.
 *
 * La navegacion es un Stack: las pantallas de detalle (cobrar, pagar, resultado
 * del escaneo) se presentan encima de las pestanas. Los patrones de cada
 * plataforma se respetan (MD 3): el gesto de volver de iOS y el boton atras de
 * Android los maneja el Stack nativo, no una barra dibujada por nosotros.
 *
 * El enrutado por rol vive aqui y no en cada pantalla. Si cada una comprobara la
 * sesion por su cuenta, la que se olvide de hacerlo queda accesible sin sesion, y
 * ese olvido no se ve en una revision de codigo.
 */
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { colors } from '@sinchi/ui';
import { DISPLAY_FONTS } from '../src/design/fonts';
import { ThemeProvider } from '../src/design/theme';
import { setCredentialProvider } from '../src/data/api';
import { currentToken, getDeviceToken, restoreSession } from '../src/data/session';
import { useSession } from '../src/data/session-hooks';

/**
 * El cliente HTTP toma sus credenciales de aqui.
 *
 * Se conecta una sola vez al cargar el modulo, antes de que cualquier pantalla
 * pida datos. `api.ts` no importa el modulo de sesion a proposito —la capa de red
 * no tiene por que saber que los tokens viven en el llavero— y este es el punto
 * donde las dos mitades se unen.
 */
setCredentialProvider({ getToken: currentToken, getDeviceToken });

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(DISPLAY_FONTS);

  useEffect(() => {
    if (fontError !== null) {
      // La app funciona sin Archivo: los titulares caen a la fuente del
      // sistema. Se registra, pero no se bloquea la puerta por una fuente.
      console.warn('No se pudo cargar Archivo:', fontError.message);
    }
  }, [fontError]);

  // Recuperar la sesion del llavero antes de decidir a donde va la app.
  useEffect(() => {
    void restoreSession();
  }, []);

  if (!fontsLoaded && fontError === null) {
    return <View style={styles.splash} />;
  }

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <StatusBar style="light" />
        <SessionRouter />
        <Stack
          screenOptions={{
            headerShown: false,
            animation: 'slide_from_right',
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="login" options={{ animation: 'fade' }} />
          <Stack.Screen name="link" options={{ animation: 'fade' }} />
          <Stack.Screen name="dev" options={{ presentation: 'modal' }} />
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

/**
 * Manda la app a donde corresponde segun la sesion.
 *
 * Es un componente sin interfaz porque los hooks de navegacion de expo-router
 * necesitan estar DENTRO del arbol del Stack: llamarlos en el layout, antes de
 * que el Stack exista, lanza "Couldn't find a navigation object".
 */
function SessionRouter() {
  const state = useSession();
  const router = useRouter();
  // `useSegments` viene tipado como tupla segun las rutas conocidas, y aqui se
  // lee por posicion sin importar cuantos niveles haya.
  const segments = useSegments() as readonly string[];

  useEffect(() => {
    if (state.status === 'loading') return;

    const primero = segments[0];
    const enLogin = primero === 'login' || primero === 'link';
    // El registro del equipo y la apertura de turno se hacen SIN sesion: son
    // justamente lo que produce una.
    const enTurno = primero === 'staff' && segments[1] === 'shift';
    // La puerta de desarrollo tambien: es de donde sale el modo demostracion.
    // Sin esto, tocar "Probar sin Google" navegaba a /dev y este efecto lo
    // devolvia a /login en el mismo instante — se veia como que no pasaba nada.
    const enDev = __DEV__ && primero === 'dev';

    if (state.status === 'signed_out') {
      if (!enLogin && !enTurno && !enDev) router.replace('/login');
      return;
    }

    if (state.status === 'unlinked') {
      if (primero !== 'link') router.replace('/link');
      return;
    }

    if (state.status === 'demo') {
      // Sin sesión real: el rol lo decide el store de demostración, y las dos
      // zonas quedan accesibles para poder recorrer la app entera.
      if (enLogin || primero === undefined || primero === 'index' || primero === 'dev') {
        router.replace('/');
      }
      return;
    }

    // Con sesion: cada rol a su sitio. El staff no entra a las pantallas del
    // alumno con su sesion de turno — para ver su propia billetera existe
    // `/auth/switch-to-student`.
    const esStaff = state.session.role !== 'student';
    const destino = esStaff ? '/staff' : '/student';

    if (enLogin || enTurno || primero === undefined || primero === 'index') {
      router.replace(destino);
      return;
    }

    const enZonaCorrecta = esStaff ? primero === 'staff' : primero !== 'staff';
    if (!enZonaCorrecta) router.replace(destino);
  }, [state, segments, router]);

  return null;
}

const styles = StyleSheet.create({
  splash: { flex: 1, backgroundColor: colors.canvas },
});
