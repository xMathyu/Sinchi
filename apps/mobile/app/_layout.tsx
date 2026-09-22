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
import { COLORS_DARK } from '@sinchi/ui';
import { DISPLAY_FONTS } from '../src/design/fonts';
import { ThemeProvider, useTheme } from '../src/design/theme';
import Constants from 'expo-constants';
import { setApiBase, setCredentialProvider } from '../src/data/api';
import { clearSession, currentToken, restoreSession } from '../src/data/session';
import { restoreFirebaseAccount } from '../src/data/auth';
import { restoreAppearance } from '../src/data/appearance';
import { useAppearance, useWelcomeState, useSession } from '../src/data/session-hooks';
import { markWelcomeSeen, restoreWelcomeState } from '../src/data/welcome';
import { hydrate, hydrateStaff } from '../src/data/hydrate';
import { markHydrating, markHydrationDone, resetState } from '../src/data/store';
import { SectionLoader } from '../src/design/loading';

/**
 * El cliente HTTP toma sus credenciales de aqui.
 *
 * Se conecta una sola vez al cargar el modulo, antes de que cualquier pantalla
 * pida datos. `api.ts` no importa el modulo de sesion a proposito —la capa de red
 * no tiene por que saber que los tokens viven en el llavero— y este es el punto
 * donde las dos mitades se unen.
 */
setCredentialProvider({
  getToken: currentToken,
  // Y la vuelta: si el servidor rechaza la sesión, se suelta aquí mismo.
  // `SessionRouter` reacciona al `signed_out` y lleva al login, que es la salida
  // que antes había que adivinar en Ajustes. Ver `onUnauthorized` en `api.ts`.
  onUnauthorized: () => {
    void clearSession();
  },
});

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
    void restoreSession(restoreFirebaseAccount);
    void restoreWelcomeState();
    // Del mismo llavero y en la misma tanda: la portada espera a las tres, y
    // pedirlas en fila sumaria tres esperas donde cabe una.
    void restoreAppearance();
  }, []);

  if (!fontsLoaded && fontError === null) {
    return <View style={styles.splash} />;
  }

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <SessionRouter />
        <DataLoader />
        <Portada />
        <AppStack />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

/**
 * La navegacion, en su propio componente porque necesita el tema.
 *
 * `RootLayout` monta el `ThemeProvider`, asi que no puede leerlo: un componente
 * no ve el contexto que el mismo pone. Este si, y de ahi salen las dos cosas
 * que antes estaban clavadas en oscuro: la barra de estado y el fondo que el
 * Stack ensena entre pantallas.
 */
