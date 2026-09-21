/**
 * La puerta del panel.
 *
 * Server Component: lo único que decide es si hay Google configurado, y eso se
 * resuelve aquí para no exponer la variable al navegador cuando no se usa. El
 * formulario es cliente porque necesita enseñar el motivo del rechazo sin
 * recargar.
 */
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Logo } from '../../../components/Brand';
import { LoginForm } from '../../../components/panel/LoginForm';
import { googleReady } from '../../../src/panel/firebase';
import { readSession } from '../../../src/panel/session';

export const metadata: Metadata = {
  title: 'Entrar · Panel de Sinchi',
  robots: { index: false, follow: false },
};

/**
 * Lee la cookie, así que esta ruta no se prerenderiza. Se dice explícito: sin
 * esto el build la trataría como estática y serviría a todo el mundo el HTML de
 * quien lo compiló.
 */
export const dynamic = 'force-dynamic';

export default async function EntrarPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly motivo?: string }>;
}) {
  // Con sesión de dueño ya abierta, esta pantalla no tiene nada que hacer. El
  // `motivo` es la excepción: viene de `requireOwner`, que rebota aquí a quien
  // entró siendo otra cosa, y mandarlo de vuelta al panel sería un bucle.
  const { motivo } = await searchParams;
  const session = await readSession();
  if (session !== null && session.role === 'owner' && motivo === undefined) redirect('/panel');

  const aviso =
    motivo === 'solo-duenos'
      ? 'El panel es para dueños de local. Si trabajas en recepción, tu sitio es la app.'
      : null;

  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) minmax(420px, 480px)',
        background: 'var(--canvas)',
      }}
      className="entrar"
    >
      <div
        className="entrar-marca"
        style={{
          boxSizing: 'border-box',
          padding: 'clamp(32px, 5vw, 60px)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          gap: 40,
          background: 'var(--screen)',
          borderRight: '1px solid var(--hairline)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Logo size={28} barColor="var(--screen)" />
          <span className="display" style={{ fontSize: 19, letterSpacing: '-0.045em' }}>
            SINCHI
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          <h1
            className="display"
            style={{ margin: 0, fontSize: 'clamp(30px, 4vw, 46px)', lineHeight: 0.98, maxWidth: 460 }}
          >
            Tu gimnasio, en una pantalla grande.
          </h1>
          <p style={{ margin: 0, fontSize: 15, lineHeight: '23px', color: 'var(--text-secondary)', maxWidth: 420 }}>
            El padrón, lo que entró este mes, quién viene siempre y quién dejó de venir. La app es
            para el mostrador; esto es para sentarse a mirar los números.
          </p>
        </div>

        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[
            'Entras con la misma cuenta de la app',
            'Tu sesión vive en una cookie que el navegador no puede leer',
          ].map((linea) => (
            <li key={linea} style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
              <span
                aria-hidden
                style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--ok)', flex: 'none', marginTop: 7 }}
              />
              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{linea}</span>
            </li>
          ))}
        </ul>
      </div>

      <div
        style={{
          boxSizing: 'border-box',
          padding: 'clamp(32px, 4vw, 56px) clamp(24px, 3vw, 48px)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
        }}
      >
        <LoginForm
          aviso={aviso}
          googleClientId={googleReady() ? (process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? null) : null}
        />
      </div>
    </div>
  );
}
