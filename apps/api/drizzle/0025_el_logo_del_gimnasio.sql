-- El gimnasio tiene logo, si quiere.
--
-- Hasta aqui un dojo era su nombre en letras: en la billetera del alumno, en el
-- directorio, en la puerta. El dueno que ya tiene una marca —el escudo del club,
-- el letrero del local— no tenia donde ponerla, y la tarjeta de su gimnasio se
-- veia igual que la del de al lado.
--
-- OPCIONAL, y eso es una decision y no un descuido: el profesor que arranca con
-- doce alumnos no tiene logo y no tiene por que tenerlo. Sin logo se ven las
-- iniciales, igual que un alumno sin foto.
--
-- LA IMAGEN VA EN LA BASE Y NO EN EL BUCKET de los videos (0015). Tres razones:
--
--   · el bucket es opcional y en produccion todavia no existe. Colgar el logo de
--     el era soltar una funcion que en produccion responde «no configurado»;
--   · un logo es PUBLICO —sale en el directorio a quien no tiene cuenta— y un
--     video de alumnos es privado y se sirve firmado. No comparten nada de lo
--     que hizo falta resolver para el video;
--   · pesa poco. A 512 pixeles por lado (`GYM_LOGO_MAX_SIDE`) son decenas de KB:
--     mil gimnasios con logo son decenas de megas.
--
-- Tabla aparte y no una columna `bytea` en `tenants`: esa tabla se lee entera en
-- muchos sitios, y cada una de esas lecturas arrastraria la imagen.

CREATE TABLE "gym_logos" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "content_type" text NOT NULL,
  "bytes" bytea NOT NULL,
  -- Leidas de la cabecera de la imagen por la api, no declaradas por el cliente.
  "width" smallint NOT NULL,
  "height" smallint NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

-- Uno por gimnasio. Cambiarlo es borrar el viejo y guardar el nuevo con OTRO id:
-- el id va en la direccion de la imagen, asi que una direccion no cambia nunca de
-- contenido y el telefono la puede guardar en cache para siempre.
CREATE UNIQUE INDEX "gym_logos_tenant_key" ON "gym_logos" USING btree ("tenant_id");--> statement-breakpoint

-- Los mismos topes que `checkGymLogo`, repetidos aqui por lo de siempre: lo que
-- la base rechaza no depende de que cada ruta se acuerde de preguntar.
--
-- El de pixeles es el que importa. Un PNG de un solo color comprime a casi nada y
-- al abrirlo ocupa gigas: uno asi en el directorio cerraria la app de quien lo
-- mire, y el tope de bytes lo dejaria pasar.
ALTER TABLE "gym_logos" ADD CONSTRAINT "gym_logos_content_type_valid"
  CHECK (content_type IN ('image/png', 'image/jpeg'));--> statement-breakpoint
ALTER TABLE "gym_logos" ADD CONSTRAINT "gym_logos_size_valid"
  CHECK (octet_length(bytes) BETWEEN 1 AND 1048576);--> statement-breakpoint
ALTER TABLE "gym_logos" ADD CONSTRAINT "gym_logos_dimensions_valid"
  CHECK (width BETWEEN 1 AND 512 AND height BETWEEN 1 AND 512);--> statement-breakpoint

-- El puntero vive en `tenants`, que es donde se lee todo lo demas del gimnasio:
-- la billetera, el directorio y la puerta ya traen esa fila, y el logo viaja con
-- ella sin una consulta mas.
--
-- `set null` y no `restrict`: quitar el logo es un acto deliberado del dueno, y
-- lo que tiene que pasar es que el gimnasio vuelva a sus iniciales, no un error.
ALTER TABLE "tenants" ADD COLUMN "logo_id" uuid;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_logo_id_gym_logos_id_fk"
  FOREIGN KEY ("logo_id") REFERENCES "public"."gym_logos"("id") ON DELETE SET NULL ON UPDATE NO ACTION;--> statement-breakpoint

-- Dos gimnasios no comparten un logo. Ademas es por donde se busca al servir la
-- imagen: la direccion trae el id del logo y de ahi se sabe de que local es.
CREATE UNIQUE INDEX "tenants_logo_id_key" ON "tenants" USING btree ("logo_id")
  WHERE logo_id IS NOT NULL;--> statement-breakpoint

ALTER TABLE "gym_logos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gym_logos" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Aislamiento por tenant como cualquier otra tabla del gimnasio, aunque la imagen
-- sea publica. Lo publico es VERLA, y para eso la api busca el gimnasio en
-- `tenants` y entra con su contexto; escribirla es solo del dueno de ese local.
CREATE POLICY "gym_logos_tenant_isolation" ON "gym_logos"
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sinchi_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "gym_logos" TO sinchi_app;
  END IF;
END $$;
