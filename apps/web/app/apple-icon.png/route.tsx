/**
 * El icono de «añadir a pantalla de inicio» en iOS.
 *
 * Safari no acepta SVG ahí —solo PNG— así que el `icon.svg` que sirve para el
 * resto de navegadores no vale. Se dibuja con la geometría de `@sinchi/ui`,
 * sobre el fondo de la app: iOS no respeta la transparencia y la recorta contra
 * blanco, y la marca es clara.
 *
 * El glifo al 62% y subido un 2.2%, igual que `generar-iconos.mjs`: la máscara
 * de iOS se come las esquinas, y la punta de lanza pesa abajo.
 */
import { ImageResponse } from 'next/og';
import { LOGO_BAR_PATH, LOGO_BAR_WIDTH, LOGO_OUTLINE_PATH, LOGO_VIEWBOX, colors } from '@sinchi/ui';

export const dynamic = 'force-static';

const LADO = 180;
/** El glifo mide 84 de alto dentro de un viewBox de 100: el marco compensa. */
const MARCO = Math.round((LADO * 0.62 * 100) / 84);

export function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: colors.screen,
        }}
      >
        <svg width={MARCO} height={MARCO} viewBox={LOGO_VIEWBOX} style={{ marginBottom: LADO * 0.044 }}>
          <path d={LOGO_OUTLINE_PATH} fill={colors.ink} />
          <path d={LOGO_BAR_PATH} stroke={colors.screen} strokeWidth={LOGO_BAR_WIDTH} />
        </svg>
      </div>
    ),
    { width: LADO, height: LADO },
  );
}
