/**
 * El alta terminó. Lo que falta se hace desde la app.
 *
 * El local nace SIN tarifas ni horario, a propósito: un gimnasio cobra distinto
 * por 2 y por 3 veces por semana, y ninguna cifra que le pidiéramos en el alta
 * sería su precio. Lo que no puede pasar es que se quede sin ninguna sin
 * enterarse: sin horario sale en el directorio como «0 clases por semana», y
 * sin plan no puede inscribir a nadie. El panel web no edita ninguna de las
 * dos cosas —eso es «Clases y precios», en la app—, así que esta página existe
 * para mandarlo ahí con la lista en la mano.
 *
 * Exige la sesión de dueño que el alta acaba de dejar: quien llega aquí sin
 * ella no registró nada y va al login del panel.
 */
import type { Metadata } from 'next';
import { promoDenialMessage, type PromoDenial } from '@sinchi/shared';
import { Logo } from '@/components/Brand';
import { StoreButtons } from '@/components/StoreButtons';
import { ThemeToggle } from '@/components/ThemeToggle';
import { formatDate } from '@/src/panel/format';
import { requireOwner } from '@/src/panel/session';

export const metadata: Metadata = {
  title: 'Tu gimnasio ya está en Sinchi',
  robots: { index: false, follow: false },
};

/** Lee la cookie de sesión, así que no se prerenderiza. */
export const dynamic = 'force-dynamic';

const PROMO_DENIALS: readonly PromoDenial[] = [
  'malformed',
  'not_found',
  'inactive',
  'expired',
  'exhausted',
  'already_used',
];

const STEPS = [
  'Descarga la app y entra con la misma cuenta.',
  'En «Clases y precios» crea tus planes y tu horario. Sin horario, tu local sale en el directorio como «0 clases por semana».',
  'Inscribe a tu primer alumno desde el padrón. Desde ese día ve su plan y su QR en su teléfono.',
] as const;

/** `YYYY-MM-DD` → la fecha, o `null` si lo que llegó por la URL no lo es. */
function freeUntilFrom(raw: string | undefined): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw ?? '');
  if (match === null) return null;
  return formatDate({ year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) });
}

function promoOutcome(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  if (raw === 'aplicado') return 'Tu código de promoción quedó aplicado: tienes más tiempo gratis.';
  if ((PROMO_DENIALS as readonly string[]).includes(raw)) {
    return `Tu código no se pudo aplicar — ${promoDenialMessage(raw as PromoDenial).toLowerCase()} Tu gimnasio quedó creado igual; puedes canjear otro desde la app.`;
  }
  return null;
}

export default async function ListoPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly hasta?: string; readonly codigo?: string }>;
}) {
  const session = await requireOwner();
  const { hasta, codigo } = await searchParams;
  const freeUntil = freeUntilFrom(hasta);
  const promo = promoOutcome(codigo);

  return (
    <div className="signup" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
      <main className="signup-main" style={{ gap: 40 }}>
        <div className="signup-card" style={{ maxWidth: 640 }}>
          <div className="signup-aside-top">
            <a href="/" className="brand" aria-label="Sinchi, inicio">
              <Logo size={26} />
              <span className="display">SINCHI</span>
            </a>
            <ThemeToggle compact />
          </div>
        </div>

        <div className="signup-card" style={{ maxWidth: 640, gap: 26 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <span className="signup-step">Listo</span>
            <h1 className="display" style={{ margin: 0, fontSize: 'clamp(30px, 4vw, 46px)', lineHeight: 0.98 }}>
              {session.tenantName} ya está en Sinchi
            </h1>
            <p style={{ margin: 0, fontSize: 15, lineHeight: '23px', color: 'var(--text-secondary)' }}>
              {freeUntil === null
                ? 'Tu local quedó creado y tu cuenta es la de su dueño.'
                : `Tu local quedó creado y es gratis hasta el ${freeUntil}. Hasta entonces no te cobramos nada, y no te pedimos tarjeta.`}
            </p>
            {promo === null ? null : (
              <p className="panel-alert ok" role="status">
                <strong aria-hidden>✓</strong>
                <span>{promo}</span>
              </p>
            )}
          </div>

          <section className="signup-section">
            <h3>Lo que sigue, desde la app</h3>
            <ol style={{ margin: 0, paddingLeft: 22, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {STEPS.map((step) => (
                <li key={step} style={{ fontSize: 14, lineHeight: '21px', color: 'var(--text-secondary)' }}>
                  {step}
                </li>
              ))}
            </ol>
            <StoreButtons />
          </section>

          <section className="signup-section">
            <h3>Y en esta misma web</h3>
            <p className="signup-hint">
              Tu panel ya está abierto: ahí ves el padrón, lo que entra cada mes y quién dejó de
              venir. Es para sentarse a mirar los números; el mostrador es la app.
            </p>
            <a href="/panel" className="panel-btn ghost" style={{ alignSelf: 'flex-start' }}>
              Ir a mi panel
            </a>
          </section>
        </div>
      </main>
    </div>
  );
}
