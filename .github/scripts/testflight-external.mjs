/**
 * Lleva un build de TestFlight a los testers EXTERNOS.
 *
 * `eas submit` sube el binario a App Store Connect, y su `--groups` solo conoce
 * grupos INTERNOS. Lo que falta para que el build llegue a quien entra por el
 * enlace publico —notas de «Que probar», entrar al grupo externo y Beta App
 * Review— se hace contra la API de App Store Connect, y es este archivo.
 *
 * Sin dependencias a proposito: el workflow de iOS no corre `npm ci` (las
 * dependencias las instala EAS en su maquina), y firmar un JWT ES256 es una
 * llamada a `node:crypto`.
 *
 * Es idempotente: correrlo dos veces sobre el mismo build no lo agrega dos veces
 * al grupo ni pide dos revisiones. Eso es lo que permite reintentar un envio a
 * medias con `build_id` sin miedo.
 *
 * Entorno: ASC_KEY_PATH, ASC_KEY_ID, ASC_ISSUER_ID, ASC_APP_ID,
 * ASC_EXTERNAL_GROUP, BUILD_NUMBER, WHATS_NEW_PATH (opcional), DRY_RUN=1 para
 * mirar sin escribir.
 */
import { readFileSync } from 'node:fs';
import { sign } from 'node:crypto';

function required(name) {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`Falta ${name}.`);
  return value;
}

const KEY_ID = required('ASC_KEY_ID');
const ISSUER_ID = required('ASC_ISSUER_ID');
const PRIVATE_KEY = readFileSync(required('ASC_KEY_PATH'), 'utf8');
const APP_ID = required('ASC_APP_ID');
const GROUP_NAME = required('ASC_EXTERNAL_GROUP');
const BUILD_NUMBER = required('BUILD_NUMBER');
const WHATS_NEW = process.env.WHATS_NEW_PATH
  ? readFileSync(process.env.WHATS_NEW_PATH, 'utf8').trim()
  : null;
/** El idioma de la ficha beta de la app. Unas notas en otro idioma no las ve nadie. */
const LOCALE = process.env.ASC_LOCALE ?? 'es-MX';
const DRY_RUN = process.env.DRY_RUN === '1';

const base64url = (value) => Buffer.from(value).toString('base64url');

/** JWT de 15 minutos. `ieee-p1363` porque Apple espera la firma r||s, no DER. */
function token() {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'ES256', kid: KEY_ID, typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({ iss: ISSUER_ID, iat: now, exp: now + 15 * 60, aud: 'appstoreconnect-v1' }),
  );
  const signature = sign('sha256', Buffer.from(`${header}.${payload}`), {
    key: PRIVATE_KEY,
    dsaEncoding: 'ieee-p1363',
  });
  return `${header}.${payload}.${base64url(signature)}`;
}

async function asc(method, path, query, body) {
  const url = new URL(`https://api.appstoreconnect.apple.com${path}`);
  for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
  const response = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const json = text === '' ? null : JSON.parse(text);
  if (!response.ok) {
    const detail = json?.errors?.map((e) => `${e.code}: ${e.detail ?? e.title}`).join(' | ');
    throw new Error(`${method} ${path} -> ${response.status} ${detail ?? ''}`);
  }
  return json;
}

const log = (message) => console.log(`[testflight] ${message}`);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Espera a que Apple termine de procesar el build.
 *
 * `eas submit` vuelve cuando el binario LLEGO, no cuando Apple lo proceso, y
 * hasta entonces no se puede poner en ningun grupo. Suele tardar de cinco a
 * quince minutos; se espera hasta una hora antes de darlo por perdido.
 */
