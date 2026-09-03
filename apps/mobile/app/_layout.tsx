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
import Constants from 'expo-constants';
import { setApiBase, setCredentialProvider } from '../src/data/api';
import { currentToken, getDeviceToken, restoreSession } from '../src/data/session';
import { restaurarCuentaDeFirebase } from '../src/data/auth';
import { useSession } from '../src/data/session-hooks';
import { hydrate, hydrateStaff } from '../src/data/hydrate';
import { marcarHidratando, marcarIntentoTerminado } from '../src/data/store';
import { CargandoSeccion } from '../src/design/loading';

/**
 * El cliente HTTP toma sus credenciales de aqui.
 *
 * Se conecta una sola vez al cargar el modulo, antes de que cualquier pantalla
 * pida datos. `api.ts` no importa el modulo de sesion a proposito —la capa de red
 * no tiene por que saber que los tokens viven en el llavero— y este es el punto
 * donde las dos mitades se unen.
 */
setCredentialProvider({ getToken: currentToken, getDeviceToken });

/**
 * `EXPO_PUBLIC_API_URL=auto`: la api local de la maquina que sirve el bundle.
 *
 * La IP del Mac cambia con cada wifi, y con ella se caen a la vez Metro y la
 * api. Metro ya sabe su propio host y lo publica en `hostUri`, y la api corre
 * en la misma maquina: derivarla de ahi hace que la direccion siga a la red
 * sola, igual para el simulador que para un telefono por wifi.
 *
 * Se resuelve aqui y no en `api.ts` porque necesita `expo-constants`, y aquel
 * archivo se prueba en Node contra una api de verdad — un modulo nativo dentro
 * romperia el unico test que detecta que el cliente y el servidor se separen.
 *
 * Solo en `__DEV__`: en un build publicado no hay servidor de desarrollo del
 * que heredar nada.
 */
