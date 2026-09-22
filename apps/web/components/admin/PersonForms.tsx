'use client';

/**
 * Lo que el panel de Sinchi le puede hacer a una persona.
 *
 * Cliente por lo mismo que los formularios de un gimnasio: enseñar el resultado
 * sin recargar, y apagar cada botón con LA MISMA función que corre la api
 * —`checkPersonDetails`, `checkPersonBan`, `checkPersonDeletion`—. La pantalla
 * no puede ofrecer lo que el servidor va a negar, ni prohibir lo que aceptaría.
 *
 * Las tres acciones van en este orden en la página, que es el de su peso:
 * corregir no le quita nada a nadie, banear le quita la app y se deshace, y
 * eliminar no tiene vuelta.
 */
import Link from 'next/link';
import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  checkPersonBan,
  checkPersonDeletion,
  checkPersonDetails,
  personBanDenialMessage,
  personDeletionDenialMessage,
  personDetailsDenialMessage,
  BAN_REASON_MIN,
} from '@sinchi/shared';
import { Alert } from '../panel/Pieces';
import { IDLE } from '../../src/panel/form-state';
import { NOTHING_DELETED } from '../../src/admin/deletion-state';
import {
  banearPersona,
  eliminarPersona,
  guardarPersona,
  levantarBaneo,
} from '../../src/admin/actions';
import type { WireBan, WirePersonKind } from '../../src/admin/types';

