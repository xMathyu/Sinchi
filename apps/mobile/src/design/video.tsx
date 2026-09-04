/**
 * El video de una rutina, reproducido DENTRO de la app.
 *
 * Se toca la miniatura y el reproductor aparece en su sitio, con la instrucción
 * del paso justo debajo. Es deliberado que no salte a otra pantalla: aprender un
 * uchimata es mirar diez segundos, leer la explicación y volver a mirar, y eso
 * no se hace navegando de ida y vuelta.
 *
 * Hay dos reproductores porque hay dos clases de video, y cuál toca lo decide el
 * dominio (`VideoLink.playback`), no esta pantalla:
 *
 *  · **`file`** — el archivo que el gimnasio subió, o un `.mp4` de su propio
 *    servidor. Va con el reproductor NATIVO: pantalla completa de verdad,
 *    control de velocidad —media clase de judo se entiende a 0.5x— y la barra de
 *    progreso del sistema;
 *  · **`embed`** — YouTube y Vimeo, que no sirven el archivo: o se embebe su
 *    reproductor, o no se ve.
 *
 * Y queda `external` para lo que no se puede reproducir —una carpeta de Drive,
 * un enlace de Instagram—: eso se abre fuera, que es lo honesto en vez de un
 * `WebView` en blanco.
 */
import { useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { WebView } from 'react-native-webview';
import ExternalLink from 'lucide-react-native/icons/external-link';
import Play from 'lucide-react-native/icons/play';
import { parseVideoLink, type VideoLink } from '@sinchi/shared';
import { withAlpha } from '@sinchi/ui';
import { Text } from './primitives';
import { useTheme } from './theme';

/** Abre lo que no se puede reproducir dentro. */
export function abrirVideo(url: string): void {
  void Linking.openURL(url).catch(() => {
    // Un enlace que el sistema no sabe abrir no puede tumbar la pantalla: la
    // rutina sigue teniendo sus instrucciones, que es la mitad que importa.
  });
}

type Tema = ReturnType<typeof useTheme>;

/**
 * `alto` fijo y proporción 16:9, que es lo que graba un celular en horizontal.
 * La miniatura se recorta —`cover`— y no se deforma: una técnica estirada se ve
 * mal hecha, y eso es lo contrario de lo que el gimnasio quiere enseñar.
 */
function marcoDe(theme: Tema, alto: number) {
  return {
    height: alto,
    borderRadius: theme.radii.lg,
    overflow: 'hidden' as const,
    backgroundColor: theme.colors.surfaceSunken,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
  };
}

type Marco = ReturnType<typeof marcoDe>;

/**
 * «Aquí hay un video», sin miniatura.
 *
 * Es lo que se pinta cuando el video es un archivo SUBIDO: no trae miniatura
 * —sacarla exige decodificar el primer fotograma, y eso ya es transcodificar— y
 * la api no firma su URL para una lista, donde nadie va a reproducir nada. Sin
 * este marcador, una rutina con video propio se ve igual que una sin video.
 */
export function MarcadorDeVideo({ alto = 168 }: { readonly alto?: number }) {
  const theme = useTheme();

  return (
    <View style={[marcoDe(theme, alto), { alignItems: 'center', justifyContent: 'center', gap: 8 }]}>
      <View
        style={{
          width: 46,
          height: 46,
          borderRadius: 23,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: withAlpha(theme.colors.ink, 0.12),
        }}
      >
        <Play size={19} color={theme.colors.textSecondary} fill={theme.colors.textSecondary} />
      </View>
      <Text variant="micro" color={theme.colors.textFaint}>
        Video
      </Text>
    </View>
  );
}

/**
 * La portada sola, sin reproducir nada.
 *
 * Es lo que va en las LISTAS, y no es una versión recortada por gusto: ahí la
 * tarjeta entera navega a la rutina, y un reproductor dentro se comería ese
 * toque para hacer otra cosa. Quien toca una fila de una lista quiere abrirla.
 */
export function PortadaDeVideo({
  url,
  alto = 168,
}: {
  readonly url: string;
  readonly alto?: number;
}) {
  const theme = useTheme();
  const video = parseVideoLink(url);
  if (video === null) return null;

  return <Portada video={video} marco={marcoDe(theme, alto)} />;
}

/** Miniatura que se convierte en reproductor. Es la de la FICHA. */
export function VideoDeRutina({
  url,
  etiqueta,
  alto = 168,
}: {
  readonly url: string;
  /** Para el lector de pantalla: «Ver el video de …». */
  readonly etiqueta: string;
  readonly alto?: number;
}) {
  const theme = useTheme();
  const [reproduciendo, setReproduciendo] = useState(false);
  const video = parseVideoLink(url);

  if (video === null) return null;
  const marco = marcoDe(theme, alto);

  if (reproduciendo && video.playback === 'file') {
    return (
      <View style={marco}>
        <ReproductorNativo url={video.url} />
      </View>
    );
  }

  if (reproduciendo && video.playback === 'embed') {
    return (
      <View style={marco}>
        <ReproductorEmbebido video={video} etiqueta={etiqueta} />
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Ver el video de ${etiqueta}`}
      onPress={() => {
        if (video.playback === 'external') abrirVideo(video.url);
        else setReproduciendo(true);
      }}
    >
      <Portada video={video} marco={marco} />
    </Pressable>
  );
}

/** Lo que se ve antes de tocar: la miniatura si la hay, y siempre el disco. */
function Portada({ video, marco }: { readonly video: VideoLink; readonly marco: Marco }) {
  const theme = useTheme();
  const fuera = video.playback === 'external';

  return (
    <View style={[marco, { alignItems: 'center', justifyContent: 'center' }]}>
      {video.thumbnailUrl === null ? null : (
        <Image
          source={{ uri: video.thumbnailUrl }}
          accessibilityIgnoresInvertColors
          resizeMode="cover"
          style={{ position: 'absolute', width: '100%', height: '100%' }}
        />
      )}

      {/* El disco va SIEMPRE, tenga miniatura o no: es lo que dice que esto se
          toca. Sin él, una imagen quieta parece decoración. */}
      <View
        style={{
          width: 54,
          height: 54,
          borderRadius: 27,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: withAlpha(theme.colors.ink, 0.82),
        }}
      >
        {fuera ? (
          <ExternalLink size={20} color={theme.colors.screen} />
        ) : (
          <Play size={22} color={theme.colors.screen} fill={theme.colors.screen} />
        )}
      </View>

      {video.thumbnailUrl === null ? (
        <Text variant="micro" color={theme.colors.textFaint} style={{ marginTop: 10 }}>
          {fuera ? 'Abrir el video' : 'Ver el video'}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * Reproductor nativo, para el archivo.
 *
 * `contentFit="contain"` y no `cover`: recortar la miniatura es una decisión de
 * maquetación, pero recortar el video es esconder media técnica. Un video
 * vertical queda con bandas y se ve entero, que es lo que hace falta.
 */
function ReproductorNativo({ url }: { readonly url: string }) {
  const player = useVideoPlayer(url, (instancia) => {
    // Arranca solo: se llegó aquí tocando el play, y pedir un segundo toque
    // dentro del reproductor es hacer trabajar dos veces por lo mismo.
    instancia.play();
    // En bucle no: una técnica se repite cuando la persona quiere, y un video
    // que vuelve a empezar solo tapa la instrucción que se estaba leyendo.
    instancia.loop = false;
  });

  return (
    <VideoView
      player={player}
      style={{ width: '100%', height: '100%' }}
      contentFit="contain"
      // Pantalla completa sí: una técnica se mira de cerca, y en una tarjeta de
      // 148px no se ve dónde va el pie de apoyo.
      fullscreenOptions={{ enable: true }}
      // El picture-in-picture NO: necesita permiso de audio en segundo plano en
      // el Info.plist, y sin declararlo activarlo aquí solo crea un botón que
      // falla.
      allowsPictureInPicture={false}
      nativeControls
    />
  );
}

/**
 * Reproductor de YouTube o Vimeo.
 *
 * Se carga como una PÁGINA con `baseUrl`, y no apuntando el `WebView` al embed
 * directamente. No es un rodeo: cargado a pelo, YouTube lo trata como una
 * petición sin origen y contesta «Video player configuration error — Error 153»
 * en vez del video. Con `baseUrl` el iframe tiene un origen válido. Lo encontró
 * el simulador; leyendo el código no se ve.
 *
 * `allowsInlineMediaPlayback` + `playsinline=1` es la pareja que hace falta en
 * iOS: sin las dos, el video se lo lleva el reproductor del sistema a pantalla
 * completa en cuanto empieza, y la instrucción del paso desaparece.
 *
 * **Y encima va nuestra propia salida a YouTube.** Un embebido depende de
 * permisos que no controlamos: el dueño del video puede prohibirlo (error 150 o
 * 152) y el simulador de iOS no lo reproduce nunca. Cuando eso pasa, dentro del
 * marco queda la tarjeta de error de YouTube — que trae su propio botón, pero en
 * inglés y con pinta de fallo de la app. Con este botón, quien quiera ver la
 * técnica la ve siempre, y esa es la promesa que importa.
 *
 * Por qué no se detecta el fallo para caer solo: la tarjeta de error se pinta
 * DENTRO del iframe, en otro origen, y el `WebView` no puede leerla. Ofrecer la
 * salida siempre es más honesto que fingir que sabemos si falló.
 */
function ReproductorEmbebido({
  video,
  etiqueta,
}: {
  readonly video: VideoLink;
  readonly etiqueta: string;
}) {
  const theme = useTheme();
  const [cargando, setCargando] = useState(true);

  if (video.embedUrl === null) return null;

  const separador = video.embedUrl.includes('?') ? '&' : '?';
  const src = `${video.embedUrl}${separador}playsinline=1&autoplay=1&rel=0&modestbranding=1`;
  const origen =
    video.provider === 'vimeo' ? 'https://player.vimeo.com' : 'https://www.youtube.com';

  const html = `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>html,body{margin:0;padding:0;background:#000;height:100%;overflow:hidden}
iframe{border:0;width:100%;height:100%;display:block}</style>
</head><body>
<iframe src="${src}" allow="autoplay; fullscreen; encrypted-media" allowfullscreen></iframe>
</body></html>`;

  return (
    <View style={{ flex: 1 }}>
      <WebView
        source={{ html, baseUrl: origen }}
        accessibilityLabel={`Video de ${etiqueta}`}
        style={{ flex: 1, backgroundColor: '#000' }}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        allowsFullscreenVideo
        // Es una página de terceros dentro de la app: se le abre la puerta a
        // reproducir un video y a nada más.
        javaScriptEnabled
        domStorageEnabled={false}
        thirdPartyCookiesEnabled={false}
        onLoadEnd={() => setCargando(false)}
      />
      {cargando ? (
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.colors.surfaceSunken,
          }}
        >
          <ActivityIndicator color={theme.colors.textSecondary} />
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Abrir el video de ${etiqueta} en ${
            video.provider === 'vimeo' ? 'Vimeo' : 'YouTube'
          }`}
          onPress={() => abrirVideo(video.url)}
          hitSlop={8}
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderRadius: theme.radii.pill,
            backgroundColor: withAlpha('#000000', 0.55),
          }}
        >
          <ExternalLink size={12} color="#FFFFFF" />
          <Text variant="micro" weight="semibold" color="#FFFFFF">
            {video.provider === 'vimeo' ? 'Vimeo' : 'YouTube'}
          </Text>
        </Pressable>
      )}
    </View>
  );
}
