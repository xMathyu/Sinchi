/**
 * El favicon, dibujado con la geometría real de la marca.
 *
 * Va como ruta y no como archivo estático para que las rutas salgan de
 * `@sinchi/ui`: un `.svg` en disco no puede importar nada, y era exactamente
 * ahí donde el logo de la web se había separado del de la app.
 *
 * El encuadre replica el de `apps/mobile/scripts/generar-iconos.mjs`: el glifo
 * ocupa el 66% del lienzo y se sube un 2.2%, porque la punta de lanza pesa
 * abajo —la base es lo ancho— y centrada geométricamente se *ve* baja.
 */
import { LOGO_BAR_PATH, LOGO_BAR_WIDTH, LOGO_OUTLINE_PATH, colors, radii } from '@sinchi/ui';

export const dynamic = 'force-static';

const ESCALA = 0.66;
const LEVANTE = 2.2;

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
  <rect width="100" height="100" rx="${radii.xxl}" fill="${colors.screen}"/>
  <g transform="translate(50 ${50 - LEVANTE}) scale(${ESCALA}) translate(-50 -50)">
    <path d="${LOGO_OUTLINE_PATH}" fill="${colors.ink}"/>
    <path d="${LOGO_BAR_PATH}" stroke="${colors.screen}" stroke-width="${LOGO_BAR_WIDTH}"/>
  </g>
</svg>`;

export function GET() {
  return new Response(SVG, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
