/**
 * El correo de invitación, en HTML.
 *
 * Escrito con tablas y estilos en línea, que en 2026 sigue siendo la única forma
 * de que un correo se vea igual en Gmail, Outlook y Mail de iOS: no hay flexbox
 * fiable, ni `<style>` que sobreviva a Gmail, ni tipografías web.
 *
 * Tres decisiones que se notan:
 *
 *  - El logo va por URL absoluta a la api. Un `data:` URI lo descarta Gmail y un
 *    SVG no lo pinta casi nadie.
 *  - El botón es una celda de tabla con fondo, no un `<a>` con `padding`:
 *    Outlook ignora el padding de un enlace y el botón sale sin área que tocar.
 *  - Debajo del botón va el enlace en texto. Los clientes que bloquean imágenes
 *    también suelen romper los botones, y quedarse sin forma de entrar por no
 *    poder pintar un rectángulo verde sería absurdo.
 */
const CANVAS = '#0E0E11';
const SUPERFICIE = '#17171B';
const TINTA = '#F4F1EA';
const SECUNDARIO = '#9C9CA6';
const VERDE = '#2FD16D';
const TINTA_VERDE = '#08260F';

const FUENTE =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

function escapar(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function correoInvitacion(input: {
  readonly primerNombre: string;
  readonly gimnasio: string;
  readonly plan: string;
  readonly enlace: string;
  readonly logo: string;
}): string {
  const gimnasio = escapar(input.gimnasio);
  const plan = escapar(input.plan);
  const enlace = escapar(input.enlace);

  return `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:${CANVAS};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CANVAS};padding:32px 16px;">
<tr><td align="center">

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:${SUPERFICIE};border-radius:22px;border:1px solid rgba(255,255,255,0.07);">
    <tr><td style="padding:32px 28px 28px;font-family:${FUENTE};">

      <img src="${escapar(input.logo)}" width="56" height="56" alt="Sinchi"
           style="display:block;border-radius:13px;border:0;">

      <div style="color:${TINTA};font-size:23px;line-height:29px;font-weight:700;letter-spacing:-0.5px;padding:20px 0 8px;">
        ${gimnasio} te inscribió
      </div>

      <div style="color:${SECUNDARIO};font-size:15px;line-height:22px;">
        Hola ${escapar(input.primerNombre)}, tu plan es
        <span style="color:${TINTA};font-weight:600;">${plan}</span>.
      </div>

      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:24px 0 14px;">
        <tr><td align="center" bgcolor="${VERDE}" style="border-radius:16px;">
          <a href="${enlace}"
             style="display:block;padding:16px 24px;font-family:${FUENTE};font-size:17px;font-weight:700;color:${TINTA_VERDE};text-decoration:none;">
            Activar mi cuenta
          </a>
        </td></tr>
      </table>

      <div style="color:#8C8C95;font-size:12px;line-height:18px;">
        Si el botón no funciona, copia este enlace:<br>
        <a href="${enlace}" style="color:${VERDE};text-decoration:none;word-break:break-all;">${enlace}</a>
      </div>

      <div style="height:1px;background:rgba(255,255,255,0.07);margin:22px 0;"></div>

      <div style="color:${SECUNDARIO};font-size:13px;line-height:20px;">
        Desde la app verás tu plan, tu cupo de la semana y el código QR con el que
        entras al gimnasio. El código cambia cada 30 segundos y funciona sin internet.
      </div>

      <div style="color:#8C8C95;font-size:12px;line-height:18px;padding-top:14px;">
        Si no esperabas este correo, ignóralo: sin abrir el enlace no se activa nada.
      </div>

    </td></tr>
  </table>

</td></tr>
</table>
</body>
</html>`;
}
