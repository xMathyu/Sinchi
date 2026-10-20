import { SAAS_FREE_TIER_LIMIT } from '@sinchi/shared';

/**
 * La oferta, antes de pedir nada.
 *
 * Es el texto que abría el alta en la app, traído tal cual: lo que se le
 * promete a un gimnasio no cambia porque cambie la pantalla donde se lo
 * promete. `compact` es para el segundo paso, donde ya la leyó y lo que hace
 * falta a su lado es sitio para el formulario.
 */
const PROMISES = [
  `Hasta ${SAAS_FREE_TIER_LIMIT} alumnos, gratis para siempre`,
  'Primer mes gratis cuando pases a pagar',
  'Sin tarjeta para empezar',
] as const;

const BENEFITS = [
  { title: 'Padrón con semáforo', body: 'Quién está al día y quién debe, de un vistazo.' },
  { title: 'Puerta con QR', body: 'El alumno muestra su código; ves verde o rojo.' },
  { title: 'Cobro por adelantado', body: 'Se cobra solo y avisa si alguien se atrasa.' },
  { title: 'Clases de prueba', body: 'Sales en el directorio de la red y la gente reserva desde la app.' },
] as const;

export function Offer({ compact = false }: { readonly compact?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <span className="eyebrow" style={{ color: 'var(--ok)' }}>
          Tu gimnasio en Sinchi
        </span>
        <h1
          className="display"
          style={{ margin: 0, fontSize: 'clamp(30px, 4vw, 46px)', lineHeight: 0.98, maxWidth: 460 }}
        >
          Cobra sin perseguir a nadie
        </h1>
        <p style={{ margin: 0, fontSize: 15, lineHeight: '23px', color: 'var(--text-secondary)', maxWidth: 420 }}>
          Membresías que se cobran solas, puerta con QR y un padrón que te dice de un vistazo
          quién está al día.
        </p>
      </div>

      <ul className="signup-promises">
        {PROMISES.map((promise) => (
          <li key={promise}>
            <span className="signup-dot" aria-hidden />
            <span>{promise}</span>
          </li>
        ))}
      </ul>

      {compact ? null : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <span className="eyebrow">Todo esto entra en cualquier plan</span>
          <ul className="signup-benefits">
            {BENEFITS.map((benefit) => (
              <li key={benefit.title}>
                <span className="signup-dot" aria-hidden />
                <span>
                  <strong>{benefit.title}</strong>
                  {benefit.body}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
