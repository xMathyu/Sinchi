/**
 * Avisos al teléfono: pedir permiso, apuntar el teléfono y abrir lo que avisa.
 *
 * Existe porque un gimnasio lo pidió: «que llegue notificación cuando un alumno
 * se inscriba». El servidor manda por Expo (`PushService`, migración 0029); aquí
 * vive lo que el teléfono pone: el permiso, el token y qué pantalla abre el
 * aviso al tocarlo.
 *
 * EL MÓDULO SE CARGA SOLO SI EL BINARIO LO TRAE, y se pregunta antes.
 * `expo-notifications` llama a `requireNativeModule` al importarse, y en un
 * binario que no lo trae —cualquier dev client anterior a este cambio, o el que
 * alguien tenga en el simulador— eso tumba la app entera al abrir. Un `try`
 * alrededor del `require` NO alcanza: se probó, y Metro reporta el error del
 * módulo como no capturado y pinta la pantalla roja igual. Por eso primero se
 * pregunta con `requireOptionalNativeModule`, que devuelve `null` sin lanzar.
 * Sin el módulo la app funciona igual: solo no hay avisos, que es lo que había.
 *
 * NADA DE AQUÍ PUEDE ROMPER EL ARRANQUE NI EL CIERRE DE SESIÓN. Un permiso
 * denegado, un Android sin Firebase o Expo caído dejan a la app sin avisos, no
 * sin app. Por eso ninguna función lanza.
 */
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { requireOptionalNativeModule } from 'expo';
import * as SecureStore from 'expo-secure-store';
import { router } from 'expo-router';
import { registerPushDeviceRequest, removePushDeviceRequest } from './api';

type NotificationsModule = typeof import('expo-notifications');

let loaded: NotificationsModule | null | undefined;

/** El módulo, o `null` si este binario no lo trae. */
function notifications(): NotificationsModule | null {
  if (loaded !== undefined) return loaded;
  try {
    // Apagado en el build (`SINCHI_PUSH`, ver `app.config.ts`): el binario no
    // tiene el entitlement de APNs, y pedir el permiso sería prometer algo que
    // no va a llegar.
    const enabled = (Constants.expoConfig?.extra as { push?: boolean } | undefined)?.push === true;
    loaded =
      !enabled || requireOptionalNativeModule('ExpoPushTokenManager') === null
        ? null
        : (require('expo-notifications') as NotificationsModule);
  } catch {
    loaded = null;
  }
  return loaded;
}

/** El último token que se apuntó desde este teléfono, para poder quitarlo al salir. */
const TOKEN_KEY = 'sinchi.push.token';

/**
 * El canal de Android de las reservas.
 *
 * Con nombre propio y no el canal por defecto: Android deja silenciar por canal
 * desde los ajustes del teléfono, y quien no quiera enterarse de las pruebas
 * tiene que poder callarlas sin callar todo Sinchi. El mismo id lo manda la api
 * en cada aviso (`bookingNotice`).
 */
const BOOKINGS_CHANNEL = 'reservas';

/**
 * Lo que se hace una vez, al arrancar: cómo se ve un aviso con la app abierta,
 * el canal de Android y qué pasa al tocarlo.
 *
 * Con la app abierta el aviso se muestra igual —arriba, con sonido—: el
 * recepcionista que está mirando el padrón cuando alguien reserva es justo el
 * que tiene que enterarse. Y `onArrive` deja que quien llama refresque lo que
 * cambió (la insignia de Reservas) sin esperar al intervalo.
 */
