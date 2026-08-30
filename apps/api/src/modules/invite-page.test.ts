/**
 * La página del enlace de invitación.
 *
 * Se prueba como HTML —una cadena— y no con un navegador: lo que puede fallar
 * aquí es servir el botón de la tienda equivocada, dejar un botón que no lleva a
 * ninguna parte, o colar el nombre del alumno sin escapar. Nada de eso necesita
 * un DOM.
 */
import { describe, expect, it } from 'vitest';
import { detectarSistema, paginaInvitacion, type Tiendas } from './invite-page';

const IOS = 'https://apps.apple.com/pe/app/sinchi/id123456789';
const ANDROID = 'https://play.google.com/store/apps/details?id=pe.sinchi.app';

const base = {
  gimnasio: 'Club Kaizen',
  nombre: 'Diego Salas',
  plan: '2 por semana',
  enlaceApp: 'sinchi:///invite/abc123',
} as const;

const pagina = (sistema: 'ios' | 'android' | 'otro', tiendas: Tiendas = { ios: IOS, android: ANDROID }) =>
  paginaInvitacion({ ...base, sistema, tiendas });

describe('detectarSistema', () => {
  it('reconoce un iPhone', () => {
    expect(
      detectarSistema(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15',
      ),
    ).toBe('ios');
  });

  it('reconoce un Android', () => {
    expect(detectarSistema('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36')).toBe(
      'android',
    );
  });

  it('un escritorio no es ninguno de los dos', () => {
    expect(detectarSistema('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('otro');
  });

  // Un cliente que no manda User-Agent no puede tumbar la página.
  it('sin User-Agent cae en «otro»', () => {
    expect(detectarSistema(undefined)).toBe('otro');
  });
});

describe('paginaInvitacion', () => {
  it('en iPhone ofrece el App Store y no Google Play', () => {
    const html = pagina('ios');
    expect(html).toContain(IOS);
    expect(html).not.toContain(ANDROID);
  });

  it('en Android el botón es un intent con la tienda de respaldo', () => {
    const html = pagina('android');
    // Es el mecanismo del sistema: si la app está, la abre; si no, Chrome va
    // solo a la tienda. Sin `browser_fallback_url` no haría lo segundo.
    expect(html).toContain('intent://invite/abc123#Intent;scheme=sinchi;package=pe.sinchi.app');
    expect(html).toContain(`S.browser_fallback_url=${encodeURIComponent(ANDROID)}`);
    expect(html).not.toContain(IOS);
  });

  it('en un ordenador enseña las dos tiendas y ningún enlace a la app', () => {
    const html = pagina('otro');
    expect(html).toContain(IOS);
    expect(html).toContain(ANDROID);
    // `sinchi://` en un escritorio no abre nada: ofrecerlo es prometer de más.
    expect(html).not.toContain('sinchi:///invite');
  });

  // Mientras la app no esté publicada, un botón a una ficha inexistente es peor
  // que no ponerlo: manda a alguien a una tienda que dice que no existe.
  it('sin URL de App Store no dibuja el botón ni el salto automático', () => {
    const html = pagina('ios', { ios: null, android: ANDROID });
    expect(html).not.toContain('App Store');
    expect(html).not.toContain('<script>');
    expect(html).toContain('sinchi:///invite/abc123');
  });

  // Un `intent://` sin `browser_fallback_url` deja a un Android sin la app
  // mirando una pagina de error de Chrome. Peor que un enlace que no hace nada.
  it('sin URL de Play no usa el intent, que se quedaria sin salida', () => {
    const html = pagina('android', { ios: IOS, android: null });
    expect(html).not.toContain('intent://');
    expect(html).toContain('sinchi:///invite/abc123');
    expect(html).not.toContain('Google Play');
  });

  it('el salto a la tienda de iOS se cancela si la app se lleva el foco', () => {
    const html = pagina('ios');
    // Sin esto, quien SÍ tiene la app abriría la app y encima acabaría en la
    // tienda al volver.
    expect(html).toContain('clearTimeout');
    expect(html).toContain('visibilitychange');
  });

  it('escapa el nombre del gimnasio, que lo escribió recepción', () => {
    const html = paginaInvitacion({
      ...base,
      gimnasio: '<script>alert(1)</script>',
      sistema: 'ios',
      tiendas: { ios: IOS, android: ANDROID },
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