function Submit({
  label,
  working,
  disabled = false,
  danger = false,
}: {
  readonly label: string;
  readonly working: string;
  readonly disabled?: boolean;
  readonly danger?: boolean;
}) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" className={danger ? 'panel-btn danger' : 'panel-btn'} disabled={pending || disabled}>
      {pending ? working : label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Corregir
// ---------------------------------------------------------------------------

/**
 * Los cuatro datos de la ficha.
 *
 * Se mandan siempre los cuatro, y no solo lo cambiado como en el gimnasio: la
 * regla juzga la ficha entera, y la api registra QUÉ campos cambiaron comparando
 * con lo que había — sin guardar los valores, que son de la persona.
 */
export function PersonEditForm({
  person,
}: {
  readonly person: {
    readonly id: string;
    readonly name: string;
    readonly phone: string;
    readonly documentId: string;
    readonly email: string | null;
  };
}) {
  const [state, action] = useActionState(guardarPersona, IDLE);
  const [draft, setDraft] = useState({
    name: person.name,
    phone: person.phone,
    documentId: person.documentId,
    email: person.email ?? '',
  });

  const denial = checkPersonDetails(draft);
  const set = (field: keyof typeof draft) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setDraft({ ...draft, [field]: event.target.value });

  return (
    <form action={action} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <input type="hidden" name="userId" value={person.id} />

      <label className="panel-field">
        <span>Nombre</span>
        <input name="name" className="panel-input" value={draft.name} onChange={set('name')} />
      </label>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <label className="panel-field">
          <span>Celular, con su código de país</span>
          <input name="phone" className="panel-input" value={draft.phone} onChange={set('phone')} placeholder="+51987654321" />
        </label>
        <label className="panel-field">
          <span>Documento</span>
          <input name="documentId" className="panel-input" value={draft.documentId} onChange={set('documentId')} />
        </label>
      </div>

      <label className="panel-field">
        <span>Correo (opcional)</span>
        <input name="email" type="email" className="panel-input" value={draft.email} onChange={set('email')} />
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
          La persona no puede cambiarlo sola porque haría falta verificar el nuevo. Aquí no se
          verifica: corregirlo es lo que deja entrar a un dueño cuyo correo se escribió mal.
        </span>
      </label>

      <p style={{ margin: 0, fontSize: 12.5, lineHeight: '19px', color: 'var(--text-secondary)' }}>
        El documento es lo que ancla quién es quién ante el padrón, y la persona no puede tocarlo.
        Corrígelo solo habiendo visto su carné: queda en el registro que fuiste tú.
      </p>

      <Alert kind="bad">{state.error}</Alert>
      <Alert kind="ok">{state.ok}</Alert>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Submit label="Guardar" working="Guardando…" disabled={denial !== null} />
        {denial === null ? null : (
          <span style={{ fontSize: 12.5, color: 'var(--text-tertiary)' }}>
            {personDetailsDenialMessage(denial)}
          </span>
        )}
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Banear
// ---------------------------------------------------------------------------

/**
 * Banear, o levantar el baneo que tiene.
 *
 * Si la persona trabaja en un gimnasio se avisa ANTES, con los nombres: banearla
 * la deja sin entrar a ese mostrador, y para sacar a un local entero lo correcto
 * es suspender el gimnasio, no a su dueño.
 */
export function PersonBanForm({
  kind,
  id,
  bans,
  staffOf,
}: {
  readonly kind: WirePersonKind;
  readonly id: string;
  readonly bans: readonly WireBan[];
  readonly staffOf: readonly string[];
}) {
  const [state, action] = useActionState(banearPersona, IDLE);
  const [reason, setReason] = useState('');
  const [lifting, setLifting] = useState(false);
  const [liftState, setLiftState] = useState(IDLE);

  const live = bans.find((ban) => ban.liftedAt === null);

  if (live !== undefined) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p className="panel-alert bad" role="status">
          <strong aria-hidden>✕</strong>
          <span>
            Baneada desde el {live.createdAt.slice(0, 10)} por {live.bannedByEmail}: {live.reason}
          </span>
        </p>
        <Alert kind="bad">{liftState.error}</Alert>
        <Alert kind="ok">{liftState.ok}</Alert>
        <div>
          <button
            type="button"
            className="panel-btn"
            disabled={lifting}
            onClick={() => {
              setLifting(true);
              void levantarBaneo(live.id, kind, id)
                .then(setLiftState)
                .finally(() => setLifting(false));
            }}
          >
            {lifting ? 'Levantando…' : 'Levantar el baneo'}
          </button>
        </div>
      </div>
    );
  }

  const denial = checkPersonBan({ reason, banned: false });

  return (
    <form action={action} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />

      <label className="panel-field">
        <span>Motivo</span>
        <textarea
          name="reason"
          className="panel-textarea"
          minLength={BAN_REASON_MIN}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Qué hizo, en una frase. Es lo que va a leer si intenta entrar."
        />
      </label>

      {staffOf.length === 0 ? null : (
        <p className="panel-alert bad" role="note">
          <strong aria-hidden>!</strong>
          <span>
            Trabaja en {staffOf.join(', ')}. Banearla la deja sin entrar a ese mostrador. Si lo que
            quieres es sacar al local, suspende el gimnasio.
          </span>
        </p>
      )}

      <p style={{ margin: 0, fontSize: 12.5, lineHeight: '19px', color: 'var(--text-secondary)' }}>
        Pierde la app: entrar, escribir a los gimnasios y reservar desde el directorio. No pierde
        nada de lo suyo — su ficha sigue en el padrón y su gimnasio la puede seguir marcando a
        mano. Se deshace cuando quieras.
      </p>

      <Alert kind="bad">{state.error}</Alert>
      <Alert kind="ok">{state.ok}</Alert>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Submit label="Banear" working="Baneando…" disabled={denial !== null} />
        {denial === null || reason.length === 0 ? null : (
          <span style={{ fontSize: 12.5, color: 'var(--text-tertiary)' }}>
            {personBanDenialMessage(denial)}
          </span>
        )}
      </div>

      {bans.length === 0 ? null : (
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-tertiary)' }}>
          Ya estuvo baneada {bans.length === 1 ? 'una vez' : `${bans.length} veces`}:{' '}
          {bans.map((ban) => `«${ban.reason}»`).join(', ')}.
        </p>
      )}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Eliminar
// ---------------------------------------------------------------------------

const FIREBASE: Record<string, string> = {
  deleted: 'Su usuario de Firebase se borró.',
  not_found: 'Su usuario de Firebase ya no existía.',
};

/**
 * La zona de lo que no tiene vuelta.
 *
 * Después de eliminar, el formulario se queda y enseña el resultado en vez de
 * volver a la lista, porque hay algo que leer: cuántos cobros se quedaron en la
 * caja de su gimnasio sin nombre y, sobre todo, si su usuario de Firebase se
 * pudo borrar. Si no, falta un paso a mano, y este es el único momento en que
 * alguien lo va a ver.
 */
export function PersonDeleteForm({
  kind,
  id,
  confirmationKey,
  staffOf,
  firebaseUid,
  what,
}: {
  readonly kind: WirePersonKind;
  readonly id: string;
  readonly confirmationKey: string;
  readonly staffOf: readonly string[];
  readonly firebaseUid: string | null;
  /** Qué se lleva por delante, dicho para esta persona. */
  readonly what: string;
}) {
  const [state, action] = useActionState(eliminarPersona, NOTHING_DELETED);
  const [typed, setTyped] = useState('');

  if (state.outcome !== null) {
    const outcome = state.outcome;
    return (
      <div className="admin-danger">
        <h2>Cuenta eliminada</h2>
        <p style={{ margin: 0, fontSize: 13, lineHeight: '20px' }}>
          Se fueron {outcome.memberships} ficha{outcome.memberships === 1 ? '' : 's'} de gimnasio,{' '}
          {outcome.bookings} reserva{outcome.bookings === 1 ? '' : 's'}, {outcome.conversations}{' '}
          conversación{outcome.conversations === 1 ? '' : 'es'} y{' '}
          {outcome.eventRegistrations} inscripción{outcome.eventRegistrations === 1 ? '' : 'es'} a
          eventos. {outcome.chargesAnonymized === 0
            ? ''
            : `${outcome.chargesAnonymized} cobro${outcome.chargesAnonymized === 1 ? ' se quedó' : 's se quedaron'} en la caja de su gimnasio, sin nombre.`}
        </p>
        {outcome.firebase === null ? null : outcome.firebase === 'unavailable' ? (
          <p className="panel-alert bad" role="alert">
            <strong aria-hidden>!</strong>
            <span>
              Su usuario de Firebase NO se pudo borrar desde aquí. Falta hacerlo a mano en la consola
              de Firebase (Authentication → Users), uid <code>{firebaseUid ?? id}</code>. Hasta
              entonces, la baja que promete la política no está completa.
            </span>
          </p>
        ) : (
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
            {FIREBASE[outcome.firebase]}
          </p>
        )}
        <div>
          <Link href="/admin/usuarios" className="panel-btn ghost">
            Volver a la lista
          </Link>
        </div>
      </div>
    );
  }

  const denial = checkPersonDeletion({ staffOf, key: confirmationKey, typed });

  return (
    <form action={action} className="admin-danger">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      <h2>Eliminar esta cuenta</h2>

      <p style={{ margin: 0, fontSize: 13, lineHeight: '20px', color: 'var(--text-secondary)' }}>
        {what} Es lo que promete sinchi.fit/eliminar-cuenta, y no hay vuelta. Si está baneada, el
        baneo se queda: eliminar su cuenta no puede ser la forma de quitárselo.
      </p>

      {staffOf.length > 0 ? (
        <p className="panel-alert bad" role="note">
          <strong aria-hidden>✕</strong>
          <span>{personDeletionDenialMessage('is_staff', staffOf)}</span>
        </p>
      ) : (
        <label className="panel-field">
          <span>
            Escribe <code>{confirmationKey}</code> para confirmar
          </span>
          <input
            name="confirm"
            className="panel-input"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
            placeholder={confirmationKey}
          />
        </label>
      )}

      <Alert kind="bad">{state.error}</Alert>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Submit label="Eliminar para siempre" working="Eliminando…" disabled={denial !== null} danger />
        {denial === null || denial === 'is_staff' ? null : (
          <span style={{ fontSize: 12.5, color: 'var(--text-tertiary)' }}>
            {personDeletionDenialMessage(denial)}
          </span>
        )}
      </div>
    </form>
  );
}
