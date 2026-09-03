-- Los planes los escribe el dueno, y uno de ellos se cobra por clase.
--
-- Hasta aqui los planes solo nacian de un script nuestro (`db:seed:kaizen`). Eso
-- servia para los tres primeros clientes y dejo de servir el dia que un gimnasio
-- se puede dar de alta solo: nace SIN NINGUN PLAN, y sin plan no se puede
-- inscribir a nadie, porque el alta exige `plan_id`. El local que se registro un
-- martes no podia usar el producto hasta que alguien de aqui le sembrara la
-- tarifa a mano.
--
-- `drop_in` es un tipo de plan, no un cuarto sabor del mismo helado:
--
--   · no genera deuda —`computeReceivable` corta antes de mirar el calendario—
--     y de ahi cae solo que no se le pueda suspender por mora;
--   · no tiene cupo semanal: lo que limita cuanto entrena es su bolsillo;
--   · `price_cents` deja de ser el precio del MES y pasa a ser el de UNA CLASE.
--
-- No se confunde con `tenants.drop_in_price_cents`, que sigue donde estaba y
-- significa otra cosa: aquel es lo que paga el alumno de un plan MENSUAL cuando
-- agota su cupo semanal, y este es el plan entero de quien nunca tuvo cupo.

-- El valor se AGREGA al enum en vez de recrearlo: recrear el tipo obliga a
-- soltar y rehacer `plans.type`, y eso es una migracion que puede fallar a la
-- mitad sobre datos reales.
ALTER TYPE "public"."plan_type" ADD VALUE IF NOT EXISTS 'drop_in';--> statement-breakpoint

-- El tipo de plan y sus parametros tienen que concordar. Se rehace por dos
-- motivos:
--
--  1. la version anterior no contemplaba `drop_in`, y un `CASE` sin rama que
--     coincida devuelve NULL — que en un CHECK PASA. El tipo nuevo se colaba sin
--     validar nada. El `ELSE false` cierra esa puerta para el siguiente tipo que
--     alguien agregue;
--
--  2. compara `type::text` y no el enum. El migrador de drizzle corre TODAS las
--     migraciones pendientes en UNA transaccion, y Postgres prohibe usar un
--     valor de enum recien agregado en la misma. Con el cast, el literal
--     'drop_in' de aqui abajo es texto y no toca el tipo nuevo, asi que esta
--     migracion se aplica junto a la de arriba sin partirse en dos archivos.
ALTER TABLE "plans" DROP CONSTRAINT IF EXISTS "plans_type_consistent";--> statement-breakpoint

ALTER TABLE "plans" ADD CONSTRAINT "plans_type_consistent" CHECK (
  CASE type::text
    WHEN 'unlimited'         THEN sessions_per_week IS NULL
    WHEN 'sessions_per_week' THEN sessions_per_week IS NOT NULL
                                  AND sessions_per_week BETWEEN 1 AND 7
    WHEN 'fixed_days'        THEN sessions_per_week IS NULL
                                  AND allowed_days IS NOT NULL
    -- La clase suelta no lleva sesiones semanales: `weeklyLimit` devuelve null
    -- a proposito. Los dias SI puede llevarlos — hay dojos que solo la ofrecen
    -- sabados y domingos.
    WHEN 'drop_in'           THEN sessions_per_week IS NULL
    ELSE false
  END
);--> statement-breakpoint

-- Dos planes activos con el mismo nombre en el mismo local no son una tarifa
-- mas: son la misma leida dos veces. El dueno los escribe desde el telefono, y
-- un toque doble en "Guardar" es como aparece el duplicado; despues el
-- mostrador elige uno de los dos al azar en el alta de un alumno.
--
-- Solo entre los ACTIVOS: archivar "Ilimitado" para escribir otro "Ilimitado"
-- con precio nuevo es exactamente lo que hay que poder hacer cuando suben los
-- precios, y el viejo tiene que quedarse para que las suscripciones que lo
-- apuntan sigan significando algo.
CREATE UNIQUE INDEX IF NOT EXISTS "plans_active_name_per_tenant"
  ON "plans" (tenant_id, lower(name)) WHERE active;
