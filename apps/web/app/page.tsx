import { Logo } from '@/components/Brand';
import { Nav } from '@/components/Nav';
import { DeniedScreen, PlanScreen, QrScreen, RosterScreen } from '@/components/Screens';
import { StoreButtons } from '@/components/StoreButtons';

const ICONS = {
  roster: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--ok)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  attendance: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--ok)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4" width="18" height="18" rx="3" /><path d="M8 2v4M16 2v4M3 10h18" /><path d="m9 16 2 2 4-4" />
    </svg>
  ),
  billing: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--ok)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2" y="6" width="20" height="13" rx="3" /><path d="M2 11h20" /><path d="M6 16h4" />
    </svg>
  ),
} as const;

const FEATURES = [
  {
    icon: 'roster' as const,
    title: 'Todos tus alumnos, mapeados',
    text: 'Cada uno con su plan, su documento y su fecha de próximo pago. El padrón se ordena por quién debe, no por orden alfabético: la pregunta del mostrador es a quién cobrarle.',
  },
  {
    icon: 'attendance' as const,
    title: 'Cada clase que marca',
    text: 'Quién vino, a qué hora y a qué clase. El cupo semanal se cuenta solo — dos por semana son dos, y no se acumulan de una semana a otra.',
  },
  {
    icon: 'billing' as const,
    title: 'El cobro, en el mostrador',
    text: 'Mensualidad, matrícula o clase suelta, en efectivo, Yape o transferencia. Queda registrado a nombre de quien lo cobró y la renovación se mueve sola.',
  },
];

const PLANS = [
  { tier: 'Hasta 60 alumnos', price: '149', detail: 'Un local, un padrón, cobro en mostrador.', featured: false },
  { tier: 'De 61 a 150', price: '299', detail: 'Ya no te caben en la cabeza los que deben. Reportes y cortes automáticos.', featured: true },
  { tier: 'Más de 150 o multi-sede', price: '499', detail: 'Varios locales bajo la misma marca, cada uno con su padrón y su caja.', featured: false },
] as const;

