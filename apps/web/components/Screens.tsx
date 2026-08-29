import { Phone } from './Brand';

/**
 * Las cuatro pantallas de la app, redibujadas con los tokens reales.
 *
 * No son capturas. Una captura de la app trae datos de una persona de verdad
 * —su nombre, su documento, su celular— y esto es una página pública; los
 * alumnos de aquí están inventados. Y redibujarlas con `@sinchi/ui` las mantiene
 * al día con la app sola: si cambia un color del semáforo, cambia aquí.
 */

/**
 * Matriz decorativa. NO es un código legible y no debe parecerlo: un QR de
 * verdad en una landing es un código que alguien escanea y no lleva a ninguna
 * parte. Se precalcula para que sea igual en cada render.
 */
const QR_BITS = '111111111111011111111|100000111011111000001|101110110010111011101|101110101101101011101|101110110011111011101|100000101011101000001|111111101101011111111|111101010111101001100|000111010101110000010|010010111010110101100|011110111101000000011|011001001001010000001|010000101010100001010|111000101110111101110|111111111111100111101|100000111001101001011|101110101101101001010|101110111011100110110|101110111001010010001|100000110110101011001|111111101010010111001';

function QrMatrix() {
  const cells: React.ReactElement[] = [];
  QR_BITS.split('|').forEach((row, y) => {
    row.split('').forEach((bit, x) => {
      if (bit === '1') cells.push(<rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="#0A0A0B" />);
    });
  });
  return (
    <svg viewBox="0 0 21 21" width={150} height={150} shapeRendering="crispEdges" aria-hidden>
      {cells}
    </svg>
  );
}

const screenPad = { padding: '20px 14px 16px', display: 'flex', flexDirection: 'column' as const, minHeight: 520 };

/* --- Padrón: lo que ve el mostrador --------------------------------------- */
function RosterRow({
  name, detail, color, amount, label,
}: {
  readonly name: string; readonly detail: string; readonly color: string;
  readonly amount?: string; readonly label: string;
}) {
  return (
    <div className="card" style={{ padding: '11px 13px', borderRadius: 'var(--r-lg)', borderColor: amount ? 'rgba(255,77,77,.3)' : 'var(--hairline)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 8, height: 8, borderRadius: 4, background: color, flex: 'none' }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1 }}>
          <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: -0.3 }}>{name}</span>
          <span style={{ fontSize: 9.5, lineHeight: '13px' }} className="tertiary">{detail}</span>
        </div>
        {amount ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
            <span style={{ fontSize: 14, fontWeight: 600, color }}>{amount}</span>
            <span style={{ fontSize: 9.5 }} className="tertiary">{label}</span>
          </div>
        ) : (
          <span style={{ fontSize: 9.5 }} className="tertiary">{label}</span>
        )}
      </div>
    </div>
  );
}

