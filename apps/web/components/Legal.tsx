import type { ReactNode } from 'react';
import { Logo } from './Brand';

/**
 * El marco de las paginas legales.
 *
 * No reusa `Nav` a proposito: esa barra navega por anclas de la portada
 * (`#planes`, `#que-hace`), y desde /privacidad un ancla suelta no lleva a
 * ningun sitio. Aqui la marca es un enlace de vuelta y ya esta — quien llega a
 * una politica de privacidad viene a leer una cosa concreta, casi siempre desde
 * la ficha de la tienda, y no a recorrer el producto.
 */
export function LegalPage({
  title,
  updated,
  intro,
  children,
}: {
  readonly title: string;
  readonly updated: string;
  readonly intro: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <>
      <header className="bar" style={{ background: 'color-mix(in srgb, var(--canvas) 82%, transparent)', borderBottomColor: 'var(--hairline)' }}>
        <div className="wrap bar-inner">
          <a href="/" className="brand" aria-label="Sinchi, inicio">
            <Logo size={26} />
            <span className="display">SINCHI</span>
          </a>
          <a href="/" className="nav-link">Volver al inicio</a>
        </div>
      </header>

      <main className="section">
        {/* 68ch: la medida de lectura. La portada es ancha porque son bloques
            cortos junto a imagenes; esto son parrafos seguidos, y a 1360 px el
            ojo pierde el renglon al volver. */}
        <div style={{ maxWidth: '68ch', margin: '0 auto' }}>
          <p className="eyebrow" style={{ marginBottom: 14 }}>Actualizada el {updated}</p>
          <h1 className="display h1" style={{ margin: '0 0 22px' }}>{title}</h1>
          <div className="lead" style={{ marginBottom: 44 }}>{intro}</div>
          {children}
        </div>
      </main>

      <footer style={{ borderTop: '1px solid var(--hairline)' }}>
        <div className="wrap foot" style={{ padding: '30px var(--gutter)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <Logo size={18} color="var(--text-tertiary)" />
            <span style={{ fontSize: 11 }} className="tertiary">Sinchi · Lima, Perú</span>
          </div>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <a href="/privacidad" style={{ fontSize: 11 }} className="tertiary">Privacidad</a>
            <a href="/eliminar-cuenta" style={{ fontSize: 11 }} className="tertiary">Eliminar mi cuenta</a>
            <a href="mailto:soporte@sinchi.fit" style={{ fontSize: 11 }} className="tertiary">soporte@sinchi.fit</a>
          </div>
        </div>
      </footer>
    </>
  );
}

/** Un apartado con su titulo. El `id` para poder enlazar a uno concreto. */
export function Section({ id, title, children }: { readonly id: string; readonly title: string; readonly children: ReactNode }) {
  return (
    <section id={id} style={{ marginBottom: 40 }}>
      <h2 className="display h3" style={{ margin: '0 0 14px' }}>{title}</h2>
      <div className="body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>{children}</div>
    </section>
  );
}

/** Lista de datos: el dato en claro y, al lado, para que se usa. */
export function DataList({ items }: { readonly items: readonly (readonly [string, string])[] }) {
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {items.map(([dato, uso]) => (
        <li key={dato} style={{ display: 'flex', gap: 12, alignItems: 'baseline', borderBottom: '1px solid var(--hairline)', paddingBottom: 10 }}>
          <span style={{ color: 'var(--ink)', fontWeight: 600, flex: 'none', minWidth: '13ch' }}>{dato}</span>
          <span>{uso}</span>
        </li>
      ))}
    </ul>
  );
}