if (__DEV__ && process.env.EXPO_PUBLIC_API_URL === 'auto') {
  const maquina = Constants.expoConfig?.hostUri?.split(':')[0];
  if (maquina !== undefined && maquina.length > 0) setApiBase(`http://${maquina}:3000/v1`);
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(DISPLAY_FONTS);

  useEffect(() => {
    if (fontError !== null) {
      // La app funciona sin Archivo: los titulares caen a la fuente del
      // sistema. Se registra, pero no se bloquea la puerta por una fuente.
      console.warn('No se pudo cargar Archivo:', fontError.message);
    }
  }, [fontError]);

  // Recuperar la sesion del llavero antes de decidir a donde va la app. Si no
  // hay token de Sinchi, se intenta con la credencial de Firebase: es la unica
  // sesion que tiene quien todavia no esta vinculado a ninguna ficha, y sin este
  // segundo intento volvia al login en cada arranque.
  useEffect(() => {
    void restoreSession(restaurarCuentaDeFirebase);
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
        <Portada />
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
          <Stack.Screen name="explore/index" />
          <Stack.Screen name="explore/[slug]" />
          <Stack.Screen name="student" />
          <Stack.Screen name="staff" />
          <Stack.Screen name="pay/[membershipId]" options={{ presentation: 'modal' }} />
          <Stack.Screen name="plan-change/[membershipId]" options={{ presentation: 'modal' }} />
          <Stack.Screen name="charge/[membershipId]" options={{ presentation: 'modal' }} />
          <Stack.Screen name="member/[membershipId]" options={{ presentation: 'modal' }} />
          <Stack.Screen name="enroll" options={{ presentation: 'modal' }} />
          <Stack.Screen name="claims" options={{ presentation: 'modal' }} />
          <Stack.Screen name="manual" options={{ presentation: 'modal' }} />
          {/* A pantalla completa y sin animacion lateral: es la camara, no una
              ficha que se consulta. Se queda abierta DEBAJO del resultado para
              que el siguiente alumno no tenga que pasar por la puerta. */}
          <Stack.Screen
            name="scan"
            options={{ presentation: 'fullScreenModal', animation: 'fade' }}
          />
          <Stack.Screen name="shift" options={{ animation: 'fade' }} />
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
      .then(() => {
        if (!cancelado) marcarIntentoTerminado();
      })
      .catch((error: unknown) => {
        // Sin conexion no se borra lo que ya habia: el alumno en la puerta del
        // gimnasio prefiere ver su ultimo estado conocido a una pantalla vacia.
        // Y se guarda POR QUE fallo: en un arranque limpio no hay nada que
        // conservar, y una pantalla vacia sin explicacion se lee como "perdiste
        // tus datos" en vez de "no llegue a la api".
        console.warn('No se pudieron cargar los datos:', error);
        if (!cancelado) {
          marcarIntentoTerminado(
            error instanceof Error ? error.message : 'No se pudo conectar con la api.',
          );
        }
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
/**
 * `explore` es compartida por una razon que no es de comodidad: el directorio de
 * gimnasios se puede mirar SIN sesion, con la cuenta a medio vincular y con
 * sesion de alumno. Es la unica pantalla del producto que atiende a alguien que
 * todavia no es de ningun gimnasio.
 *
 * `gym-signup` va con ella y por lo mismo: quien registra su gimnasio llega
 * desde el directorio, y su cuenta puede estar en cualquiera de esos tres
 * estados. Una ruta que no este en estas listas se redirige EN SILENCIO —sin
 * error y sin pantalla— asi que anadir una y olvidarse de esto es escribirla
 * para nadie.
 */
const RUTAS_COMPARTIDAS = new Set(['settings', 'explore', 'gym-signup']);

const RUTAS_DE: Readonly<Record<'staff' | 'student', ReadonlySet<string>>> = {
  staff: new Set(['charge', 'result', 'member', 'enroll', 'claims', 'manual', 'scan']),
  student: new Set(['pay', 'plan-change']),
};

/**
 * Tapa la app hasta que hay algo de verdad que ensenar.
 *
 * El arranque mostraba la billetera de Mathyu Quispe y sus tres gimnasios
 * inventados durante los segundos que tardan el llavero y `/me`, y luego
 * cambiaban por los reales delante del alumno. Con el store ya vacio lo que se
 * veria en su lugar es una pantalla a medio llenar, que no es mejor: sigue
 * afirmando "no tienes membresias" a alguien que si las tiene.
 *
 * Va ENCIMA del Stack y no en su lugar: `SessionRouter` y `DataLoader` viven
 * dentro del arbol, y devolver otra cosa antes de montarlos deja la sesion sin
 * restaurar y la carga sin empezar. La app se monta debajo, tapada.
 */
function Portada() {
  const state = useSession();

  // Solo mientras se lee el llavero, que son milisegundos. Es corto pero no
  // se puede saltar: hasta que no se sabe el rol no se sabe QUE barra de
  // pestanas toca, y montar la del alumno para cambiarla por la del staff se
  // ve como un fallo. La espera larga —la de la red— ya no se tapa: ocurre
  // dentro de la app, en `CargandoSeccion`.
  if (state.status !== 'loading') return null;

  return (
    <View style={styles.portada}>
      <CargandoSeccion texto="" size={52} />
    </View>
  );
}

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
    const enTurno = primero === 'shift';
    // La puerta de desarrollo tambien: es de donde sale el modo demostracion.
    // Sin esto, tocar "Probar sin Google" navegaba a /dev y este efecto lo
    // devolvia a /login en el mismo instante — se veia como que no pasaba nada.
    const enDev = __DEV__ && primero === 'dev';
    // La invitacion se abre SIN sesion —es lo que viene a crear— y por eso entra
    // en la lista. Es la misma trampa que ya se pago con /dev: sin esto, el
    // enlace navegaba y este efecto lo devolvia a /login en el mismo instante.
    const enInvitacion = primero === 'invite';
    // El directorio se mira sin cuenta: quien busca dojo todavia no tiene una, y
    // exigirsela para ver una lista es perderlo en la primera pantalla.
    const enDirectorio = primero === 'explore';
    /**
     * El alta de un gimnasio sale del directorio, y quien la abre casi siempre
     * es una cuenta RECIEN creada sin ficha en ningun padron — que es el estado
     * `unlinked`, cuya rama devuelve al directorio todo lo que no sea el codigo
     * de vinculacion. Sin esta excepcion el boton rebotaba a `/explore` sin
     * mostrar nada, y el fallo era mudo: ni error, ni ruta desconocida, nada.
     */
    const enAltaDeGimnasio = primero === 'gym-signup';

    if (state.status === 'signed_out') {
      if (!enLogin && !enTurno && !enDev && !enInvitacion && !enDirectorio) {
        router.replace('/login');
      }
      return;
    }

    if (state.status === 'unlinked') {
      /**
       * Cuenta creada y sin ficha en ningun padron: aterriza en el DIRECTORIO,
       * no en el codigo de seis digitos.
       *
       * Antes lo primero que veia quien acababa de instalar la app era un numero
       * que solo sirve si ya hay un gimnasio esperandolo con su ficha hecha. Al
       * que todavia no entrena en ningun sitio —que es justo a quien este
       * producto quiere— la app le abria con una pared.
       *
       * El codigo NO desaparece: sigue en `/link`, a un toque desde el
       * directorio. Hace falta para el alumno al que su gimnasio dio de alta por
       * DNI sin invitarlo, que es el unico camino que le queda para que esa
       * ficha llegue a su app — el auto-vinculo por correo solo existe para el
       * dueno (`tryLinkOwnerByEmail`).
       */
      if (primero !== 'link' && !enDirectorio && !enAltaDeGimnasio) router.replace('/explore');
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
  portada: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.canvas,
    alignItems: 'center',
    justifyContent: 'center',
    // Por encima del Stack y de la barra de pestanas.
    zIndex: 10,
  },
});
