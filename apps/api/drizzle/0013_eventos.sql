-- Eventos con fecha: el seminario, el taller, la clase del invitado.
--
-- Es lo tercero que un gimnasio vende, y hasta ahora no se podia ni escribir. No
-- es un `class_schedules` —eso es el horario semanal, y se repite— ni un `plans`
-- —eso es una suscripcion—. Es una clase suelta con fecha, cupo y dos precios.
--
-- LOS DOS PRECIOS SON EL PUNTO. Un seminario con alguien conocido se llena con
-- gente que TODAVIA no entrena aqui, y cobrarle lo mismo que al alumno de casa
-- es regalar el unico dia del ano en que entra gente nueva por la puerta. Por
-- eso el evento sale en el directorio y lo reserva cualquiera, como la clase
-- gratis.
--
-- La consecuencia que ordena el resto: la plaza de alguien de fuera es plata del
-- gimnasio que NO tiene membresia detras. O se le inventa una ficha en el padron
-- —que seria mentira, viene a una clase, no se inscribe— o el ledger admite un
-- cargo sin alumno. Se hace lo segundo, acotado por CHECK al unico tipo que lo
-- necesita.

CREATE TYPE "public"."gym_event_status" AS ENUM('draft', 'published', 'canceled');--> statement-breakpoint

-- Mismos valores que `trial_booking_status` y tipo propio a proposito: son dos
-- ciclos que se parecen hoy y no tienen por que seguir pareciendose. Compartir
-- el enum ata el dia que uno de los dos necesite un estado mas.
CREATE TYPE "public"."event_registration_status" AS ENUM('booked', 'attended', 'no_show', 'canceled');--> statement-breakpoint

ALTER TYPE "public"."charge_type" ADD VALUE IF NOT EXISTS 'event';--> statement-breakpoint

CREATE TABLE "gym_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"instructor" text,
	"local_date" date NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"capacity" smallint,
	"member_price_cents" integer NOT NULL,
	"guest_price_cents" integer NOT NULL,
	"status" "gym_event_status" DEFAULT 'draft' NOT NULL,
	"canceled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE "event_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"membership_id" uuid,
	"user_id" uuid,
	"firebase_uid" text,
	"full_name" text NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"price_cents" integer NOT NULL,
	"status" "event_registration_status" DEFAULT 'booked' NOT NULL,
	"charge_id" uuid,
	"canceled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "gym_events" ADD CONSTRAINT "gym_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_event_id_gym_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."gym_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- `set null` y no `cascade`: dar de baja a un alumno del padron no puede borrarlo
-- de la lista del seminario que ya pago.
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_charge_id_charges_id_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."charges"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- "Lo que viene" del directorio y del mostrador barren por aqui.
CREATE INDEX "gym_events_tenant_date_idx" ON "gym_events" USING btree ("tenant_id","local_date");--> statement-breakpoint

-- UNA plaza por persona y evento, contada por celular. Va en la base y no solo
-- en el servicio: reservar dos veces desde dos pestanas a la vez es justo la
-- carrera que un `select` previo no atrapa, y con cupo de por medio esa carrera
-- vende una plaza que no existe.
CREATE UNIQUE INDEX "event_registrations_one_per_phone" ON "event_registrations" USING btree ("event_id","phone") WHERE status <> 'canceled';--> statement-breakpoint

-- Solo por celular no basta: la misma cuenta escribiendo otro numero se lleva
-- una segunda plaza, y en un evento con cupo esa es una plaza que otro se queda
-- sin comprar. Las tres llaves con las que se puede reconocer a una persona
-- valen una plaza cada una.
CREATE UNIQUE INDEX "event_registrations_one_per_user" ON "event_registrations" USING btree ("event_id","user_id") WHERE user_id is not null and status <> 'canceled';--> statement-breakpoint
CREATE UNIQUE INDEX "event_registrations_one_per_account" ON "event_registrations" USING btree ("event_id","firebase_uid") WHERE firebase_uid is not null and status <> 'canceled';--> statement-breakpoint
CREATE INDEX "event_registrations_event_idx" ON "event_registrations" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "event_registrations_tenant_idx" ON "event_registrations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "event_registrations_membership_idx" ON "event_registrations" USING btree ("membership_id") WHERE membership_id is not null;--> statement-breakpoint

ALTER TABLE "gym_events" ADD CONSTRAINT "gym_events_prices_non_negative" CHECK (member_price_cents >= 0 AND guest_price_cents >= 0);--> statement-breakpoint
ALTER TABLE "gym_events" ADD CONSTRAINT "gym_events_capacity_positive" CHECK (capacity IS NULL OR capacity > 0);--> statement-breakpoint
-- Un evento de 19:00 a 18:00 pasa desapercibido y despues nadie entiende por que
-- no sale en "lo que viene".
ALTER TABLE "gym_events" ADD CONSTRAINT "gym_events_ends_after_start" CHECK (end_time > start_time);--> statement-breakpoint
ALTER TABLE "gym_events" ADD CONSTRAINT "gym_events_canceled_has_date" CHECK ((status = 'canceled') = (canceled_at IS NOT NULL));--> statement-breakpoint
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_price_non_negative" CHECK (price_cents >= 0);--> statement-breakpoint
ALTER TABLE "event_registrations" ADD CONSTRAINT "event_registrations_canceled_has_date" CHECK ((status = 'canceled') = (canceled_at IS NOT NULL));--> statement-breakpoint

-- El ledger admite a quien no es alumno, y SOLO para esto.
--
-- Compara `type::text` y no el enum: drizzle corre todas las migraciones
-- pendientes en UNA transaccion, y Postgres prohibe usar ahi un valor de enum
-- recien agregado — que es justo lo que hace 'event' seis lineas mas arriba.
ALTER TABLE "charges" ALTER COLUMN "membership_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_membership_unless_event" CHECK (
  membership_id IS NOT NULL OR type::text = 'event'
);--> statement-breakpoint

ALTER TABLE "gym_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gym_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "event_registrations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "event_registrations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "gym_events_tenant_isolation" ON "gym_events"
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint

-- Misma puerta que las reservas de clase gratis: quien presenta un ID token de
-- Firebase ya verificado ve SUS plazas, que es lo unico que tiene alguien que
-- todavia no entrena en ningun sitio. Escribir sigue exigiendo gimnasio: la
-- reserva nace dentro de uno y el servicio lo adopta tras resolver el slug.
CREATE POLICY "event_registrations_tenant_user_or_account" ON "event_registrations"
  USING (
    tenant_id = app_current_tenant()
    OR user_id = app_current_user()
    OR (firebase_uid IS NOT NULL AND firebase_uid = app_trial_account())
  )
  WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint

-- El rol de la api no existe en toda base: las pruebas de esquema migran contra
-- una base limpia donde solo esta el superusuario. Mismo resguardo que 0002.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sinchi_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "gym_events" TO sinchi_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "event_registrations" TO sinchi_app;
  END IF;
END $$;
