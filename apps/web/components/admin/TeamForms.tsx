'use client';

/**
 * Dar y quitar acceso al panel de Sinchi.
 *
 * Invitar aquí NO crea ninguna cuenta: crea el permiso. Quien lo recibe entra
 * con su Google de siempre, y hasta que entre, su fila aparece como «invitado,
 * todavía no entró». Decirlo importa — si no, quien invita se queda esperando un
 * correo que nadie manda.
 *
 * El botón de quitar se apaga con `checkAdminRevocation`, la MISMA función que
 * corre la api: no a ti mismo, no al último. Las dos negativas existen para el
 * mismo fallo, que es quedarse fuera del panel sin nadie dentro que pueda volver
 * a invitarte.
 */
import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { adminRevocationDenialMessage, checkAdminRevocation } from '@sinchi/shared';
import { Alert } from '../panel/Pieces';
import { IDLE } from '../../src/panel/form-state';
import { invitarAdministrador, quitarAdministrador } from '../../src/admin/actions';

export function InviteForm() {
  const [state, action] = useActionState(invitarAdministrador, IDLE);

  return (
    <form action={action} className="panel-card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <h2>Dar acceso a alguien</h2>

      <label className="panel-field">
        <span>Su correo de Google</span>
        <input
          name="email"
          type="email"
          className="panel-input"
          placeholder="dev@sinchi.fit"
          required
          autoComplete="off"
        />
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
          Tiene que ser el de su cuenta de Google: es con lo que se entra, y el correo llega
          verificado por Google o no entra.
        </span>
      </label>

      <label className="panel-field">
        <span>Cómo se llama (opcional)</span>
        <input name="name" className="panel-input" placeholder="Para reconocerlo en la lista" />
      </label>

      <Alert kind="bad">{state.error}</Alert>
      <Alert kind="ok">{state.ok}</Alert>

      <div>
        <Submit />
      </div>

      <p style={{ margin: 0, fontSize: 12.5, lineHeight: '19px', color: 'var(--text-tertiary)' }}>
        No se le manda ningún correo: el acceso queda dado y funciona la próxima vez que entre a
        /admin. Avísale tú.
      </p>
    </form>
  );
}

function Submit() {
  const { pending } = useFormStatus();

  return (
    <button type="submit" className="panel-btn" disabled={pending}>
      {pending ? 'Dando acceso…' : 'Dar acceso'}
    </button>
  );
}

export function RevokeButton({
  adminId,
  actingAdminId,
  liveCount,
}: {
  readonly adminId: string;
  readonly actingAdminId: string;
  readonly liveCount: number;
}) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const denial = checkAdminRevocation({ adminId, actingAdminId, liveCount });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
      <button
        type="button"
        className="panel-btn danger"
        style={{ padding: '6px 12px', fontSize: 13 }}
        disabled={working || denial !== null}
        onClick={() => {
          setWorking(true);
          setError(null);
          void quitarAdministrador(adminId)
            .then((state) => setError(state.error))
            .finally(() => setWorking(false));
        }}
      >
        {working ? '…' : 'Quitar acceso'}
      </button>
      {denial === null ? null : (
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)', textAlign: 'right', maxWidth: 260 }}>
          {adminRevocationDenialMessage(denial)}
        </span>
      )}
      {error === null ? null : <span style={{ fontSize: 12, color: 'var(--bad)' }}>{error}</span>}
    </div>
  );
}
