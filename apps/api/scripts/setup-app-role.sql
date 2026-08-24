-- Rol con el que se conecta la api.
--
-- POR QUÉ EXISTE. En Neon, el rol que viene por defecto (`neondb_owner`) tiene
-- `BYPASSRLS = true`. Eso significa que las políticas RLS de la migración 0001
-- —incluido `FORCE ROW LEVEL SECURITY`— **no se le aplican**. Conectando la api
-- con ese rol, todo el aislamiento por tenant queda inerte: funciona el filtro
-- del repositorio y nada más.
--
-- Se comprueba así:
--   select rolsuper, rolbypassrls from pg_roles where rolname = current_user;
--
-- Así que hay dos roles, con dos trabajos distintos:
--
--   neondb_owner  dueño del esquema. Corre las migraciones. Nunca sirve tráfico.
--   sinchi_app    la api. Sin BYPASSRLS, sin ser dueño de nada: sujeto a RLS.
--
-- Es la diferencia entre tener aislamiento y creer que se tiene.
--
-- Cómo aplicarlo (una vez por base, como neondb_owner):
--   psql "$DATABASE_URL_OWNER" -v app_password="'una-clave-larga'" -f scripts/setup-app-role.sql
--
-- O desde la consola SQL de Neon, reemplazando :app_password a mano.

BEGIN;

-- `nobypassrls` es lo único no negociable de esta línea.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sinchi_app') THEN
    EXECUTE format('CREATE ROLE sinchi_app LOGIN PASSWORD %L NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE', :'app_password');
  ELSE
    EXECUTE format('ALTER ROLE sinchi_app PASSWORD %L', :'app_password');
    ALTER ROLE sinchi_app NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO sinchi_app;

-- Datos: todo lo que la api necesita, nada más. Sin DDL: cambiar el esquema es
-- trabajo de las migraciones, no de una petición HTTP.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sinchi_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sinchi_app;

-- Que las tablas futuras también queden cubiertas: si no, la próxima migración
-- crea una tabla que la api no puede leer y el error aparece en producción.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sinchi_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO sinchi_app;

COMMIT;

-- Verificación. `rolbypassrls` tiene que salir en `f`.
SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole
  FROM pg_roles
 WHERE rolname IN ('sinchi_app', current_user)
 ORDER BY rolname;
