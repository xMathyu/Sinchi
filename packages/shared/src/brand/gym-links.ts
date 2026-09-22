/**
 * La página web del gimnasio y sus redes: qué se acepta y cómo se guarda.
 *
 * TODO OPCIONAL, como el logo. Muchos dojos no tienen web; casi todos tienen
 * Instagram, Facebook o TikTok, y ahí es donde se ve cómo entrenan. A quien los
 * encuentra en el directorio le sirve poder ir a mirar antes de reservar.
 *
 * Las redes se guardan como la dirección CANÓNICA del perfil, armada aquí, y no
 * como lo que pegó el dueño. Es lo que permite que la ficha diga «Instagram» con
 * la seguridad de que el enlace abre Instagram: un campo de texto libre con la
 * etiqueta de una red es un sitio donde cabe cualquier dirección disfrazada.
 *
 * Se analiza con expresiones regulares y no con `URL`, por lo mismo que
 * `parseVideoLink`: el motor de React Native trae una versión incompleta, y una
 * regla que decide distinto en el teléfono y en la api no sirve.
 */

/** Largo máximo de cada dirección, ya normalizada. */
export const GYM_LINK_MAX_LENGTH = 200;

/**
 * Las redes que tienen su propio campo.
 *
 * WhatsApp no está, a propósito: con el alumno se habla por el chat de Sinchi
 * (decisiones §12), y un botón de WhatsApp en la ficha se llevaría la
 * conversación fuera de la app.
 */
export const GYM_SOCIAL_NETWORKS = ['instagram', 'facebook', 'tiktok'] as const;

export type GymSocialNetwork = (typeof GYM_SOCIAL_NETWORKS)[number];

export type GymLinkKind = 'website' | GymSocialNetwork;

/** En este orden se piden y se muestran: la web primero, que es la que es suya. */
export const GYM_LINK_KINDS: readonly GymLinkKind[] = ['website', ...GYM_SOCIAL_NETWORKS];

export const GYM_LINK_LABELS: Readonly<Record<GymLinkKind, string>> = {
  website: 'Página web',
  instagram: 'Instagram',
  facebook: 'Facebook',
  tiktok: 'TikTok',
};

/** Las cuatro direcciones, ya normalizadas. `null` = no tiene. */
export type GymLinks = Readonly<Record<GymLinkKind, string | null>>;

export type GymLinkDenialCode =
  /** La web no tiene forma de dirección. */
  | 'not_a_website'
  /** La web es en realidad una red: va en su propio campo. */
  | 'use_network_field'
  /** No es un perfil de esa red. */
  | 'not_a_profile'
  /** Es una publicación, no el perfil. */
  | 'post_not_profile'
  /** Un enlace corto de TikTok, que no dice de quién es. */
  | 'short_link'
  | 'too_long';

export interface GymLinkDenial {
  readonly kind: GymLinkKind;
  readonly code: GymLinkDenialCode;
}

/** El motivo, o `null` si sirve. Vacío sirve: todo esto es opcional. */
export function checkGymLink(kind: GymLinkKind, raw: string): GymLinkDenial | null {
  const parsed = parseLink(kind, raw);
  if (parsed.ok) {
    return parsed.url !== null && parsed.url.length > GYM_LINK_MAX_LENGTH
      ? { kind, code: 'too_long' }
      : null;
  }
  return { kind, code: parsed.code };
}

/** El primer motivo de los cuatro campos, o `null` si todos sirven. */
export function checkGymLinks(raw: Readonly<Record<GymLinkKind, string>>): GymLinkDenial | null {
  for (const kind of GYM_LINK_KINDS) {
    const denial = checkGymLink(kind, raw[kind]);
    if (denial !== null) return denial;
  }
  return null;
}

/**
 * La dirección como se guarda, o `null` si el campo quedó vacío.
 *
 * Lanza si no sirve: llamar antes a `checkGymLink` para tener el motivo. Lanzar
 * y no devolver otra cosa es para que nadie guarde por descuido lo que el dueño
 * tecleó tal cual.
 */
