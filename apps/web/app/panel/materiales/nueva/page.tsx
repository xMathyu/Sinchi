import Link from 'next/link';
import { PanelShell } from '../../../../components/panel/Shell';
import { SectionHeader } from '../../../../components/panel/Pieces';
import { RutinaEditor } from '../../../../components/panel/RutinaEditor';
import { requireOwner } from '../../../../src/panel/session';

export const dynamic = 'force-dynamic';

/**
 * Una rutina nueva nace en BORRADOR.
 *
 * Es lo contrario de lo que hace casi todo editor, y es deliberado: publicar es
 * enseñársela a los alumnos, y nadie escribe una técnica completa de una
 * sentada. Publicar es un botón aparte, con su momento.
 */
export default async function NuevaRutinaPage() {
  const session = await requireOwner();

  return (
    <PanelShell tenantName={session.tenantName}>
      <Link
        href="/panel/materiales"
        style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}
      >
        ← Materiales
      </Link>

      <div style={{ height: 14 }} />

      <SectionHeader eyebrow="Nace en borrador" title="Nueva rutina" />

      <div style={{ maxWidth: 760 }}>
        <RutinaEditor
          routineId={null}
          publicada={false}
          pasosIniciales={[]}
          inicial={{
            title: '',
            summary: '',
            level: '',
            // De alumnos por defecto: es lo que sostiene la mensualidad, y
            // publicar al escaparate algo que todavía no está terminado se
            // deshace peor de lo que se evita.
            visibility: 'members',
            videoUrl: '',
            videoAssetId: '',
          }}
        />
      </div>
    </PanelShell>
  );
}
