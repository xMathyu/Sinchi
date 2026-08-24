# Imagen de la api.
#
# Se construye desde la RAÍZ del monorepo, no desde apps/api:
#   docker build -f apps/api/Dockerfile -t sinchi-api .
#
# La api depende de `@sinchi/shared`, que es un paquete del workspace y hay que
# compilar. Copiar solo apps/api daría un `Cannot find module '@sinchi/shared'`
# en el arranque, que es el error clásico de contenerizar un monorepo.

# ---------------------------------------------------------------------------
# 1. Dependencias
# ---------------------------------------------------------------------------
# Se copian solo los manifiestos antes del código fuente: mientras las
# dependencias no cambien, Docker reusa esta capa y `npm ci` no vuelve a correr.
# Es la diferencia entre un build de 20 segundos y uno de dos minutos.
FROM node:24-alpine AS deps
WORKDIR /repo

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
COPY apps/api/package.json apps/api/

# `--ignore-scripts` evita que los postinstall de las dependencias de la app
# móvil (que no hacen falta aquí) corran en el contenedor.
RUN npm ci --workspace @sinchi/api --include-workspace-root --ignore-scripts

# ---------------------------------------------------------------------------
# 2. Compilación
# ---------------------------------------------------------------------------
FROM deps AS build
WORKDIR /repo

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api

# El orden importa: la api importa los tipos compilados de shared.
RUN npm run build --workspace @sinchi/shared \
 && npm run build --workspace @sinchi/api

# Se rehacen las dependencias sin las de desarrollo. `nest`, `typescript`,
# `vitest` y `drizzle-kit` no tienen nada que hacer en la imagen final.
RUN npm ci --workspace @sinchi/api --include-workspace-root --omit=dev --ignore-scripts

# ---------------------------------------------------------------------------
# 3. Imagen final
# ---------------------------------------------------------------------------
FROM node:24-alpine AS runtime
WORKDIR /repo

ENV NODE_ENV=production
# Cloud Run inyecta PORT; el valor por defecto solo aplica si se corre a mano.
ENV PORT=8080

# `dumb-init` como PID 1: sin él, node no recibe la señal SIGTERM que Cloud Run
# manda al apagar la instancia, y el pool de Postgres no se cierra limpio —
# quedan conexiones colgando contra Neon hasta que expiran.
RUN apk add --no-cache dumb-init

COPY --from=build /repo/node_modules node_modules
COPY --from=build /repo/package.json package.json
COPY --from=build /repo/packages/shared/package.json packages/shared/package.json
COPY --from=build /repo/packages/shared/dist packages/shared/dist
COPY --from=build /repo/apps/api/package.json apps/api/package.json
COPY --from=build /repo/apps/api/dist apps/api/dist
# Las migraciones viajan con la imagen: así se pueden aplicar desde el mismo
# artefacto que está desplegado, sin depender de una copia del repo.
COPY --from=build /repo/apps/api/drizzle apps/api/drizzle

# Usuario sin privilegios. `node` ya existe en la imagen base con uid 1000.
USER node

WORKDIR /repo/apps/api
EXPOSE 8080

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
