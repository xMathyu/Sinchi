/**
 * Las dos páginas que abre el enlace de una invitación.
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

/** Nada de lo que entra aquí es del servidor: el nombre lo escribió recepción. */
function escapar(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function envoltorio(cuerpo: string): string {
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
    display: block; margin: 22px 0 14px;
    background: ${VERDE}; color: #08260F;
    text-decoration: none; font-weight: 700; font-size: 17px;
    padding: 16px; border-radius: 16px;
  }
  .pie { font-size: 12px; line-height: 17px; color: #8C8C95; margin-top: 4px; }
</style>
</head>
<body><div class="tarjeta">${cuerpo}</div></body>
</html>`;
}

const LOGO = `<img src="/v1/brand/logo.png" width="64" height="64" alt="Sinchi" style="border-radius:15px">`;

export function paginaInvitacion(input: {
  readonly gimnasio: string;
  readonly nombre: string;
  readonly plan: string;
  readonly enlaceApp: string;
}): string {
  return envoltorio(`
    ${LOGO}
    <h1>${escapar(input.gimnasio)} te inscribió</h1>
    <p>Hola ${escapar(input.nombre.trim().split(/\s+/)[0] ?? input.nombre)}, tu plan es
       <span class="dato">${escapar(input.plan)}</span>.</p>
    <a class="boton" href="${escapar(input.enlaceApp)}">Abrir en Sinchi</a>
    <p class="pie">
      El botón abre la app. Si no la tienes instalada todavía, ábrelo desde el
      teléfono donde la instales — el enlace sigue siendo válido.
    </p>`);
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
