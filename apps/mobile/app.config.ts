/**
 * La configuración de Expo, con lo que no puede vivir en `app.json`.
 *
 * `app.json` sigue siendo la base y es donde se lee todo lo demás: dos archivos
 * de configuración es una molestia, y por eso aquí va lo MÍNIMO que no cabe
 * allá. Son dos cosas —la clave de Google Maps y el `google-services.json` de
 * Android— y la razón de que no quepan es la misma: `app.json` es JSON, no puede
 * leer una variable de entorno, y ninguna de las dos se escribe en el repo.
 *
 * SOBRE LA CLAVE. No es un secreto, en el mismo sentido exacto en que no lo es
 * la de Firebase (ver `src/data/firebase.ts`): se compila DENTRO del
 * AndroidManifest del APK publicado, así que cualquiera la extrae de una
 * descarga. Rotarla no cambiaría eso. Lo que la protege es estar restringida, y
 * lo está por partida doble:
 *
 *   · a una sola api, `maps-android-backend` (el SDK de mapas de Android);
 *   · a la aplicación `fit.sinchi.app` firmada con una huella SHA-1 concreta.
 *
 * Fuera de un binario firmado con ese certificado, la clave no dibuja un mapa.
 *
 * Aun así no va escrita aquí, por lo mismo que la de Firebase: el escáner de
 * secretos de GitHub marca cualquier `AIza…` en cualquier archivo del repo, y un
 * aviso que siempre es falso entrena a ignorar los avisos de verdad. El valor
 * está en `.env.example`, que explica cómo sacarlo con `gcloud`.
 *
 * SIN LA CLAVE la app compila y funciona: el mapa de Android sale en gris y la
 * ficha del gimnasio sigue teniendo la dirección y los botones de cómo llegar,
 * que es lo que de verdad lleva a alguien a la puerta. iOS no la necesita —usa
 * Apple Maps, que no pide clave— así que el simulador nunca la echa de menos, y
 * eso es justo lo que hace fácil olvidarla al compilar para Android.
 */
import type { ConfigContext, ExpoConfig } from 'expo/config';
import { withEntitlementsPlist } from 'expo/config-plugins';

/**
 * EL `google-services.json` DE ANDROID, por lo mismo que la clave de mapas.
 *
 * Sin él Android no tiene FCM y Expo no le puede dar un token de avisos al
 * teléfono (migración 0029). Lleva una clave `AIza…` y por eso no se versiona:
 * en EAS va como variable de tipo ARCHIVO, `GOOGLE_SERVICES_JSON`, que EAS
 * convierte en la ruta del archivo al compilar. Sin la variable la app compila y
 * funciona; solo no le llegan avisos en Android, que es lo que había.
 */
const googleServicesFile = process.env.GOOGLE_SERVICES_JSON;

/**
 * LOS AVISOS AL TELÉFONO SE ENCIENDEN POR BUILD, con `SINCHI_PUSH=1`.
 *
 * El plugin de `expo-notifications` añade a iOS el entitlement `aps-environment`,
 * y un binario con ese entitlement no firma con un perfil que no lo tenga:
 * Apple lo exige en el App ID, y activar la capacidad invalida el perfil que ya
 * existe —pasó con Entrar con Apple, y el build murió a los diez minutos—.
 * Hasta que el App ID tenga Push, el perfil esté rehecho y EAS tenga la llave de
 * APNs (y la de FCM para Android), cualquier build con el plugin fallaría.
 *
 * Así el código entra a `main` sin romper el próximo envío a la tienda: sin la
 * variable, el binario sale como hasta ahora y la app no pide un permiso para
 * avisos que todavía no llegarían (`extra.push`, que lee `src/data/push.ts`).
 *
 * NO BASTA CON NO LISTAR EL PLUGIN. `@expo/prebuild-config` aplica el de
 * `expo-notifications` por su cuenta en cuanto el paquete está instalado
 * (`versionedExpoSDKPackages`), y así murió el build 14: «Provisioning profile
 * doesn't include the Push Notifications capability». Por eso, apagado, además
 * se QUITA `aps-environment` de los entitlements. Funciona por el orden de los
 * mods: cada uno corre su acción y después la del anterior, así que el que se
 * registra aquí —antes que los plugins por defecto— corre el último y su
 * borrado es el que queda. Comprobado con `expo config --type introspect`.
 */
const pushEnabled = process.env.SINCHI_PUSH === '1';

const withoutPushEntitlement = (config: ExpoConfig): ExpoConfig =>
  withEntitlementsPlist(config, (mod) => {
    delete mod.modResults['aps-environment'];
    return mod;
  });

const build = (config: ConfigContext['config']): ExpoConfig => ({
  ...(config as ExpoConfig),
  plugins: [
    ...(config.plugins ?? []),
    ...(pushEnabled
      ? [
          [
            'expo-notifications',
            { icon: './assets/notification-icon.png', color: '#2FD16D' },
          ] as [string, Record<string, string>],
        ]
      : []),
  ],
  extra: { ...config.extra, push: pushEnabled },
  android: {
    ...config.android,
    ...(googleServicesFile === undefined || googleServicesFile.length === 0
      ? {}
      : { googleServicesFile }),
    config: {
      ...config.android?.config,
      googleMaps: { apiKey: process.env.GOOGLE_MAPS_ANDROID_KEY ?? '' },
    },
  },
});

export default ({ config }: ConfigContext): ExpoConfig => {
  const resolved = build(config);
  return pushEnabled ? resolved : withoutPushEntitlement(resolved);
};
