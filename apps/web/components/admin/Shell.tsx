'use client';

/**
 * El menú del panel de Sinchi.
 *
 * Cliente por una sola razón —`usePathname`, para marcar la sección abierta— y
 * por eso no recibe ni el token ni nada de la sesión: solo el correo de quien
 * está dentro, que ya es texto en el HTML.
 *
 * La franja «INTERNO» y el correo no son decoración. Las dos pantallas se
 * parecen mucho, y el parecido es el riesgo: la misma persona administra Sinchi
 * y es dueña de un dojo. Saber en cuál de las dos estás tiene que ser cuestión
 * de mirar, no de recordar.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Logo } from '../Brand';
import { ThemeToggle } from '../ThemeToggle';
import { salirDelPanelDeSinchi } from '../../src/admin/actions';

const SECCIONES = [
  { href: '/admin', label: 'Resumen', icon: 'home' },
  { href: '/admin/gimnasios', label: 'Gimnasios', icon: 'building' },
  { href: '/admin/codigos', label: 'Códigos', icon: 'tag' },
  { href: '/admin/equipo', label: 'Equipo', icon: 'users' },
] as const;

const ICONS: Record<string, React.ReactNode> = {
  home: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  building: (
    <>
      <path d="M3 21h18" />
      <path d="M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16" />
      <path d="M15 21V11h3a2 2 0 0 1 2 2v8" />
      <path d="M9 7h2M9 11h2M9 15h2" />
    </>
  ),
  tag: (
    <>
      <path d="M20.6 13.4 12 22l-9-9V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" />
      <circle cx="7.5" cy="7.5" r="1.3" />
    </>
  ),
  users: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    </>
  ),
};

export function AdminShell({
  email,
  children,
}: {
  readonly email: string;
  readonly children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="panel">
      <aside className="panel-aside">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <Logo size={22} />
            <span className="display" style={{ fontSize: 17, letterSpacing: '-0.03em' }}>
              SINCHI
            </span>
          </div>
          <span className="admin-mark">Interno</span>
        </div>

        <nav className="panel-nav" aria-label="Secciones del panel de Sinchi">
          {SECCIONES.map((seccion) => (
            <Link
              key={seccion.href}
              href={seccion.href}
              className="panel-link"
              // Exacto para «Resumen» y por prefijo para el resto: sin esto,
              // `/admin` quedaría marcado desde cualquier subsección y el menú
              // diría que estás en dos sitios a la vez.
              aria-current={
                (seccion.href === '/admin'
                  ? pathname === seccion.href
                  : pathname.startsWith(seccion.href))
                  ? 'page'
                  : undefined
              }
            >
              <svg
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                {ICONS[seccion.icon]}
              </svg>
              {seccion.label}
            </Link>
          ))}
        </nav>

        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span className="panel-eyebrow">Entraste como</span>
            <span style={{ fontSize: 12.5, fontWeight: 600, wordBreak: 'break-all' }}>{email}</span>
          </div>
          <Link
            href="/panel"
            className="panel-link"
            style={{ paddingLeft: 0, fontSize: 13 }}
            // El camino de vuelta al panel de un gimnasio, para quien tiene los
            // dos. Sin él, salir de aquí y entrar allá es escribir la URL.
          >
            ← Ir al panel de un gimnasio
          </Link>
          <ThemeToggle compact />
          {/* Un form y no un `onClick`: cerrar sesión borra una cookie del
              servidor, así que es una Server Action. Y así funciona igual
              mientras el JavaScript de la página todavía no ha cargado. */}
          <form action={salirDelPanelDeSinchi}>
            <button
              type="submit"
              className="panel-btn ghost"
              style={{ width: '100%', padding: '8px 12px', fontSize: 13 }}
            >
              Cerrar sesión
            </button>
          </form>
        </div>
      </aside>

      <main className="panel-main">{children}</main>
    </div>
  );
}
