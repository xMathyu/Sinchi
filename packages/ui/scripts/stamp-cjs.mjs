// El package.json raiz declara "type": "module"; el bundle CJS necesita
// su propio marcador para que Node no interprete sus .js como ESM.
import { writeFileSync, mkdirSync } from 'node:fs';

mkdirSync(new URL('../dist/cjs/', import.meta.url), { recursive: true });
writeFileSync(
  new URL('../dist/cjs/package.json', import.meta.url),
  `${JSON.stringify({ type: 'commonjs' }, null, 2)}\n`,
);
