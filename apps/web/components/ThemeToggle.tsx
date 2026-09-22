'use client';

/**
 * El interruptor de tema.
 *
 * Tres estados y no un booleano, por la misma razón que en la app
 * (decisiones §17): «claro» y «el sistema está en claro» son dos hechos
 * distintos, y guardar solo el resultado perdería la diferencia. Quien no ha
 * tocado nada sigue al sistema y cambia CON él; quien elige, manda.
 *
 * Se guarda en `localStorage` y no en una cookie: es de este navegador, no de la
 * cuenta —entrar desde otra máquina no se lo lleva—, y el servidor no necesita
 * saberlo porque quien lo aplica antes de pintar es `THEME_BOOTSTRAP`.
 *
 * Es un único componente para la landing y el panel. Dos habrían sido dos
 * sitios donde escribir la misma clave, y el segundo es el que un día se
 * escribe mal y deja a la landing y al panel en temas distintos.
 *
 * ## Por qué iconos y no las tres palabras
 *
 * «Auto · Claro · Oscuro» ocupaban 200 px de barra al lado del botón de ventas
 * y pesaban más que los enlaces de las secciones, que es lo que la página viene
 * a que mires. Con los glifos son 96 px y se lee igual de rápido: el sol y la
 * luna no necesitan traducción.
 *
 * Y sigue siendo un segmentado de tres y no un botón que cicla, que es la otra
 * forma de ahorrar sitio: un botón que cicla no dice a dónde va —hay que
 * pulsarlo para averiguar si el siguiente es claro o auto— y esconde que existe
 * un tercer estado, que es justo el que trae puesto casi todo el mundo.
 *
 * Los estilos están en `globals.css` y no aquí en línea, aunque eso ate el
 * componente a una hoja: un estilo en línea no puede escribir un `:hover` ni un
 * `:focus-visible`, y sin ellos el control no responde a que lo señalas. La
 * hoja la carga el layout raíz, así que llega igual al panel y a /admin.
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';

type Preferencia = 'system' | 'light' | 'dark';

const CLAVE = 'sinchi.tema';

/**
 * Los glifos.
 *
 * De trazo y no de relleno, al mismo grosor que los del menú del panel: a 16 px
 * un icono macizo se convierte en una mancha y deja de leerse.
 *
 * El de «auto» es un círculo medio pintado —el `circle.lefthalf.filled` de
 * Apple— y no una «A» de automático: dice «las dos caras» sin depender del
 * idioma, y es el mismo dibujo que quien viene del iPhone ya ha visto en los
 * ajustes de pantalla.
 */
const GLIFOS: Record<Preferencia, ReactNode> = {
  system: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      {/* Sin `stroke` propio la mitad pintada se sale del círculo por el grosor
          de la línea y el borde recto queda abultado. */}
      <path d="M12 3.4a8.6 8.6 0 0 0 0 17.2Z" fill="currentColor" stroke="none" />
    </>
  ),
  light: (
    <>
      <circle cx="12" cy="12" r="4.1" />
      <path d="M12 2.7v2.1M12 19.2v2.1M21.3 12h-2.1M4.8 12H2.7M18.6 5.4 17.1 6.9M6.9 17.1 5.4 18.6M18.6 18.6l-1.5-1.5M6.9 6.9 5.4 5.4" />
    </>
  ),
  dark: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />,
};

const OPCIONES: readonly { readonly value: Preferencia; readonly label: string; readonly title: string }[] = [
  // «Auto» primero porque es lo que trae puesto, y claro antes que oscuro
  // porque así está en los ajustes de iOS y de Android.
  { value: 'system', label: 'Auto', title: 'Seguir al sistema' },
  { value: 'light', label: 'Claro', title: 'Siempre claro' },
  { value: 'dark', label: 'Oscuro', title: 'Siempre oscuro' },
];

function leer(): Preferencia {
  try {
    const guardado = localStorage.getItem(CLAVE);
    return guardado === 'light' || guardado === 'dark' ? guardado : 'system';
  } catch {
    // Ventana privada o almacenamiento bloqueado: se sigue al sistema, que es
    // el estado por defecto y el que no le estorba a nadie.
    return 'system';
  }
}

export function ThemeToggle({ compact = false }: { readonly compact?: boolean }) {
  /**
   * Arranca en `system` SIEMPRE, no en lo guardado.
   *
   * El HTML lo pinta el servidor, que no puede leer `localStorage`; empezar en
   * otro valor haría que React encontrara un árbol distinto al hidratar. Lo
   * guardado se lee en el efecto, ya en el cliente. Mientras tanto no hay
   * fogonazo: el atributo del `<html>` ya lo puso `THEME_BOOTSTRAP` antes de
   * pintar, y este componente solo decide qué botón se ve marcado.
   */
  const [preferencia, setPreferencia] = useState<Preferencia>('system');
  /**
   * Y este flag existe SOLO para no animar la primera colocación.
   *
   * Quien tiene guardado «oscuro» ve el HTML del servidor con la pastilla en
   * «Auto» y el efecto la manda a la tercera casilla: sin esto, cada carga de
   * página empieza con la pastilla cruzando el control sola, que parece que
   * alguien lo acaba de tocar.
   */
  const [montado, setMontado] = useState(false);

  useEffect(() => {
    setPreferencia(leer());
    setMontado(true);
  }, []);

  const elegir = (value: Preferencia) => {
    setPreferencia(value);
    try {
      if (value === 'system') localStorage.removeItem(CLAVE);
      else localStorage.setItem(CLAVE, value);
    } catch {
      // Se pierde al recargar, pero la página ya cambió: es el fallo que menos
      // estorba de los dos posibles.
    }

    // Quitar el atributo —y no ponerlo en 'system'— es lo que devuelve el mando
    // al `@media`. Con un tercer valor en el atributo, ninguna regla casaría.
    if (value === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', value);
  };

  // A la pastilla se le da la CASILLA, no unos píxeles: el ancho lo reparte el
  // flex y en la versión con texto las tres palabras no miden lo mismo, así que
  // cualquier desplazamiento calculado aquí sería el de otro tipo de letra.
  const casilla = OPCIONES.findIndex((opcion) => opcion.value === preferencia);

  return (
    <div
      role="radiogroup"
      aria-label="Tema de la página"
      className="theme-switch"
      data-compact={compact ? '' : undefined}
      data-montado={montado ? '' : undefined}
      style={{ '--casilla': casilla } as CSSProperties}
    >
      <span className="theme-switch-thumb" aria-hidden />
      {OPCIONES.map((opcion) => (
        <button
          key={opcion.value}
          type="button"
          role="radio"
          // Sin `montado`: antes de hidratar la pastilla ya está en «Auto»
          // —que es el valor con el que arranca el estado—, y marcar otra cosa
          // o no marcar nada dejaría al lector de pantalla diciendo algo
          // distinto de lo que se ve.
          aria-checked={preferencia === opcion.value}
          title={opcion.title}
          onClick={() => elegir(opcion.value)}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.7}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            {GLIFOS[opcion.value]}
          </svg>
          {/* La palabra se escribe siempre y en `compact` la esconde el CSS
              fuera de la vista, no un `display:none`: el nombre del botón tiene
              que seguir siendo «Claro» para quien navega por voz o lo escucha,
              y un icono sin texto se anuncia como «botón». */}
          <span className="theme-switch-label">{opcion.label}</span>
        </button>
      ))}
    </div>
  );
}
