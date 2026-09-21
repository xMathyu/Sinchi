'use client';

/**
 * Lo que se le puede hacer a un gimnasio desde el panel de Sinchi.
 *
 * Cliente porque los cuatro formularios necesitan enseñar su resultado sin
 * recargar, y porque el de eliminar tiene que apagar su botón mientras lo
 * escrito no coincida — y esa comprobación la hace `checkGymDeletion`, LA MISMA
 * función que corre la api. Ese es el patrón del repo: el botón se apaga por el
 * motivo exacto por el que el POST respondería 403.
 *
 * Los cuatro están en un archivo porque comparten el gimnasio y se leen juntos;
 * si alguno crece, sale solo.
 */
import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  SAAS_TIER_LABELS,
  SUSPENSION_REASON_MIN,
  checkGymDeletion,
  gymDeletionDenialMessage,
  type SaasTier,
} from '@sinchi/shared';
import { Alert } from '../panel/Pieces';
import { IDLE } from '../../src/panel/form-state';
import {
  eliminarGimnasio,
  guardarGimnasio,
  reactivarGimnasio,
  registrarPago,
  suspenderGimnasio,
} from '../../src/admin/actions';
import type { WireGymDetail } from '../../src/admin/types';

/** Céntimos → lo que se escribe en la casilla, que va en soles. */
const aSoles = (cents: number | null): string =>
  cents === null ? '' : String(Math.round(cents) / 100);

function Submit({ label, working }: { readonly label: string; readonly working: string }) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" className="panel-btn" disabled={pending}>
      {pending ? working : label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Editar
// ---------------------------------------------------------------------------

/**
 * El formulario de edición.
 *
 * Cada campo lleva su valor actual en un `input hidden` con sufijo `__antes`.
 * Es lo que permite mandar SOLO lo que cambió: sin eso, abrir la pantalla y
 * guardar sin tocar nada aparecería en el registro como una edición de doce
 * campos, y el registro dejaría de servir para encontrar qué cambió de verdad.
 */
export function GymEditForm({ gym }: { readonly gym: WireGymDetail }) {
  const [state, action] = useActionState(guardarGimnasio, IDLE);

  return (
    <form action={action} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <input type="hidden" name="tenantId" value={gym.id} />

      <Campo label="Nombre" name="name" value={gym.name} />
      <Campo
        label="Identificador (sale en el directorio)"
        name="slug"
        value={gym.slug}
        hint="Cambiarlo rompe los enlaces que el gimnasio ya repartió."
      />
      <Campo label="Dirección" name="address" value={gym.address ?? ''} />
      <Campo
        label="RUC"
        name="taxId"
        value={gym.taxId ?? ''}
        hint="Opcional. Se comprueba el dígito verificador."
      />

      <label className="panel-field">
        <span>Escalón de precio</span>
        <input type="hidden" name="saasTier__antes" value={gym.saas.tier} />
        <select name="saasTier" className="panel-select" defaultValue={gym.saas.tier}>
          {(Object.keys(SAAS_TIER_LABELS) as SaasTier[]).map((tier) => (
            <option key={tier} value={tier}>
              {SAAS_TIER_LABELS[tier]}
            </option>
          ))}
        </select>
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
          Es el que se fijó al dar de alta. El que se cobra sale del padrón y lo recalcula el
          trabajo diario.
        </span>
      </label>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <Campo label="Días de gracia" name="graceDays" value={String(gym.graceDays)} type="number" />
        <Campo
          label="Clase suelta (S/)"
          name="dropInPrice"
          value={aSoles(gym.dropInPriceCents)}
          type="number"
        />
        <Campo
          label="Matrícula (S/)"
          name="enrollmentFee"
          value={aSoles(gym.enrollmentFeeCents)}
          type="number"
        />
        <Campo
          label="Clase de prueba (S/)"
          name="trialClassPrice"
          value={aSoles(gym.trialClassPriceCents)}
          type="number"
        />
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 14 }}>
        <input type="hidden" name="trialClassEnabled__antes" value={String(gym.trialClassEnabled)} />
        <input type="checkbox" name="trialClassEnabled" defaultChecked={gym.trialClassEnabled} />
        Ofrece la primera clase a quien lo descubre desde la app
      </label>

      <Alert kind="bad">{state.error}</Alert>
      <Alert kind="ok">{state.ok}</Alert>

      <div>
        <Submit label="Guardar" working="Guardando…" />
      </div>
    </form>
  );
}

