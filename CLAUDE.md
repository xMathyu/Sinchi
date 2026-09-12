# Sinchi

Plataforma de gestión para gimnasios y escuelas de artes marciales. Monorepo de
npm: `packages/shared` (dominio puro), `packages/ui` (design system),
`apps/api` (NestJS + Drizzle + Postgres), `apps/mobile` (Expo), `apps/web`
(Next.js, la landing).

## Idioma

**El producto se habla en español y el código se escribe en inglés.**
Identificadores y nombres de archivo en inglés; comentarios y textos de interfaz
en español. Nunca los dos idiomas dentro del mismo nombre.

La tabla de traducción del dominio está en [`docs/glosario.md`](docs/glosario.md)
y es la autoridad: antes de inventar un nombre para algo del negocio, buscarlo
ahí. Si ves algo en español en el código, tradúcelo.

Tres cosas **no** se traducen, y no es un descuido:

- **RUC** — es el nombre del documento peruano, como DNI o IBAN. Traducirlo lo
  vuelve irreconocible para quien lo teclea;
- **los nombres de `apps/api/drizzle/*.sql`** — Drizzle las aplica por nombre y
  lleva registro de cuáles corrió. Renombrar una migración ya aplicada la vuelve
  a aplicar sobre una base que ya la tiene;
- **`/eliminar-cuenta` y `/privacidad` de `apps/web`** — son URLs públicas, y la
  primera está declarada en Google Play como el camino para darse de baja.
  Cambiarlas rompe una promesa legal por una cuestión de estilo. La ruta
  equivalente de la app, que es interna, sí va en inglés.

Para un renombrado grande, **nunca `sed`**: la prosa de este repo está en
español y un `\bnombre\b → name` la destroza. Se hace con renombrado de símbolos
de TypeScript (`findRenameLocations`), que solo toca código.

## Comentarios

Son la mitad del valor de este repo y tienen una forma: **explican POR QUÉ, no
qué hace la línea de abajo**. Lo que merece un comentario es la decisión —qué se
descartó y a cambio de qué—, el caso real que la provocó y la trampa que ya se
pisó una vez. Un comentario que repite el código en prosa sobra.

Los comentarios citan la especificación por número (`MD 4.3`, `MD 8.1`). Está en
[`docs/especificacion.md`](docs/especificacion.md). Las decisiones tomadas y sus
porqués viven en [`docs/decisiones.md`](docs/decisiones.md).

## Cómo se entrega

Commit y push directo a `main`, sin rama y sin PR: Mathyu es el único
desarrollador. Un commit por idea, con un mensaje que cuente el porqué igual que
los comentarios — el historial es donde se busca cuando algo no se entiende.

`ci.yml` corre en cada push a `main` y levanta un Postgres de verdad. **Correr
las pruebas de punta a punta en local antes de empujar**: cada ida y vuelta al
CI son varios minutos y estas tardan quince segundos.

## Comandos

```bash
nvm use                       # Node 24.8.0 (.nvmrc)
npm ci
npm run build                 # compila shared y ui: la app los consume COMPILADOS
npm run typecheck             # los cuatro workspaces
npm test                      # sin base: se saltan los e2e
```

Después de tocar `packages/shared` o `packages/ui`, `npm run build` antes de
recargar la app o correr la api: se consumen desde `dist/`, no como fuente.

Las pruebas de punta a punta necesitan un Postgres con un rol **sin BYPASSRLS**,
o el aislamiento por tenant no se prueba. Receta completa en
[`docs/api.md`](docs/api.md):

```bash
docker run -d --name sinchi-pg -e POSTGRES_PASSWORD=postgres -p 55432:5432 postgres:17
docker exec -i sinchi-pg psql -U postgres -c "create role sinchi_app login password 'app_local' nosuperuser nobypassrls"
docker exec -i sinchi-pg psql -U postgres -c "create database sinchi_test owner sinchi_app"

cd apps/api
DATABASE_URL="postgresql://sinchi_app:app_local@localhost:55432/sinchi_test" \
MIGRATION_DATABASE_URL="postgresql://sinchi_app:app_local@localhost:55432/sinchi_test" \
  npm run db:migrate
TEST_DATABASE_URL="postgresql://sinchi_app:app_local@localhost:55432/sinchi_test" npm test
```

No hay `lint` configurado en ningún workspace: el `npm run lint` de la raíz no
hace nada. La red de seguridad son el typecheck y las pruebas.

## Reglas del dominio

Las reglas de negocio —prorrateo, cupos, mora, validación de la puerta, borrador
de un plan o de un horario— viven en `packages/shared` como **funciones puras**,
y las corren los dos lados: la app para no ofrecer lo que va a fallar, la api
para no confiar en que la app lo hizo. Escribir una regla dos veces es cómo se
llega a que la app y el servidor digan cosas distintas del mismo hecho.

Devuelven el **motivo** y no un booleano (`checkPlanDraft`, `validateCheckIn`,
`validateTrialBooking`): «no se pudo» deja al interesado sin saber qué corregir,
y es lo que permite apagar un botón por la misma razón exacta por la que el POST
respondería 400.

La api es la autoridad final y consume `packages/shared` tal cual: no
reimplementa ninguna regla.

## Lo que no se toca sin pensarlo dos veces

- **Migraciones ya aplicadas.** Se añade una nueva; no se edita una vieja.
  Se escriben a mano (el meta de Drizzle está desincronizado desde `0001`) y se
  registran en `drizzle/meta/_journal.json`.
- **`apps/*/.env`.** No están versionados y no son secretos: lo que llevan viaja
  dentro del binario publicado. Están fuera del repo porque el escáner de
  GitHub marca cualquier `AIza…` y un aviso que siempre es falso entrena a
  ignorar los avisos. Documentar cada variable nueva en `.env.example`.
- **El aislamiento por tenant.** El repositorio filtra por `tenant_id` y además
  lo fuerzan las políticas RLS. Cualquier consulta nueva pasa por uno de los
  `with*` de `apps/api/src/db/client.ts` —`withTenant`, `withUser`,
  `withoutTenantIsolation` y los de invitación, dispositivo y clase gratis—,
  nunca por el pool pelado. Cada uno abre la transacción con el contexto que esa
  política espera; sin contexto no se ve ninguna fila, que es fallar cerrado.
