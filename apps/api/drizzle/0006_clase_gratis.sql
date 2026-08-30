-- La clase gratis: la unica puerta de Sinchi que abre desde afuera.
--
-- Hasta aqui, para entrar a un gimnasio habia que estar ya dentro: el staff daba
-- de alta la ficha, o mandaba una invitacion. Las dos empiezan en el mostrador.
-- Un alumno que descubre la escuela POR LA APP no tenia forma de decirle nada al
-- gimnasio, y el gimnasio no tenia forma de enterarse de que existia.
--
-- Esta tabla es ese primer contacto, y por eso su forma es distinta al resto:
--
--  · `user_id` es OPCIONAL. Quien reserva todavia no es alumno de nadie y muchas
--    veces todavia no es nadie en Sinchi — es una cuenta de Google recien creada
--    sin ficha en ningun padron. Exigirle una identidad global significaria
--    pedirle el DNI para mirar un horario, y ahi se acaba el alta.
--  · `full_name` y `phone` viajan en la fila. Es lo unico que el gimnasio
--    necesita para atender a alguien que dijo que vendria el martes.
--  · el nombre y la hora de la clase van COPIADOS, no resueltos por
--    `class_schedule_id`. El gimnasio puede reordenar su horario entre la
--    reserva y el dia, y la lista del mostrador tiene que seguir diciendo lo que
--    se le prometio a la persona.
--
-- Lo que NO es: una asistencia. Marcar en la puerta exige suscripcion viva, y
-- justamente no la hay. Cuando la persona se inscribe, entra por el alta normal
-- y esta fila queda como el rastro de por donde llego.

-- El gimnasio decide si la ofrece. Por defecto si: un local que aparece en el
-- directorio y no deja probar desperdicia la visita.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "trial_class_enabled" boolean NOT NULL DEFAULT true;--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE "public"."trial_booking_status" AS ENUM('booked', 'attended', 'no_show', 'canceled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "trial_bookings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  -- Se conserva la reserva aunque el gimnasio borre el bloque de horario: la
  -- persona sigue existiendo y el mostrador sigue necesitando saber que viene.
  "class_schedule_id" uuid REFERENCES "class_schedules"("id") ON DELETE SET NULL,
  "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  -- La cuenta de Firebase de quien todavia no tiene ficha. Es lo unico que la
  -- identifica entre una sesion y la siguiente.
  "firebase_uid" text,
  "full_name" text NOT NULL,
  "phone" text NOT NULL,
  "email" text,
  "class_name" text NOT NULL,
  "local_date" date NOT NULL,
  "start_time" text NOT NULL,
  "end_time" text NOT NULL,
  "status" "trial_booking_status" DEFAULT 'booked' NOT NULL,
  -- Cuando se le aviso al gimnasio. Sin esto no hay forma de saber si el correo
  -- salio, y "no me avisaron" es la queja que hunde la funcion.
  "notified_at" timestamptz,
  "canceled_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  -- Sin una de las dos, la reserva no pertenece a nadie: ni el gimnasio puede
  -- reconocer a quien viene ni la persona puede volver a verla.
  CONSTRAINT "trial_bookings_has_account"
    CHECK (user_id IS NOT NULL OR firebase_uid IS NOT NULL),
  CONSTRAINT "trial_bookings_time_format" CHECK (
    start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    AND end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    AND end_time > start_time
  ),
  -- Misma forma que `subscriptions_canceled_has_date`: el estado y su fecha no
  -- pueden discrepar.
  CONSTRAINT "trial_bookings_canceled_has_date"
    CHECK ((status = 'canceled') = (canceled_at IS NOT NULL)),
  CONSTRAINT "trial_bookings_email_lowercase"
    CHECK (email IS NULL OR email = lower(email))
);--> statement-breakpoint

-- UNA clase gratis por persona y por gimnasio. Es la regla del producto, y va en
-- la base y no solo en el servicio: reservar dos veces desde dos telefonos a la
-- vez es exactamente la carrera que un `select` previo no atrapa.
--
-- Por celular y no por cuenta: la misma persona puede volver con otra cuenta de
-- Google en un minuto, y el celular es la llave con la que el alumno se
-- reconoce en el resto del sistema (`users_phone_key`).
--
-- Parcial sobre las vigentes: cancelar libera el cupo. Quien aviso que no puede
-- ir merece poder reservar otro dia, y conservar la fila cancelada es lo que
-- permite ver que paso.
CREATE UNIQUE INDEX IF NOT EXISTS "trial_bookings_one_per_phone"
  ON "trial_bookings" ("tenant_id", "phone")
  WHERE status <> 'canceled';--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "trial_bookings_one_per_user"
  ON "trial_bookings" ("tenant_id", "user_id")
  WHERE user_id IS NOT NULL AND status <> 'canceled';--> statement-breakpoint

-- La consulta del mostrador: "quien viene esta semana", ordenado por dia.
CREATE INDEX IF NOT EXISTS "trial_bookings_tenant_date_idx"
  ON "trial_bookings" ("tenant_id", "local_date");--> statement-breakpoint

-- La de la app de quien todavia no tiene ficha: sus reservas en toda la red.
CREATE INDEX IF NOT EXISTS "trial_bookings_account_idx"
  ON "trial_bookings" ("firebase_uid")
  WHERE firebase_uid IS NOT NULL;--> statement-breakpoint

ALTER TABLE "trial_bookings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "trial_bookings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Cuarta puerta del mismo patron que ya usan el token de equipo y el de
-- invitacion: quien presenta algo cuyo secreto controla puede ver exactamente
-- las filas que le corresponden. Aqui lo que se presenta es un ID token de
-- Firebase ya verificado, y lo que abre son sus propias reservas — que es lo
-- unico que tiene alguien sin gimnasio todavia.
CREATE OR REPLACE FUNCTION app_trial_account() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.trial_account', true), '')
$$;--> statement-breakpoint

CREATE POLICY "trial_bookings_tenant_user_or_account" ON "trial_bookings"
  USING (
    tenant_id = app_current_tenant()
    OR user_id = app_current_user()
    OR (firebase_uid IS NOT NULL AND firebase_uid = app_trial_account())
  )
  -- Escribir sigue exigiendo gimnasio: la reserva nace dentro de uno, y el
  -- servicio lo adopta despues de resolver el slug.
  WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint

-- El rol de la api no existe en toda base: las pruebas de esquema migran contra
-- una base limpia donde solo esta el superusuario. Mismo resguardo que 0002.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sinchi_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "trial_bookings" TO sinchi_app;
  END IF;
END $$;
