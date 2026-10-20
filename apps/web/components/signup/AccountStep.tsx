'use client';

/**
 * Paso 1 del alta: la cuenta.
 *
 * Google primero y el correo debajo, como en el login del panel: es la puerta
 * que más gente va a usar y la que no obliga a inventar una contraseña. El
 * botón de Google no aparece si este despliegue no tiene cliente OAuth; lo
 * decide el servidor y llega como prop.
 *
 * El formulario de correo tiene UN botón, «Continuar», que crea la cuenta o
 * entra con la que ya existe —esa decisión la toma la acción—. Dos botones,
 * «Crear cuenta» y «Ya tengo una», obligan a quien no se acuerda de si la
 * creó a adivinar, y la mitad adivina mal.
 */
import { useActionState, useCallback } from 'react';
import { useFormStatus } from 'react-dom';
import type { SaasTier } from '@sinchi/shared';
import { GoogleButton } from '../panel/GoogleButton';
import { IDLE } from '../../src/panel/form-state';
import { startWithEmail, startWithGoogle } from '../../src/signup/actions';

export function AccountStep({
  googleClientId,
  plan,
  notice,
}: {
  readonly googleClientId: string | null;
  /** El plan elegido en la portada, para que llegue marcado al paso 2. */
  readonly plan: SaasTier | null;
  /** Por qué volvió aquí, si volvió: la credencial venció a medio formulario. */
  readonly notice: string | null;
}) {
  const [state, action] = useActionState(startWithEmail, IDLE);
  // Estable mientras no cambie el plan: `GoogleButton` vuelve a inicializar GIS
  // cada vez que cambia su callback, y una función nueva por render le haría
  // dibujar el botón dos veces.
  const onGoogle = useCallback((credential: string) => startWithGoogle(credential, plan), [plan]);

  return (
    <div className="signup-card">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        <span className="signup-step">Paso 1 de 2</span>
        <h2 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em' }}>
          Tu cuenta
        </h2>
        <p style={{ margin: 0, fontSize: 14, lineHeight: '21px', color: 'var(--text-secondary)' }}>
          Con ella entras a la app y al panel. Si ya entrenas en un gimnasio de la red, usa la
          misma: tu local queda a tu nombre y después cambias entre tu vista de dueño y la de
          alumno.
        </p>
      </div>

      {notice === null ? null : (
        <p className="panel-alert bad" role="alert">
          <strong aria-hidden>✕</strong>
          <span>{notice}</span>
        </p>
      )}

      {googleClientId === null ? null : (
        <>
          <GoogleButton clientId={googleClientId} onCredential={onGoogle} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ height: 1, flexGrow: 1, background: 'var(--hairline)' }} />
            <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>o con tu correo</span>
            <span style={{ height: 1, flexGrow: 1, background: 'var(--hairline)' }} />
          </div>
        </>
      )}

      <form action={action} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {plan === null ? null : <input type="hidden" name="plan" value={plan} />}

        <label className="panel-field">
          <span>Correo</span>
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="tucorreo@ejemplo.com"
            className="panel-input"
          />
        </label>

        <label className="panel-field">
          <span>Contraseña</span>
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={6}
            placeholder="Al menos 6 caracteres"
            className="panel-input"
          />
        </label>

        {!state.error ? null : (
          <p className="panel-alert bad" role="alert">
            <strong aria-hidden>✕</strong>
            <span>{state.error}</span>
          </p>
        )}

        <Submit />
      </form>

      <p className="signup-hint">
        Si ese correo ya tiene cuenta en Sinchi, entras con su contraseña y sigues. Al continuar
        aceptas nuestra <a href="/privacidad">política de privacidad</a>.
      </p>
    </div>
  );
}

/**
 * Componente aparte porque `useFormStatus` solo lee el estado del `<form>` que
 * lo contiene: llamarlo en `AccountStep` devolvería siempre `pending: false`.
 */
function Submit() {
  const { pending } = useFormStatus();

  return (
    <button type="submit" className="panel-btn" disabled={pending} style={{ height: 44 }}>
      {pending ? 'Creando tu cuenta…' : 'Continuar'}
    </button>
  );
}
