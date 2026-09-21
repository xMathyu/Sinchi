'use client';

/**
 * El botón de Google.
 *
 * Lo dibuja Google Identity Services, no nosotros, y eso no es pereza: el
 * aspecto del botón está en las condiciones de marca de Google, y uno propio
 * que abra el mismo flujo es lo que hace que te rechacen la verificación de la
 * pantalla de consentimiento. Su script se carga solo en esta pantalla.
 *
 * Lo único que hacemos con lo que devuelve es pasarlo al servidor. La credencial
 * es un JWT de Google que aquí NO se abre ni se cree: quien lo verifica es
 * Identity Toolkit al canjearlo, y lo que sale de ahí lo vuelve a verificar la
 * api. Si esta pantalla intentara leer el correo de dentro para «adelantar
 * trabajo», estaría confiando en un dato que el navegador puede escribir.
 *
 * El componente no existe si no hay cliente OAuth configurado — quien decide eso
 * es `googleReady()` en el servidor, y por eso llega como prop: leer la variable
 * aquí obligaría a exponerla aunque no se use.
 */
import { useEffect, useRef, useState } from 'react';
import { entrarConGoogle } from '../../src/panel/actions';

/** Lo que GIS le pasa al callback. Solo se usa `credential`. */
interface CredentialResponse {
  readonly credential?: string;
}

declare global {
  interface Window {
    readonly google?: {
      readonly accounts: {
        readonly id: {
          initialize: (config: {
            client_id: string;
            callback: (response: CredentialResponse) => void;
            auto_select?: boolean;
            cancel_on_tap_outside?: boolean;
          }) => void;
          renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
        };
      };
    };
  }
}

const SCRIPT = 'https://accounts.google.com/gsi/client';

export function GoogleButton({ clientId }: { readonly clientId: string }) {
  const slot = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const render = () => {
      const target = slot.current;
      const gis = window.google?.accounts.id;
      if (cancelled || target === null || gis === undefined) return;

      gis.initialize({
        client_id: clientId,
        callback: (response) => {
          const credential = response.credential;
          if (typeof credential !== 'string') {
            setError('Google no devolvió una credencial. Intenta de nuevo.');
            return;
          }

          setWorking(true);
          setError(null);
          // La acción redirige al panel cuando sale bien, así que solo vuelve
          // aquí si falló: el `setWorking(false)` del final no es alcanzable en
          // el camino feliz, y tampoco molesta.
          void entrarConGoogle(credential)
            .then((state) => {
              if (state.error !== null) setError(state.error);
            })
            .catch(() => setError('No se pudo entrar con Google. Intenta de nuevo.'))
            .finally(() => setWorking(false));
        },
        // Sin One Tap: en un panel de administración, una hoja que aparece sola
        // y mete sesión sin que nadie la pida es peor que un botón.
        auto_select: false,
        cancel_on_tap_outside: true,
      });

      gis.renderButton(target, {
        type: 'standard',
        theme: 'filled_black',
        size: 'large',
        shape: 'pill',
        text: 'signin_with',
        locale: 'es',
        // GIS dibuja en un iframe de ancho fijo: sin esto sale a 200px dentro de
        // una columna de 364 y queda descentrado respecto del botón de al lado.
        width: 364,
      });
    };

    if (window.google?.accounts.id !== undefined) {
      render();
      return () => {
        cancelled = true;
      };
    }

    // Un solo `<script>` aunque el componente se monte dos veces: en desarrollo
    // React monta, desmonta y vuelve a montar, y dos copias de GIS dibujan dos
    // botones.
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT}"]`);
    const script = existing ?? document.createElement('script');
    script.addEventListener('load', render);

    if (existing === null) {
      script.src = SCRIPT;
      script.async = true;
      script.defer = true;
      script.addEventListener('error', () => {
        if (!cancelled) setError('No se pudo cargar el acceso con Google.');
      });
      document.head.appendChild(script);
    }

    return () => {
      cancelled = true;
      script.removeEventListener('load', render);
    };
  }, [clientId]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* `aria-busy` y no un spinner que tape el botón: mientras la acción va,
          GIS ya deshabilita el suyo, y lo que falta es decirlo en voz alta. */}
      <div ref={slot} aria-busy={working} style={{ minHeight: 44, colorScheme: 'light' }} />
      {error === null ? null : (
        <p className="panel-alert bad" role="alert">
          <strong aria-hidden>✕</strong>
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}
