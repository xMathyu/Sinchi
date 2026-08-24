-- Autenticación con Google vía Firebase.
--
-- EL PROBLEMA QUE RESUELVE. El padrón se crea ANTES de que el alumno abra la
-- app: la recepcionista escribe nombre, DNI y celular en el mostrador. Eso es
-- deliberado, porque el sistema tiene que atender al alumno sin celular.
--
-- Google Sign-In devuelve `{ uid, email, name }`. Nada de eso está en la fila
-- que escribió la recepcionista: el celular no viene en el token, el email es
-- opcional y probablemente nadie lo pidió, y el nombre no es único. Así que en
-- el primer login hay una cuenta verificada y ninguna forma de saber a qué ficha
-- del padrón corresponde.
--
-- No se resuelve pidiéndole el DNI al alumno: el DNI peruano son 8 dígitos
-- semipúblicos que aparecen en cualquier formulario. Quien lo sepa reclamaría la
-- membresía de otro, con su historial de pagos y su QR, y eso desarma el control
-- de acceso completo.
--
-- Se resuelve con la verificación de identidad más fuerte que hay y que además
-- es gratis: la recepcionista tiene al alumno enfrente. El alumno entra con
-- Google, su app muestra un código de 6 dígitos, y recepción lo escribe junto a
-- su nombre. Eso es `account_claims`.

-- ---------------------------------------------------------------------------
-- 1. Vínculo con la cuenta de Google
-- ---------------------------------------------------------------------------

ALTER TABLE "users" ADD COLUMN "firebase_uid" text;--> statement-breakpoint

-- Parcial: la mayoría de las fichas del padrón no tienen cuenta vinculada
-- todavía, y `NULL` no debe chocar con `NULL`.
CREATE UNIQUE INDEX "users_firebase_uid_key" ON "users" USING btree ("firebase_uid")
  WHERE firebase_uid IS NOT NULL;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Códigos de vinculación
-- ---------------------------------------------------------------------------
--
-- Sin `tenant_id` a propósito: un código se emite ANTES de saber a qué gimnasio
-- pertenece la persona — eso es justamente lo que la recepcionista va a resolver.
-- Por eso tampoco lleva RLS.
--
-- La protección no está en esta tabla, está del otro lado: confirmar un código
-- exige una sesión de staff y una `membership_id`, y las membresías SÍ están
-- aisladas por RLS. Un recepcionista solo puede vincular contra su propio
-- padrón.

CREATE TABLE "account_claims" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "firebase_uid" text NOT NULL,
  "email" text,
  "display_name" text,
  -- 6 dígitos. Corto porque se dicta en voz alta en el mostrador.
  "code" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "consumed_by" uuid,
  "linked_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "account_claims" ADD CONSTRAINT "account_claims_consumed_by_fk"
  FOREIGN KEY ("consumed_by") REFERENCES "staff"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "account_claims" ADD CONSTRAINT "account_claims_linked_user_fk"
  FOREIGN KEY ("linked_user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint

-- Seis dígitos, siempre.
ALTER TABLE "account_claims" ADD CONSTRAINT "account_claims_code_format"
  CHECK (code ~ '^\d{6}$');--> statement-breakpoint

-- Consumido significa consumido: las tres columnas van juntas o ninguna.
ALTER TABLE "account_claims" ADD CONSTRAINT "account_claims_consumed_complete"
  CHECK ((consumed_at IS NULL) = (linked_user_id IS NULL));--> statement-breakpoint

-- Un código activo no puede repetirse. Los ya consumidos sí, porque el espacio
-- es de un millón y se reciclan; lo que importa es que en un momento dado no
-- haya dos vivos iguales.
CREATE UNIQUE INDEX "account_claims_active_code" ON "account_claims" USING btree ("code")
  WHERE consumed_at IS NULL;--> statement-breakpoint

CREATE INDEX "account_claims_firebase_uid_idx" ON "account_claims" USING btree ("firebase_uid");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. PIN del staff
-- ---------------------------------------------------------------------------
--
-- El equipo del mostrador es compartido y los turnos rotan. Cerrar y abrir
-- sesión de Google en cada cambio termina en "dejemos la de Ana abierta", que es
-- justo el agujero que la auditoría intenta cerrar: `attendance.recorded_by` y
-- `charges.recorded_by` dejarían de decir la verdad.
--
-- Así que el equipo queda registrado (`checkin_devices`) y cada persona abre su
-- turno con un PIN. El cobro y el marcado manual siguen quedando a nombre de
-- quien lo hizo.
--
-- Se guarda un HASH con scrypt, nunca el PIN. Son 4-6 dígitos: un hash rápido
-- se rompe por fuerza bruta en segundos, y el intento se limita en la aplicación.

ALTER TABLE "staff" ADD COLUMN "pin_hash" text;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "pin_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "pin_failed_attempts" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "pin_locked_until" timestamp with time zone;--> statement-breakpoint

ALTER TABLE "staff" ADD CONSTRAINT "staff_pin_complete"
  CHECK ((pin_hash IS NULL) = (pin_updated_at IS NULL));--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. Token del dispositivo del mostrador
-- ---------------------------------------------------------------------------
--
-- El equipo se autentica con un secreto de portador, no con un JWT: revocarlo
-- tiene que ser inmediato —una tablet que se pierde en el gimnasio— y borrar una
-- fila es inmediato, mientras que un JWT vive hasta que expira.

ALTER TABLE "checkin_devices" ADD COLUMN "token_hash" text;--> statement-breakpoint
ALTER TABLE "checkin_devices" ADD COLUMN "token_issued_at" timestamp with time zone;--> statement-breakpoint

CREATE UNIQUE INDEX "checkin_devices_token_hash_key" ON "checkin_devices" USING btree ("token_hash")
  WHERE token_hash IS NOT NULL;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5. Búsqueda del equipo por su token
-- ---------------------------------------------------------------------------
--
-- Al abrir turno todavía no se sabe el gimnasio: se descubre a partir del token
-- del equipo. Pero `checkin_devices` tiene RLS forzado, así que una consulta sin
-- contexto de tenant no devuelve nada — falla cerrado, que es lo correcto en
-- general y un problema justo aquí.
--
-- Se resuelve con una función `SECURITY DEFINER`, que corre con los privilegios
-- de su dueño y por tanto ve la fila. Es la herramienta idiomática de Postgres
-- para exactamente esto: un único salto acotado del aislamiento.
--
-- Por qué es seguro y no un agujero:
--   · recibe un hash de 32 bytes de entropía, imposible de adivinar;
--   · devuelve solo el id y el gimnasio, ningún otro dato del equipo;
--   · `search_path` fijado para que nadie pueda plantar una tabla homónima;
--   · solo la puede ejecutar el rol de la api.
--
-- La alternativa era ensanchar la política RLS con otra variable de sesión, y
-- eso deja la puerta abierta para todas las consultas, no para una.

CREATE OR REPLACE FUNCTION app_device_by_token(p_token_hash text)
RETURNS TABLE (device_id uuid, tenant_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT d.id, d.tenant_id
    FROM checkin_devices d
   WHERE d.token_hash = p_token_hash
     AND d.active
   LIMIT 1
$$;--> statement-breakpoint

-- `public` no debe poder llamarla; solo el rol de la api.
REVOKE ALL ON FUNCTION app_device_by_token(text) FROM PUBLIC;--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sinchi_app') THEN
    GRANT EXECUTE ON FUNCTION app_device_by_token(text) TO sinchi_app;
  END IF;
END
$$;
