/**
 * Botones de descarga.
 *
 * Propios, no las insignias oficiales de Apple y Google: esas son marcas
 * registradas con sus propias reglas de uso, y usarlas mal es peor que no
 * usarlas. Se sustituyen por las de verdad el día que la app esté publicada.
 *
 * Las URLs son las MISMAS que sirve la página de la invitación (`IOS_STORE_URL`
 * y `ANDROID_STORE_URL` en la api), y mientras falten el botón NO es un enlace:
 * la app todavía no está publicada en ninguna de las dos tiendas, y mandar a
 * alguien a una ficha que dice «no encontrado» es peor que decirle que todavía
 * no está. Se quedan puestos porque son la promesa de la página; el día que se
 * publique, cada uno se enciende con su variable.
 */
const IOS = process.env['NEXT_PUBLIC_IOS_STORE_URL'] ?? null;
const ANDROID = process.env['NEXT_PUBLIC_ANDROID_STORE_URL'] ?? null;

const GLYPHS = {
  ios: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--canvas)" strokeWidth={2} strokeLinecap="round" aria-hidden>
      <rect x="6" y="2" width="12" height="20" rx="3" />
      <path d="M11 18h2" />
    </svg>
  ),
  android: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--canvas)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3v11" />
      <path d="M7.5 9.5 12 14l4.5-4.5" />
      <path d="M4 17.5v1A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5v-1" />
    </svg>
  ),
} as const;

const SHELL = {
  display: 'flex', alignItems: 'center', gap: 12,
  background: 'var(--ink)', color: 'var(--canvas)',
  borderRadius: 14, padding: '13px 20px',
} as const;

function StoreButton({
  store,
  kicker,
  glyph,
  href,
}: {
  readonly store: string;
  readonly kicker: string;
  readonly glyph: keyof typeof GLYPHS;
  readonly href: string | null;
}) {
  const inner = (
    <>
      {GLYPHS[glyph]}
      <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15 }}>
        <span style={{ fontSize: 11, letterSpacing: 0.4, opacity: 0.62 }}>{kicker}</span>
        <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: -0.3 }}>{store}</span>
      </span>
    </>
  );

  if (href === null) {
    return (
      <span className="store-btn" style={{ ...SHELL, opacity: 0.66, cursor: 'default' }}>
        {inner}
      </span>
    );
  }

  return (
    <a className="store-btn" href={href} style={SHELL}>
      {inner}
    </a>
  );
}

export function StoreButtons({ column = false }: { readonly column?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', flexDirection: column ? 'column' : 'row' }}>
      <StoreButton
        store="App Store"
        kicker={IOS === null ? 'Muy pronto en el' : 'Descargar en el'}
        glyph="ios"
        href={IOS}
      />
      <StoreButton
        store="Google Play"
        kicker={ANDROID === null ? 'Muy pronto en' : 'Disponible en'}
        glyph="android"
        href={ANDROID}
      />
    </div>
  );
}
