'use client';

/**
 * El formulario de cobro.
 *
 * Cliente porque tiene que hacer dos cosas que el HTML solo no hace: enseñar el
 * motivo del rechazo sin recargar la ficha, y esconder el campo de monto cuando
 * el concepto es una mensualidad — ahí el importe lo calcula la api contra lo
 * que se debe, y un campo editable invitaría a escribir una cifra que después no
 * cuadra con la deuda.
 *
 * El botón dice qué va a pasar («Cobrar S/ 298»), no «Confirmar». Es dinero de
 * otra persona: la cifra tiene que estar delante en el momento de pulsar.
 */
import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Alert } from './Pieces';
import { IDLE, cobrar } from '../../src/panel/actions';
import { soles } from '../../src/panel/format';

type Concepto = 'renewal' | 'enrollment' | 'drop_in';

export function CobrarForm({
  membershipId,
  debeCents,
  periodosDebidos,
  mensualidadCents,
}: {
  readonly membershipId: string;
  readonly debeCents: number;
  readonly periodosDebidos: number;
  readonly mensualidadCents: number;
}) {
  const [state, action] = useActionState(cobrar, IDLE);
  const [concepto, setConcepto] = useState<Concepto>('renewal');

  const debe = debeCents > 0;

  return (
    <section
      className="panel-card"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 15,
        borderColor: debe ? 'rgba(47,209,109,.3)' : 'var(--hairline)',
        background: debe ? 'rgba(47,209,109,.05)' : 'var(--surface)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h2>Cobrar</h2>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          {debe ? (
            <>
              Debe{' '}
              <b style={{ color: 'var(--bad)', fontVariantNumeric: 'tabular-nums' }}>
                {soles(debeCents)}
              </b>{' '}
              · {periodosDebidos} {periodosDebidos === 1 ? 'periodo' : 'periodos'}
            </>
          ) : (
            'Está al día'
          )}
        </span>
      </div>

      <form action={action} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <input type="hidden" name="membershipId" value={membershipId} />

        <div style={{ display: 'flex', gap: 11, flexWrap: 'wrap' }}>
          <label className="panel-field" style={{ flex: '1 1 160px' }}>
            <span>Concepto</span>
            <select
              name="type"
              className="panel-select"
              value={concepto}
              onChange={(event) => setConcepto(event.target.value as Concepto)}
            >
              <option value="renewal">Mensualidad</option>
              <option value="enrollment">Matrícula</option>
              <option value="drop_in">Clase suelta</option>
            </select>
          </label>

          <label className="panel-field" style={{ flex: '1 1 160px' }}>
            <span>Medio de pago</span>
            <select name="rail" className="panel-select" defaultValue="cash">
              <option value="cash">Efectivo</option>
              <option value="yape">Yape</option>
              <option value="bank_transfer">Transferencia</option>
            </select>
          </label>

          {/* Solo donde no hay tarifa derivable. La mensualidad la calcula la api
              contra la deuda real, y mandarle un monto inventado desde aquí es
              cómo se cuadra mal una caja. */}
          {concepto === 'renewal' ? null : (
            <label className="panel-field" style={{ flex: '1 1 140px' }}>
              <span>Monto en soles</span>
              <input
                name="amountCents"
                type="number"
                min="0"
                step="0.5"
                required
                placeholder="50"
                className="panel-input"
              />
            </label>
          )}
        </div>

        {state.error === null ? null : <Alert kind="bad">{state.error}</Alert>}
        {state.ok === undefined ? null : <Alert kind="ok">{state.ok}</Alert>}

        <Submit
          etiqueta={
            concepto === 'renewal'
              ? `Cobrar ${soles(debe ? debeCents : mensualidadCents)}`
              : 'Cobrar'
          }
        />
      </form>

      <p style={{ margin: 0, fontSize: 12, lineHeight: '18px', color: 'var(--text-secondary)' }}>
        Al confirmar se crea el cargo, la renovación avanza y el escáner vuelve a validar su código.
        Queda registrado a tu nombre.
      </p>
    </section>
  );
}

/** Aparte, porque `useFormStatus` solo lee el `<form>` que lo contiene. */
function Submit({ etiqueta }: { readonly etiqueta: string }) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" className="panel-btn" disabled={pending} style={{ alignSelf: 'flex-start' }}>
      {pending ? 'Registrando…' : etiqueta}
    </button>
  );
}
