/**
 * Rehace las capturas de la ficha de App Store a partir de las de verdad.
 *
 * Las de aquí no son dibujos: cada teléfono es una captura de la app corriendo
 * en el simulador, la misma tanda que usa la landing. Un dibujo de la app no es
 * la app, y en la tienda eso se paga doble — quien instala esperando lo que vio
 * desinstala. La receta de cómo se sacan (datos sembrados, quién entra a cada
 * pantalla, cómo se navega sin poder tocar el simulador) está en
 * `docs/capturas.md`; aquí solo se componen.
 *
 * LAS FUENTES VAN EN JPEG y no en PNG por tamaño: son el original a 1206 px, y
 * en PNG pesaban 4,5 MB. Se muestran reducidas a 1046 (iPhone) y 1000 (iPad),
 * así que siempre se reduce y nunca se amplía: la pérdida no se ve.
 *
 * SE RINDE EN UNA TIRA DE CINCO y se corta después. Arrancar Chrome cuesta
 * cerca de un minuto en esta Mac y dibujar la página no cuesta nada, así que
 * cinco arranques eran cinco minutos por plataforma. Y las fuentes se pre-reducen
 * antes de dárselas: con los PNG de 1,9 MB dentro, Chrome se colgaba sin error
 * ni mensaje, siempre en la misma lámina.
 *
 *   cd store/appstore/fuente && npm i sharp && node generar.mjs
 */
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import sharp from 'sharp';

const DIR = import.meta.dirname;
const OUT = `${DIR}/..`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/** El titular vende; la captura demuestra. El acento sale de la propia pantalla. */
const LAMINAS = [
  { src: 'roster', accent: '#2FD16D',
    head: 'Quién está al día<br>y quién debe',
    sub: 'Tu padrón entero en una pantalla. Sin cuadernos ni hojas de cálculo.' },
  { src: 'qr', accent: '#FFC94D',
    head: 'Su QR cambia cada<br>30 segundos',
    sub: 'Código firmado, imposible de prestar. Funciona aunque no haya internet.' },
  { src: 'corte', accent: '#FF6161',
    head: 'La mora aparece<br>en la puerta',
    sub: 'Cobras en el momento y el acceso se libera solo.' },
  { src: 'plan', accent: '#2FD16D',
    head: 'Dejan de preguntar<br>en mostrador',
    sub: 'Su plan, las sesiones que le quedan esta semana y cuándo vuelve a pagar.' },
  { src: 'billetera', accent: '#FFC94D',
    head: 'Una cuenta para<br>todos sus gimnasios',
    sub: 'Un DNI y un QR que le abren cualquier local de la red Sinchi.' },
];

const FORMATOS = [
  { nombre: 'iphone67', W: 1290, H: 2796, phoneW: 1046 },
  { nombre: 'ipad13', W: 2064, H: 2752, phoneW: 1000 },
];

/**
 * Los cuerpos de letra van en PÍXELES FIJOS, no en fracción del ancho. El lienzo
 * de iPad es 1,6 veces más ancho que el de iPhone y casi igual de alto: con
 * tipografía proporcional al ancho, el titular crecía hasta empujar al subtítulo
 * por debajo del teléfono y lo dejaba medio tapado. El texto mide lo mismo en
 * los dos formatos; lo que cambia es el aire que le sobra a los lados.
 */
function lamina({ accent, head, sub }, { W, H, phoneW }, img) {
  const alto = Math.round((phoneW * 2622) / 1206);
  return `<div class="l" style="width:${W}px;height:${H}px">
    <div class="glow" style="background:
      radial-gradient(120% 50% at 50% -5%, ${accent}33 0%, ${accent}12 40%, transparent 70%),
      radial-gradient(80% 36% at 50% 103%, ${accent}16 0%, transparent 68%)"></div>
    <div class="txt">
      <h1>${head}</h1>
      <p style="max-width:${Math.min(980, W - 160)}px">${sub}</p>
      <div class="rule" style="background:${accent}"></div>
    </div>
    <div class="phone" style="top:${H - alto + 62}px;width:${phoneW}px;height:${alto}px;
      border-radius:${Math.round(phoneW * 0.052)}px"><img src="${img}"></div>
  </div>`;
}

const tira = (formato, imgs) => `<!doctype html><html><head><meta charset="utf-8"><style>
  @font-face{font-family:Archivo;font-weight:600;src:url('${DIR}/archivo-600.woff2')format('woff2')}
  @font-face{font-family:Archivo;font-weight:900;src:url('${DIR}/archivo-900.woff2')format('woff2')}
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#08080A;font-family:Archivo,sans-serif;-webkit-font-smoothing:antialiased}
  .l{position:relative;overflow:hidden;background:#08080A}
  .glow{position:absolute;inset:0}
  .txt{position:absolute;top:150px;left:0;right:0;text-align:center}
  h1{font-weight:900;font-size:94px;line-height:1.06;letter-spacing:-0.025em;color:#F4F1EA}
  p{margin:26px auto 0;font-weight:600;font-size:38px;line-height:1.36;color:#F4F1EAA6}
  .rule{width:92px;height:6px;border-radius:99px;margin:34px auto 0}
  .phone{position:absolute;left:50%;transform:translateX(-50%);overflow:hidden;
    box-shadow:0 26px 80px rgba(0,0,0,.62),0 0 0 1px rgba(255,255,255,.085)}
  .phone img{display:block;width:100%}
</style></head><body>${LAMINAS.map((l, i) => lamina(l, formato, imgs[i])).join('')}</body></html>`;

/** Chrome sin tope se cuelga para siempre; macOS no trae `timeout`. */
function captura(page, out, W, H, segundos = 150) {
  const perfil = `${DIR}/.perfil`;
  rmSync(perfil, { recursive: true, force: true });
  const hijo = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--force-device-scale-factor=1', `--user-data-dir=${perfil}`,
    '--virtual-time-budget=4000', `--window-size=${W},${H}`, `--screenshot=${out}`, `file://${page}`,
  ], { stdio: 'ignore', detached: true });
  const fin = Date.now() + segundos * 1000;
  while (Date.now() < fin) {
    try { process.kill(hijo.pid, 0); } catch { return; }
    execFileSync('sleep', ['1']);
  }
  try { process.kill(-hijo.pid, 'SIGKILL'); } catch { /* ya murió */ }
}

for (const f of FORMATOS) {
  const imgs = [];
  for (const l of LAMINAS) {
    const chico = `${DIR}/.${l.src}-${f.nombre}.png`;
    await sharp(`${DIR}/${l.src}.jpg`).resize({ width: f.phoneW }).png().toFile(chico);
    imgs.push(chico);
  }
  const page = `${DIR}/.tira-${f.nombre}.html`;
  const tiraPng = `${DIR}/.tira-${f.nombre}.png`;
  writeFileSync(page, tira(f, imgs));
  captura(page, tiraPng, f.W, f.H * LAMINAS.length);
  mkdirSync(OUT, { recursive: true });
  for (let i = 0; i < LAMINAS.length; i++) {
    await sharp(tiraPng)
      .extract({ left: 0, top: i * f.H, width: f.W, height: f.H })
      .png().toFile(`${OUT}/${f.nombre}_${i + 1}.png`);
  }
  console.log(`${f.nombre}: ${LAMINAS.length} laminas de ${f.W}x${f.H}`);
}
