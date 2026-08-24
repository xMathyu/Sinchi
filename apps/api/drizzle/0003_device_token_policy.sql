-- Corrige cómo se resuelve el equipo del mostrador a partir de su token.
--
-- QUÉ ESTABA MAL. La migración 0002 usaba una función `SECURITY DEFINER` para
-- que la búsqueda por token viera la fila a pesar de RLS. Pero
-- `SECURITY DEFINER` corre con los privilegios del DUEÑO de la función, y el
-- dueño es quien aplica la migración:
--
--   · en Neon las migraciones van con `neondb_owner`, que tiene BYPASSRLS, así
--     que la función veía la fila — pero solo por esa propiedad;
--   · en cualquier base donde el dueño NO tenga BYPASSRLS (el Postgres local de
--     pruebas, por ejemplo) la función queda sujeta a RLS igual y devuelve cero
--     filas. Abrir turno falla con "este equipo no está registrado".
--
-- O sea: el mecanismo dependía en silencio de un privilegio del rol, y encima
-- del privilegio que este diseño intenta NO necesitar. Se comportaba distinto en
-- producción y en pruebas, que es la peor forma de estar mal.
--
-- CÓMO QUEDA. Con el mismo patrón que ya usan `memberships` y `staff`: una
-- excepción acotada en la propia política, expresada como "puedes leer la fila
-- cuyo secreto tienes en la mano".
--
--   app.device_token_hash   hash del token que presentó el equipo
--
-- Es una comparación de columna, sin subconsultas, indexada, y se comporta igual
-- con cualquier rol. El contexto lo fija `withContext()` por transacción.

CREATE OR REPLACE FUNCTION app_device_token_hash() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.device_token_hash', true), '')
$$;--> statement-breakpoint

DROP POLICY IF EXISTS "checkin_devices_tenant_isolation" ON "checkin_devices";--> statement-breakpoint

CREATE POLICY "checkin_devices_tenant_or_token" ON "checkin_devices"
  USING (tenant_id = app_current_tenant() OR token_hash = app_device_token_hash())
  WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint

-- La función de 0002 ya no se usa. Se borra para que nadie la encuentre y crea
-- que es el camino bueno.
DROP FUNCTION IF EXISTS app_device_by_token(text);