export function normalizeGymLink(kind: GymLinkKind, raw: string): string | null {
  const parsed = parseLink(kind, raw);
  if (!parsed.ok) throw new Error(gymLinkDenialMessage({ kind, code: parsed.code }));
  return parsed.url;
}

export function gymLinkDenialMessage(denial: GymLinkDenial): string {
  const label = GYM_LINK_LABELS[denial.kind];
  switch (denial.code) {
    case 'not_a_website':
      return 'Escribe la dirección de tu página, como midojo.pe.';
    case 'use_network_field':
      return 'Esa es una red social: ponla en su propio campo, más abajo.';
    case 'not_a_profile':
      return denial.kind === 'facebook'
        ? 'Eso no es una página de Facebook. Pega el enlace de tu página o escribe su nombre de usuario.'
        : `Eso no es un perfil de ${label}. Escribe tu usuario, como @midojo.`;
    case 'post_not_profile':
      return `Ese enlace es de una publicación. Pon el de tu perfil de ${label}, o tu usuario.`;
    case 'short_link':
      return 'Ese es un enlace corto y no dice de quién es. Escribe tu usuario, como @midojo.';
    case 'too_long':
      return `La dirección no puede pasar de ${GYM_LINK_MAX_LENGTH} caracteres.`;
  }
}

/**
 * Cómo se lee en la ficha.
 *
 * `@midojo` para las redes de usuario, que es como se dicen en voz alta, y la
 * web sin `https://`, sin `www.` y sin la barra del final: la dirección entera es
 * ruido que además no cabe en una línea.
 */
export function displayGymLink(kind: GymLinkKind, url: string): string {
  if (kind === 'instagram') return `@${url.slice(INSTAGRAM_PROFILE.length)}`;
  if (kind === 'tiktok') return url.slice(TIKTOK_PROFILE.length);
  return url
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/$/, '');
}

/**
 * Lo guardado, como lo escribiría el dueño para editarlo.
 *
 * Las redes vuelven como `@usuario` o `facebook.com/pagina`, que es lo que
 * reconoce y lo que cabe en un campo. A la web solo se le quita el `https://`,
 * y no el `www.` ni un `http://`: al volver a guardar sin tocarla, cualquiera de
 * los dos cambiaría la dirección, y hay sitios que solo responden con `www.` o
 * sin certificado. La regla es que `normalizeGymLink` de esto devuelva EXACTAMENTE
 * lo guardado.
 */
