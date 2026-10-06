/**
 * La revocación de «Entrar con Apple», sin hablar con Apple.
 *
 * Lo que se equivoca aquí no es la red: es la firma ES256 —Node la da en DER y
 * Apple la quiere en `ieee-p1363`— y decidir cuándo se le pide el código a la
 * app. Las dos cosas se prueban con una llave generada y un `fetch` falso.
 */
import { generateKeyPairSync, verify } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppleRevocation, appleClientSecret } from './apple-revocation';
import { resetEnvCache } from '../config/env';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString());

describe('appleClientSecret', () => {
  it('firma un JWT ES256 que Apple puede verificar, con lo que Apple pide dentro', () => {
    const jwt = appleClientSecret({
      teamId: '5QGSG9RD22',
      keyId: 'ABCDE12345',
      clientId: 'fit.sinchi.app',
      privateKey: PEM,
      now: 1_790_000_000_000,
    });
    const [header, payload, signature] = jwt.split('.');

    expect(decode(header!)).toEqual({ alg: 'ES256', kid: 'ABCDE12345' });
    expect(decode(payload!)).toEqual({
      iss: '5QGSG9RD22',
      iat: 1_790_000_000,
      exp: 1_790_000_300,
      aud: 'https://appleid.apple.com',
      sub: 'fit.sinchi.app',
    });
    const valid = verify(
      'sha256',
      Buffer.from(`${header}.${payload}`),
      { key: publicKey, dsaEncoding: 'ieee-p1363' },
      Buffer.from(signature!, 'base64url'),
    );
    expect(valid).toBe(true);
  });

  it('acepta el PEM con los saltos escritos como `\\n`, como a veces sale de Secret Manager', () => {
    expect(() =>
      appleClientSecret({
        teamId: '5QGSG9RD22',
        keyId: 'ABCDE12345',
        clientId: 'fit.sinchi.app',
        privateKey: PEM.replace(/\n/g, '\\n'),
      }),
    ).not.toThrow();
  });
});

describe('AppleRevocation.settle', () => {
  const apple = new AppleRevocation();
  const fetchMock = vi.fn();
  const saved = { ...process.env };

  const configure = (on: boolean) => {
    process.env.APPLE_TEAM_ID = on ? '5QGSG9RD22' : '';
    process.env.APPLE_SIGNIN_KEY_ID = on ? 'ABCDE12345' : '';
    process.env.APPLE_SIGNIN_PRIVATE_KEY = on ? PEM : '';
    resetEnvCache();
  };

  beforeEach(() => {
    process.env.DATABASE_URL ??= 'postgres://x:y@localhost:5432/z';
    process.env.JWT_SECRET ??= 'x'.repeat(64);
    process.env.ENCRYPTION_KEY ??= Buffer.alloc(32).toString('base64');
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...saved };
    resetEnvCache();
  });

  it('a una cuenta que no es de Apple no le pide nada', async () => {
    configure(true);
    expect(await apple.settle({ isApple: false, consent: {} })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sin la llave no puede revocar, y no por eso frena la baja', async () => {
    configure(false);
    expect(await apple.settle({ isApple: true, consent: {} })).toBe('not_configured');
  });

  it('a una cuenta de Apple sin código le pide confirmar con Apple, antes de borrar', async () => {
    configure(true);
    await expect(apple.settle({ isApple: true, consent: {} })).rejects.toMatchObject({
      response: { code: 'apple_authorization_required' },
    });
  });

  it('desde un teléfono que no puede pedir el código, sigue sin revocar', async () => {
    configure(true);
    expect(await apple.settle({ isApple: true, consent: { unavailable: true } })).toBe('skipped');
  });

  it('con el código: lo canjea y revoca el token de refresco que sale de él', async () => {
    configure(true);
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ refresh_token: 'r-1', access_token: 'a-1' }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response('', { status: 200 }));

    expect(
      await apple.settle({ isApple: true, consent: { authorizationCode: 'code-123' } }),
    ).toBe('revoked');

    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0]!;
    expect(tokenUrl).toBe('https://appleid.apple.com/auth/token');
    const canje = new URLSearchParams(tokenInit.body as string);
    expect(canje.get('code')).toBe('code-123');
    expect(canje.get('client_id')).toBe('fit.sinchi.app');
    expect(canje.get('grant_type')).toBe('authorization_code');

    const [revokeUrl, revokeInit] = fetchMock.mock.calls[1]!;
    expect(revokeUrl).toBe('https://appleid.apple.com/auth/revoke');
    const revocado = new URLSearchParams(revokeInit.body as string);
    expect(revocado.get('token')).toBe('r-1');
    expect(revocado.get('token_type_hint')).toBe('refresh_token');
  });

  it('si Apple rechaza el código, lo dice y no lanza: la baja sigue', async () => {
    configure(true);
    fetchMock.mockResolvedValueOnce(new Response('{"error":"invalid_grant"}', { status: 400 }));
    expect(await apple.revokeWithCode('vencido')).toBe('failed');
  });

  it('si Apple no contesta, tampoco lanza', async () => {
    configure(true);
    fetchMock.mockRejectedValueOnce(new Error('timeout'));
    expect(await apple.revokeWithCode('code')).toBe('failed');
  });
});
