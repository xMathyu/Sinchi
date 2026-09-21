'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Alert } from './Pieces';
import { inscribir } from '../../src/panel/actions';
import { IDLE } from '../../src/panel/form-state';
import { soles } from '../../src/panel/format';
import type { WirePlan } from '../../src/panel/types';

export function AltaForm({ planes }: { readonly planes: readonly WirePlan[] }) {
  const [state, action] = useActionState(inscribir, IDLE);

  if (planes.length === 0) {
    // Un gimnasio nace sin tarifas, y eso es la respuesta, no el problema: no se
    // puede inscribir a nadie contra un plan que no existe. Se dice dónde ir.
    return (
      <Alert kind="bad">
        Todavía no tienes planes publicados. Créalos desde la app antes de dar de alta a nadie: una
        inscripción necesita un plan contra el que cobrar.
      </Alert>
    );
  }

  return (
    <form action={action} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <section className="panel-card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h2>Quién es</h2>

        <label className="panel-field">
          <span>Documento (DNI o carné de extranjería)</span>
          <input
            name="documentId"
            required
            minLength={6}
            maxLength={20}
            inputMode="numeric"
            placeholder="44189203"
            className="panel-input"
          />
        </label>

        <p style={{ margin: 0, fontSize: 12, lineHeight: '18px', color: 'var(--text-tertiary)' }}>
          Si ya entrena en otro gimnasio de la red, con el documento basta: su nombre y su celular
          ya se saben y no hace falta volver a escribirlos.
        </p>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <label className="panel-field" style={{ flex: '1 1 200px' }}>
            <span>Nombre completo</span>
            <input name="name" maxLength={120} placeholder="Carla Medina" className="panel-input" />
          </label>

          <label className="panel-field" style={{ flex: '1 1 160px' }}>
            <span>Celular</span>
            <input
              name="phone"
              type="tel"
              placeholder="+51 987 442 118"
              className="panel-input"
            />
          </label>
        </div>

        <label className="panel-field">
          <span>Correo (opcional)</span>
          <input name="email" type="email" placeholder="carla@ejemplo.pe" className="panel-input" />
        </label>
      </section>

      <section className="panel-card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h2>Con qué plan</h2>

        <label className="panel-field">
          <span>Plan</span>
          <select name="planId" required className="panel-select" defaultValue="">
            <option value="" disabled>
              Elige un plan
            </option>
            {planes.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.name} · {soles(plan.priceCents)}
                {plan.enrollmentFeeCents > 0
                  ? ` + ${soles(plan.enrollmentFeeCents)} de matrícula`
                  : ''}
              </option>
            ))}
          </select>
        </label>

        <p style={{ margin: 0, fontSize: 12, lineHeight: '18px', color: 'var(--text-tertiary)' }}>
          El alta no cobra nada: los cargos nacen pendientes y se cobran desde su ficha. Y no vincula
          su cuenta — le deja una solicitud que la persona acepta desde su app, que es lo que impide
          que alguien reclame la membresía de otro sabiéndose su DNI.
        </p>
      </section>

      {!state.error ? null : <Alert kind="bad">{state.error}</Alert>}

      <Submit />
    </form>
  );
}

function Submit() {
  const { pending } = useFormStatus();

  return (
    <button type="submit" className="panel-btn" disabled={pending} style={{ alignSelf: 'flex-start' }}>
      {pending ? 'Dando de alta…' : 'Dar de alta'}
    </button>
  );
}
