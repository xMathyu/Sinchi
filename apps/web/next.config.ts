import type { NextConfig } from 'next';

/**
 * La landing es estatica: no tiene datos, ni sesion, ni formularios que envien
 * nada. `output: 'export'` lo hace explicito — cualquier hosting de archivos la
 * sirve, y si algun dia alguien anade un endpoint, el build falla en vez de
 * arrastrar un servidor sin querer.
 */
const nextConfig: NextConfig = {
  output: 'export',
  images: { unoptimized: true },
  typedRoutes: true,
};

export default nextConfig;
