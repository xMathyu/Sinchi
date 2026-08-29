/**
 * El icono de «añadir a pantalla de inicio» en iOS.
 *
 * Safari no acepta SVG ahí —solo PNG— así que el `icon.svg` que sirve para el
 * resto de navegadores no vale. Se dibuja con la misma geometría de la marca,
 * sobre el fondo de la app: iOS no respeta la transparencia y la recorta contra
 * blanco, y el logo es claro.
 */
import { ImageResponse } from 'next/og';
import { colors } from '@sinchi/ui';

export const dynamic = 'force-static';

const SIZE = { width: 180, height: 180 };

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
          background: colors.canvas,
        }}
      >
        <svg width="108" height="108" viewBox="0 0 64 64">
          <path d="M32 6 L54 52 L32 41 L10 52 Z" fill={colors.ink} />
          <path d="M32 41 L32 24" stroke={colors.canvas} strokeWidth={5} />
        </svg>
      </div>
    ),
    SIZE,
  );
}
