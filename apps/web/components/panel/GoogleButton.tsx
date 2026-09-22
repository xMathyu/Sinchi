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
 *
 * QUÉ SE HACE CON LA CREDENCIAL también llega como prop, y por eso este botón
 * sirve a las dos puertas: la del dueño (`/panel`) y la de quien administra
 * Sinchi (`/admin`). Lo que cambia entre ellas es a qué ruta de la api se canjea
 * el token, y eso pasa en el servidor. Copiar el componente habría duplicado la
 * carga del script de GIS y las condiciones de marca de Google, para cambiar una
 * línea.
 *
 * LA ESPERA SE VE, y es la mitad de lo que hace este archivo. Entre que Google
 * devuelve la credencial y el panel aparece hay dos viajes al servidor —Identity
 * Toolkit y la api— más la navegación, y el panel todavía tiene que pedir sus
 * datos: son segundos en los que la pantalla del login sigue ahí. Sin nada que
 * lo diga, eso se lee como que no pasó nada, y quien entra vuelve a pulsar.
 */
import { useEffect, useRef, useState } from 'react';
import type { FormState } from '../../src/panel/form-state';

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

export function GoogleButton({
  clientId,
  onCredential,
}: {
  readonly clientId: string;
  /** La Server Action que canjea la credencial. Redirige si sale bien. */
  readonly onCredential: (credential: string) => Promise<FormState>;
}) {
  const slot = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  // Lo mismo que `working`, pero en un ref, y hace falta: quien lo consulta es
  // el callback que GIS recibió AL MONTAR, y ese cierra sobre el estado de
  // entonces — leería `false` para siempre.
  const inFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const render = () => {
      const target = slot.current;
      const gis = window.google?.accounts.id;
      if (cancelled || target === null || gis === undefined) return;

      gis.initialize({
        client_id: clientId,
        callback: (response) => {
          // Una segunda credencial mientras la primera se canjea abre dos
          // sesiones seguidas, y la de después pisa a la de antes. El aviso ya
          // tapa el botón; esto cubre lo que un aviso no puede — un GIS que
          // vuelva a llamar al callback por su cuenta.
          if (inFlight.current) return;

          const credential = response.credential;
          if (typeof credential !== 'string') {
            setError('Google no devolvió una credencial. Intenta de nuevo.');
            return;
          }

          inFlight.current = true;
          setWorking(true);
          setError(null);

          const failed = (message: string) => {
            inFlight.current = false;
            setWorking(false);
            setError(message);
          };

          // `working` NO se apaga cuando la promesa vuelve bien, y ahí estaba el
          // defecto: la acción redirige, pero la promesa vuelve aquí ANTES de
          // que el panel esté en pantalla —Next navega dentro de la misma
          // transición y la página de destino todavía tiene que pedir sus
          // datos—. Apagarlo devolvía el botón de Google durante esos segundos,
          // se leía como que el intento no había prendido, y el segundo clic
          // salía solo. Mientras la navegación va, esta pantalla sigue montada y
          // tiene que seguir diciendo que está entrando; la apaga el desmontaje.
          void onCredential(credential)
            .then((state: FormState | undefined) => {
              // `undefined` es el camino feliz: la acción llamó a `redirect()`,
              // que en el servidor no devuelve nada. El tipo dice `FormState`
              // porque `redirect()` tipa como `never`; el runtime dice otra cosa.
              if (state !== undefined && state.error !== null) failed(state.error);
            })
            .catch(() => failed('No se pudo entrar con Google. Intenta de nuevo.'));
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
  }, [clientId, onCredential]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ position: 'relative', minHeight: 44 }}>
        {/* El botón de GIS no se toca mientras se espera —desmontarlo obligaría
            a que Google lo volviera a dibujar al primer error—: el aviso va
            ENCIMA y es opaco, que además es lo que hace imposible el segundo
            clic. `inert` es la otra mitad de eso: sin él el iframe sigue siendo
            tabulable debajo de algo que no se ve. */}
        <div ref={slot} inert={working} style={{ minHeight: 44, colorScheme: 'light' }} />
        {!working ? null : (
          // `role="status"` y no `aria-busy` en un div vacío: quien no ve la
          // pantalla necesita que la espera se ANUNCIE, no que esté disponible
          // para quien vaya a buscarla.
          <p className="panel-waiting" role="status">
            <span className="panel-spinner" aria-hidden />
            <span>Entrando con Google…</span>
          </p>
        )}
      </div>
      {error === null ? null : (
        <p className="panel-alert bad" role="alert">
          <strong aria-hidden>✕</strong>
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}
