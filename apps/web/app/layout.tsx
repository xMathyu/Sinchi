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

export const metadata: Metadata = {
  title: 'Sinchi · Quién entrena, quién paga y cuándo le toca',
  description:
    'Sinchi lleva el padrón de tu gimnasio, marca la asistencia de cada clase y cobra las mensualidades. Tú lo ves en el mostrador y tu alumno en su teléfono.',
  openGraph: {
    title: 'Sinchi',
    description: 'El padrón, la asistencia y el cobro de tu gimnasio, en una sola app.',
    locale: 'es_PE',
    type: 'website',
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
