/**
 * Las personas de la red.
 *
 * Dos pestañas porque una persona en Sinchi tiene dos formas: CON ficha —está en
 * el padrón de algún gimnasio, tenga o no la app— y SIN ella —entró con Google
 * y no entrena en ningún sitio todavía—. Mezclarlas en una tabla invitaría a
 * buscar un documento que la mitad de las filas no tiene.
 *
 * Encima de todo, las bajas pedidas. No es una lista más: cada una es una
 * promesa con plazo —la política publicada dice 30 días— y hasta este panel
 * nadie las ejecutaba. Van primero y con los días que les quedan.
 *
 * La búsqueda es un `<form method="get">` y no un buscador en vivo: la
 * pantalla es un Server Component, la URL guarda la búsqueda, y volver atrás
 * desde una ficha deja la lista donde estaba.
 */
import Link from 'next/link';
import type { Route } from 'next';
import { AdminShell } from '../../../components/admin/Shell';
import { Empty, SectionHeader } from '../../../components/panel/Pieces';
import { adminApi } from '../../../src/admin/api';
import { requireAdmin } from '../../../src/admin/session';
import type { WirePeoplePage, WirePendingDeletion, WirePersonRow } from '../../../src/admin/types';

export const dynamic = 'force-dynamic';

export default async function UsuariosPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly kind?: string; readonly q?: string; readonly page?: string }>;
}) {
  const session = await requireAdmin();
  const params = await searchParams;
  const kind = params.kind === 'account' ? 'account' : 'identity';
  const q = (params.q ?? '').trim();
  const page = Math.max(1, Number(params.page) || 1);

  const query = new URLSearchParams({ kind, page: String(page), ...(q.length > 0 ? { q } : {}) });
  const [people, pending] = await Promise.all([
    adminApi<WirePeoplePage>(`/admin/people?${query.toString()}`),
    adminApi<readonly WirePendingDeletion[]>('/admin/people/deletion-requests'),
  ]);

  const pages = Math.max(1, Math.ceil(people.total / people.pageSize));
  // `Route` y no `string`: con `typedRoutes`, un enlace armado en tiempo de
  // ejecución hay que declararlo. La ruta es la de esta misma página; lo que
  // varía es la búsqueda.
  const link = (overrides: Record<string, string>): Route => {
    const next = new URLSearchParams({ kind, ...(q.length > 0 ? { q } : {}), ...overrides });
    return `/admin/usuarios?${next.toString()}` as Route;
  };

  return (
    <AdminShell email={session.email}>
      <SectionHeader
        eyebrow={`${people.total} ${kind === 'identity' ? 'con ficha' : 'sin ficha'}${q.length > 0 ? ` que coinciden con «${q}»` : ''}`}
        title="Usuarios"
      />

      {pending.length === 0 ? null : (
        <section className="admin-danger" style={{ marginBottom: 14 }}>
          <h2>Bajas pedidas sin ejecutar</h2>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
            La política publicada promete completarlas en 30 días. Abre la ficha, comprueba que
            corresponde y elimínala desde ahí.
          </p>
          <table className="panel-table">
            <tbody>
              {pending.map((baja) => (
                <tr key={baja.userId}>
                  <td>
                    <Link href={`/admin/usuarios/${baja.userId}`} style={{ fontWeight: 600, color: 'var(--ink)' }}>
                      {baja.name}
                    </Link>
                    <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                      {' '}
                      {baja.email ?? ''}
                    </span>
                  </td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                    {baja.reason === null ? 'sin motivo' : `«${baja.reason}»`}
                  </td>
                  <td
                    className="num"
                    style={{
                      color: baja.daysLeft < 0 ? 'var(--bad)' : baja.daysLeft <= 7 ? 'var(--warn)' : 'var(--text-secondary)',
                      fontWeight: 700,
                    }}
                  >
                    {baja.daysLeft < 0
                      ? `vencida hace ${-baja.daysLeft} d`
                      : `quedan ${baja.daysLeft} d`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <nav aria-label="Qué personas" style={{ display: 'flex', gap: 4 }}>
          <Link
            href={link({ kind: 'identity', page: '1' })}
            className="panel-link"
            aria-current={kind === 'identity' ? 'page' : undefined}
          >
            Con ficha
          </Link>
          <Link
            href={link({ kind: 'account', page: '1' })}
            className="panel-link"
            aria-current={kind === 'account' ? 'page' : undefined}
          >
            Sin ficha
          </Link>
        </nav>

        <form method="get" action="/admin/usuarios" style={{ display: 'flex', gap: 8, flexGrow: 1, maxWidth: 480 }}>
          <input type="hidden" name="kind" value={kind} />
          <input
            name="q"
            defaultValue={q}
            className="panel-input"
            placeholder={kind === 'identity' ? 'Nombre, correo, celular o documento' : 'Nombre, correo o celular'}
            aria-label="Buscar"
          />
          <button type="submit" className="panel-btn ghost">
            Buscar
          </button>
        </form>
      </div>

      {people.rows.length === 0 ? (
        <Empty
          title={q.length > 0 ? 'Nadie coincide' : 'Todavía no hay nadie aquí'}
          body={
            kind === 'identity'
              ? 'Una ficha nace cuando un gimnasio inscribe a alguien.'
              : 'Una cuenta sin ficha es alguien que entró a la app con Google y no está en ningún padrón.'
          }
        />
      ) : (
        <div className="panel-card panel-scroll">
          <table className="panel-table">
            <thead>
              <tr>
                <th>Persona</th>
                <th>Contacto</th>
                {kind === 'identity' ? <th>Documento</th> : null}
                <th>Estado</th>
                <th className="num">Desde</th>
              </tr>
            </thead>
            <tbody>
              {people.rows.map((person) => (
                <Fila key={person.id} person={person} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages <= 1 ? null : (
        <nav
          aria-label="Páginas"
          style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'flex-end', marginTop: 12 }}
        >
          {page > 1 ? (
            <Link href={link({ page: String(page - 1) })} className="panel-btn ghost">
              ← Anterior
            </Link>
          ) : null}
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            Página {page} de {pages}
          </span>
          {page < pages ? (
            <Link href={link({ page: String(page + 1) })} className="panel-btn ghost">
              Siguiente →
            </Link>
          ) : null}
        </nav>
      )}
    </AdminShell>
  );
}

function Fila({ person }: { readonly person: WirePersonRow }) {
  const href = (
    person.kind === 'identity' ? `/admin/usuarios/${person.id}` : `/admin/usuarios/cuenta/${person.id}`
  ) as Route;

  return (
    <tr>
      <td>
        <Link href={href} style={{ fontWeight: 600, color: 'var(--ink)' }}>
          {person.name ?? 'Sin nombre'}
        </Link>
      </td>
      <td style={{ fontSize: 13 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span>{person.email ?? '—'}</span>
          <span style={{ color: 'var(--text-tertiary)' }}>{person.phone ?? ''}</span>
        </div>
      </td>
      {person.kind === 'identity' ? (
        <td style={{ fontVariantNumeric: 'tabular-nums' }}>{person.documentId}</td>
      ) : null}
      <td>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {person.banned ? <Chip color="var(--bad)">Baneada</Chip> : null}
          {person.deletionRequestedAt === null ? null : <Chip color="var(--warn)">Pidió la baja</Chip>}
          {/* Sin app no es un problema: es la ficha que la recepción creó antes de
              que la persona instalara nada. Se dice para no buscarla en la app. */}
          {person.hasApp ? null : <Chip color="var(--text-tertiary)">Sin app</Chip>}
        </div>
      </td>
      <td className="num" style={{ color: 'var(--text-secondary)' }}>
        {person.createdAt.slice(0, 10)}
      </td>
    </tr>
  );
}

/** Siempre con la palabra, nunca el color solo (decisiones §17). */
function Chip({ color, children }: { readonly color: string; readonly children: React.ReactNode }) {
  return (
    <span className="panel-chip" style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}>
      <i className="panel-dot" style={{ background: color }} aria-hidden />
      {children}
    </span>
  );
}
