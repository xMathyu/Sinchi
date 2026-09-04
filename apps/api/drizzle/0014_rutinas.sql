-- Rutinas y tecnicas: lo que el gimnasio ENSENA, y quien puede verlo.
--
-- Hasta aqui un gimnasio en Sinchi era un padron, un cobro y una puerta. Todo lo
-- que vendia pasaba por que la persona ESTUVIERA ahi. Esto es lo primero que
-- vale sin que nadie cruce el umbral: el "dia de pecho" con sus videos, el
-- uchimata explicado paso a paso, el calentamiento de hombro.
--
-- LA DECISION ESTA EN `visibility`, Y VA POR RUTINA. Es literalmente lo que se
-- pidio, y es lo correcto: la misma escuela necesita las dos cosas a la vez. Una
-- rutina publica es un anuncio —la ve cualquiera desde la ficha del directorio,
-- sin cuenta, y es lo que hace que alguien elija ESTE dojo— y una de alumnos es
-- media razon para seguir pagando la mensualidad. Un gimnasio que solo pudiera
-- publicar hacia fuera regala su trabajo; uno que solo pudiera guardarlo no lo
-- usa nunca para traer gente.
--
-- El valor por defecto es `members` a proposito: de los dos errores posibles,
-- publicar sin querer hacia todo internet es el que no se puede deshacer —el
-- enlace ya salio— y guardarse algo de mas se arregla con un toque.
--
-- SINCHI NO ALOJA VIDEO EN LA VERSION 1: guarda un enlace (`video_url`). Es
-- costo, no pereza. El gimnasio ya graba con el celular y sube a YouTube; hacerlo
-- nosotros significa transcodificar, CDN y una factura por GB que crece con lo
-- que el local publique y que el del plan gratis no financia. La consecuencia
-- hay que decirla: un enlace no es un secreto. Lo que la api garantiza es que
-- NUNCA entrega la direccion a quien no tiene acceso; que un alumno la reparta a
-- mano es el mismo riesgo que grabar la clase con el celular.

CREATE TYPE "public"."routine_visibility" AS ENUM('public', 'members');--> statement-breakpoint

-- Sin `canceled`, a diferencia de `gym_event_status`: un seminario se CAE y hay
-- gente con plaza a la que avisar; una rutina simplemente deja de ofrecerse, y
-- para eso basta despublicarla.
CREATE TYPE "public"."routine_status" AS ENUM('draft', 'published');--> statement-breakpoint

CREATE TYPE "public"."routine_level" AS ENUM('beginner', 'intermediate', 'advanced');--> statement-breakpoint

CREATE TABLE "routines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"video_url" text,
	"level" "routine_level",
	"visibility" "routine_visibility" DEFAULT 'members' NOT NULL,
	"status" "routine_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

-- Un paso de la rutina: el ejercicio del dia de pecho, la entrada del uchimata.
--
-- `tenant_id` esta aunque se pudiera deducir por `routine_id`, y es deliberado:
-- la politica RLS de esta tabla tiene que poder decidir SIN join. Una politica
-- que necesita mirar otra tabla es una politica que alguien desactiva el dia que
-- estorbe.
CREATE TABLE "routine_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"routine_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"title" text NOT NULL,
	"instructions" text,
	"video_url" text,
	-- "4 series de 12", "5 minutos de uchikomi". Texto libre a proposito: series
	-- y repeticiones no significan nada en judo, y modelar solo el gimnasio de
	-- pesas dejaria al dojo rellenando casillas vacias.
	"prescription" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "routines" ADD CONSTRAINT "routines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routine_items" ADD CONSTRAINT "routine_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- `cascade`: borrar la rutina se lleva sus pasos. No hay nada que conservar —un
-- ejercicio suelto sin la rutina que lo explica no le sirve a nadie— al reves de
-- lo que pasa con las plazas de un evento, que son la lista de a quien avisar.
ALTER TABLE "routine_items" ADD CONSTRAINT "routine_items_routine_id_routines_id_fk" FOREIGN KEY ("routine_id") REFERENCES "public"."routines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "routines_tenant_status_idx" ON "routines" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "routine_items_routine_idx" ON "routine_items" USING btree ("routine_id");--> statement-breakpoint

-- El orden es un dato, no una sugerencia: un calentamiento despues del trabajo
-- fuerte es otra rutina. Sin este indice, dos pasos con la misma posicion salen
-- en el orden que Postgres quiera y la lista cambia sola entre dos aperturas.
CREATE UNIQUE INDEX "routine_items_position_per_routine" ON "routine_items" USING btree ("routine_id","position");--> statement-breakpoint

-- Los CHECK van con `IS NULL OR` en todo lo nulable. No es ceremonia: en esta
-- misma base ya se colaron dos CHECK que pasaban con NULL —una comparacion con
-- NULL da NULL, y NULL en un CHECK PASA— y los encontraron los tests de esquema,
-- no la lectura del codigo.
ALTER TABLE "routines" ADD CONSTRAINT "routines_title_not_blank" CHECK (length(btrim(title)) >= 3);--> statement-breakpoint
ALTER TABLE "routines" ADD CONSTRAINT "routines_video_url_not_blank" CHECK (video_url IS NULL OR length(btrim(video_url)) > 0);--> statement-breakpoint
ALTER TABLE "routine_items" ADD CONSTRAINT "routine_items_title_not_blank" CHECK (length(btrim(title)) >= 2);--> statement-breakpoint
ALTER TABLE "routine_items" ADD CONSTRAINT "routine_items_position_non_negative" CHECK ("position" >= 0);--> statement-breakpoint
ALTER TABLE "routine_items" ADD CONSTRAINT "routine_items_video_url_not_blank" CHECK (video_url IS NULL OR length(btrim(video_url)) > 0);--> statement-breakpoint

ALTER TABLE "routines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "routines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "routine_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "routine_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Aislamiento por gimnasio y nada mas, al contrario que `event_registrations`,
-- que necesito abrir puertas por identidad y por cuenta de Firebase.
--
-- Aqui no hacen falta: quien lee una rutina desde la calle no tiene sesion de
-- este gimnasio, pero la api resuelve el slug primero y ADOPTA el tenant antes
-- de consultar, igual que hace con los eventos publicados. Quien decide que
-- puede ver es `checkRoutineAccess`, en el dominio, y la fila nunca sale de su
-- gimnasio.
CREATE POLICY "routines_tenant_isolation" ON "routines"
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint

CREATE POLICY "routine_items_tenant_isolation" ON "routine_items"
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint

-- El rol de la api no existe en toda base: las pruebas de esquema migran contra
-- una base limpia donde solo esta el superusuario. Mismo resguardo que 0002.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sinchi_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "routines" TO sinchi_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "routine_items" TO sinchi_app;
  END IF;
END $$;
