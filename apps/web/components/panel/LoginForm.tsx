'use client';

/**
 * Las dos puertas del panel.
 *
 * Google va PRIMERO y el correo debajo, separados por un «o». No es estética:
 * el dueño que dio de alta su gimnasio desde la app lo hizo con Google —es lo
 * que su vínculo automático por `email_verified` necesita— así que es la puerta
 * que la mayoría va a usar. Poner el formulario arriba haría que escribieran
 * una contraseña que quizá nunca crearon.
 *
 * El botón de Google no aparece si este despliegue no tiene cliente OAuth. Lo
 * decide el servidor (`googleReady`) y llega como prop: enseñar un botón que
 * lleva a «OPERATION_NOT_ALLOWED» es la forma más cara de decir «falta
 * configurar», y es el defecto que este producto ya se conoce — una acción que
 * invita a algo que la api va a rechazar.
 */
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { GoogleButton } from './GoogleButton';
import { IDLE, entrar } from '../../src/panel/actions';

export function LoginForm({
  aviso,
  googleClientId,
}: {
  readonly aviso: string | null;
  readonly googleClientId: string | null;
}) {
  const [state, action] = useActionState(entrar, IDLE);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        <h2 style={{ margin: 0, fontSize: 21, fontWeight: 700, letterSpacing: '-0.015em' }}>
          Entra a tu panel
        </h2>
        <p style={{ margin: 0, fontSize: 14, color: 'var(--text-secondary)' }}>
          Es solo para dueños de local.
        </p>
      </div>

      {aviso === null ? null : (
        <p className="panel-alert bad" role="alert">
          <strong aria-hidden>✕</strong>
          <span>{aviso}</span>
        </p>
      )}

      {googleClientId === null ? null : (
        <>
          <GoogleButton clientId={googleClientId} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ height: 1, flexGrow: 1, background: 'var(--hairline)' }} />
            <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>o con tu correo</span>
            <span style={{ height: 1, flexGrow: 1, background: 'var(--hairline)' }} />
          </div>
        </>
      )}

      <form action={action} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <label className="panel-field">
          <span>Correo</span>
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="sergio@ironmuaythai.pe"
            className="panel-input"
          />
        </label>

        <label className="panel-field">
          <span>Contraseña</span>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            placeholder="••••••••"
            className="panel-input"
          />
        </label>

        {state.error === null ? null : (
          <p className="panel-alert bad" role="alert">
            <strong aria-hidden>✕</strong>
            <span>{state.error}</span>
          </p>
        )}

        <Submit />
      </form>

      <p style={{ margin: 0, fontSize: 13, lineHeight: '20px', color: 'var(--text-tertiary)' }}>
        ¿Trabajas en recepción? Tu sitio es la app, de pie en el mostrador.
      </p>
    </div>
  );
}

/**
 * El botón, apagado mientras la acción va.
 *
 * Componente aparte porque `useFormStatus` solo lee el estado del `<form>` que
 * lo contiene — llamarlo en `LoginForm` devolvería siempre `pending: false`, y
 * el botón se podría pulsar tres veces mientras Identity Toolkit contesta.
 */
function Submit() {
  const { pending } = useFormStatus();

  return (
    <button type="submit" className="panel-btn" disabled={pending} style={{ height: 44 }}>
      {pending ? 'Entrando…' : 'Entrar'}
    </button>
  );
}
