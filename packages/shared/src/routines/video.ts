/**
 * El enlace de un video, entendido.
 *
 * En la version 1 Sinchi **no aloja video**: guarda un enlace. Es una decision
 * de costo, no de pereza. Un gimnasio peruano ya graba con el celular y sube a
 * YouTube o Instagram; alojarlo nosotros significa transcodificar, servir por
 * CDN y pagar por GB — una factura que crece con lo que el gimnasio publica y
 * que el local del plan gratis no financia. Guardar una cadena cuesta cero y
 * funciona hoy.
 *
 * La consecuencia hay que decirla en voz alta: **un enlace no es un secreto**.
 * Un video "solo para alumnos" en YouTube oculto lo ve cualquiera que tenga la
 * direccion. Lo que Sinchi si garantiza es que la api NUNCA entrega esa
 * direccion a quien no tiene acceso (`checkRoutineAccess`), asi que para
 * filtrarlo hace falta que un alumno lo reparta a mano — el mismo riesgo que
 * grabar la clase con el celular, y ese ya se corre.
 *
 * Se analiza con expresiones regulares y no con `URL`, por lo mismo que las
 * fechas se calculan sin `Intl`: el motor de React Native trae una version
 * incompleta —`searchParams` no siempre esta— y una funcion del dominio que se
 * comporta distinto en el telefono y en la api no sirve para decidir nada.
 */

/**
 * De donde sale el video.
 *
 * `file` es un archivo de video servido tal cual —lo que sube el gimnasio, y
 * tambien el `.mp4` que alguien pega de su propio sitio—: se reproduce con el
 * reproductor nativo, sin navegador de por medio.
 *
 * `link` es el cajon honesto: se reconoce que es una direccion valida y se abre
 * fuera, pero no se puede ni embeber ni reproducir.
 */
export type VideoProvider = 'youtube' | 'vimeo' | 'file' | 'link';

/**
 * COMO se reproduce, que es lo que la pantalla necesita saber.
 *
 * Se decide aqui y no en la app por la razon de siempre: son tres superficies
 * —la app, el panel web y el correo— y el dia que se agregue un proveedor, la
 * que se olvide de mirarlo manda a la gente al navegador sin motivo.
 *
 *  · `file`     reproductor nativo. Es lo que hace que el video se vea DENTRO
 *               de la app, con pantalla completa y control de velocidad;
 *  · `embed`    reproductor del sitio, dentro de un `WebView`. YouTube y Vimeo
 *               no sirven el archivo, asi que es esto o nada;
 *  · `external` se abre fuera. Solo para lo que no se puede reproducir.
 */
export type VideoPlayback = 'file' | 'embed' | 'external';

export interface VideoLink {
  readonly provider: VideoProvider;
  readonly playback: VideoPlayback;
  /** Canonica: es la que se abre al tocar. */
  readonly url: string;
  /** Reproductor embebido. `null` cuando no se puede. */
  readonly embedUrl: string | null;
  /**
   * Miniatura, sin subir ninguna imagen.
   *
   * Es lo que convierte una lista de titulos en una lista de videos. Vimeo la
   * esconde detras de su api, asi que ahi va `null` y la pantalla dibuja su
   * marcador.
   */
  readonly thumbnailUrl: string | null;
}

