'use client';

/**
 * El botón de entrar al panel de Sinchi.
 *
 * Es cliente porque el botón lo dibuja Google Identity Services en el navegador
 * —no hay forma de que lo haga el servidor: el consentimiento es suyo— y porque
 * el rechazo tiene que verse sin recargar. Lo único que se hace con la
 * credencial es pasarla a la Server Action.
 *
 * Sin cliente OAuth configurado no se dibuja nada y se dice por qué. Un botón
 * que lleva a «OPERATION_NOT_ALLOWED» es la forma más cara de decir «falta
 * configurar».
 */
import { GoogleButton } from '../panel/GoogleButton';
import { entrarAlPanelDeSinchi } from '../../src/admin/actions';

export function AdminLoginCard({ googleClientId }: { readonly googleClientId: string | null }) {
  if (googleClientId === null) {
    return (
      <p className="panel-alert bad" role="alert">
        <strong aria-hidden>✕</strong>
        <span>
          Este despliegue no tiene configurado el acceso con Google. Ver{' '}
          <code>apps/web/.env.example</code>.
        </span>
      </p>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <GoogleButton clientId={googleClientId} onCredential={entrarAlPanelDeSinchi} />
      <p style={{ margin: 0, fontSize: 12.5, lineHeight: '19px', color: 'var(--text-tertiary)' }}>
        Tu sesión dura 12 horas y vive en una cookie que el navegador no puede leer.
      </p>
    </div>
  );
}
