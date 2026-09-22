'use client';

/**
 * La barra y el menú.
 *
 * Es el único componente cliente de la página: todo lo demás es HTML estático.
 * Un menú hamburguesa se puede hacer sin JavaScript con un `<input type=checkbox>`
 * escondido, pero entonces el lector de pantalla anuncia una casilla —no un
 * botón que abre un menú— y no hay forma de cerrarlo con Escape. Por 40 líneas
 * de estado, mejor un botón de verdad.
 */
import { useEffect, useState } from 'react';
import { Logo } from './Brand';
import { ThemeToggle } from './ThemeToggle';

const LINKS = [
  { href: '#que-hace', label: 'Qué hace' },
  { href: '#los-dos-lados', label: 'Los dos lados' },
  { href: '#planes', label: 'Planes' },
] as const;

export function Nav() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // El menú tapa la pantalla entera: si la página sigue scrolleando debajo, al
    // cerrarlo apareces en otro sitio.
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    // Ensanchar la ventana esconde el botón por CSS, y sin esto el menú se
    // quedaría abierto e invisible, robando el foco.
    const desktop = window.matchMedia('(min-width: 901px)');
    const onResize = () => {
      if (desktop.matches) setOpen(false);
    };

    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    desktop.addEventListener('change', onResize);

    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
      desktop.removeEventListener('change', onResize);
    };
  }, [open]);

  return (
    <>
      <header className="bar">
        <div className="wrap bar-inner">
          <a href="#top" className="brand" aria-label="Sinchi, inicio">
            <Logo size={26} />
            <span className="display">SINCHI</span>
          </a>

          <nav className="nav-sections" aria-label="Secciones">
            {LINKS.map((link) => (
              <a key={link.href} href={link.href} className="nav-link">
                {link.label}
              </a>
            ))}
          </nav>

          {/* Lo de la derecha NO son tres enlaces más: son el tema, la cuenta y
              la acción, y por eso van detrás de una raya y no dentro del `<nav>`
              de las secciones. «Entrar» puesto en fila con «Planes» decía que
              era otro sitio de la página al que bajar, y no lo es — es la puerta
              de quien YA es cliente. Sigue siendo un enlace y no un botón: el
              botón de esta barra tiene que seguir siendo el de ventas, que es a
              lo que la página viene. */}
          <div className="nav-utils">
            <ThemeToggle compact />
            <a href="/panel" className="nav-link">
              Entrar
            </a>
            <a href="#contacto" className="btn-outline">
              Hablar con ventas
            </a>
          </div>

          <button
            type="button"
            className="burger"
            aria-expanded={open}
            aria-controls="menu"
            aria-label={open ? 'Cerrar el menú' : 'Abrir el menú'}
            onClick={() => setOpen((value) => !value)}
          >
            <span />
            <span />
            <span />
          </button>
        </div>
      </header>

      {/* `inert` y no solo `aria-hidden`: cerrado, el tabulador tiene que
          saltárselo entero, no solo dejar de anunciarlo. */}
      <div id="menu" className="menu" data-open={open} inert={!open}>
        <nav aria-label="Secciones">
          {LINKS.map((link) => (
            <a key={link.href} href={link.href} onClick={() => setOpen(false)}>
              {link.label}
            </a>
          ))}
        </nav>
        {/* El mismo orden que en la barra —tema, cuenta, acción— y los dos
            botones juntos al final: arriba el de quien ya es cliente, abajo el
            de quien todavía no. */}
        <ThemeToggle />
        <a href="/panel" className="btn-outline menu-btn" onClick={() => setOpen(false)}>
          Entrar a mi panel
        </a>
        <a href="#contacto" className="btn-solid" onClick={() => setOpen(false)}>
          Hablar con ventas
        </a>
      </div>
    </>
  );
}
