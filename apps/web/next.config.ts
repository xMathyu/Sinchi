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
  // Next 16 escribe un AGENTS.md y un CLAUDE.md propios en cada arranque. Las
  // convenciones de este repo estan en el CLAUDE.md de la raiz, y un archivo
  // generado que las contradice a mitad de arbol es peor que no tener ninguno.
  agentRules: false,
};

export default nextConfig;
