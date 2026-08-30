import type { Metadata, Viewport } from 'next';
import { Archivo } from 'next/font/google';
import { tokenCss } from './tokens';
import './globals.css';

/**
 * Archivo, la voz de la marca (`packages/ui`: «condensada y muy pesada, con
 * tracking negativo… viene del mundo del cartel deportivo»).
 *
 * Por `next/font` y no por un `<link>` a Google: así la fuente se sirve desde el
 * mismo dominio y no hay una petición a un tercero antes de que se pinte el
 * titular. Es la primera línea que lee quien llega.
 */
const archivo = Archivo({
  subsets: ['latin'],
  weight: ['700', '800', '900'],
  variable: '--font-display',
  display: 'swap',
});

/**
 * Sin esto, `og:image` sale como una ruta relativa y ni WhatsApp ni Twitter la
 * resuelven: la vista previa aparece sin imagen. El dominio se puede fijar por
 * entorno para poder previsualizar desde una URL de pruebas.
 */
const SITE = process.env['NEXT_PUBLIC_SITE_URL'] ?? 'https://sinchi.pe';

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: 'Sinchi · Quién entrena, quién paga y cuándo le toca',
  description:
    'Sinchi lleva el padrón de tu gimnasio, marca la asistencia de cada clase y cobra las mensualidades. Tú lo ves en el mostrador y tu alumno en su teléfono.',
  applicationName: 'Sinchi',
  // Los dos van declarados: en cuanto se nombra uno, Next deja de anadir el
  // que detecta solo, y la pestana se quedaria pidiendo un /favicon.ico que no
  // existe.
  icons: {
    icon: [{ url: '/icon.svg', type: 'image/svg+xml' }],
    apple: '/apple-icon.png',
  },
  openGraph: {
    title: 'Sinchi · Quién entrena, quién paga y cuándo le toca',
    description:
      'El padrón, la asistencia y el cobro de tu gimnasio, en una sola app. El primer mes es gratis.',
    siteName: 'Sinchi',
    url: SITE,
    locale: 'es_PE',
    type: 'website',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Sinchi · Quién entrena, quién paga y cuándo le toca' }],
  },
  twitter: {
    // `summary_large_image` y no `summary`: con la tarjeta pequeña el logo sale
    // recortado en un cuadrado de 120 px y no se lee nada.
    card: 'summary_large_image',
    title: 'Sinchi · Quién entrena, quién paga y cuándo le toca',
    description:
      'El padrón, la asistencia y el cobro de tu gimnasio, en una sola app. El primer mes es gratis.',
    images: ['/og.png'],
  },
};

export const viewport: Viewport = {
  themeColor: '#08080A',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { readonly children: React.ReactNode }) {
  return (
    <html lang="es" className={archivo.variable}>
      <head>
        <style dangerouslySetInnerHTML={{ __html: tokenCss() }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