async function processedBuild() {
  const deadline = Date.now() + 60 * 60_000;
  for (;;) {
    const { data } = await asc('GET', '/v1/builds', {
      'filter[app]': APP_ID,
      'filter[version]': BUILD_NUMBER,
      'fields[builds]': 'version,processingState',
    });
    const build = data[0];
    const state = build?.attributes.processingState;
    log(`build ${BUILD_NUMBER}: ${state ?? 'todavia no aparece en App Store Connect'}`);
    if (state === 'VALID') return build;
    if (state === 'FAILED' || state === 'INVALID') {
      throw new Error(`Apple no proceso el build ${BUILD_NUMBER} (${state}).`);
    }
    if (DRY_RUN) return build ?? null;
    if (Date.now() > deadline) throw new Error(`El build ${BUILD_NUMBER} no quedo procesado en una hora.`);
    await pause(60_000);
  }
}

const build = await processedBuild();
if (build === null) {
  log('en seco: el build todavia no existe, no hay nada que mirar.');
  process.exit(0);
}

const groups = await asc('GET', '/v1/betaGroups', {
  'filter[app]': APP_ID,
  'filter[name]': GROUP_NAME,
  'fields[betaGroups]': 'name,isInternalGroup',
});
const group = groups.data.find(
  (candidate) => candidate.attributes.name === GROUP_NAME && !candidate.attributes.isInternalGroup,
);
// Un nombre que no existe o que es de un grupo INTERNO no se «arregla» creando
// otro: el grupo externo es el del enlace publico que ya tienen los testers.
if (group === undefined) throw new Error(`No hay un grupo EXTERNO llamado «${GROUP_NAME}».`);

const { data: inGroup } = await asc('GET', `/v1/betaGroups/${group.id}/builds`, {
  'fields[builds]': 'version',
  limit: '200',
});
const alreadyInGroup = inGroup.some((candidate) => candidate.id === build.id);
const { data: submissions } = await asc('GET', '/v1/betaAppReviewSubmissions', {
  'filter[build]': build.id,
});

if (DRY_RUN) {
  log(
    `en seco: grupo «${GROUP_NAME}» ${group.id} · ya en el grupo: ${alreadyInGroup} · ` +
      `revision: ${submissions[0]?.attributes.betaReviewState ?? 'sin pedir'} · ` +
      `notas: ${WHATS_NEW === null ? 'no se tocan' : `${WHATS_NEW.length} caracteres`}`,
  );
  process.exit(0);
}

// Las notas van primero: Beta App Review las exige para externos, y pedir la
// revision sin ellas devuelve un 409 que no dice cual es el campo que falta.
if (WHATS_NEW !== null) {
  const { data: localizations } = await asc('GET', `/v1/builds/${build.id}/betaBuildLocalizations`);
  const current = localizations.find((item) => item.attributes.locale === LOCALE);
  if (current !== undefined) {
    await asc('PATCH', `/v1/betaBuildLocalizations/${current.id}`, undefined, {
      data: { type: 'betaBuildLocalizations', id: current.id, attributes: { whatsNew: WHATS_NEW } },
    });
  } else {
    await asc('POST', '/v1/betaBuildLocalizations', undefined, {
      data: {
        type: 'betaBuildLocalizations',
        attributes: { locale: LOCALE, whatsNew: WHATS_NEW },
        relationships: { build: { data: { type: 'builds', id: build.id } } },
      },
    });
  }
  log(`notas de «Que probar» puestas (${LOCALE})`);
}

if (alreadyInGroup) {
  log(`ya estaba en «${GROUP_NAME}»`);
} else {
  await asc('POST', `/v1/betaGroups/${group.id}/relationships/builds`, undefined, {
    data: [{ type: 'builds', id: build.id }],
  });
  log(`agregado a «${GROUP_NAME}»`);
}

if (submissions.length > 0) {
  log(`la revision ya estaba pedida: ${submissions[0].attributes.betaReviewState}`);
} else {
  await asc('POST', '/v1/betaAppReviewSubmissions', undefined, {
    data: {
      type: 'betaAppReviewSubmissions',
      relationships: { build: { data: { type: 'builds', id: build.id } } },
    },
  });
  log('enviado a Beta App Review');
}

const { data: detail } = await asc('GET', `/v1/builds/${build.id}/buildBetaDetail`);
log(`estado para externos: ${detail.attributes.externalBuildState}`);
