/**
 * Alta de un alumno.
 *
 * El ancla es el DOCUMENTO, no el nombre: si ya hay una identidad con ese DNI en
 * la red, la api la reutiliza y el nombre y el celular ya se saben. Por eso son
 * los únicos campos opcionales del formulario, y por eso el documento va primero.
 *
 * El alta deja una SOLICITUD, no vincula la cuenta: quien acepta es la persona,
 * desde su app. Se dice en pantalla, porque un alta que parece completa y deja a
 * alguien esperando sin saberlo es la que genera la llamada al día siguiente.
 */
import Link from 'next/link';
import { PanelShell } from '../../../../components/panel/Shell';
import { SectionHeader } from '../../../../components/panel/Pieces';
import { AltaForm } from '../../../../components/panel/AltaForm';
import { api } from '../../../../src/panel/api';
import { requireOwner } from '../../../../src/panel/session';
import type { WirePlan } from '../../../../src/panel/types';

export const dynamic = 'force-dynamic';

export default async function NuevoAlumnoPage() {
  const session = await requireOwner();
  // Los ACTIVOS, que es contra lo que se inscribe. Ofrecer un plan archivado
  // sería invitar a algo que la api va a rechazar.
  const planes = await api<readonly WirePlan[]>('/staff/plans');

  return (
    <PanelShell tenantName={session.tenantName}>
      <Link
        href="/panel/alumnos"
        style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}
      >
        ← Alumnos
      </Link>

      <div style={{ height: 14 }} />

      <SectionHeader eyebrow="Alta en el padrón" title="Nuevo alumno" />

      <div style={{ maxWidth: 640 }}>
        <AltaForm planes={planes} />
      </div>
    </PanelShell>
  );
}
