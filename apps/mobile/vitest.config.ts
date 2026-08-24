import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // Solo la capa de datos. Las pantallas necesitarian un runtime de React
    // Native; lo que se prueba aqui es el contrato con la api, que es codigo
    // TypeScript plano.
    include: ['src/data/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
