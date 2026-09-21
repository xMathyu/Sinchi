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
 */
import { useEffect, useState } from 'react';

type Preferencia = 'system' | 'light' | 'dark';

const CLAVE = 'sinchi.tema';

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

  return (
    <div
      role="radiogroup"
      aria-label="Tema de la página"
      style={{
        display: 'inline-flex',
        gap: 2,
        padding: 2,
        borderRadius: 'var(--r-pill)',
        border: '1px solid var(--border)',
        background: 'var(--surface)',
      }}
    >
      {OPCIONES.map((opcion) => {
        const activa = montado && preferencia === opcion.value;
        return (
          <button
            key={opcion.value}
            type="button"
            role="radio"
            aria-checked={activa}
            title={opcion.title}
            onClick={() => elegir(opcion.value)}
            style={{
              padding: compact ? '5px 9px' : '6px 12px',
              borderRadius: 'var(--r-pill)',
              border: 'none',
              background: activa ? 'var(--chip-active)' : 'transparent',
              color: activa ? 'var(--ink)' : 'var(--text-secondary)',
              fontSize: compact ? 11 : 12,
              fontWeight: 600,
              fontFamily: 'inherit',
              cursor: 'pointer',
              lineHeight: 1.6,
            }}
          >
            {opcion.label}
          </button>
        );
      })}
    </div>
  );
}