export default function Landing() {
  return (
    <>
      <Nav />

      <main id="top">
        {/* Portada: el trabajo que hace, y las dos caras a la vez. */}
        <section className="section wrap stack" style={{ display: 'flex', gap: 48, alignItems: 'center', paddingTop: 46 }}>
          <div className="enter" style={{ display: 'flex', flexDirection: 'column', gap: 26, flex: 1, minWidth: 0 }}>
            <span className="pill" style={{ background: 'rgba(47,209,109,.10)', color: 'var(--ok)', alignSelf: 'flex-start' }}>
              Gimnasios y escuelas de artes marciales
            </span>
            <h1 className="display h1" style={{ margin: 0, maxWidth: 640 }}>
              Quién entrena, quién paga y cuándo le toca.
            </h1>
            <p className="lead" style={{ margin: 0, maxWidth: 530 }}>
              Sinchi lleva el padrón de tu gimnasio, marca la asistencia de cada clase y cobra
              las mensualidades. Tú lo ves en el mostrador — y tu alumno, en su teléfono.
            </p>
            <StoreButtons />
            <p className="body" style={{ margin: 0, fontSize: 13 }}>
              <strong style={{ color: 'var(--ok)', fontWeight: 700 }}>Primer mes gratis.</strong>{' '}
              Después, desde S/ 149 al mes por local · Yape, efectivo y transferencia
            </p>
          </div>

          {/* Un halo detrás de los teléfonos: sin él, dos rectángulos oscuros
              sobre fondo oscuro se pierden. */}
          <div className="center-mobile enter-late" style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flex: 'none', position: 'relative' }}>
            <div
              className="halo"
              aria-hidden
              style={{
                position: 'absolute', inset: '-14% -10%', pointerEvents: 'none',
                background: 'radial-gradient(circle at 50% 38%, rgba(47,209,109,.16), transparent 68%)',
                filter: 'blur(26px)',
              }}
            />
            <RosterScreen className="float" />
            <div className="hide-lg"><PlanScreen className="float" /></div>
          </div>
        </section>

        {/* Las tres cosas que lleva */}
        <section id="que-hace" style={{ background: 'var(--screen)' }}>
          <div className="section wrap" style={{ display: 'flex', flexDirection: 'column', gap: 44 }}>
            <div className="reveal" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <span className="eyebrow">Lo que deja de vivir en el cuaderno</span>
              <h2 className="display h2" style={{ margin: 0, maxWidth: 640 }}>
                Tres cosas que hoy se te escapan
              </h2>
            </div>
            <div className="grid-3 stagger" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 44 }}>
              {FEATURES.map((feature) => (
                <div key={feature.title} style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                  {ICONS[feature.icon]}
                  <h3 style={{ fontSize: 19, margin: 0, fontWeight: 700, letterSpacing: -0.5 }}>{feature.title}</h3>
                  <p className="body" style={{ margin: 0 }}>{feature.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* La mitad que ningún cuaderno da */}
        <section id="los-dos-lados" className="section wrap stack-reverse" style={{ display: 'flex', gap: 96, alignItems: 'center' }}>
          <div className="center-mobile" style={{ flex: 'none', display: 'flex' }}>
            <QrScreen className="parallax" />
          </div>
          <div className="reveal" style={{ display: 'flex', flexDirection: 'column', gap: 20, flex: 1, minWidth: 0 }}>
            <span className="eyebrow">Los dos lados</span>
            <h2 className="display h2" style={{ margin: 0, maxWidth: 560 }}>
              Tu alumno ve lo mismo que tú
            </h2>
            <p className="lead" style={{ margin: 0, maxWidth: 620 }}>
              Su plan, cuántas sesiones le quedan esta semana, el horario de clases y —lo que
              de verdad importa— <strong style={{ color: 'var(--ink)', fontWeight: 600 }}>cuándo le toca pagar</strong>.
            </p>
            <p className="body" style={{ margin: 0, maxWidth: 620, fontSize: 16, lineHeight: '24px' }}>
              Es la diferencia entre un cuaderno y esto. Nadie llega a fin de mes sin saber que
              debía, nadie discute la fecha en la puerta, y tú te ahorras la conversación
              incómoda antes de que haga falta tenerla.
            </p>
            <div style={{ display: 'flex', gap: 11, alignItems: 'flex-start', marginTop: 4 }}>
              <div style={{ width: 8, height: 8, borderRadius: 4, background: 'var(--ok)', flex: 'none', marginTop: 7 }} />
              <p className="body" style={{ margin: 0 }}>
                Su código cambia cada 30 segundos y funciona sin internet: el wifi de un
                gimnasio no aguanta la hora punta.
              </p>
            </div>
          </div>
        </section>

        {/* La consecuencia */}
        <section style={{ background: 'var(--screen)' }}>
          <div className="section wrap stack" style={{ display: 'flex', gap: 72, alignItems: 'center' }}>
            <div className="reveal" style={{ display: 'flex', flexDirection: 'column', gap: 20, flex: 1, minWidth: 0 }}>
              <span className="eyebrow">Y cuando alguien deja de pagar</span>
              <h2 className="display h2" style={{ margin: 0, maxWidth: 480 }}>
                El corte lo hace la puerta, no tú
              </h2>
              <p className="body" style={{ margin: 0, maxWidth: 490, fontSize: 16, lineHeight: '24px' }}>
                Tú decides cuántos días de gracia da tu local. Mientras duren, el alumno entra y
                ve lo que debe. Cuando vencen, el escáner deja de validar su código y el motivo
                sale escrito — nunca «acceso denegado» a secas.
              </p>
              <div style={{ display: 'flex', gap: 16, alignItems: 'stretch', paddingTop: 6 }}>
                <div style={{ width: 3, background: 'var(--bad)', borderRadius: 2, flex: 'none' }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span className="display h3" style={{ color: 'var(--bad)', lineHeight: 1 }}>S/ 1,500</span>
                  <p className="body" style={{ margin: 0, maxWidth: 400 }}>
                    al mes es lo que pierde un local de 60 alumnos con 20% de morosidad: gente que
                    entrena y no paga.
                  </p>
                </div>
              </div>
            </div>
            <div className="center-mobile" style={{ flex: 'none', display: 'flex' }}>
              <DeniedScreen className="parallax" />
            </div>
          </div>
        </section>

        {/* Planes */}
        <section id="planes" className="section wrap" style={{ display: 'flex', flexDirection: 'column', gap: 38 }}>
          <div className="stack reveal" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 40 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <span className="eyebrow">Planes</span>
              <h2 className="display h2" style={{ margin: 0, maxWidth: 540 }}>
                Precio fijo al mes. Ni un sol por transacción.
              </h2>
            </div>
            <p className="body" style={{ margin: 0, maxWidth: 380 }}>
              Se cuenta por <strong style={{ color: 'var(--ink)', fontWeight: 600 }}>alumnos activos</strong> — los que
              marcaron asistencia o pagaron ese mes—, no por los registrados. Un alumno que se
              fue en marzo no te cuesta en abril.
            </p>
          </div>
          {/* Antes de los precios y no después: es lo que decide si alguien se
              para a mirarlos. Y dice qué se lleva gratis, no solo que es gratis. */}
          <div
            className="card"
            style={{
              display: 'flex', gap: 18, alignItems: 'center', padding: '20px 24px',
              borderColor: 'rgba(47,209,109,.35)', background: 'rgba(47,209,109,.06)',
            }}
          >
            <div style={{ width: 3, alignSelf: 'stretch', background: 'var(--ok)', borderRadius: 2, flex: 'none' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span className="display" style={{ fontSize: 24, color: 'var(--ok)' }}>
                El primer mes no lo pagas
              </span>
              <p className="body" style={{ margin: 0, maxWidth: 640 }}>
                Monta tu padrón, marca la asistencia de un mes entero y cobra las mensualidades. Si
                al final no te sirve, te vas sin haber pagado nada — y tus datos se van contigo.
              </p>
            </div>
          </div>

          <div className="grid-3 stagger" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 20 }}>
            {PLANS.map((plan) => (
              <div
                key={plan.tier}
                className="card lift"
                style={{
                  padding: '26px 24px', display: 'flex', flexDirection: 'column', gap: 12,
                  borderColor: plan.featured ? 'var(--ok)' : 'var(--hairline)',
                }}
              >
                {plan.featured ? (
                  <span className="pill" style={{ background: 'rgba(47,209,109,.13)', color: 'var(--ok)', alignSelf: 'flex-start' }}>
                    El más común
                  </span>
                ) : null}
                <span className="eyebrow">{plan.tier}</span>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span className="display" style={{ fontSize: 42 }}>S/ {plan.price}</span>
                  <span className="body">/ mes</span>
                </div>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ok)' }}>
                  El primer mes, gratis
                </span>
                <p className="body" style={{ margin: 0 }}>{plan.detail}</p>
              </div>
            ))}
          </div>
          <p className="body" style={{ margin: 0, fontSize: 13 }}>
            El alumno te paga a ti, no a nosotros. Nosotros te cobramos con el mismo motor con
            el que tú le cobras a él: si falla, nos enteramos antes que tú.
          </p>
        </section>

        {/* Cierre */}
        <section id="contacto" style={{ background: 'var(--screen)' }}>
          <div className="section wrap reveal" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 26, textAlign: 'center' }}>
            <Logo size={54} barColor="var(--screen)" />
            <h2 className="display h2" style={{ margin: 0, maxWidth: 760 }}>
              Deja de llevar tu gimnasio en un cuaderno
            </h2>
            <p className="lead" style={{ margin: 0, maxWidth: 480 }}>
              Monta tu padrón esta semana y tus alumnos lo ven desde el primer día.{' '}
              <strong style={{ color: 'var(--ok)', fontWeight: 600 }}>El primer mes es gratis.</strong>
            </p>
            <StoreButtons />
          </div>
        </section>
      </main>

      <footer style={{ borderTop: '1px solid var(--hairline)' }}>
        <div
          className="wrap foot"
          style={{
            padding: '30px var(--gutter)', display: 'flex',
            justifyContent: 'space-between', alignItems: 'center', gap: 20, flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <Logo size={18} color="var(--text-tertiary)" />
            <span style={{ fontSize: 11 }} className="tertiary">Sinchi · Lima, Perú</span>
          </div>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <a href="#" style={{ fontSize: 11 }} className="tertiary">Términos</a>
            <a href="#" style={{ fontSize: 11 }} className="tertiary">Privacidad</a>
            <a href="mailto:soporte@sinchi.fit" style={{ fontSize: 11 }} className="tertiary">soporte@sinchi.fit</a>
          </div>
        </div>
      </footer>
    </>
  );
}
