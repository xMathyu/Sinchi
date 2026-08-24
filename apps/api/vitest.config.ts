import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.test.ts'],
    // El e2e levanta la api completa contra Postgres: no compite bien con los
    // demas archivos en paralelo, y el orden importa dentro de el.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
  plugins: [
    // Nest resuelve sus dependencias leyendo `design:paramtypes`, que solo
    // existe con `emitDecoratorMetadata`. esbuild —el transformador por defecto
    // de vitest— no la emite, asi que las inyecciones llegan como `undefined`.
    // swc si la emite.
    swc.vite({ module: { type: 'es6' } }),
  ],
});
