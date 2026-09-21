/**
 * La puerta del panel de Sinchi.
 *
 * Una sola forma de entrar: Google. No es una simplificación de la pantalla — la
 * api RECHAZA cualquier otra (`PlatformAdminService.signIn`), porque la segunda
 * llave de un poder que elimina gimnasios no puede ser una contraseña. Dibujar
 * aquí un formulario de correo sería invitar a algo que la api va a negar.
 *
 * Y no dice qué es esto. Quien tiene que entrar ya lo sabe; para el resto, una
 * página que explica qué se administra desde aquí es un mapa del tesoro.
 */
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Logo } from '../../../components/Brand';
import { AdminLoginCard } from '../../../components/admin/LoginCard';
import { ThemeToggle } from '../../../components/ThemeToggle';
import { googleReady } from '../../../src/panel/firebase';
import { readAdminSession } from '../../../src/admin/session';

export const metadata: Metadata = {
  title: 'Entrar · Sinchi interno',
  robots: { index: false, follow: false },
};

/** Lee la cookie, así que no se prerenderiza. */
export const dynamic = 'force-dynamic';

export default async function EntrarAlPanelDeSinchi() {
  if ((await readAdminSession()) !== null) redirect('/admin');

  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: 'var(--canvas)',
      }}
    >
      <div
        className="panel-card"
        style={{
          width: 'min(420px, 100%)',
          display: 'flex',
          flexDirection: 'column',
          gap: 22,
          padding: 28,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <Logo size={24} />
            <span className="display" style={{ fontSize: 18, letterSpacing: '-0.035em' }}>
              SINCHI
            </span>
          </div>
          <ThemeToggle compact />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <span className="admin-mark">Interno</span>
          <h1 style={{ margin: '6px 0 0', fontSize: 21, fontWeight: 700, letterSpacing: '-0.015em' }}>
            Entra con tu cuenta
          </h1>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--text-secondary)', lineHeight: '21px' }}>
            Solo para quien administra Sinchi. Si tienes un gimnasio, tu panel está en{' '}
            <a href="/panel" style={{ color: 'var(--ok)' }}>
              /panel
            </a>
            .
          </p>
        </div>

        <AdminLoginCard
          googleClientId={googleReady() ? (process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? null) : null}
        />
      </div>
    </div>
  );
}
