/**
 * Las páginas que abre el enlace de una invitación.
 *
 * HTML escrito a mano y sin motor de plantillas: son dos páginas, sin estado y
 * sin formularios. Una dependencia con su propio caché y su propia sintaxis no
 * se paga por esto.
 *
 * Los colores salen de `packages/ui` a mano y no importados: este archivo lo
 * sirve la api, que no depende del design system —ni debe, es de la interfaz— y
 * duplicar cuatro hex es más barato que arrastrar el paquete al contenedor.
 */
const CANVAS = '#0E0E11';
const SUPERFICIE = '#17171B';
const TINTA = '#F4F1EA';
const SECUNDARIO = '#9C9CA6';
const VERDE = '#2FD16D';

/** El teléfono desde el que se abrió el enlace. */
export type Sistema = 'ios' | 'android' | 'otro';

/**
 * De qué teléfono viene.
 *
 * Por User-Agent y en el servidor: la página tiene que llegar ya con el botón
 * correcto. Resolverlo en el navegador dejaría un parpadeo entre «Descargar» y
 * «Descargar en el App Store», que es justo el momento en el que alguien toca.
 *
 * iPadOS miente y dice ser un Mac; por eso la comprobación de pantalla táctil no
 * está: un iPad al que le llega el botón de escritorio ve las dos tiendas, que
 * es un fallo aceptable. Mandar a un Mac al App Store del iPhone, no.
 */
export function detectarSistema(userAgent: string | undefined): Sistema {
  if (userAgent === undefined) return 'otro';
  if (/android/i.test(userAgent)) return 'android';
  if (/iphone|ipad|ipod/i.test(userAgent)) return 'ios';
  return 'otro';
}

