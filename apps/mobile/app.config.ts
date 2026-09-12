/**
 * La configuración de Expo, con lo que no puede vivir en `app.json`.
 *
 * `app.json` sigue siendo la base y es donde se lee todo lo demás: dos archivos
 * de configuración es una molestia, y por eso aquí va lo MÍNIMO que no cabe
 * allá. Hoy es una sola cosa —la clave de Google Maps para Android— y la razón
 * de que no quepa es que `app.json` es JSON: no puede leer una variable de
 * entorno, y esta clave no se escribe en el repo.
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

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...(config as ExpoConfig),
  android: {
    ...config.android,
    config: {
      ...config.android?.config,
      googleMaps: { apiKey: process.env.GOOGLE_MAPS_ANDROID_KEY ?? '' },
    },
  },
});