function Campo({
  label,
  name,
  value,
  type = 'text',
  hint,
}: {
  readonly label: string;
  readonly name: string;
  readonly value: string;
  readonly type?: string;
  readonly hint?: string;
}) {
  return (
    <label className="panel-field">
      <span>{label}</span>
      <input type="hidden" name={`${name}__antes`} value={value} />
      <input name={name} type={type} defaultValue={value} className="panel-input" />
      {hint === undefined ? null : (
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{hint}</span>
      )}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Cobrar
// ---------------------------------------------------------------------------

/**
 * Registrar lo que el gimnasio le pagó a Sinchi.
 *
 * El número de operación no es opcional de verdad: es la llave de idempotencia
 * del pago manual. Sin él, anotar dos veces el mismo depósito le cobra dos
 * meses. Se avisa en vez de exigirlo porque un pago en efectivo no siempre trae
 * comprobante — la misma decisión que ya tomaba `saas:pay`.
 */
export function GymPaymentForm({ gym }: { readonly gym: WireGymDetail }) {
  const [state, action] = useActionState(registrarPago, IDLE);

  return (
    <form action={action} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <input type="hidden" name="tenantId" value={gym.id} />

      <label className="panel-field">
        <span>Cómo pagó</span>
        <select name="rail" className="panel-select" defaultValue="bank_transfer">
          <option value="bank_transfer">Transferencia</option>
          <option value="yape">Yape</option>
          <option value="cash">Efectivo</option>
        </select>
      </label>

      <label className="panel-field">
        <span>Número de operación</span>
        <input name="reference" className="panel-input" placeholder="00123456" />
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
          Sin él no hay forma de detectar un duplicado: anotarlo dos veces cobraría dos meses.
        </span>
      </label>

      <label className="panel-field">
        <span>Monto (S/), solo si fue un precio pactado</span>
        <input name="amount" type="number" step="0.01" className="panel-input" placeholder={aSoles(gym.saas.priceCents)} />
      </label>

      <Alert kind="bad">{state.error}</Alert>
      <Alert kind="ok">{state.ok}</Alert>

      <div>
        <Submit label="Registrar pago" working="Registrando…" />
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Suspender y reactivar
// ---------------------------------------------------------------------------

export function GymSuspendForm({ gym }: { readonly gym: WireGymDetail }) {
  const [state, action] = useActionState(suspenderGimnasio, IDLE);

  if (gym.status === 'suspended') return <GymRestore gym={gym} />;

  return (
    <form action={action} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <input type="hidden" name="tenantId" value={gym.id} />

      <label className="panel-field">
        <span>Motivo</span>
        <textarea
          name="reason"
          className="panel-textarea"
          minLength={SUSPENSION_REASON_MIN}
          required
          placeholder="Qué pasó, en una frase. Es lo que le vas a explicar al dueño."
        />
      </label>

      <p style={{ margin: 0, fontSize: 12.5, lineHeight: '19px', color: 'var(--text-secondary)' }}>
        Suspender saca al gimnasio del directorio y su staff deja de poder entrar, con este
        motivo en pantalla. Los alumnos conservan su billetera y su historial: no entrenan en un
        local que sacamos, pero la culpa de eso no es suya.
      </p>

      <Alert kind="bad">{state.error}</Alert>
      <Alert kind="ok">{state.ok}</Alert>

      <div>
        <Submit label="Suspender" working="Suspendiendo…" />
      </div>
    </form>
  );
}

function GymRestore({ gym }: { readonly gym: WireGymDetail }) {
  const [state, setState] = useState(IDLE);
  const [working, setWorking] = useState(false);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p className="panel-alert bad" role="status">
        <strong aria-hidden>✕</strong>
        <span>
          Suspendido{gym.suspendedAt === null ? '' : ` el ${gym.suspendedAt.slice(0, 10)}`}
          {gym.suspendedReason === null ? '' : `: ${gym.suspendedReason}`}
        </span>
      </p>

      <Alert kind="bad">{state.error}</Alert>
      <Alert kind="ok">{state.ok}</Alert>

      <div>
        <button
          type="button"
          className="panel-btn"
          disabled={working}
          onClick={() => {
            setWorking(true);
            void reactivarGimnasio(gym.id)
              .then(setState)
              .finally(() => setWorking(false));
          }}
        >
          {working ? 'Reactivando…' : 'Reactivar'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Eliminar
// ---------------------------------------------------------------------------

/**
 * La zona de lo que no tiene vuelta.
 *
 * El botón está apagado mientras `checkGymDeletion` diga que no, y lo que dice
 * se enseña: «suspéndelo primero» o «el identificador no coincide». Es la misma
 * función que corre la api, así que la pantalla no puede ofrecer algo que el
 * servidor vaya a negar — ni al revés, prohibir algo que el servidor aceptaría.
 */
export function GymDeleteForm({ gym }: { readonly gym: WireGymDetail }) {
  const [state, action] = useActionState(eliminarGimnasio, IDLE);
  const [typed, setTyped] = useState('');

  const denial = checkGymDeletion({ slug: gym.slug, typed, status: gym.status });

  return (
    <form action={action} className="admin-danger">
      <input type="hidden" name="tenantId" value={gym.id} />
      <h2>Eliminar este gimnasio</h2>

      <p style={{ margin: 0, fontSize: 13, lineHeight: '20px', color: 'var(--text-secondary)' }}>
        Se lleva por delante {gym.stats.activeMembers} ficha
        {gym.stats.activeMembers === 1 ? '' : 's'}, {gym.stats.staffCount} del equipo,{' '}
        {gym.stats.bookings} reserva{gym.stats.bookings === 1 ? '' : 's'} y {gym.stats.routines}{' '}
        rutina{gym.stats.routines === 1 ? '' : 's'}, con su caja y sus asistencias. No hay vuelta.
      </p>

      <label className="panel-field">
        <span>
          Escribe <code>{gym.slug}</code> para confirmar
        </span>
        <input
          name="slug"
          className="panel-input"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          autoComplete="off"
          placeholder={gym.slug}
        />
      </label>

      <Alert kind="bad">{state.error}</Alert>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button type="submit" className="panel-btn danger" disabled={denial !== null}>
          Eliminar para siempre
        </button>
        {denial === null ? null : (
          <span style={{ fontSize: 12.5, color: 'var(--text-tertiary)' }}>
            {gymDeletionDenialMessage(denial)}
          </span>
        )}
      </div>
    </form>
  );
}
