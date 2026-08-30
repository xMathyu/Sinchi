/**
 * La imagen que sale cuando alguien pega el enlace en WhatsApp.
 *
 * Se genera en el build con `next/og` y no es un PNG hecho a mano: el titular y
 * los colores salen del mismo sitio que la página, así que no se quedan atrás
 * cuando cambie el mensaje.
 *
 * Va como ruta `/og.png` y no por el convenio `opengraph-image.tsx` por una
 * razón tonta y decisiva: ese convenio exporta el archivo SIN extensión, y un
 * hosting de estáticos lo sirve entonces como `application/octet-stream`. El
 * robot de WhatsApp y el de Facebook descartan una `og:image` que no llega con
 * un tipo de imagen, así que la vista previa saldría sin foto.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import {
  LOGO_BAR_PATH,
  LOGO_BAR_WIDTH,
  LOGO_OUTLINE_PATH,
  LOGO_VIEWBOX,
  SEMAPHORE_DEFAULT,
  colors,
} from '@sinchi/ui';

// Con `output: 'export'` hay que decirlo explicito: la imagen se hornea en el
// build, no se genera por peticion.
export const dynamic = 'force-static';

const SIZE = { width: 1200, height: 630 };

/**
 * Archivo en TTF, leido del paquete que ya usa la app.
 *
 * Del disco y no de Google: si la vista previa dependiera de una descarga, un
 * runner de CI sin salida a internet dejaria de compilar. Y Satori no entiende
 * WOFF2, que es lo unico que sirve `next/font`.
 */
function archivo(peso: '400Regular' | '800ExtraBold'): ArrayBuffer | null {
  try {
    const ttf = readFileSync(
      join(process.cwd(), `node_modules/@expo-google-fonts/archivo/${peso}/Archivo_${peso}.ttf`),
    );
    return ttf.buffer.slice(ttf.byteOffset, ttf.byteOffset + ttf.byteLength) as ArrayBuffer;
  } catch {
    // Sin la fuente la tarjeta sale en la sans del sistema. Fea, pero sale: no
    // vale la pena tumbar un build por esto. Queda escrito en el log del build
    // para que una regresion no pase en silencio.
    console.warn(`[og] no se pudo leer Archivo ${peso}: la tarjeta sale con la fuente del sistema`);
    return null;
  }
}

/** Las dos voces: el titular en negra, el resto en redonda. */
function fuentes() {
  const negra = archivo('800ExtraBold');
  const redonda = archivo('400Regular');
  const cargadas = [
    ...(negra === null ? [] : [{ name: 'Archivo', data: negra, weight: 800 as const, style: 'normal' as const }]),
    ...(redonda === null ? [] : [{ name: 'Archivo', data: redonda, weight: 400 as const, style: 'normal' as const }]),
  ];
  return cargadas.length === 0 ? null : cargadas;
}

export function GET() {
  const fonts = fuentes();

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '70px 78px',
          color: colors.ink,
          fontFamily: 'Archivo, sans-serif',
          fontWeight: 400,
          // El halo de la portada. Un degradado y no un circulo: Satori no sabe
          // desenfocar, asi que un circulo de verdad sale con el borde duro.
          backgroundColor: colors.canvas,
          backgroundImage: `radial-gradient(920px 720px at 94% 6%, rgba(47,209,109,0.17), rgba(8,8,10,0) 68%)`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <svg width="58" height="58" viewBox={LOGO_VIEWBOX}>
            <path d={LOGO_OUTLINE_PATH} fill={colors.ink} />
            <path d={LOGO_BAR_PATH} stroke={colors.canvas} strokeWidth={LOGO_BAR_WIDTH} />
          </svg>
          <span style={{ fontWeight: 800, fontSize: 42, letterSpacing: 3 }}>SINCHI</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <span
            style={{
              fontWeight: 800,
              fontSize: 82,
              letterSpacing: -3,
              lineHeight: 1.02,
              maxWidth: 900,
            }}
          >
            Quién entrena, quién paga y cuándo le toca.
          </span>
          <span style={{ fontSize: 29, color: colors.textSecondary, maxWidth: 700, lineHeight: 1.35 }}>
            El padrón, la asistencia y el cobro de tu gimnasio, en una sola app.
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 15 }}>
          <div style={{ width: 15, height: 15, borderRadius: 8, background: SEMAPHORE_DEFAULT.ok, display: 'flex' }} />
          <span style={{ fontSize: 25, color: colors.textTertiary }}>
            <span style={{ color: SEMAPHORE_DEFAULT.ok }}>Primer mes gratis</span>
            {/* Satori se come el espacio del principio de una cadena suelta. */}
            <span style={{ marginLeft: 9 }}>· Gimnasios y escuelas de artes marciales</span>
          </span>
        </div>
      </div>
    ),
    {
      ...SIZE,
      ...(fonts === null ? {} : { fonts }),
    },
  );
}
