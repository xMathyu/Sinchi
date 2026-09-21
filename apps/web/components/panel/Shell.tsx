'use client';

/**
 * El menú del panel y la carcasa que lo rodea.
 *
 * Es cliente por una sola razón —`usePathname`, para marcar la sección abierta—
 * y por eso no recibe ni el token ni nada de la sesión: solo el nombre del
 * gimnasio y el de la persona, que son texto que ya está en el HTML. Todo lo
 * demás lo pintan Server Components dentro de `children`.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Logo } from '../Brand';
import { salir } from '../../src/panel/actions';

const SECCIONES = [
  { href: '/panel', label: 'Inicio', icon: 'home' },
  { href: '/panel/alumnos', label: 'Alumnos', icon: 'users' },
  { href: '/panel/ganancias', label: 'Ganancias', icon: 'chart' },
  { href: '/panel/materiales', label: 'Materiales', icon: 'play' },
] as const;

const ICONS: Record<string, React.ReactNode> = {
  home: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  users: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    </>
  ),
  chart: (
    <>
      <path d="M3 3v18h18" />
      <path d="M7 15l4-5 3 3 5-7" />
    </>
  ),
  play: (
    <>
      <rect x="2" y="4" width="20" height="16" rx="3" />
      <path d="m10 9 5 3-5 3z" />
    </>
  ),
};

export function PanelShell({
  tenantName,
  children,
}: {
  readonly tenantName: string;
  readonly children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="panel">
      <aside className="panel-aside">
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <Logo size={22} />
          <span className="display" style={{ fontSize: 17, letterSpacing: '-0.03em' }}>
            SINCHI
          </span>
        </div>

        <nav className="panel-nav" aria-label="Secciones del panel">
          {SECCIONES.map((seccion) => (
            <Link
              key={seccion.href}
              href={seccion.href}
              className="panel-link"
              // Exacto para «Inicio» y por prefijo para el resto: sin esto,
              // `/panel` quedaba marcado desde cualquier subsección y el menú
              // decía que estabas en dos sitios a la vez.
              aria-current={
                (seccion.href === '/panel'
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
            <span className="panel-eyebrow">Tu local</span>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{tenantName}</span>
          </div>
          {/* Un form y no un `onClick`: cerrar sesión borra una cookie del
              servidor, así que es una Server Action. Y así funciona igual
              mientras el JavaScript de la página todavía no ha cargado. */}
          <form action={salir}>
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