export function configurePush(onArrive: (data: Record<string, unknown>) => void): () => void {
  const Notifications = notifications();
  if (Notifications === null) return () => {};

  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });

    if (Platform.OS === 'android') {
      void Notifications.setNotificationChannelAsync(BOOKINGS_CHANNEL, {
        name: 'Reservas',
        description: 'Cuando alguien reserva una prueba, una clase suelta o su inscripción.',
        importance: Notifications.AndroidImportance.HIGH,
      }).catch(() => {});
    }

    const received = Notifications.addNotificationReceivedListener((notification) => {
      onArrive(notification.request.content.data ?? {});
    });
    const tapped = Notifications.addNotificationResponseReceivedListener((response) => {
      open(response.notification.request.content.data);
    });

    // La app estaba cerrada y se abrió tocando el aviso: el listener de arriba
    // llega tarde para ese toque, que queda guardado como «el último».
    const last = Notifications.getLastNotificationResponse();
    if (last !== null) {
      open(last.notification.request.content.data);
      Notifications.clearLastNotificationResponse();
    }

    return () => {
      received.remove();
      tapped.remove();
    };
  } catch {
    return () => {};
  }
}

/**
 * Lleva a la pantalla que el aviso nombra.
 *
 * Solo rutas de la app —empiezan por `/`— y con `navigate`, no `push`: si ya se
 * está en Reservas, un `push` apilaba otra Reservas encima que había que cerrar.
 * Lo que la sesión no puede ver, lo reencamina `SessionRouter` como a cualquier
 * enlace.
 */
function open(data: Record<string, unknown> | undefined, attempt = 0): void {
  const url = data?.url;
  if (typeof url !== 'string' || !url.startsWith('/')) return;
  // Al abrir en frío el router todavía no montó sus pantallas y `navigate` lanza
  // «before mounting the Root Layout». Se reintenta unas veces en vez de perder
  // el toque, que es justo el que trajo a la persona a la app.
  setTimeout(() => {
    try {
      router.navigate(url as never);
    } catch {
      if (attempt < 8) open(data, attempt + 1);
    }
  }, attempt === 0 ? 0 : 400);
}

/**
 * Apunta este teléfono a nombre de la sesión.
 *
 * `ask` decide si se pide el permiso o solo se usa el que ya hay. Se pide en el
 * modo staff, que es donde hoy hay algo que avisar —las reservas—; al alumno no
 * se le interrumpe con un permiso para avisos que todavía no existen, pero si ya
 * lo dio, su teléfono queda apuntado para cuando existan.
 *
 * Devuelve si quedó apuntado. No lanza.
 */
export async function registerPushDevice(options: { readonly ask: boolean }): Promise<boolean> {
  const Notifications = notifications();
  if (Notifications === null) return false;

  try {
    const current = await Notifications.getPermissionsAsync();
    let granted = current.granted;
    if (!granted && options.ask && current.canAskAgain) {
      granted = (await Notifications.requestPermissionsAsync()).granted;
    }
    if (!granted) return false;

    // Sin el id del proyecto de EAS, Expo no sabe a qué app pertenece el token.
    const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)
      ?.eas?.projectId;
    if (projectId === undefined) return false;

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await registerPushDeviceRequest(token, Platform.OS === 'ios' ? 'ios' : 'android');
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    return true;
  } catch (error) {
    // El caso normal de este `catch` es un Android compilado sin
    // `google-services.json`: Expo no puede pedirle el token a FCM. Se deja
    // constancia y se sigue, que la app funciona igual sin avisos.
    console.warn('No se pudo apuntar el teléfono para avisos:', error);
    return false;
  }
}

/**
 * Lo quita, antes de cerrar la sesión.
 *
 * Tiene que ir ANTES: la api solo quita el teléfono de quien lo pide, y sin
 * sesión ya no hay quien lo pida. Si falla —sin red en el mostrador— queda
 * apuntado a la persona que salió hasta que otra entre en ese teléfono y lo
 * vuelva a apuntar, que es cuando pasa a su nombre.
 */
export async function forgetPushDevice(): Promise<void> {
  try {
    const token = await SecureStore.getItemAsync(TOKEN_KEY);
    if (token === null) return;
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    await removePushDeviceRequest(token);
  } catch {
    // Ver arriba: el próximo que entre lo reclama.
  }
}
