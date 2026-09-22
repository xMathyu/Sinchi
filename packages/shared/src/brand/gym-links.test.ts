import { describe, expect, it } from 'vitest';
import {
  checkGymLink,
  checkGymLinks,
  displayGymLink,
  editableGymLink,
  gymLinkDenialMessage,
  normalizeGymLink,
  GYM_LINK_KINDS,
  GYM_LINK_MAX_LENGTH,
  type GymLinkDenialCode,
} from './gym-links.js';

describe('todo es opcional', () => {
  it('vacío es no tener, y vale en los cuatro campos', () => {
    for (const kind of GYM_LINK_KINDS) {
      expect(checkGymLink(kind, '  '), kind).toBeNull();
      expect(normalizeGymLink(kind, ''), kind).toBeNull();
    }
    expect(checkGymLinks({ website: '', instagram: '', facebook: '', tiktok: '' })).toBeNull();
  });
});

describe('la página web', () => {
  /** Nadie escribe `https://`. */
  it('le pone https delante si no lo trae', () => {
    expect(normalizeGymLink('website', 'midojo.pe')).toBe('https://midojo.pe');
  });

  it('respeta el http que escribió, y pone en minúsculas solo lo que no distingue', () => {
    expect(normalizeGymLink('website', 'http://MiDojo.PE/Horarios')).toBe('http://midojo.pe/Horarios');
    expect(normalizeGymLink('website', 'HTTPS://www.midojo.pe/')).toBe('https://www.midojo.pe');
  });

  it('acepta puerto, ruta y parámetros', () => {
    expect(normalizeGymLink('website', 'midojo.pe:8080/clases?dia=lunes')).toBe(
      'https://midojo.pe:8080/clases?dia=lunes',
    );
  });

  it('un dominio con eñe es un dominio', () => {
    expect(checkGymLink('website', 'gimnasiopeña.pe')).toBeNull();
  });

  it('lo que no tiene forma de dirección', () => {
    for (const raw of ['midojo', 'mi dojo.pe', 'midojo.pe es mi web']) {
      expect(checkGymLink('website', raw)?.code, raw).toBe('not_a_website');
    }
  });

  /** Abrirlos desde la ficha no llevaría a ninguna página, o llevaría a otra cosa. */
  it('un esquema que no es web', () => {
    for (const raw of ['javascript:alert(1)', 'mailto:hola@midojo.pe', 'ftp://midojo.pe', 'tel:987654321']) {
      expect(checkGymLink('website', raw)?.code, raw).toBe('not_a_website');
    }
  });

  /**
   * `https://midojo.pe@otro.com` abre `otro.com`: lo de antes de la arroba es un
   * usuario, no el sitio.
   */
  it('una dirección que aparenta un sitio y abre otro', () => {
    expect(checkGymLink('website', 'https://midojo.pe@otro.com')?.code).toBe('not_a_website');
  });

  /** Si no, la ficha diría lo mismo dos veces: «Página web» e «Instagram». */
  it('una red social va en su propio campo', () => {
    for (const raw of ['instagram.com/midojo', 'https://www.facebook.com/midojo', 'tiktok.com/@midojo']) {
      expect(checkGymLink('website', raw)?.code, raw).toBe('use_network_field');
    }
  });

  it('una dirección absurdamente larga', () => {
    expect(checkGymLink('website', `midojo.pe/${'x'.repeat(GYM_LINK_MAX_LENGTH)}`)?.code).toBe(
      'too_long',
    );
  });
});

describe('Instagram', () => {
  it('el usuario, con o sin arroba', () => {
    expect(normalizeGymLink('instagram', '@MiDojo')).toBe('https://www.instagram.com/midojo');
    expect(normalizeGymLink('instagram', 'mi.dojo_lince')).toBe('https://www.instagram.com/mi.dojo_lince');
  });

  /** Es lo que da «Copiar enlace del perfil»: con su rastreo detrás. */
  it('el enlace del perfil, sin lo que Instagram pega detrás', () => {
    expect(normalizeGymLink('instagram', 'https://www.instagram.com/midojo/?igsh=MWQ1ZGUxMzBkMA==')).toBe(
      'https://www.instagram.com/midojo',
    );
    expect(normalizeGymLink('instagram', 'instagram.com/midojo')).toBe('https://www.instagram.com/midojo');
  });

  it('una publicación no es el perfil', () => {
    expect(checkGymLink('instagram', 'https://www.instagram.com/p/C1abc/')?.code).toBe('post_not_profile');
    expect(checkGymLink('instagram', 'https://www.instagram.com/reel/C1abc/')?.code).toBe('post_not_profile');
  });

  it('otra página, o un usuario imposible, no es un perfil', () => {
    expect(checkGymLink('instagram', 'https://midojo.pe/instagram')?.code).toBe('not_a_profile');
    expect(checkGymLink('instagram', '@mi dojo')?.code).toBe('not_a_profile');
    expect(checkGymLink('instagram', 'instagram.com')?.code).toBe('not_a_profile');
  });
});