function AppStack() {
  const theme = useTheme();

  return (
    <>
      {/* `auto` no sirve: sigue al TELEFONO, y aqui manda la preferencia de la
          persona. Con el tema claro forzado sobre un telefono en oscuro, `auto`
          pintaria la hora en blanco sobre la barra clara de la app. */}
      <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
          // El hueco que se ve mientras una pantalla entra y otra sale. Sin
          // esto lo pinta la navegacion, que no conoce el tema y lo deja
          // blanco: un destello de luz en cada transicion del tema oscuro.
          contentStyle: { backgroundColor: theme.colors.canvas },
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="welcome" options={{ animation: 'fade' }} />
        <Stack.Screen name="login" options={{ animation: 'fade' }} />
        <Stack.Screen name="dev" options={{ presentation: 'modal' }} />
        <Stack.Screen name="explore/index" />
        <Stack.Screen name="explore/[slug]" />
        <Stack.Screen name="chat/[slug]" />
        <Stack.Screen name="inbox/[conversationId]" />
        <Stack.Screen name="student" />
        <Stack.Screen name="staff" />
        <Stack.Screen name="pay/[membershipId]" options={{ presentation: 'modal' }} />
        <Stack.Screen name="plan-change/[membershipId]" options={{ presentation: 'modal' }} />
        <Stack.Screen name="charge/[membershipId]" options={{ presentation: 'modal' }} />
        <Stack.Screen name="member/[membershipId]" options={{ presentation: 'modal' }} />
        <Stack.Screen name="enroll" options={{ presentation: 'modal' }} />
        <Stack.Screen name="manual" options={{ presentation: 'modal' }} />
        {/* A pantalla completa y sin animacion lateral: es la camara, no una
            ficha que se consulta. Se queda abierta DEBAJO del resultado para
            que el siguiente alumno no tenga que pasar por la puerta. */}
        <Stack.Screen
          name="scan"
          options={{ presentation: 'fullScreenModal', animation: 'fade' }}
        />
        <Stack.Screen
          name="result/[membershipId]"
          options={{ presentation: 'fullScreenModal', animation: 'fade' }}
        />
        <Stack.Screen name="settings" options={{ presentation: 'modal' }} />
        {/* La oferta del gimnasio. Van como modal y no como pestaña porque no
            se consultan a diario: se entra a cambiar un precio y se sale. */}
        <Stack.Screen name="plans/index" options={{ presentation: 'modal' }} />
        <Stack.Screen name="plans/[planId]" options={{ presentation: 'modal' }} />
        <Stack.Screen name="pricing" options={{ presentation: 'modal' }} />
        <Stack.Screen name="gym-logo" options={{ presentation: 'modal' }} />
        <Stack.Screen name="events/index" options={{ presentation: 'modal' }} />
        <Stack.Screen name="events/[eventId]" options={{ presentation: 'modal' }} />
        <Stack.Screen name="events/edit/[eventId]" options={{ presentation: 'modal' }} />
        <Stack.Screen name="routines/index" options={{ presentation: 'modal' }} />
        <Stack.Screen name="routines/[routineId]" options={{ presentation: 'modal' }} />
        <Stack.Screen name="routines/edit/[routineId]" options={{ presentation: 'modal' }} />
      </Stack>
    </>
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
 * `hydrating` y las pantallas lo pueden usar para no ensenar datos falsos como
 * si fueran del servidor.
 */
function DataLoader() {
  const state = useSession();

  useEffect(() => {
    /**
     * Sin sesión de Sinchi, el store no puede conservar lo de nadie.
     *
     * «Cerrar sesión» ya lo vaciaba, pero la sesión también se cae sola —un 401
     * suelta el token en `onUnauthorized`— y ese camino dejaba la billetera y el
     * error de carga de la persona anterior. Mientras la cuenta sin ficha vivía en
     * otra pantalla no se notaba; con la misma billetera, quien entraba después
     * leía «Sesión inválida o expirada» de otra cuenta, y habría visto sus
     * membresías si las tenía. Se vacía aquí porque aquí se ven todos los cambios
     * de sesión, vengan de donde vengan. La demostración no: su store es el dato.
     */
    if (state.status === 'signed_out' || state.status === 'unlinked') {
      resetState();
      return;
    }
    if (state.status !== 'signed_in') return;

    let cancelado = false;
    markHydrating(true);

    // Dos cargas distintas porque son dos preguntas distintas: el alumno pide su
    // billetera, el staff pide el padron del gimnasio donde trabaja. Un
    // recepcionista no tiene membresia ahi, asi que pedirle `/me` devolveria una
    // lista vacia y la pantalla quedaria en blanco sin explicar por que.
    const session = state.session;
    const carga =
      session.role === 'student'
        ? hydrate()
        : hydrateStaff({
            userId: session.userId,
            tenantId: session.tenantId,
            role: session.role,
          });

    void carga
      .then(() => {
        if (!cancelado) markHydrationDone();
      })
      .catch((error: unknown) => {
        // Sin conexion no se borra lo que ya habia: el alumno en la puerta del
        // gimnasio prefiere ver su ultimo estado conocido a una pantalla vacia.
        // Y se guarda POR QUE fallo: en un arranque limpio no hay nada que
        // conservar, y una pantalla vacia sin explicacion se lee como "perdiste
        // tus datos" en vez de "no llegue a la api".
        console.warn('No se pudieron cargar los datos:', error);
        if (!cancelado) {
          markHydrationDone(
            error instanceof Error ? error.message : 'No se pudo conectar con la api.',
          );
        }
      });

    return () => {
      cancelado = true;
    };
    // Se rehidrata al cambiar de persona o de ROL, no en cada render.
    //
    // El rol entro con el cambio de modo. Hasta entonces no podia cambiar dentro
    // de una sesion, asi que bastaba con la persona; ahora el dueno que pasa a
    // alumno es el mismo `userId` y sigue `signed_in`, y sin esta dependencia el
    // efecto NO se volvia a disparar: `switchMode` vacia el store y nadie lo
    // volvia a llenar. La billetera quedaba en blanco y la cabecera de ajustes
    // mostraba «· identidad Sinchi» sin nombre.
    //
    // Y no es solo que falte cargar: son dos cargas DISTINTAS —`hydrate` pide la
    // billetera, `hydrateStaff` pide el padron— asi que el rol es exactamente lo
    // que decide cual toca.
    //
    // El TENANT entro con el cambio de local, y volvio a pasar exactamente lo
    // mismo un escalon mas abajo: el dueno que salta de un gimnasio suyo al otro
    // es el mismo `userId`, el mismo `role` y sigue `signed_in` — solo cambia el
    // gimnasio. Sin esta dependencia el efecto no se disparaba, y como
    // `switchGym` vacia el store, el padron se quedaba en «Trayendo el
    // padron...» para siempre. La sesion nueva ya era la correcta; lo que
    // faltaba era ir a buscar los datos.
  }, [
    state.status,
    state.status === 'signed_in' ? state.session.userId : null,
    state.status === 'signed_in' ? state.session.role : null,
    state.status === 'signed_in' ? state.session.tenantId : null,
  ]);

  return null;
}

/**
 * Rutas de detalle, que el Stack presenta ENCIMA de las pestanas.
 *
 * No viven bajo `/staff` ni bajo `/student` porque son modales del Stack raiz, y
 * la regla de zonas las trataba como territorio ajeno: con sesion de staff,
 * abrir el cobro o los ajustes rebotaba a `/staff` en el mismo instante. Se ve
 * como que el boton no hace nada, y por eso el modo staff no tenia forma de
 * cerrar sesion.
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
 * desde el directorio o desde la tarjeta de dueno del login, y su cuenta puede
 * estar en cualquiera de esos tres estados —incluida ninguna. Una ruta que no
 * este en estas listas se redirige EN SILENCIO —sin error y sin pantalla— asi
 * que anadir una y olvidarse de esto es escribirla para nadie.
 *
 * `routines` va con ellas por lo mismo, y es la primera pantalla del producto
 * que atiende a los TRES publicos a la vez: el dueno que la escribe, el alumno
 * que la abre desde su gimnasio y quien todavia no entrena en ningun sitio y
 * llega desde el directorio. Quien ve que NO lo decide esta lista sino la api,
 * que a quien no le toca le devuelve el titulo y ni un video.
 *
 * `chat` es la segunda con los tres publicos, y por lo mismo: le escribe al
 * gimnasio el alumno con sesion, la cuenta sin ficha que acaba de llegar al
 * directorio y —para que el boton no rebote en silencio— quien todavia no entro,
 * que ve ahi mismo la invitacion a hacerlo.
 */
const SHARED_ROUTES = new Set(['settings', 'explore', 'gym-signup', 'routines', 'chat']);

const ROUTES_OF: Readonly<Record<'staff' | 'student', ReadonlySet<string>>> = {
  staff: new Set([
    'charge',
    'result',
    'member',
    'enroll',
    'manual',
    'scan',
    // La oferta del local. Del staff y no compartidas: el alumno no tiene nada
    // que hacer en la pantalla donde se escriben los precios. Dentro, `plans` y
    // `pricing` se apagan solas para recepcion, que las lee pero no las toca.
    'plans',
    'pricing',
    // Sin esto la ruta se redirige EN SILENCIO —sin error, sin pantalla— y la
    // pantalla queda escrita para nadie. Ya se pagó una vez con `plans`.
    'events',
    'schedules',
    // Donde queda el local. Del staff: recepcion la LEE —se la preguntan por
    // telefono tanto como el precio— y dentro se apaga para que no la escriba.
    'location',
    // Su logo. Del staff por lo mismo que `location`: recepción lo ve, y dentro
    // se apaga para que no lo cambie.
    'gym-logo',
    // Un hilo de la bandeja. La lista es pestana (`staff/messages`); el hilo se
    // presenta encima, y sin esto rebotaba a la puerta al tocar una conversacion.
    'inbox',
  ]),
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
  const theme = useTheme();
  const state = useSession();
  const welcome = useWelcomeState();
  const appearance = useAppearance();

  // Solo mientras se lee el llavero, que son milisegundos. Es corto pero no
  // se puede saltar: hasta que no se sabe el rol no se sabe QUE barra de
  // pestanas toca, y montar la del alumno para cambiarla por la del staff se
  // ve como un fallo. La espera larga —la de la red— ya no se tapa: ocurre
  // dentro de la app, en `SectionLoader`.
  // También mientras se resuelve si toca la bienvenida: son dos lecturas del
  // mismo llavero, lanzadas a la vez, y decidir con una sola manda al login a
  // quien iba a ver la bienvenida y lo saca un instante después.
  // Y la tercera lectura es el tema: hasta que llega, la app se pinta con el
  // del teléfono, y quien lo tiene en oscuro y eligió claro vería la app entera
  // cambiar de color delante suyo. Detrás de la portada ese cambio no se ve.
  if (state.status !== 'loading' && welcome !== 'cargando' && appearance !== null) return null;

  return (
    <View style={[styles.portada, { backgroundColor: theme.colors.canvas }]}>
      <SectionLoader text="" size={52} />
    </View>
  );
}

function SessionRouter() {
  const state = useSession();
  const welcome = useWelcomeState();
  const router = useRouter();
  // `useSegments` viene tipado como tupla segun las rutas conocidas, y aqui se
  // lee por posicion sin importar cuantos niveles haya.
  const segments = useSegments() as readonly string[];

  useEffect(() => {
    if (state.status === 'loading' || welcome === 'cargando') return;

    const first = segments[0];
    const onWelcome = first === 'welcome';
    const enLogin = first === 'login';
    // La puerta de desarrollo tambien: es de donde sale el modo demostracion.
    // Sin esto, tocar "Probar sin Google" navegaba a /dev y este efecto lo
    // devolvia a /login en el mismo instante — se veia como que no pasaba nada.
    const enDev = __DEV__ && first === 'dev';
    // La invitacion se abre SIN sesion —es lo que viene a crear— y por eso entra
    // en la lista. Es la misma trampa que ya se pago con /dev: sin esto, el
    // enlace navegaba y este efecto lo devolvia a /login en el mismo instante.
    const onInvite = first === 'invite';
    // El directorio se mira sin cuenta: quien busca dojo todavia no tiene una, y
    // exigirsela para ver una lista es perderlo en la primera pantalla.
    const enDirectorio = first === 'explore';
    /**
     * El alta de un gimnasio sale del directorio, y quien la abre casi siempre
     * es una cuenta RECIEN creada sin ficha en ningun padron — que es el estado
     * `unlinked`, cuya rama devuelve a sus pestañas todo lo que no este en su
     * lista. Sin esta excepcion el boton rebotaba sin mostrar nada, y el fallo
     * era mudo: ni error, ni ruta desconocida, nada.
     */
    const onGymSignUp = first === 'gym-signup';
    // Escribirle a un gimnasio nace en el directorio, que se mira sin cuenta: la
    // pantalla del chat es la que invita a entrar, no este efecto el que rebota.
    const onChat = first === 'chat';

    if (state.status === 'signed_out') {
      /**
       * La bienvenida intercepta el ARRANQUE, y nada más.
       *
       * Quien llega por un enlace —una invitación, la ficha de un gimnasio del
       * directorio, el alta de un local— viene a algo concreto, y meterle tres
       * láminas por delante es perderlo en la puerta. Por eso la condición no
       * es «no la ha visto» sino «no la ha visto Y no venía a otra cosa».
       */
      const enArranque = first === undefined || first === 'index' || first === 'login';
      if (welcome === 'pendiente' && enArranque) {
        if (!onWelcome) router.replace('/welcome');
        return;
      }

      /**
       * El alta de un gimnasio tambien se abre SIN sesion, y no por comodidad.
       *
       * Su primera vista es la oferta —lo que Sinchi le hace a un gimnasio y
       * cuanto cuesta— y esa pantalla existe justamente para quien todavia no
       * tiene cuenta. Exigirsela antes de ensenarle nada es pedirle el correo a
       * quien acaba de entrar a mirar el escaparate. La cuenta se crea DENTRO
       * del flujo, en el paso siguiente, que es donde de verdad hace falta:
       * `registerGym` firma el alta con la credencial de Firebase.
       */
      if (
        !enLogin &&
        !enDev &&
        !onInvite &&
        !enDirectorio &&
        !onGymSignUp &&
        !onChat &&
        !onWelcome
      ) {
        router.replace('/login');
      }
      return;
    }

    if (state.status === 'unlinked') {
      /**
       * Cuenta creada y sin ficha en ningun padron: aterriza en SU BILLETERA, la
       * misma que la del alumno.
       *
       * Fue primero el codigo de seis digitos, una pared para quien todavia no
       * entrena en ningun sitio; despues el directorio a secas, y despues unas
       * pestañas propias. Las dos ultimas tenian el mismo defecto: la misma
       * persona veia otra app segun tuviera o no una ficha. Ahora cambia solo lo
       * que ya no puede ser igual —su QR es el de la cuenta, y la billetera esta
       * vacia— y la ficha le llega como una solicitud (decisiones §14).
       *
       * `settings` es Mi cuenta: tambien sin ficha se corrige el nombre y se
       * cierra sesion desde ahi (decisiones §15).
       */
      if (
        first !== 'student' &&
        first !== 'settings' &&
        !enDirectorio &&
        !onGymSignUp &&
        !onChat
      ) {
        router.replace('/student');
      }
      return;
    }

    if (state.status === 'demo') {
      // Sin sesión real: el rol lo decide el store de demostración, y las dos
      // zonas quedan accesibles para poder recorrer la app entera.
      if (enLogin || first === undefined || first === 'index' || first === 'dev') {
        router.replace('/');
      }
      return;
    }

    void markWelcomeSeen();

    // Con sesion: cada rol a su sitio. El staff no entra a las pantallas del
    // alumno con su sesion de trabajo — para ver su propia billetera existe
    // `/auth/switch-to-student`.
    const esStaff = state.session.role !== 'student';
    const destino = esStaff ? '/staff' : '/student';

    if (enLogin || first === undefined || first === 'index') {
      router.replace(destino);
      return;
    }

    const zona = esStaff ? 'staff' : 'student';
    const permitida =
      first === zona || SHARED_ROUTES.has(first) || ROUTES_OF[zona].has(first);
    if (!permitida) router.replace(destino);
  }, [state, welcome, segments, router]);

  return null;
}

const styles = StyleSheet.create({
  /**
   * Oscuro SIEMPRE, aunque el tema sea claro, y no es un descuido: esto no es
   * una pantalla de la app sino la continuacion de la de arranque nativa, que
   * es oscura en los dos temas porque `splash-icon.png` trae su propio fondo
   * oscuro horneado. Pintarlo del tema abriria un corte de color en medio del
   * arranque. El color es el de `expo-splash-screen` en `app.json`.
   */
  splash: { flex: 1, backgroundColor: COLORS_DARK.screen },
  portada: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    // Por encima del Stack y de la barra de pestanas.
    zIndex: 10,
  },
});
