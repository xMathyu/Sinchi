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
import { hydrate, hydrateStaff } from '../src/data/hydrate';
import { marcarHidratando } from '../src/data/store';

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
        <DataLoader />
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
          <Stack.Screen name="member/[membershipId]" options={{ presentation: 'modal' }} />
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
/**
 * Trae los datos de verdad en cuanto hay sesion.
 *
 * Va aparte del enrutado porque son dos preguntas distintas: una es "a que
 * pantalla toca ir", la otra "con que datos se pinta". Mezclarlas hacia que
 * navegar volviera a pedir la billetera.
 *
 * Mientras no responda, las pantallas siguen mostrando lo que hubiera en el
 * store — que en un arranque limpio es la demostracion. Por eso se marca
 * `hidratando` y las pantallas lo pueden usar para no ensenar datos falsos como
 * si fueran del servidor.
 */
function DataLoader() {
  const state = useSession();

  useEffect(() => {
    if (state.status !== 'signed_in') return;

    let cancelado = false;
    marcarHidratando(true);

    // Dos cargas distintas porque son dos preguntas distintas: el alumno pide su
    // billetera, el staff pide el padron del gimnasio donde trabaja. Un
    // recepcionista no tiene membresia ahi, asi que pedirle `/me` devolveria una
    // lista vacia y la pantalla quedaria en blanco sin explicar por que.
    const sesion = state.session;
    const carga =
      sesion.role === 'student'
        ? hydrate()
        : hydrateStaff({
            userId: sesion.userId,
            tenantId: sesion.tenantId,
            role: sesion.role,
          });

    void carga
      .catch((error: unknown) => {
        // Sin conexion no se borra lo que ya habia: el alumno en la puerta del
        // gimnasio prefiere ver su ultimo estado conocido a una pantalla vacia.
        console.warn('No se pudieron cargar los datos:', error);
      })
      .finally(() => {
        if (!cancelado) marcarHidratando(false);
      });

    return () => {
      cancelado = true;
    };
    // Se rehidrata al cambiar de persona, no en cada render.
  }, [state.status, state.status === 'signed_in' ? state.session.userId : null]);

  return null;
}

/**
 * Rutas de detalle, que el Stack presenta ENCIMA de las pestanas.
 *
 * No viven bajo `/staff` ni bajo `/student` porque son modales del Stack raiz, y
 * la regla de zonas las trataba como territorio ajeno: con sesion de staff,
 * abrir el cobro o los ajustes rebotaba a `/staff` en el mismo instante. Se ve
 * como que el boton no hace nada, y por eso el modo staff no tenia forma de
 * cerrar turno.
 *
 * Se enumeran en vez de dejar pasar todo lo que no sea la zona contraria: una
 * pantalla nueva tiene que decidir de quien es, y olvidarse la deja fuera —que
 * es el fallo seguro. Al reves, olvidarse la dejaria accesible al rol
 * equivocado sin que nadie lo note.
 */
const RUTAS_COMPARTIDAS = new Set(['settings']);

const RUTAS_DE: Readonly<Record<'staff' | 'student', ReadonlySet<string>>> = {
  staff: new Set(['charge', 'result', 'member']),
  student: new Set(['pay', 'plan-change']),
};

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
    // La invitacion se abre SIN sesion —es lo que viene a crear— y por eso entra
    // en la lista. Es la misma trampa que ya se pago con /dev: sin esto, el
    // enlace navegaba y este efecto lo devolvia a /login en el mismo instante.
    const enInvitacion = primero === 'invite';

    if (state.status === 'signed_out') {
      if (!enLogin && !enTurno && !enDev && !enInvitacion) router.replace('/login');
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

    const zona = esStaff ? 'staff' : 'student';
    const permitida =
      primero === zona || RUTAS_COMPARTIDAS.has(primero) || RUTAS_DE[zona].has(primero);
    if (!permitida) router.replace(destino);
  }, [state, segments, router]);

  return null;
}

const styles = StyleSheet.create({
  splash: { flex: 1, backgroundColor: colors.canvas },
});
