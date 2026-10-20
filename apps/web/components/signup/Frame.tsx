import type { ReactNode } from 'react';
import { Logo } from '../Brand';
import { ThemeToggle } from '../ThemeToggle';

/**
 * El marco del alta: la oferta a un lado, el formulario al otro.
 *
 * Es la misma composición que el login del panel, y por lo mismo: a la
 * izquierda lo que Sinchi le hace a un gimnasio, a la derecha lo que se le
 * pide. No reusa `Nav` porque esa barra navega por anclas de la portada, y
 * desde aquí un ancla suelta no lleva a ningún sitio; la marca es la vuelta al
 * inicio y ya está.
 */
export function SignupFrame({
  aside,
  children,
}: {
  readonly aside: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className="signup">
      <aside className="signup-aside">
        <div className="signup-aside-top">
          <a href="/" className="brand" aria-label="Sinchi, inicio">
            <Logo size={26} barColor="var(--screen)" />
            <span className="display">SINCHI</span>
          </a>
          <ThemeToggle compact />
        </div>

        {aside}

        <p className="signup-hint" style={{ marginTop: 'auto' }}>
          ¿Tu gimnasio ya está en Sinchi? <a href="/panel/entrar">Entra a tu panel</a>.
        </p>
      </aside>

      <main className="signup-main">{children}</main>
    </div>
  );
}
