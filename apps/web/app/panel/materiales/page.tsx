/**
 * La biblioteca del local: lo que el gimnasio enseña en video.
 *
 * Se enseñan los borradores junto a lo publicado, marcados: son del local, y el
 * caso que importa es justo el de la rutina a medias que alguien olvidó
 * terminar. Esconderlos la haría desaparecer.
 */
import Link from 'next/link';
import { PanelShell } from '../../../components/panel/Shell';
import { Empty, SectionHeader } from '../../../components/panel/Pieces';
import { api } from '../../../src/panel/api';
import { requireOwner } from '../../../src/panel/session';
import type { WireRoutineCard } from '../../../src/panel/types';

export const dynamic = 'force-dynamic';

const NIVEL: Record<string, string> = {
  beginner: 'Principiante',
  intermediate: 'Intermedio',
  advanced: 'Avanzado',
};

export default async function MaterialesPage() {
  const session = await requireOwner();
  const rutinas = await api<readonly WireRoutineCard[]>('/staff/routines');

  const publicadas = rutinas.filter((card) => card.routine.status === 'published').length;
  const borradores = rutinas.length - publicadas;

  return (
    <PanelShell tenantName={session.tenantName}>
      <SectionHeader
        eyebrow={`${publicadas} publicadas · ${borradores} en borrador`}
        title="Materiales de clase"
        action={
          <Link href="/panel/materiales/nueva" className="panel-btn">
            + Nueva rutina
          </Link>
        }
      />

      <p style={{ margin: '0 0 18px', fontSize: 13, lineHeight: '20px', color: 'var(--text-secondary)', maxWidth: 720 }}>
        Lo <b style={{ color: 'var(--ink)', fontWeight: 600 }}>de alumnos</b> es media razón para
        seguir pagando la mensualidad. Lo <b style={{ color: 'var(--ink)', fontWeight: 600 }}>público</b>{' '}
        se ve desde el directorio sin cuenta: es tu escaparate.
      </p>

      {rutinas.length === 0 ? (
        <Empty
          title="Tu biblioteca está vacía"
          body="Sube una técnica o una rutina en video. Lo que marques como público atrae desde el directorio; lo de alumnos es lo que mantiene a tu gente atada a la escuela."
        />
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))',
            gap: 12,
          }}
        >
          {rutinas.map(({ routine, itemCount, hasVideo }) => {
            const borrador = routine.status !== 'published';

            return (
              <article
                key={routine.id}
                className="panel-card"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 11,
                  borderColor: borrador ? 'rgba(255,201,77,.22)' : 'var(--hairline)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                  <h2>{routine.title}</h2>
                  {hasVideo ? (
                    <span title="Tiene video" style={{ flex: 'none', color: 'var(--text-secondary)' }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-label="Tiene video">
                        <rect x="2" y="4" width="20" height="16" rx="3" />
                        <path d="m10 9 5 3-5 3z" />
                      </svg>
                    </span>
                  ) : null}
                </div>

                {routine.summary === null ? null : (
                  <p style={{ margin: 0, fontSize: 13, lineHeight: '19px', color: 'var(--text-secondary)' }}>
                    {routine.summary}
                  </p>
                )}

                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span
                    className="panel-chip"
                    style={{
                      background: borrador ? 'rgba(255,201,77,.14)' : 'rgba(47,209,109,.14)',
                      color: borrador ? 'var(--warn)' : 'var(--ok)',
                    }}
                  >
                    <i className="panel-dot" style={{ background: 'currentColor' }} aria-hidden />
                    {borrador ? 'Borrador' : 'Publicada'}
                  </span>
                  <span
                    className="panel-chip"
                    style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
                  >
                    {routine.visibility === 'public' ? 'Público' : 'De alumnos'}
                  </span>
                  {routine.level === null ? null : (
                    <span
                      className="panel-chip"
                      style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
                    >
                      {NIVEL[routine.level] ?? routine.level}
                    </span>
                  )}
                </div>

                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 10,
                    paddingTop: 10,
                    borderTop: '1px solid var(--divider)',
                  }}
                >
                  <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                    {itemCount} {itemCount === 1 ? 'paso' : 'pasos'}
                  </span>
                  <Link href={`/panel/materiales/${routine.id}`} style={{ fontSize: 13, fontWeight: 600 }}>
                    Editar
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </PanelShell>
  );
}
