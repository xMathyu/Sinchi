-- El panel de Sinchi ve, corrige, banea y elimina a PERSONAS (decisiones §25).
--
-- Tres cambios, y los tres existen porque borrar una cuenta como promete la
-- política publicada (sinchi.fit/eliminar-cuenta) no era posible con el esquema
-- que había:
--
--   account_bans                 quién no puede usar Sinchi, y por qué.
--   charges.anonymized_at        el asiento que se queda cuando la persona se va.
--   account_deletion_requests    la prueba de que se cumplió, que se borraba
--                                junto con lo que prueba.

-- ---------------------------------------------------------------------------
-- 1. El baneo
-- ---------------------------------------------------------------------------

-- Tabla propia y no una columna en `users`, porque hay que poder banear a quien
-- NO tiene fila ahí: la cuenta de Google que entró a la app sin estar en ningún
-- padrón (`account_claims`) es justo la que reserva clases falsas y le escribe a
-- los gimnasios desde el directorio.
--
-- Tres llaves y basta una. `user_id` para la ficha; `firebase_uid` para la
-- cuenta con la que entra; `email` para la cuenta de Google detrás. El correo
-- está porque borrar el usuario de Firebase —que la política promete— hace que
-- esa misma cuenta de Google vuelva con un uid NUEVO: con solo el uid, eliminar
-- la cuenta de alguien baneado sería la forma de quitarse el baneo.
--
-- Se levanta, no se borra: un baneo levantado es historia que alguien va a
-- preguntar («¿esta persona ya estuvo baneada?»).
CREATE TABLE IF NOT EXISTS "account_bans" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  -- `set null`: eliminar la cuenta de alguien baneado no puede levantarle el
  -- baneo. Se queda con el uid y el correo, que es lo que lo reconoce si vuelve.
  "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "firebase_uid" text,
  "email" text,
  "reason" text NOT NULL,
  "banned_by" uuid NOT NULL REFERENCES "platform_admins"("id") ON DELETE RESTRICT,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "lifted_at" timestamp with time zone,
  "lifted_by" uuid REFERENCES "platform_admins"("id") ON DELETE RESTRICT
);--> statement-breakpoint

ALTER TABLE "account_bans" ADD CONSTRAINT "account_bans_names_someone" CHECK (
  user_id IS NOT NULL OR firebase_uid IS NOT NULL OR email IS NOT NULL
);--> statement-breakpoint

-- Levantado con fecha y con quién, o ninguna de las dos. Un baneo levantado sin
-- saber quién lo levantó es el primer sitio donde se mira cuando algo se repite.
ALTER TABLE "account_bans" ADD CONSTRAINT "account_bans_lifted_by_someone" CHECK (
  (lifted_at IS NULL) = (lifted_by IS NULL)
);--> statement-breakpoint

-- El correo en minúsculas, igual que en `platform_admins`: se compara contra el
-- del token de Google, que ya llega normalizado (`FirebaseVerifier`).
ALTER TABLE "account_bans" ADD CONSTRAINT "account_bans_email_normalized" CHECK (
  email IS NULL OR email = lower(email)
);--> statement-breakpoint

-- Uno vivo por ficha: banear dos veces a la misma persona dejaría dos motivos y
-- levantar uno la dejaría baneada igual, sin que nadie entienda por qué.
CREATE UNIQUE INDEX IF NOT EXISTS "account_bans_one_live_per_user"
  ON "account_bans" ("user_id") WHERE lifted_at IS NULL AND user_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "account_bans_one_live_per_account"
  ON "account_bans" ("firebase_uid") WHERE lifted_at IS NULL AND firebase_uid IS NOT NULL;--> statement-breakpoint

-- Lo que la api carga para decidir. Pequeño a propósito: los vivos, nada más.
CREATE INDEX IF NOT EXISTS "account_bans_live_idx"
  ON "account_bans" ("created_at") WHERE lifted_at IS NULL;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. El asiento que se queda
-- ---------------------------------------------------------------------------

-- La política publicada promete que al borrar una cuenta se van la ficha, el
-- historial y todo lo que identifica, y se quedan los pagos «sin decir de
-- quién»: un gimnasio tiene que poder cuadrar su caja y responder ante la SUNAT
-- por lo que facturó.
--
-- El esquema no lo permitía, por dos lados. `charges.membership_id` es CASCADE
-- —borrar la ficha se llevaba la caja entera— y `charges_membership_unless_walk_in`
-- exige ficha en toda mensualidad y matrícula. La cascada se esquiva en el
-- código, soltando la ficha ANTES de borrarla. El CHECK se relaja aquí, y solo
-- para el cobro que se anonimizó con fecha: una mensualidad sin ficha sigue
-- siendo un error en cualquier otro caso, que es lo que el CHECK vigilaba.
ALTER TABLE "charges" ADD COLUMN IF NOT EXISTS "anonymized_at" timestamp with time zone;--> statement-breakpoint

ALTER TABLE "charges" DROP CONSTRAINT IF EXISTS "charges_membership_unless_walk_in";--> statement-breakpoint

ALTER TABLE "charges" ADD CONSTRAINT "charges_membership_unless_walk_in" CHECK (
  membership_id IS NOT NULL
  OR (type)::text = ANY (ARRAY['event'::text, 'drop_in'::text])
  OR anonymized_at IS NOT NULL
);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. La prueba de que se cumplió
-- ---------------------------------------------------------------------------

-- La 0016 guardó `resolved_at` para «poder demostrar que se cumplió el plazo si
-- alguien reclama» y, a la vez, colgó la fila de `users` con CASCADE: ejecutar
-- la baja borraba la prueba de haberla ejecutado. Ahora la fila sobrevive, sin
-- a quién apuntar — la fecha de la solicitud y la del borrado es lo que hay que
-- poder enseñar, y no dice de quién era.
ALTER TABLE "account_deletion_requests" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint

ALTER TABLE "account_deletion_requests"
  DROP CONSTRAINT IF EXISTS "account_deletion_requests_user_id_users_id_fk";--> statement-breakpoint

ALTER TABLE "account_deletion_requests"
  ADD CONSTRAINT "account_deletion_requests_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;
