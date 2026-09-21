'use client';

/**
 * Crear y apagar códigos de promoción.
 *
 * Cliente por dos cosas que no se pueden hacer desde el servidor: enseñar el
 * rechazo sin recargar, y apagar el botón mientras `checkPromoDraft` diga que
 * no —la MISMA función que corre la api—. Lo que se lee aquí es lo que se
 * leería en el 400.
 *
 * El tope de usos tiene una casilla de «sin tope» en vez de aceptar el campo
 * vacío: un código sin tope regala meses a todo el que lo reciba, y eso tiene
 * que ser una decisión, no lo que sale por olvidar un número.
 */
import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  PROMO_MAX_FREE_MONTHS,
  checkPromoDraft,
  parsePlainDate,
  plainDateInZone,
  promoDraftDenialMessage,
  TZ_LIMA,
} from '@sinchi/shared';
import { Alert } from '../panel/Pieces';
import { IDLE } from '../../src/panel/form-state';
import { cambiarEstadoCodigo, crearCodigo } from '../../src/admin/actions';

export function PromoCreateForm() {
  const [state, action] = useActionState(crearCodigo, IDLE);
  const [code, setCode] = useState('');
  const [freeMonths, setFreeMonths] = useState('1');
  const [sinTope, setSinTope] = useState(false);
  const [maxRedemptions, setMaxRedemptions] = useState('20');
  const [expiresOn, setExpiresOn] = useState('');

  /**
   * El borrador, contra la misma regla que la api.
   *
   * «Hoy» se calcula en Lima y no con el reloj del navegador: un código que
   * vence hoy tiene que seguir siendo válido para quien lo crea desde otro huso,
   * y sobre todo el «hoy» que use la pantalla tiene que ser el mismo que usará
   * el servidor al comprobarlo.
   */
  const denial = checkPromoDraft(
    {
      code,
      freeMonths: Number(freeMonths),
      maxRedemptions: sinTope ? null : Number(maxRedemptions),
      expiresOn: /^\d{4}-\d{2}-\d{2}$/.test(expiresOn) ? parsePlainDate(expiresOn) : null,
    },
    plainDateInZone(new Date(), TZ_LIMA),
  );

  // Con el campo todavía vacío no se acusa a nadie de nada: el aviso aparece
  // cuando ya se escribió algo.
  const aviso = code.length === 0 ? null : denial;

  return (
    <form action={action} className="panel-card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <h2>Código nuevo</h2>

      <label className="panel-field">
        <span>Código</span>
        <input
          name="code"
          className="panel-input"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="VERANO2026"
          autoComplete="off"
          style={{ textTransform: 'uppercase' }}
        />
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
          Se guarda en mayúsculas y sin separadores: «verano-2026» y «VERANO 2026» abren la misma
          puerta.
        </span>
      </label>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <label className="panel-field">
          <span>Meses de regalo</span>
          <input
            name="freeMonths"
            type="number"
            min={1}
            max={PROMO_MAX_FREE_MONTHS}
            className="panel-input"
            value={freeMonths}
            onChange={(event) => setFreeMonths(event.target.value)}
          />
        </label>

        <label className="panel-field">
          <span>Tope de usos</span>
          <input
            name="maxRedemptions"
            type="number"
            min={1}
            className="panel-input"
            value={maxRedemptions}
            onChange={(event) => setMaxRedemptions(event.target.value)}
            disabled={sinTope}
          />
        </label>

        <label className="panel-field">
          <span>Vence el (opcional)</span>
          <input
            name="expiresOn"
            type="date"
            className="panel-input"
            value={expiresOn}
            onChange={(event) => setExpiresOn(event.target.value)}
          />
        </label>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 14 }}>
        <input
          type="checkbox"
          name="sinTope"
          checked={sinTope}
          onChange={(event) => setSinTope(event.target.checked)}
        />
        Sin tope de usos, a propósito
      </label>

      <label className="panel-field">
        <span>Para qué es</span>
        <input
          name="note"
          className="panel-input"
          placeholder="A quién se lo diste y por qué. Dentro de seis meses nadie se acuerda."
        />
      </label>

      <Alert kind="bad">{state.error}</Alert>
      <Alert kind="ok">{state.ok}</Alert>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Submit disabled={denial !== null} />
        {aviso === null ? null : (
          <span style={{ fontSize: 12.5, color: 'var(--text-tertiary)' }}>
            {promoDraftDenialMessage(aviso)}
          </span>
        )}
      </div>
    </form>
  );
}

function Submit({ disabled }: { readonly disabled: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" className="panel-btn" disabled={pending || disabled}>
      {pending ? 'Creando…' : 'Crear código'}
    </button>
  );
}

/**
 * El interruptor de un código.
 *
 * Apagar y no borrar: los canjes apuntan al código, así que borrarlo dejaría a
 * los gimnasios que lo usaron sin poder explicar de dónde salieron sus meses
 * gratis.
 */
export function PromoToggle({
  promoId,
  active,
}: {
  readonly promoId: string;
  readonly active: boolean;
}) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
      <button
        type="button"
        className={active ? 'panel-btn ghost' : 'panel-btn'}
        style={{ padding: '6px 12px', fontSize: 13 }}
        disabled={working}
        onClick={() => {
          setWorking(true);
          setError(null);
          void cambiarEstadoCodigo(promoId, !active)
            .then((state) => setError(state.error))
            .finally(() => setWorking(false));
        }}
      >
        {working ? '…' : active ? 'Apagar' : 'Encender'}
      </button>
      {error === null ? null : (
        <span style={{ fontSize: 12, color: 'var(--bad)' }}>{error}</span>
      )}
    </div>
  );
}