export function editableGymLink(kind: GymLinkKind, url: string): string {
  return kind === 'website' ? url.replace(/^https:\/\//, '') : displayGymLink(kind, url);
}

// ---------------------------------------------------------------------------
// Interno
// ---------------------------------------------------------------------------

type Parsed =
  | { readonly ok: true; readonly url: string | null }
  | { readonly ok: false; readonly code: GymLinkDenialCode };

const INSTAGRAM_PROFILE = 'https://www.instagram.com/';
const TIKTOK_PROFILE = 'https://www.tiktok.com/';
const FACEBOOK_PAGE = 'https://www.facebook.com/';

/**
 * Esquema, host, puerto, ruta y consulta.
 *
 * El host exige un punto y un dominio de al menos dos letras: «midojo» a secas no
 * lleva a ningún sitio. No admite `@` ni espacios, y eso no es estética:
 * `https://midojo.pe@otro.com` abre `otro.com`, y quien toca el enlace cree que
 * va a la web del gimnasio.
 */
const WEB_URL =
  /^(https?):\/\/([^\s/?#:@]+\.[^\s/?#:@.\d]{2,})(:\d{1,5})?(\/[^\s?#]*)?(\?[^\s#]*)?(#\S*)?$/i;

interface WebUrl {
  readonly scheme: string;
  /** En minúsculas y sin `www.` ni `m.`: es lo que se compara. */
  readonly site: string;
  readonly host: string;
  readonly port: string;
  /** Sin la barra del final. `''` en la raíz. */
  readonly path: string;
  readonly query: string;
}

function parseWebUrl(raw: string): WebUrl | null {
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw);
  const match = WEB_URL.exec(hasScheme ? raw : `https://${raw}`);
  if (match === null) return null;
  const [, scheme, host, port, path, query] = match;
  const lowerHost = host!.toLowerCase();
  return {
    scheme: scheme!.toLowerCase(),
    host: lowerHost,
    site: lowerHost.replace(/^(www|m|web)\./, ''),
    port: port ?? '',
    path: (path ?? '').replace(/\/+$/, ''),
    query: query ?? '',
  };
}

const segments = (path: string): string[] => path.split('/').filter((s) => s.length > 0);

const NETWORK_SITES: Readonly<Record<string, GymSocialNetwork>> = {
  'instagram.com': 'instagram',
  'instagr.am': 'instagram',
  'facebook.com': 'facebook',
  'fb.com': 'facebook',
  'tiktok.com': 'tiktok',
  'vm.tiktok.com': 'tiktok',
  'vt.tiktok.com': 'tiktok',
};

/** Lo que tiene cara de enlace y no de usuario: una barra o el dominio de la red. */
const looksLikeUrl = (raw: string): boolean =>
  raw.includes('/') || /(instagram\.com|instagr\.am|facebook\.com|fb\.com|tiktok\.com)/i.test(raw);

function parseLink(kind: GymLinkKind, raw: string): Parsed {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: true, url: null };
  switch (kind) {
    case 'website':
      return parseWebsite(trimmed);
    case 'instagram':
      return parseInstagram(trimmed);
    case 'facebook':
      return parseFacebook(trimmed);
    case 'tiktok':
      return parseTikTok(trimmed);
  }
}

function parseWebsite(raw: string): Parsed {
  const url = parseWebUrl(raw);
  if (url === null) return { ok: false, code: 'not_a_website' };
  if (NETWORK_SITES[url.site] !== undefined) return { ok: false, code: 'use_network_field' };
  // El esquema y el host no distinguen mayúsculas; la ruta sí puede, y se deja
  // como la escribió.
  return {
    ok: true,
    url: `${url.scheme}://${url.host}${url.port}${url.path}${url.query}`,
  };
}

/** Instagram: letras, números, puntos y guiones bajos, hasta 30. */
const INSTAGRAM_USER = /^[a-z0-9._]{1,30}$/i;
/** Lo que va después de `instagram.com/` y NO es un perfil. */
const INSTAGRAM_NOT_PROFILE = new Set(['p', 'reel', 'reels', 'tv', 'stories', 'explore', 'accounts', 'direct']);

function parseInstagram(raw: string): Parsed {
  if (!looksLikeUrl(raw)) {
    const user = raw.replace(/^@/, '');
    return INSTAGRAM_USER.test(user)
      ? { ok: true, url: `${INSTAGRAM_PROFILE}${user.toLowerCase()}` }
      : { ok: false, code: 'not_a_profile' };
  }
  const url = parseWebUrl(raw);
  if (url === null || NETWORK_SITES[url.site] !== 'instagram') return { ok: false, code: 'not_a_profile' };
  const [first] = segments(url.path);
  if (first === undefined) return { ok: false, code: 'not_a_profile' };
  if (INSTAGRAM_NOT_PROFILE.has(first.toLowerCase())) return { ok: false, code: 'post_not_profile' };
  return INSTAGRAM_USER.test(first)
    ? { ok: true, url: `${INSTAGRAM_PROFILE}${first.toLowerCase()}` }
    : { ok: false, code: 'not_a_profile' };
}

/** TikTok: letras, números, puntos y guiones bajos, de 2 a 24. */
const TIKTOK_USER = /^[a-z0-9._]{2,24}$/i;

function parseTikTok(raw: string): Parsed {
  if (!looksLikeUrl(raw)) {
    const user = raw.replace(/^@/, '');
    return TIKTOK_USER.test(user)
      ? { ok: true, url: `${TIKTOK_PROFILE}@${user.toLowerCase()}` }
      : { ok: false, code: 'not_a_profile' };
  }
  const url = parseWebUrl(raw);
  if (url === null || NETWORK_SITES[url.site] !== 'tiktok') return { ok: false, code: 'not_a_profile' };
  // `vm.tiktok.com/ZMabc` es lo que da «Compartir perfil»: redirige, pero la
  // dirección no dice a quién, y no hay forma de comprobarlo sin seguirla.
  if (url.site !== 'tiktok.com') return { ok: false, code: 'short_link' };
  const [first] = segments(url.path);
  if (first === undefined || !first.startsWith('@')) {
    return { ok: false, code: first === undefined ? 'not_a_profile' : 'post_not_profile' };
  }
  const user = first.slice(1);
  return TIKTOK_USER.test(user)
    ? { ok: true, url: `${TIKTOK_PROFILE}@${user.toLowerCase()}` }
    : { ok: false, code: 'not_a_profile' };
}

/**
 * Facebook: el nombre de usuario de la página, de 5 a 50.
 *
 * Es la única red donde el perfil no siempre tiene usuario: muchas páginas viven
 * en `profile.php?id=…`, en `/p/Nombre-123` o detrás de un `/share/…`, que es lo
 * que da hoy el botón «Compartir». Esas se aceptan con su ruta, porque son la
 * única dirección que la página tiene; lo que se descarta es la consulta de
 * rastreo que Facebook pega detrás (`?mibextid=…`).
 */
const FACEBOOK_USER = /^[a-z0-9.]{5,50}$/i;
/** Rutas de una página que no tiene usuario: se guardan tal cual. */
const FACEBOOK_PAGE_PATHS = new Set(['p', 'people', 'pages', 'groups', 'share']);
/** Lo que va después de `facebook.com/` y es una publicación, no la página. */
const FACEBOOK_NOT_PROFILE = new Set([
  'watch',
  'photo',
  'photo.php',
  'photos',
  'story.php',
  'permalink.php',
  'events',
  'reel',
  'posts',
  'videos',
]);

function parseFacebook(raw: string): Parsed {
  if (!looksLikeUrl(raw)) {
    const user = raw.replace(/^@/, '');
    return FACEBOOK_USER.test(user)
      ? { ok: true, url: `${FACEBOOK_PAGE}${user.toLowerCase()}` }
      : { ok: false, code: 'not_a_profile' };
  }
  const url = parseWebUrl(raw);
  if (url === null || NETWORK_SITES[url.site] !== 'facebook') return { ok: false, code: 'not_a_profile' };
  const parts = segments(url.path);
  const first = parts[0]?.toLowerCase();
  if (first === undefined) return { ok: false, code: 'not_a_profile' };

  if (first === 'profile.php') {
    const id = /[?&]id=(\d+)/.exec(url.query)?.[1];
    return id === undefined
      ? { ok: false, code: 'not_a_profile' }
      : { ok: true, url: `${FACEBOOK_PAGE}profile.php?id=${id}` };
  }
  if (FACEBOOK_PAGE_PATHS.has(first)) {
    // Sin nada detrás, `/p/` o `/share/` no son la página de nadie.
    if (parts.length < 2 || !parts.every((part) => /^[^\s?#]+$/.test(part))) {
      return { ok: false, code: 'not_a_profile' };
    }
    return { ok: true, url: `${FACEBOOK_PAGE}${parts.join('/')}` };
  }
  if (FACEBOOK_NOT_PROFILE.has(first)) return { ok: false, code: 'post_not_profile' };
  // `facebook.com/midojo/photos/…` es una foto DE la página: la página es el
  // primer tramo.
  return FACEBOOK_USER.test(parts[0]!)
    ? { ok: true, url: `${FACEBOOK_PAGE}${parts[0]!.toLowerCase()}` }
    : { ok: false, code: 'not_a_profile' };
}