/** Nada de lo que entra aquí es del servidor: el nombre lo escribió recepción. */
function escapar(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Dentro de un `<script>` no vale escapar HTML: `</script>` cerraría la etiqueta. */
function enJs(texto: string | null): string {
  return JSON.stringify(texto).replace(/</g, '\\u003c');
}

function envoltorio(cuerpo: string, script = ''): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sinchi</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh;
    display: flex; align-items: center; justify-content: center;
    background: ${CANVAS}; color: ${TINTA};
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    padding: 24px;
  }
  .tarjeta {
    width: 100%; max-width: 380px;
    background: ${SUPERFICIE};
    border: 1px solid rgba(255,255,255,.07);
    border-radius: 22px; padding: 28px 24px;
    text-align: center;
  }
  h1 { font-size: 22px; line-height: 28px; margin: 18px 0 6px; letter-spacing: -.5px; }
  p { font-size: 15px; line-height: 21px; color: ${SECUNDARIO}; margin: 0 0 6px; }
  .dato { color: ${TINTA}; font-weight: 600; }
  .boton {
    display: block; margin: 22px 0 10px;
    background: ${VERDE}; color: #08260F;
    text-decoration: none; font-weight: 700; font-size: 17px;
    padding: 16px; border-radius: 16px;
  }
  .tienda {
    display: flex; align-items: center; justify-content: center; gap: 9px;
    margin: 0 0 10px;
    background: ${TINTA}; color: ${CANVAS};
    text-decoration: none; font-weight: 700; font-size: 15px;
    padding: 14px; border-radius: 16px;
  }
  .tiendas { display: flex; flex-direction: column; gap: 10px; margin: 22px 0 10px; }
  .pie { font-size: 12px; line-height: 17px; color: #8C8C95; margin-top: 4px; }
</style>
</head>
<body><div class="tarjeta">${cuerpo}</div>${script}</body>
</html>`;
}

const LOGO = `<img src="/v1/brand/logo.png" width="64" height="64" alt="Sinchi" style="border-radius:15px">`;

const GLIFO_IOS = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="${CANVAS}" stroke-width="2" stroke-linecap="round" aria-hidden><rect x="6" y="2" width="12" height="20" rx="3"/><path d="M11 18h2"/></svg>`;
const GLIFO_ANDROID = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="${CANVAS}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden><path d="M12 3v11"/><path d="M7.5 9.5 12 14l4.5-4.5"/><path d="M4 17.5v1A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5v-1"/></svg>`;

export interface Tiendas {
  /** `null` mientras la app no esté publicada en esa tienda. */
  readonly ios: string | null;
  readonly android: string | null;
}

/**
 * Enlace `intent://` de Android.
 *
 * Es el mecanismo del sistema para exactamente esto: si la app está instalada,
 * la abre; si no, Chrome navega solo a `browser_fallback_url`. Sin temporizadores
 * y sin adivinar — que es como se hace en iOS por no tener nada equivalente.
 */
function intentAndroid(ruta: string, respaldo: string | null): string {
  const partes = ['Intent', 'scheme=sinchi', 'package=pe.sinchi.app'];
  if (respaldo !== null) partes.push(`S.browser_fallback_url=${encodeURIComponent(respaldo)}`);
  return `intent://${ruta}#${partes.join(';')};end`;
}

export function paginaInvitacion(input: {
  readonly gimnasio: string;
  readonly nombre: string;
  readonly plan: string;
  /** `sinchi:///invite/<token>` */
  readonly enlaceApp: string;
  readonly sistema: Sistema;
  readonly tiendas: Tiendas;
}): string {
  const { sistema, tiendas } = input;
  // El esquema sobra en la ruta del intent: Android lo lee de `scheme=`.
  const ruta = input.enlaceApp.replace(/^sinchi:\/\/\/?/, '');

  const abrir =
    sistema === 'android'
      ? `<a class="boton" id="abrir" href="${escapar(intentAndroid(ruta, tiendas.android))}">Abrir en Sinchi</a>`
      : `<a class="boton" id="abrir" href="${escapar(input.enlaceApp)}">Abrir en Sinchi</a>`;

  const tienda = (url: string, etiqueta: string, glifo: string) =>
    `<a class="tienda" href="${escapar(url)}">${glifo}${etiqueta}</a>`;

  let descarga = '';
  let pie: string;

  if (sistema === 'ios') {
    descarga =
      tiendas.ios === null ? '' : tienda(tiendas.ios, 'Descargar en el App Store', GLIFO_IOS);
    pie =
      tiendas.ios === null
        ? 'Si todavía no tienes la app instalada, guarda este enlace: sigue siendo válido cuando la instales.'
        : 'El primer botón abre la app si ya la tienes. Si no, descárgala y vuelve a este enlace.';
  } else if (sistema === 'android') {
    descarga =
      tiendas.android === null
        ? ''
        : tienda(tiendas.android, 'Descargar en Google Play', GLIFO_ANDROID);
    pie =
      tiendas.android === null
        ? 'Si todavía no tienes la app instalada, guarda este enlace: sigue siendo válido cuando la instales.'
        : 'El botón abre la app, y si todavía no la tienes te lleva a Google Play. Al volver aquí, entrarás directo.';
  } else {
    // En un ordenador el botón de arriba no lleva a ninguna parte: no hay app.
    descarga = [
      tiendas.ios === null ? '' : tienda(tiendas.ios, 'Descargar en el App Store', GLIFO_IOS),
      tiendas.android === null
        ? ''
        : tienda(tiendas.android, 'Descargar en Google Play', GLIFO_ANDROID),
    ].join('');
    pie = 'Sinchi vive en el teléfono. Abre este mismo enlace desde el tuyo y entrarás directo.';
  }

  const cuerpo = `
    ${LOGO}
    <h1>${escapar(input.gimnasio)} te inscribió</h1>
    <p>Hola ${escapar(input.nombre.trim().split(/\s+/)[0] ?? input.nombre)}, tu plan es
       <span class="dato">${escapar(input.plan)}</span>.</p>
    ${sistema === 'otro' ? `<div class="tiendas">${descarga}</div>` : `${abrir}${descarga}`}
    <p class="pie">${pie}</p>`;

  /**
   * El salto a la app, solo en iOS.
   *
   * Android no lo necesita: su `intent://` ya cae solo a la tienda. iOS no tiene
   * nada equivalente, así que se hace a mano — se lanza el esquema propio y se
   * arma un temporizador hacia la tienda. Si la app existe, el sistema se lleva
   * el foco, la página se oculta y el temporizador se cancela; si no existe,
   * nadie responde, la página sigue delante y el temporizador dispara.
   *
   * Va colgado del BOTÓN y no del `load`: lanzar `sinchi://` al abrir la página
   * en un iPhone sin la app le enseña a alguien un diálogo de error de Safari
   * antes de haber tocado nada, justo en el caso que esta página existe para
   * resolver.
   */
  const script =
    sistema === 'ios' && tiendas.ios !== null
      ? `<script>
(function () {
  var boton = document.getElementById('abrir');
  var app = ${enJs(input.enlaceApp)};
  var tienda = ${enJs(tiendas.ios)};
  if (!boton) return;
  boton.addEventListener('click', function (evento) {
    evento.preventDefault();
    var salto = setTimeout(function () { window.location.href = tienda; }, 1400);
    var cancelar = function () { clearTimeout(salto); };
    window.addEventListener('pagehide', cancelar);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) cancelar();
    });
    window.location.href = app;
  });
})();
</script>`
      : '';

  return envoltorio(cuerpo, script);
}

export function paginaCaducada(): string {
  return envoltorio(`
    ${LOGO}
    <h1>Este enlace ya no vale</h1>
    <p>Las invitaciones caducan, y también se pueden revocar desde el mostrador.</p>
    <p class="pie">
      Pídele a tu gimnasio que te mande una nueva. Tu ficha y tu historial, si ya
      los tenías, siguen ahí.
    </p>`);
}
