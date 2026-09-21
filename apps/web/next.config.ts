import type { NextConfig } from 'next';

/**
 * La landing nacio estatica (`output: 'export'`) y dejo de serlo al entrar el
 * panel del dueno. Conviene decir por que, porque el comentario anterior pedia
 * explicitamente que nadie arrastrara un servidor sin querer.
 *
 * El panel necesita sesion, y la sesion se guarda en una cookie `httpOnly`: el
 * JWT de Sinchi abre la caja del gimnasio entero, asi que no puede quedar al
 * alcance de `document.cookie`. Una cookie `httpOnly` no la puede leer el
 * navegador — y tampoco la puede MANDAR a Cloud Run, que esta en otro dominio.
 * De ahi sale toda la forma del panel: quien habla con la api es el servidor de
 * Next, leyendo la cookie; los Server Components pintan ya con los datos y las
 * mutaciones van por Server Actions. En el navegador no hay cliente de api, ni
 * token, ni CORS que abrir.
 *
 * Lo que NO se pierde: la landing sigue siendo estatica. Sus paginas no leen
 * cookies ni cabeceras, asi que el App Router las prerenderiza en el build y
 * Vercel las sirve desde el CDN igual que antes. Lo que cambia es que ahora,
 * ademas, hay rutas que corren en el servidor — y eso es deliberado, no un
 * descuido: esta escrito en `docs/decisiones.md` §18.
 */
const nextConfig: NextConfig = {
  images: { unoptimized: true },
  typedRoutes: true,
  // Next 16 escribe un AGENTS.md y un CLAUDE.md propios en cada arranque. Las
  // convenciones de este repo estan en el CLAUDE.md de la raiz, y un archivo
  // generado que las contradice a mitad de arbol es peor que no tener ninguno.
  agentRules: false,
};

export default nextConfig;