describe('TikTok', () => {
  it('el usuario, con o sin arroba, y el enlace del perfil', () => {
    expect(normalizeGymLink('tiktok', '@MiDojo')).toBe('https://www.tiktok.com/@midojo');
    expect(normalizeGymLink('tiktok', 'https://www.tiktok.com/@midojo?_t=8abc&_r=1')).toBe(
      'https://www.tiktok.com/@midojo',
    );
  });

  it('un video es del perfil que lo publicó', () => {
    expect(normalizeGymLink('tiktok', 'tiktok.com/@midojo/video/7300000000000000000')).toBe(
      'https://www.tiktok.com/@midojo',
    );
  });

  /** `vm.tiktok.com` redirige, pero la dirección no dice a quién. */
  it('un enlace corto no se acepta', () => {
    expect(checkGymLink('tiktok', 'https://vm.tiktok.com/ZMabc123/')?.code).toBe('short_link');
  });

  it('lo que no es un perfil', () => {
    expect(checkGymLink('tiktok', 'https://www.tiktok.com/discover')?.code).toBe('post_not_profile');
    expect(checkGymLink('tiktok', 'instagram.com/midojo')?.code).toBe('not_a_profile');
  });
});

describe('Facebook', () => {
  it('el usuario de la página, y su enlace', () => {
    expect(normalizeGymLink('facebook', 'DojoKaizen')).toBe('https://www.facebook.com/dojokaizen');
    expect(normalizeGymLink('facebook', 'https://m.facebook.com/dojokaizen?mibextid=ZbWKwL')).toBe(
      'https://www.facebook.com/dojokaizen',
    );
    expect(normalizeGymLink('facebook', 'fb.com/dojokaizen')).toBe('https://www.facebook.com/dojokaizen');
  });

  /** Muchas páginas no tienen usuario, y esa es su única dirección. */
  it('una página sin usuario se guarda con su ruta, sin el rastreo', () => {
    expect(normalizeGymLink('facebook', 'https://www.facebook.com/profile.php?id=100089123456789&mibextid=x')).toBe(
      'https://www.facebook.com/profile.php?id=100089123456789',
    );
    expect(normalizeGymLink('facebook', 'https://www.facebook.com/p/Dojo-Kaizen-100089123456789/')).toBe(
      'https://www.facebook.com/p/Dojo-Kaizen-100089123456789',
    );
    expect(normalizeGymLink('facebook', 'https://www.facebook.com/share/1AbCdEf/?mibextid=wwXIfr')).toBe(
      'https://www.facebook.com/share/1AbCdEf',
    );
  });

  it('una foto de la página lleva a la página', () => {
    expect(normalizeGymLink('facebook', 'facebook.com/dojokaizen/photos/a.123/456')).toBe(
      'https://www.facebook.com/dojokaizen',
    );
  });

  it('lo que no es una página', () => {
    const cases: readonly (readonly [string, GymLinkDenialCode])[] = [
      ['https://www.facebook.com/watch/?v=123', 'post_not_profile'],
      ['https://www.facebook.com/profile.php', 'not_a_profile'],
      ['https://www.facebook.com/share/', 'not_a_profile'],
      ['facebook.com', 'not_a_profile'],
      ['dojo', 'not_a_profile'],
    ];
    for (const [raw, code] of cases) {
      expect(checkGymLink('facebook', raw)?.code, raw).toBe(code);
    }
  });
});

/**
 * Abrir «Logo y redes» y guardar sin tocar nada no puede cambiar ninguna
 * dirección: ni quitarle el `www.` a una web que lo necesita, ni pasar a https
 * una que no tiene certificado.
 */
describe('editar lo guardado', () => {
  it('guardar sin tocar deja cada dirección como estaba', () => {
    const stored: readonly (readonly [Parameters<typeof editableGymLink>[0], string])[] = [
      ['website', 'https://www.midojo.pe'],
      ['website', 'http://midojo.pe/Horarios'],
      ['website', 'https://midojo.pe:8080/clases?dia=lunes'],
      ['instagram', 'https://www.instagram.com/mi.dojo_lince'],
      ['tiktok', 'https://www.tiktok.com/@midojo'],
      ['facebook', 'https://www.facebook.com/dojokaizen'],
      ['facebook', 'https://www.facebook.com/profile.php?id=100089123456789'],
      ['facebook', 'https://www.facebook.com/share/1AbCdEf'],
    ];
    for (const [kind, url] of stored) {
      expect(normalizeGymLink(kind, editableGymLink(kind, url)), url).toBe(url);
    }
  });

  it('se edita como se escribió', () => {
    expect(editableGymLink('instagram', 'https://www.instagram.com/midojo')).toBe('@midojo');
    expect(editableGymLink('website', 'https://www.midojo.pe')).toBe('www.midojo.pe');
  });
});

describe('cómo se lee en la ficha', () => {
  it('las redes de usuario con arroba, la web sin lo que sobra', () => {
    expect(displayGymLink('instagram', 'https://www.instagram.com/midojo')).toBe('@midojo');
    expect(displayGymLink('tiktok', 'https://www.tiktok.com/@midojo')).toBe('@midojo');
    expect(displayGymLink('facebook', 'https://www.facebook.com/dojokaizen')).toBe('facebook.com/dojokaizen');
    expect(displayGymLink('website', 'https://www.midojo.pe')).toBe('midojo.pe');
  });

  it('cada motivo tiene su frase, y nombra la red', () => {
    expect(gymLinkDenialMessage({ kind: 'instagram', code: 'not_a_profile' })).toContain('Instagram');
    expect(gymLinkDenialMessage({ kind: 'tiktok', code: 'post_not_profile' })).toContain('TikTok');
    expect(gymLinkDenialMessage({ kind: 'website', code: 'too_long' })).toContain(String(GYM_LINK_MAX_LENGTH));
  });

  it('el primer campo que falla es el que se dice', () => {
    expect(
      checkGymLinks({ website: 'midojo.pe', instagram: '@mal usuario', facebook: 'x', tiktok: '' }),
    ).toEqual({ kind: 'instagram', code: 'not_a_profile' });
  });
});
