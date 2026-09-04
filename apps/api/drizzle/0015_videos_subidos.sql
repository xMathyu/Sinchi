-- El gimnasio SUBE el video, y no solo pega un enlace.
--
-- El enlace sigue existiendo y no es un plan B: un dojo con canal de YouTube ya
-- tiene su material ahi, y obligarlo a volver a subirlo seria trabajo por nada.
-- Lo que faltaba es el otro caso, que es el normal: el profesor graba con el
-- celular en el tatami y quiere que eso salga en la app sin abrir cuenta en
-- ningun sitio.
--
-- EL ARCHIVO NO PASA POR LA API. Se firma una URL y el telefono sube DIRECTO al
-- bucket. Meter 200 MB de video por un proceso de Cloud Run con 512 MiB de
-- memoria y 30s de timeout es la forma conocida de tumbar la api con una sola
-- subida, y ademas se pagaria el trafico dos veces.
--
-- Y de aqui sale lo que el enlace nunca pudo dar: **el contenido de alumnos pasa
-- a ser exclusivo de verdad**. Un video de YouTube oculto lo ve cualquiera que
-- tenga la direccion; un objeto privado del bucket solo se sirve con una URL
-- firmada que caduca, y la api solo la firma para quien pasa `checkRoutineAccess`.

CREATE TYPE "public"."routine_video_status" AS ENUM('pending', 'ready');--> statement-breakpoint

/**
 * Un archivo de video del gimnasio.
 *
 * La fila nace ANTES que el archivo —se crea para poder firmar la subida— y por
 * eso `pending` existe: sin ese estado no habria forma de distinguir un video
 * que se esta subiendo de uno cuya subida se cayo a la mitad, y la rutina
 * ensenaria un reproductor contra un objeto que no existe.
 */
CREATE TABLE "routine_videos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	-- Ruta dentro del bucket. Se DERIVA del id, nunca del nombre que traia el
	-- archivo: "../../otro-gimnasio/kata.mp4" es un nombre de archivo valido.
	"object_path" text NOT NULL,
	"content_type" text NOT NULL,
	-- Lo dice el almacenamiento al confirmar, no el cliente: el telefono puede
	-- declarar 10 MB y subir 900.
	"size_bytes" integer,
	-- Solo para que el dueno reconozca cual es. No se usa para nada mas.
	"original_name" text,
	"status" "routine_video_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ready_at" timestamp with time zone
);--> statement-breakpoint

ALTER TABLE "routine_videos" ADD CONSTRAINT "routine_videos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE UNIQUE INDEX "routine_videos_object_path_key" ON "routine_videos" USING btree ("object_path");--> statement-breakpoint
CREATE INDEX "routine_videos_tenant_idx" ON "routine_videos" USING btree ("tenant_id");--> statement-breakpoint

ALTER TABLE "routine_videos" ADD CONSTRAINT "routine_videos_size_non_negative" CHECK (size_bytes IS NULL OR size_bytes >= 0);--> statement-breakpoint
-- Un video listo tiene fecha de listo, y uno pendiente no la tiene. Sin esto,
-- "listo" acaba significando lo que cada consulta quiera.
ALTER TABLE "routine_videos" ADD CONSTRAINT "routine_videos_ready_has_date" CHECK ((status = 'ready') = (ready_at IS NOT NULL));--> statement-breakpoint

ALTER TABLE "routines" ADD COLUMN "video_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "routine_items" ADD COLUMN "video_asset_id" uuid;--> statement-breakpoint

-- `set null` y no `restrict`: borrar un video subido es un acto deliberado del
-- dueno —lo reemplazo— y que la rutina se quede sin video es mejor que un error
-- de clave foranea en mitad de una edicion.
ALTER TABLE "routines" ADD CONSTRAINT "routines_video_asset_id_routine_videos_id_fk" FOREIGN KEY ("video_asset_id") REFERENCES "public"."routine_videos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routine_items" ADD CONSTRAINT "routine_items_video_asset_id_routine_videos_id_fk" FOREIGN KEY ("video_asset_id") REFERENCES "public"."routine_videos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- O enlace, o archivo, o nada: NUNCA los dos.
--
-- Con los dos puestos hay dos videos para un mismo paso y quien lee decide cual
-- gana; el dia que la app y el panel decidan distinto, el alumno y el dueno
-- estan mirando cosas distintas.
ALTER TABLE "routines" ADD CONSTRAINT "routines_one_video_source" CHECK (NOT (video_url IS NOT NULL AND video_asset_id IS NOT NULL));--> statement-breakpoint
ALTER TABLE "routine_items" ADD CONSTRAINT "routine_items_one_video_source" CHECK (NOT (video_url IS NOT NULL AND video_asset_id IS NOT NULL));--> statement-breakpoint

ALTER TABLE "routine_videos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "routine_videos" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "routine_videos_tenant_isolation" ON "routine_videos"
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sinchi_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "routine_videos" TO sinchi_app;
  END IF;
END $$;
