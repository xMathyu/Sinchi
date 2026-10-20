'use client';

/**
 * Paso 2 del alta: el gimnasio.
 *
 * Un solo formulario y no un asistente: en una pantalla grande los tres
 * bloques —tú, tu local, tu plan— caben a la vista, y lo que hace abandonar
 * un alta es no saber cuánto falta. Los campos son los mismos que pedía la
 * app, menos dos que se hacen mejor desde ella con el local ya creado: el pin
 * del mapa y el logo.
 *
 * El escalón se ELIGE aquí solo para que sepa cuánto le va a costar. Lo que se
 * le cobre sale del padrón real, así que equivocarse eligiendo no le cuesta
 * dinero — y por eso el texto no lo trata como una decisión grave.
 */
import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  GYM_LINK_KINDS,
  GYM_LINK_LABELS,
  SAAS_FREE_TIER_LIMIT,
  SAAS_TIER_LABELS,
  SAAS_TIER_PRICES,
  formatPEN,
  isFreeTier,
  type GymLinkKind,
  type SaasTier,
} from '@sinchi/shared';
import { IDLE } from '../../src/panel/form-state';
import { createGym, switchAccount } from '../../src/signup/actions';
import { TIERS } from '../../src/signup/tiers';

const LINK_PLACEHOLDER: Readonly<Record<GymLinkKind, string>> = {
  website: 'midojo.pe',
  instagram: '@midojo',
  facebook: 'facebook.com/midojo',
  tiktok: '@midojo',
};

