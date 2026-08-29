/**
 * Compila los paquetes del monorepo que la landing consume, antes de compilar
 * la landing.
 *
 * `@sinchi/ui` se resuelve por su `dist`, y ese `dist` solo existe si alguien
 * corrió el build del paquete. En este portátil siempre estaba —el repo entero
 * se compila— así que el problema no se veía hasta que un hosting clonó el repo
 * en limpio y falló con «module not found: @sinchi/ui».
 *
 * Consumirlo desde su código fuente sería más limpio y no se puede: el paquete
 * escribe sus imports internos con extensión `.js` —lo exige Node para ESM— y
 * Turbopack no reescribe `.js` a `.ts`. Comprobado con un archivo de prueba
 * dentro de la propia app, no solo con el paquete.
 *
 * Lo importante es que esto NO necesita el workspace de npm de la raíz: usa el
 * TypeScript que ya instala pnpm aquí. Así `pnpm build` se basta solo desde un
 * clon recién hecho, en cualquier hosting y sin comandos a medida.
 *
 * `@sinchi/shared` va primero porque `@sinchi/ui` importa un tipo suyo
 * (`AccessLevel`). Es solo un tipo —se borra al compilar— pero para compilar
 * hay que poder leerlo.
 */
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const WEB = join(AQUI, '..');
const PAQUETES = join(WEB, '..', '..', 'packages');

const tsc = join(WEB, 'node_modules', '.bin', 'tsc');
const compilar = (config) => execFileSync(tsc, ['-p', config], { cwd: WEB, stdio: 'inherit' });

/**
 * El marcador de CommonJS.
 *
 * El package.json de cada paquete declara `"type": "module"`: sin esto, Node
 * leería los .js del bundle CommonJS como ESM.
 */
const marcarCjs = (paquete) =>
  execFileSync(process.execPath, [join(PAQUETES, paquete, 'scripts', 'stamp-cjs.mjs')], {
    stdio: 'inherit',
  });

// `shared` con sus propias configuraciones: es autónomo y no importa a nadie.
compilar(join(PAQUETES, 'shared', 'tsconfig.build.json'));
compilar(join(PAQUETES, 'shared', 'tsconfig.build.cjs.json'));
marcarCjs('shared');

// `ui` con configuraciones de aquí, que solo añaden de dónde sale `@sinchi/shared`:
// resolverlo por node_modules exigiría el `npm install` de la raíz, que es justo
// lo que este script existe para no necesitar.
compilar('tsconfig.ui.json');
compilar('tsconfig.ui.cjs.json');
marcarCjs('ui');

console.log('  @sinchi/shared y @sinchi/ui compilados');