export function RosterScreen() {
  return (
    <Phone>
      <div style={{ ...screenPad, gap: 14 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span className="eyebrow">Padrón</span>
          <span className="display" style={{ fontSize: 23 }}>42 alumnos</span>
          <span style={{ fontSize: 12.5, color: 'var(--warn)' }}>7 con deuda · S/ 840 por cobrar</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div className="card" style={{ flex: 1, padding: '11px 12px', borderRadius: 'var(--r-xl)' }}>
            <div className="display" style={{ fontSize: 20, color: 'var(--ok)' }}>S/ 3,420</div>
            <div style={{ fontSize: 9.5 }} className="secondary">cobrado este mes</div>
          </div>
          <div className="card" style={{ flex: 1, padding: '11px 12px', borderRadius: 'var(--r-xl)' }}>
            <div className="display" style={{ fontSize: 20, color: 'var(--warn)' }}>S/ 840</div>
            <div style={{ fontSize: 9.5 }} className="secondary">por cobrar</div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <RosterRow name="Rosa Meléndez" detail="3 por semana · Suspendida" color="var(--bad)" amount="S/ 360" label="cobrar" />
          <RosterRow name="Luis Ttito" detail="2 por semana · Debe S/150" color="var(--warn)" amount="S/ 150" label="cobrar" />
          <RosterRow name="Marco Ochoa" detail="Ilimitado · Cupo agotado" color="var(--alert)" label="al día" />
          <RosterRow name="Diego Salas" detail="2 por semana · Al día" color="var(--ok)" label="al día" />
          <RosterRow name="Ana Quiroz" detail="Ilimitado · Al día" color="var(--ok)" label="al día" />
        </div>
      </div>
    </Phone>
  );
}

/* --- Plan: lo que ve el alumno, con su próximo pago ----------------------- */
export function PlanScreen() {
  const days = ['L', 'M', 'M', 'J', 'V', 'S', 'D'] as const;
  const todayClasses = [
    { name: 'Funcional', time: '07:00 – 08:00' },
    { name: 'Boxeo', time: '19:00 – 20:00' },
  ];
  const lastCheckIns = ['Lunes 25 · 19:04', 'Viernes 22 · 07:12'];

  return (
    <Phone>
      <div style={{ ...screenPad, gap: 14 }}>
        <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: -0.5 }}>Club Kaizen</span>

        <div className="card" style={{ padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span className="eyebrow">Plan actual</span>
              <span className="display" style={{ fontSize: 21 }}>2 por semana</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
              <span className="display" style={{ fontSize: 19 }}>S/ 150</span>
              <span style={{ fontSize: 9.5 }} className="tertiary">al mes</span>
            </div>
          </div>
          <div style={{ height: 1, background: 'var(--divider)', margin: '13px 0' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontSize: 12.5 }} className="secondary">Sesiones de esta semana</span>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ok)' }}>1 de 2</span>
          </div>
          <div style={{ display: 'flex', gap: 5, marginTop: 8 }}>
            <div style={{ flex: 1, height: 5, borderRadius: 3, background: 'var(--ok)' }} />
            <div style={{ flex: 1, height: 5, borderRadius: 3, background: 'var(--surface-high)' }} />
          </div>
        </div>

        <div
          className="card"
          style={{
            padding: 14, borderRadius: 'var(--r-lg)', borderColor: 'rgba(47,209,109,.3)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span className="eyebrow" style={{ color: 'var(--ok)' }}>Tu próximo pago</span>
            <span style={{ fontSize: 9.5 }} className="tertiary">y el escáner sigue validando</span>
          </div>
          <span className="display" style={{ fontSize: 19, color: 'var(--ok)' }}>3 set</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="eyebrow">Tu semana</span>
          <div style={{ display: 'flex', gap: 5 }}>
            {days.map((day, index) => (
              <div
                key={index}
                style={{
                  flex: 1, aspectRatio: '1', borderRadius: 9,
                  background: index === 6 ? '#131317' : 'var(--surface-high)',
                  border: index === 2 ? '1.5px solid var(--ok)' : 'none',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <span style={{ fontSize: 11 }} className={index === 6 ? 'tertiary' : undefined}>{day}</span>
              </div>
            ))}
          </div>
          <div className="card" style={{ padding: '11px 13px', borderRadius: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', gap: 7, alignItems: 'baseline' }}>
              <span style={{ fontSize: 11, fontWeight: 700 }} className="secondary">Miércoles</span>
              <span style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--ok)' }}>HOY</span>
            </div>
            {todayClasses.map((session) => (
              <div key={session.name} style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12.5 }}>{session.name}</span>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: '#B8B8C0' }}>{session.time}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 'auto' }}>
          <span className="eyebrow">Tus últimas asistencias</span>
          {lastCheckIns.map((when) => (
            <div key={when} style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12.5 }}>{when}</span>
              <span style={{ fontSize: 9.5 }} className="tertiary">QR</span>
            </div>
          ))}
        </div>
      </div>
    </Phone>
  );
}

/* --- Mi QR: el código que rota de verdad ---------------------------------- */
export function QrScreen() {
  const seconds = Array.from({ length: 31 }, (_, i) => 30 - i);
  return (
    <Phone background="linear-gradient(160deg,#FF9E5C,#E0641C)">
      <div style={{ ...screenPad, gap: 12, padding: '20px 16px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'rgba(10,10,11,.10)', padding: '5px 10px 5px 6px', borderRadius: 'var(--r-pill)' }}>
            <div style={{ width: 17, height: 17, borderRadius: 6, background: 'rgba(10,10,11,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: 9, color: '#fff', fontWeight: 800 }}>AK</span>
            </div>
            <span style={{ fontSize: 11, color: '#2B1305', fontWeight: 600 }}>Club Kaizen</span>
          </div>
          <span style={{ fontSize: 9.5, color: '#2B1305', opacity: 0.5, fontWeight: 700, letterSpacing: 1.4 }}>MI QR</span>
        </div>

        <div style={{ display: 'flex', gap: 11, alignItems: 'center' }}>
          <div style={{ width: 48, height: 48, borderRadius: 24, background: 'var(--avatar)', border: '3px solid rgba(255,255,255,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
            <span className="display" style={{ fontSize: 15, color: 'var(--text-tertiary)' }}>DS</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: -0.5, color: '#2B1305' }}>Diego Salas</span>
            <span style={{ fontSize: 9.5, color: '#2B1305', opacity: 0.62, fontWeight: 600 }}>2 por semana · Club Kaizen</span>
          </div>
        </div>

        <div style={{ background: '#fff', borderRadius: 24, padding: 15, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <QrMatrix />
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', width: '100%' }}>
            <div style={{ width: 32, height: 32, position: 'relative', flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width={32} height={32} viewBox="0 0 32 32" style={{ position: 'absolute', transform: 'rotate(-90deg)' }} aria-hidden>
                <circle cx={16} cy={16} r={14} fill="none" stroke="rgba(10,10,11,.12)" strokeWidth={3} />
                <circle className="ring" cx={16} cy={16} r={14} fill="none" stroke="var(--ok)" strokeWidth={3} strokeLinecap="round" strokeDasharray={88} />
              </svg>
              <div className="counter" style={{ position: 'relative', fontSize: 9.5, color: '#0A0A0B', fontWeight: 700 }}>
                <div>
                  {seconds.map((second) => (
                    <div key={second} style={{ height: 13 }}>{second}</div>
                  ))}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: 11, color: '#0A0A0B', fontWeight: 600 }}>Se renueva cada 30 s</span>
              <span style={{ fontSize: 9.5, color: '#7A7A83' }}>Código firmado · funciona sin internet</span>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', background: 'rgba(10,10,11,.92)', padding: '8px 15px', borderRadius: 'var(--r-pill)' }}>
            <div style={{ width: 8, height: 8, borderRadius: 4, background: 'var(--ok)' }} />
            <span style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>Puedes entrar</span>
          </div>
          <span style={{ fontSize: 9.5, color: '#2B1305', opacity: 0.72, textAlign: 'center' }}>
            Tu suscripción está al día. 1 de 2 sesiones esta semana.
          </span>
        </div>
      </div>
    </Phone>
  );
}

/* --- El corte: la consecuencia -------------------------------------------- */
export function DeniedScreen() {
  return (
    <Phone background="linear-gradient(160deg,#FF6161,#C22B2B)">
      <div style={{ ...screenPad, gap: 14, padding: '22px 16px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontSize: 9.5, color: '#380B0B', fontWeight: 800, letterSpacing: 1.6 }}>ACCESO DENEGADO</span>
          <span style={{ fontSize: 9.5, color: '#380B0B', opacity: 0.55, fontWeight: 700 }}>19:06 · QR</span>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div style={{ width: 64, height: 64, borderRadius: 32, background: 'var(--avatar)', border: '4px solid rgba(255,255,255,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
            <span className="display" style={{ fontSize: 20, color: 'var(--text-tertiary)' }}>RM</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span className="display" style={{ fontSize: 21, color: '#380B0B' }}>ROSA MELÉNDEZ</span>
            <span style={{ fontSize: 11, color: '#380B0B', opacity: 0.65, fontWeight: 600 }}>3 por semana · S/ 180</span>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', background: 'rgba(10,10,11,.10)', borderRadius: 14, padding: '11px 13px' }}>
          <span style={{ fontSize: 11, color: '#380B0B', fontWeight: 600 }}>Deuda</span>
          <span style={{ fontSize: 14, color: '#380B0B', fontWeight: 800 }}>S/ 360.00</span>
        </div>

        <div style={{ background: '#380B0B', borderRadius: 20, padding: 16, display: 'flex', flexDirection: 'column', gap: 7 }}>
          <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
            <div style={{ width: 10, height: 10, borderRadius: 5, background: 'var(--bad)', marginTop: 5, flex: 'none' }} />
            <span className="display" style={{ fontSize: 19, color: '#fff', letterSpacing: -0.5 }}>Suspendido por mora</span>
          </div>
          <span style={{ fontSize: 12.5, lineHeight: '17px', color: '#E8D5D5' }}>
            Lleva 21 días de atraso y venció el periodo de gracia.
          </span>
        </div>

        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontSize: 9.5, color: '#380B0B', textAlign: 'center', opacity: 0.62 }}>
            Cobra aquí y el acceso se libera al instante.
          </span>
          <div style={{ background: '#380B0B', borderRadius: 14, padding: 13, textAlign: 'center' }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>Cobrar S/ 360 en mostrador</span>
          </div>
        </div>
      </div>
    </Phone>
  );
}
