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

          <nav className="nav-desktop" aria-label="Secciones">
            {LINKS.map((link) => (
              <a key={link.href} href={link.href} className="nav-link">
                {link.label}
              </a>
            ))}
            <a href="#contacto" className="btn-outline">
              Hablar con ventas
            </a>
          </nav>

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
        <a href="#contacto" className="btn-solid" onClick={() => setOpen(false)}>
          Hablar con ventas
        </a>
      </div>
    </>
  );
}