export function GymForm({
  identity,
  defaultTier,
}: {
  /** Con qué cuenta se está registrando. Solo lo que se puede enseñar. */
  readonly identity: { readonly email: string | null; readonly displayName: string | null };
  readonly defaultTier: SaasTier;
}) {
  const [state, action] = useActionState(createGym, IDLE);
  const [tier, setTier] = useState<SaasTier>(defaultTier);

  return (
    <form action={action} className="signup-card">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        <span className="signup-step">Paso 2 de 2</span>
        <h2 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em' }}>
          Tu gimnasio
        </h2>
        <p style={{ margin: 0, fontSize: 14, lineHeight: '21px', color: 'var(--text-secondary)' }}>
          Registrando con <strong style={{ color: 'var(--ink)' }}>{identity.email ?? 'tu cuenta'}</strong>.{' '}
          {/* `formNoValidate`: este botón sale del formulario, y sin él el
              navegador exigiría llenar los campos obligatorios para irse. */}
          <button type="submit" formAction={switchAccount} formNoValidate className="signup-link">
            Cambiar de cuenta
          </button>
        </p>
      </div>

      <section className="signup-section">
        <h3>Tú</h3>
        <label className="panel-field">
          <span>Tu nombre</span>
          <input
            name="ownerName"
            defaultValue={identity.displayName ?? ''}
            required
            minLength={2}
            maxLength={120}
            autoComplete="name"
            placeholder="Nombre y apellido"
            className="panel-input"
          />
        </label>
        <div className="signup-row">
          <label className="panel-field">
            <span>Tu documento</span>
            <input
              name="documentId"
              required
              minLength={6}
              maxLength={20}
              inputMode="numeric"
              autoComplete="off"
              placeholder="DNI"
              className="panel-input"
            />
          </label>
          <label className="panel-field">
            <span>Tu celular</span>
            <input
              name="phone"
              type="tel"
              required
              autoComplete="tel"
              placeholder="987 654 321"
              className="panel-input"
            />
          </label>
        </div>
        <p className="signup-hint">
          El documento es lo que te identifica en la red: si ya entrenas en otro gimnasio de
          Sinchi, tu local queda a nombre de esa misma persona. El celular es de Perú; si es de
          otro país, escríbelo con su código (+1…).
        </p>
      </section>

      <section className="signup-section">
        <h3>Tu local</h3>
        <label className="panel-field">
          <span>Nombre del gimnasio</span>
          <input
            name="gymName"
            required
            minLength={3}
            maxLength={120}
            autoComplete="organization"
            placeholder="Academia Kaizen"
            className="panel-input"
          />
        </label>
        <div className="signup-row">
          <label className="panel-field">
            <span>RUC (opcional)</span>
            <input
              name="taxId"
              inputMode="numeric"
              maxLength={20}
              placeholder="Si ya lo tienes"
              className="panel-input"
            />
          </label>
        </div>
        <label className="panel-field">
          <span>Dirección</span>
          <input
            name="address"
            required
            minLength={10}
            maxLength={240}
            autoComplete="street-address"
            placeholder="Av. Primavera 120, Surco"
            className="panel-input"
          />
        </label>
        <p className="signup-hint">
          Calle, número y distrito: es lo primero que mira quien busca dónde entrenar. El punto
          exacto en el mapa y tu logo los pones después desde la app.
        </p>
      </section>

      <section className="signup-section">
        <h3>Tu plan</h3>
        <p className="signup-hint">
          Elige por los alumnos que tienes hoy. Equivocarte no te cuesta nada: lo que se cobra
          sale del padrón real.
        </p>
        <div className="signup-tiers" role="radiogroup" aria-label="¿Cuántos alumnos tienes?">
          {TIERS.map((option) => (
            <label key={option} className="signup-tier">
              <input
                type="radio"
                name="saasTier"
                value={option}
                checked={tier === option}
                onChange={() => setTier(option)}
              />
              <span className="signup-tier-label">{SAAS_TIER_LABELS[option]}</span>
              <span className="signup-tier-price">
                {isFreeTier(option)
                  ? 'Gratis'
                  : `${formatPEN(SAAS_TIER_PRICES[option], { withDecimals: false })} / mes`}
              </span>
            </label>
          ))}
        </div>
        <p className="signup-hint">
          {isFreeTier(tier)
            ? `Con ${SAAS_FREE_TIER_LIMIT} alumnos o menos no se te cobra. Ni ahora ni en un año.`
            : 'Arrancas sin pagar: el primer cobro te llega recién al mes, y te lo cobramos a ti, no a tus alumnos.'}
        </p>
        <label className="panel-field">
          <span>Código de promoción (opcional)</span>
          <input
            name="promoCode"
            maxLength={40}
            autoCapitalize="characters"
            autoComplete="off"
            placeholder="Si te dieron uno"
            className="panel-input"
          />
        </label>
      </section>

      <details className="signup-details">
        <summary>Tu web y tus redes (opcional)</summary>
        <div className="signup-section" style={{ borderTop: 0, paddingTop: 12 }}>
          {GYM_LINK_KINDS.map((kind) => (
            <label key={kind} className="panel-field">
              <span>{GYM_LINK_LABELS[kind]}</span>
              <input
                name={`link_${kind}`}
                maxLength={400}
                autoComplete="off"
                placeholder={LINK_PLACEHOLDER[kind]}
                className="panel-input"
              />
            </label>
          ))}
        </div>
      </details>

      {!state.error ? null : (
        <p className="panel-alert bad" role="alert">
          <strong aria-hidden>✕</strong>
          <span>{state.error}</span>
        </p>
      )}

      <Submit />

      <p className="signup-hint">
        Sin tarjeta. Cuando termines, descarga la app: ahí creas tus planes, tu horario y tu
        primer alumno.
      </p>
    </form>
  );
}

/**
 * Componente aparte porque `useFormStatus` solo lee el estado del `<form>` que
 * lo contiene: llamarlo en `GymForm` devolvería siempre `pending: false`.
 */
function Submit() {
  const { pending } = useFormStatus();

  return (
    <button type="submit" className="panel-btn" disabled={pending} style={{ height: 46 }}>
      {pending ? 'Creando tu gimnasio…' : 'Crear mi gimnasio'}
    </button>
  );
}