/** Once caracteres exactos: es el formato del id de YouTube desde siempre. */
const YOUTUBE =
  /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com|youtube-nocookie\.com)\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/|v\/)([A-Za-z0-9_-]{11})(?:[?&#/]|$)/;
const YOUTU_BE = /^https?:\/\/(?:www\.)?youtu\.be\/([A-Za-z0-9_-]{11})(?:[?&#/]|$)/;
const VIMEO = /^https?:\/\/(?:www\.)?vimeo\.com\/(?:video\/|channels\/[\w-]+\/)?(\d{6,12})(?:[?&#/]|$)/;
const VIMEO_PLAYER = /^https?:\/\/player\.vimeo\.com\/video\/(\d{6,12})(?:[?&#/]|$)/;

/**
 * Los sitios de los que SI sabemos sacar un id.
 *
 * Si la direccion es de uno de ellos y aun asi no se le saca el id, es un tipeo
 * —o un enlace a un canal, o a una lista— y NO se guarda como enlace generico.
 * Aceptarlo esconderia el error hasta el dia en que un alumno toca la tecnica y
 * YouTube le contesta que el video no existe; rechazarlo lo pone delante del
 * dueno mientras tiene el campo abierto, que es cuando cuesta diez segundos
 * arreglarlo.
 */
const KNOWN_HOST = /^https?:\/\/(?:www\.|m\.|player\.)?(?:youtube\.com|youtube-nocookie\.com|youtu\.be|vimeo\.com)\//;

/**
 * Cualquier otra direccion, con dos condiciones: que tenga forma de direccion y
 * que sea `https`.
 *
 * Lo de `https` no es purismo: iOS bloquea el trafico en claro (App Transport
 * Security), asi que un `http://` guardado hoy es un video que no se ve manana
 * en la mitad de los telefonos. Mejor rechazarlo mientras el dueno tiene el
 * campo delante.
 */
const HTTPS_LINK = /^https:\/\/[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)+(?::\d{1,5})?(?:[/?#]|$)/i;

/**
 * Un archivo de video servido directo.
 *
 * Es lo que devuelve el almacenamiento cuando el gimnasio SUBE el video, y
 * tambien lo que pega quien lo tiene en su propio servidor. La extension se
 * mira antes del `?`: una URL firmada trae media docena de parametros detras y
 * sin recortar ahi no coincide con nada.
 */
const VIDEO_FILE = /\.(mp4|m4v|mov|webm|m3u8)$/i;

/**
 * Entiende el enlace, o `null` si no es uno.
 *
 * `null` y no una excepcion porque lo llaman los dos lados por la misma razon
 * que `checkPlanDraft`: la app apaga el boton mientras el dueno escribe, la api
 * no se fia de que lo haya hecho.
 */
export function parseVideoLink(raw: string): VideoLink | null {
  const url = raw.trim();
  if (url.length === 0 || url.length > 500) return null;

  const youtubeId = YOUTUBE.exec(url)?.[1] ?? YOUTU_BE.exec(url)?.[1];
  if (youtubeId !== undefined) {
    return {
      provider: 'youtube',
      playback: 'embed',
      url: `https://www.youtube.com/watch?v=${youtubeId}`,
      embedUrl: `https://www.youtube.com/embed/${youtubeId}`,
      thumbnailUrl: `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`,
    };
  }

  const vimeoId = VIMEO.exec(url)?.[1] ?? VIMEO_PLAYER.exec(url)?.[1];
  if (vimeoId !== undefined) {
    return {
      provider: 'vimeo',
      playback: 'embed',
      url: `https://vimeo.com/${vimeoId}`,
      embedUrl: `https://player.vimeo.com/video/${vimeoId}`,
      thumbnailUrl: null,
    };
  }

  if (KNOWN_HOST.test(url)) return null;

  if (HTTPS_LINK.test(url)) {
    // La ruta sin la query: `?X-Goog-Signature=...` no puede tapar el `.mp4`.
    const ruta = url.split(/[?#]/)[0] ?? url;
    const esArchivo = VIDEO_FILE.test(ruta);
    return {
      provider: esArchivo ? 'file' : 'link',
      playback: esArchivo ? 'file' : 'external',
      url,
      embedUrl: null,
      // Un archivo no trae miniatura: sacarla exige decodificar el primer
      // fotograma, y eso ya es transcodificar. El reproductor la pinta solo.
      thumbnailUrl: null,
    };
  }

  return null;
}

/** `true` si es un enlace que se puede guardar. */
export const isValidVideoLink = (raw: string): boolean => parseVideoLink(raw) !== null;

/**
 * La direccion canonica, para guardarla.
 *
 * Normalizar al guardar y no al leer tiene una razon: dos duenos pegan el mismo
 * video, uno desde el movil (`youtu.be/...`) y otro desde el navegador con
 * `&list=` y `&t=42` detras. Guardadas tal cual son dos cadenas distintas para
 * el mismo video, y el `?t=42` arranca la tecnica por la mitad.
 */
export const canonicalVideoUrl = (raw: string): string | null => parseVideoLink(raw)?.url ?? null;
