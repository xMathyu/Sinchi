/**
 * Le pone las notas de «Novedades» a una release de una pista de Play.
 *
 * `eas submit` sube el .aab y crea la release en la pista, pero NO sabe escribir
 * notas: su config de Android solo tiene `track`, `releaseStatus` y `rollout`.
 * El resultado es una release muda —la de la versionCode 6 lleva asi desde el
 * 2026-09-08— y el tester que actualiza no se entera de que cambio. Esto es el
 * equivalente de Android del paso de «Que probar» de `testflight-external.mjs`.
 *
 * NO HAY LLAVE NI SECRETO. El token entra por `PLAY_TOKEN`, y quien lo pide es
 * el workflow con `gcloud auth print-access-token --impersonate-service-account`
 * sobre `play-publisher@`, la misma cuenta de servicio cuyo JSON usa `eas
 * submit` desde EAS. El runner entra a Google Cloud por federacion de identidad
 * como `sinchi-deployer`, que tiene `serviceAccountTokenCreator` sobre
 * `play-publisher`. Asi el JSON de la cuenta sigue existiendo en un solo lugar
 * —EAS— y GitHub no guarda nada.
 *
 * Sin dependencias, como el script de iOS: la Play Developer API es REST y
 * `fetch` alcanza.
 *
 * Es idempotente: si la release ya tiene exactamente estas notas no abre ninguna
 * edicion y no escribe. Eso es lo que permite reintentar con `build_id` sin
 * miedo a dejar la ficha a medias.
 *
 * Entorno: PLAY_TOKEN, PLAY_VERSION_CODE, RELEASE_NOTES_PATH, PLAY_PACKAGE
 * (opcional), PLAY_TRACK (opcional), PLAY_LANGUAGE (opcional), DRY_RUN=1 para
 * mirar sin escribir.
 */
import { readFileSync } from 'node:fs';

function required(name) {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`Falta ${name}.`);
  return value;
}

const TOKEN = required('PLAY_TOKEN');
const VERSION_CODE = required('PLAY_VERSION_CODE');
const PACKAGE = process.env.PLAY_PACKAGE ?? 'fit.sinchi.app';
const TRACK = process.env.PLAY_TRACK ?? 'alpha';
/**
 * El unico idioma de la ficha (`edits.listings` devuelve solo `es-419`). Unas
 * notas en un idioma que la ficha no declara las rechaza la API, y unas en el
 * idioma equivocado no las lee nadie.
 */
const LANGUAGE = process.env.PLAY_LANGUAGE ?? 'es-419';
const DRY_RUN = process.env.DRY_RUN === '1';

/** Play corta las notas a 500 caracteres POR IDIOMA y responde 400 si te pasas. */
const LIMIT = 500;

const NOTES = readFileSync(required('RELEASE_NOTES_PATH'), 'utf8').trim();
if (NOTES === '') throw new Error(`${process.env.RELEASE_NOTES_PATH} esta vacio.`);
if (NOTES.length > LIMIT) {
  throw new Error(
    `Las notas miden ${NOTES.length} caracteres y Play acepta ${LIMIT}. ` +
      `Recorta ${process.env.RELEASE_NOTES_PATH}; no es el archivo de TestFlight, que no tiene limite.`,
  );
}

const API = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}`;
const log = (message) => console.log(`[play] ${message}`);

async function play(method, path, body, query) {
  const url = new URL(`${API}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(body === undefined ? { 'Content-Length': '0' } : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const json = text === '' ? null : JSON.parse(text);
  if (!response.ok) {
    const error = json?.error;
    throw Object.assign(
      new Error(`${method} ${path} -> ${response.status} ${error?.message ?? text}`),
      { status: response.status, reason: error?.message ?? '' },
    );
  }
  return json;
}

/**
 * Toda escritura en Play pasa por una «edicion»: se abre, se cambia, se hace
 * commit. Una edicion abierta que no se cierra bloquea las siguientes con
 * «editAlreadyCommitted» horas despues, asi que el borrado va en el `finally`.
 */
async function withEdit(work) {
  const { id } = await play('POST', '/edits');
  log(`edicion ${id}`);
  let committed = false;
  try {
    const commit = await work(id);
    if (commit) committed = true;
    return commit;
  } finally {
    if (!committed) {
      await play('DELETE', `/edits/${id}`).catch((error) =>
        log(`no se pudo borrar la edicion ${id}: ${error.message}`),
      );
    }
  }
}

/**
 * `changesNotSentForReview` es para las apps que todavia no pasaron una
 * revision: Play rechaza el commit y te dice en el mensaje que lo pongas. Se
 * intenta primero SIN el parametro —lo normal, y lo que manda los cambios a
 * revisar— y solo se repite con el si Play lo pide. Al reves dejaria cambios
 * guardados y sin enviar, invisibles para el tester, sin que nadie se enterara.
 */
async function commit(edit) {
  try {
    return await play('POST', `/edits/${edit}:commit`);
  } catch (error) {
    if (!/changesNotSentForReview/i.test(error.reason ?? '')) throw error;
    log('Play pide changesNotSentForReview=true: la app aun no paso una revision');
    return play('POST', `/edits/${edit}:commit`, undefined, { changesNotSentForReview: 'true' });
  }
}

const same = (release) =>
  (release.releaseNotes ?? []).some((note) => note.language === LANGUAGE && note.text === NOTES);

await withEdit(async (edit) => {
  const track = await play('GET', `/edits/${edit}/tracks/${TRACK}`);
  const releases = track.releases ?? [];
  const target = releases.find((release) =>
    (release.versionCodes ?? []).includes(String(VERSION_CODE)),
  );
  if (!target) {
    const donde = releases
      .map((r) => `${r.name ?? '?'} (${(r.versionCodes ?? []).join(',') || 'sin codigos'})`)
      .join('; ');
    throw new Error(
      `La versionCode ${VERSION_CODE} no esta en la pista ${TRACK}. Hay: ${donde || 'nada'}. ` +
        'Este paso corre DESPUES de `eas submit`: si el submit fallo, no hay release que anotar.',
    );
  }

  if (same(target)) {
    log(`la release ${target.name ?? VERSION_CODE} ya tiene estas notas: nada que hacer`);
    return null;
  }

  // PUT y no PATCH: `releases` es un arreglo, y la API lo reemplaza entero en
  // los dos casos. Se manda tal como se leyo, con las notas puestas solo en la
  // release que toca, para no borrar de paso el resto de la pista.
  const notes = [
    ...(target.releaseNotes ?? []).filter((note) => note.language !== LANGUAGE),
    { language: LANGUAGE, text: NOTES },
  ];
  const cuerpo = {
    track: TRACK,
    releases: releases.map((release) =>
      release === target ? { ...release, releaseNotes: notes } : release,
    ),
  };

  if (DRY_RUN) {
    log(`DRY_RUN: dejaria ${NOTES.length} caracteres en ${target.name ?? VERSION_CODE}`);
    console.log(JSON.stringify(cuerpo, null, 2));
    return null;
  }

  await play('PUT', `/edits/${edit}/tracks/${TRACK}`, cuerpo);
  const hecho = await commit(edit);
  log(
    `notas de ${NOTES.length} caracteres en ${TRACK} / ${target.name ?? VERSION_CODE} ` +
      `(${LANGUAGE}), edicion ${hecho?.id ?? edit} cerrada`,
  );
  return hecho ?? true;
});
