import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PanelShell } from '../../../../components/panel/Shell';
import { SectionHeader } from '../../../../components/panel/Pieces';
import { RutinaEditor } from '../../../../components/panel/RutinaEditor';
import { ApiError, api } from '../../../../src/panel/api';
import { requireOwner } from '../../../../src/panel/session';
import type { WireRoutineView } from '../../../../src/panel/types';

export const dynamic = 'force-dynamic';

export default async function RutinaPage({
  params,
}: {
  readonly params: Promise<{ readonly routineId: string }>;
}) {
  const session = await requireOwner();
  const { routineId } = await params;

  let vista: WireRoutineView;
  try {
    vista = await api<WireRoutineView>(`/staff/routines/${routineId}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  // La api devuelve una unión: con `unlocked: false` da un anzuelo sin videos.
  // Eso es para la calle — al dueño de su propio local le llega siempre
  // desbloqueada, así que llegar aquí con la otra rama es que el id no es suyo.
  if (!vista.unlocked) notFound();

  const { routine, itemCount } = vista.card;
  const publicada = routine.status === 'published';

  return (
    <PanelShell tenantName={session.tenantName}>
      <Link
        href="/panel/materiales"
        style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}
      >
        ← Materiales
      </Link>

      <div style={{ height: 14 }} />

      <SectionHeader
        eyebrow={`${publicada ? 'Publicada' : 'Borrador'} · ${itemCount} ${itemCount === 1 ? 'paso' : 'pasos'} · ${routine.visibility === 'public' ? 'pública' : 'de alumnos'}`}
        title={routine.title}
      />

      <div style={{ maxWidth: 760 }}>
        <RutinaEditor
          routineId={routine.id}
          publicada={publicada}
          pasosIniciales={vista.items}
          inicial={{
            title: routine.title,
            summary: routine.summary ?? '',
            level: routine.level ?? '',
            visibility: routine.visibility,
            videoUrl: routine.videoUrl ?? '',
            videoAssetId: routine.videoAssetId ?? '',
          }}
        />
      </div>
    </PanelShell>
  );
}
