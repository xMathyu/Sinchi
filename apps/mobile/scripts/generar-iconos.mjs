/**
 * Genera los iconos de la app desde la geometría de la marca.
 *
 * No se dibujan a mano en un editor: las rutas viven en `packages/ui/src/brand.ts`
 * y son las mismas que renderiza el componente `Logo` dentro de la app. Así el
 * icono no puede desincronizarse del logo — que es justo lo que pasa cuando un
 * PNG suelto se queda con una versión vieja del símbolo.
 *
 * Se rasteriza a mano en vez de traer un motor de SVG porque la marca son dos
 * formas: un polígono de cuatro puntos y un rectángulo. Meter una dependencia
 * nativa (sharp, canvas) para eso es desproporcionado, y las nativas son
 * exactamente las que rompen la instalación en la máquina de otro.
 *
 *   node scripts/generar-iconos.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(AQUI, '..', 'assets');

// --- la marca, copiada de packages/ui/src/brand.ts -------------------------
// Se replica en vez de importarse porque este script corre con node suelto,
// antes de que el workspace esté compilado. Si cambian allí, cambian aquí: hay
// una prueba que lo comprueba.
const LOGO_PUNTOS = [
  [50, 8],
  [88, 92],
  [50, 71],
  [12, 92],
];
const BARRA = { x0: 31, x1: 69, y: 51, grosor: 11 };

const FONDO = [0x0e, 0x0e, 0x11];
const TINTA = [0xf4, 0xf1, 0xea];

/** Supermuestreo: se dibuja a 4x y se promedia. Sin esto los bordes son escalera. */
const MUESTRAS = 4;

function dentroDelPoligano(px, py, puntos) {
  let dentro = false;
  for (let i = 0, j = puntos.length - 1; i < puntos.length; j = i++) {
    const [xi, yi] = puntos[i];
    const [xj, yj] = puntos[j];
    const cruza = yi > py !== yj > py;
    if (cruza && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

const dentroDeLaBarra = (px, py) =>
  px >= BARRA.x0 &&
  px <= BARRA.x1 &&
  py >= BARRA.y - BARRA.grosor / 2 &&
  py <= BARRA.y + BARRA.grosor / 2;

/**
 * Caja real del glifo dentro del viewBox de 100.
 *
 * Se mide en vez de asumir 0..100: el símbolo ocupa 76x84 de ese cuadro, así que
 * escalar por el viewBox dejaba el logo un 20% más pequeño de lo pedido y con
 * aire desigual arriba y abajo. Lo que hay que encajar es el dibujo, no el
 * lienzo en el que está descrito.
 */
const CAJA = (() => {
  const xs = LOGO_PUNTOS.map((p) => p[0]);
  const ys = LOGO_PUNTOS.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  return { x0, y0, ancho: Math.max(...xs) - x0, alto: Math.max(...ys) - y0 };
})();

/**
 * Dibuja el icono.
 *
 * `escala` es qué fracción del lienzo ocupa el **glifo**. iOS recorta las
 * esquinas con su propia máscara, así que 0.62 deja aire suficiente; Android
 * recorta más —la zona segura del icono adaptativo es el 66% central— y por eso
 * su primer plano se genera bastante menor.
 *
 * `LEVANTE` sube el dibujo un pelo. El chevron es pesado abajo —la base es lo
 * ancho— así que centrado geométricamente se *ve* bajo. Es la corrección óptica
 * de siempre: el ojo centra la masa, no la caja.
 */
const LEVANTE = 0.022;

function dibujar(lado, escala, conFondo) {
  const png = new PNG({ width: lado, height: lado });
  // Se encaja por el lado mayor del glifo para que nunca se salga.
  const unidad = (lado * escala) / Math.max(CAJA.ancho, CAJA.alto);
  const offX = (lado - CAJA.ancho * unidad) / 2 - CAJA.x0 * unidad;
  const offY = (lado - CAJA.alto * unidad) / 2 - CAJA.y0 * unidad - lado * LEVANTE;

  for (let y = 0; y < lado; y++) {
    for (let x = 0; x < lado; x++) {
      let tinta = 0;
      let cubierto = 0;

      for (let sy = 0; sy < MUESTRAS; sy++) {
        for (let sx = 0; sx < MUESTRAS; sx++) {
          const px = (x + (sx + 0.5) / MUESTRAS - offX) / unidad;
          const py = (y + (sy + 0.5) / MUESTRAS - offY) / unidad;

          if (!dentroDelPoligano(px, py, LOGO_PUNTOS)) continue;
          cubierto++;
          // La barra va en color de fondo: es una muesca que atraviesa el
          // chevron, no una línea encima.
          if (!dentroDeLaBarra(px, py)) tinta++;
        }
      }

      const total = MUESTRAS * MUESTRAS;
      const i = (lado * y + x) << 2;
      const a = tinta / total;
      const c = cubierto / total;

      if (conFondo) {
        // Mezcla sobre el fondo opaco. La parte cubierta-pero-no-tinta es la
        // muesca, que también es fondo, así que se resuelve sola.
        png.data[i] = Math.round(FONDO[0] + (TINTA[0] - FONDO[0]) * a);
        png.data[i + 1] = Math.round(FONDO[1] + (TINTA[1] - FONDO[1]) * a);
        png.data[i + 2] = Math.round(FONDO[2] + (TINTA[2] - FONDO[2]) * a);
        png.data[i + 3] = 255;
      } else {
        // Primer plano transparente para el icono adaptativo de Android: el
        // sistema pone el fondo. La muesca tiene que ser TRANSPARENTE, no
        // negra, o se vería un rectángulo oscuro sobre el color de fondo.
        png.data[i] = TINTA[0];
        png.data[i + 1] = TINTA[1];
        png.data[i + 2] = TINTA[2];
        png.data[i + 3] = Math.round(255 * a);
      }
      void c;
    }
  }
  // Sin canal alfa cuando el icono es opaco: la App Store **rechaza** iconos con
  // transparencia, y un PNG RGBA lo tiene aunque todos los pixeles esten al 100%.
  // El adaptativo de Android si lo necesita, porque el sistema pinta detras.
  return PNG.sync.write(png, conFondo ? { colorType: 2 } : { colorType: 6 });
}

mkdirSync(ASSETS, { recursive: true });

const salidas = [
  // iOS y tiendas: 1024 y sin transparencia — App Store rechaza el alfa.
  ['icon.png', 1024, 0.62, true],
  // Android: primer plano transparente, más pequeño por la zona segura del 66%.
  ['adaptive-icon.png', 1024, 0.44, false],
  // Pantalla de arranque: el mismo símbolo, con aire.
  ['splash-icon.png', 512, 0.52, true],
  ['favicon.png', 64, 0.66, true],
];

for (const [nombre, lado, escala, conFondo] of salidas) {
  writeFileSync(join(ASSETS, nombre), dibujar(lado, escala, conFondo));
  console.log(`  ${nombre.padEnd(20)} ${lado}x${lado}  glifo al ${Math.round(escala * 100)}%`);
}
