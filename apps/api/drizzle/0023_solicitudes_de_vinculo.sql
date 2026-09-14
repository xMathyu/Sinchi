-- El gimnasio ya no vincula una cuenta con un codigo: le PIDE a la persona que
-- la acepte.
--
-- Hasta aqui, quien se registraba en la app sin ficha en ningun padron recibia
-- un codigo de 6 digitos que tenia que dictar en el mostrador, y recepcion lo
-- confirmaba contra su padron. Tenia dos problemas. El primero, que era una
-- pared para quien todavia no entrena en ningun sitio. El segundo aparecio al
-- mirarlo de cerca: inscribir por DNI a alguien que YA tenia cuenta metia el
-- gimnasio en su app sin preguntarle, y cualquier local que conociera un DNI
-- podia hacerlo con quien quisiera.
--
-- Ahora el gimnasio inscribe como siempre —la ficha, el plan y el cobro no
-- esperan a nadie— y deja una solicitud. La persona la ve en su app y la acepta
-- o la rechaza; hasta que acepta, ese gimnasio no aparece en su billetera.
--
-- A quien va la solicitud:
--
--   firebase_uid   la cuenta del QR que se escaneo en el mostrador, o la que la
--                  identidad ya tenia. Solo esa cuenta puede contestarla.
--   (nulo)         la cuenta que entre con el celular o el correo de la ficha.
--                  Se leen de `users` y no se copian aqui: si recepcion corrige
--                  el celular, la solicitud lo sigue.
--
-- El celular que se da al registrarse no se verifica, asi que alguien que
-- escriba el de otra persona podria aceptar una solicitud que no es suya. Lo
-- acotan dos cosas: el gimnasio ve que cuenta contesto
-- (`decided_by_firebase_uid`) y el dueno puede desvincular. Es una decision de
-- producto, contada en decisiones §14.

DO $$ BEGIN
  CREATE TYPE "public"."link_request_status" AS ENUM('pending', 'accepted', 'rejected', 'canceled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "link_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "membership_id" uuid NOT NULL REFERENCES "memberships"("id") ON DELETE CASCADE,
  -- La identidad de la ficha. Con ella se ve la solicitud desde la billetera de
  -- quien ya tiene cuenta, y se lee el celular y el correo de quien no.
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "firebase_uid" text,
  "status" "link_request_status" DEFAULT 'pending' NOT NULL,
  "created_by" uuid REFERENCES "staff"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "decided_at" timestamp with time zone,
  "decided_by_firebase_uid" text
);--> statement-breakpoint

-- Una pendiente por ficha: inscribir dos veces no le manda dos avisos a nadie.
-- Las contestadas se conservan todas, son el rastro de quien acepto que.
CREATE UNIQUE INDEX IF NOT EXISTS "link_requests_one_pending"
  ON "link_requests" ("membership_id") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "link_requests_user_idx" ON "link_requests" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "link_requests_account_idx" ON "link_requests" ("firebase_uid");--> statement-breakpoint

ALTER TABLE "link_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "link_requests" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Leer y contestar: el gimnasio en su padron, la persona en lo suyo.
--
-- «Lo suyo» tiene las dos caras de siempre. Con ficha, `app_current_user()`; sin
-- ficha, la cuenta de Firebase que presento (`app_trial_account()`, la misma
-- puerta que abren las reservas y el chat — ver la nota de la 0020 sobre su
-- nombre). La billetera tambien lee por aqui: es lo que le dice que ficha
-- esperan una respuesta.
CREATE POLICY "link_requests_read" ON "link_requests" FOR SELECT
  USING (
    tenant_id = app_current_tenant()
    OR user_id = app_current_user()
    OR (firebase_uid IS NOT NULL AND firebase_uid = app_trial_account())
  );--> statement-breakpoint

CREATE POLICY "link_requests_answer" ON "link_requests" FOR UPDATE
  USING (
    tenant_id = app_current_tenant()
    OR user_id = app_current_user()
    OR (firebase_uid IS NOT NULL AND firebase_uid = app_trial_account())
  )
  WITH CHECK (
    tenant_id = app_current_tenant()
    OR user_id = app_current_user()
    OR (firebase_uid IS NOT NULL AND firebase_uid = app_trial_account())
  );--> statement-breakpoint

-- Crear, solo el gimnasio: una persona no se manda solicitudes a si misma. Y sin
-- politica de DELETE, a proposito — retirar una solicitud es `canceled`.
CREATE POLICY "link_requests_create" ON "link_requests" FOR INSERT
  WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint

-- El QR de la cuenta. Largo y aleatorio: quien lo canjea recibe nombre, celular y
-- correo, y seis digitos se podrian recorrer desde cualquier sesion de staff.
ALTER TABLE "account_claims" ADD COLUMN IF NOT EXISTS "qr_token" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "account_claims_active_qr_token"
  ON "account_claims" ("qr_token") WHERE consumed_at IS NULL AND qr_token IS NOT NULL;--> statement-breakpoint

-- El codigo de 6 digitos ya no se confirma, y su indice unico era lo que obligaba
-- a borrar los vencidos: con un millon de combinaciones, la basura subia la
-- probabilidad de choque. Esa limpieza se llevaba el nombre y el celular de quien
-- se registro hace mas de diez minutos, que ahora hacen falta para encontrar sus
-- solicitudes. Sin el indice, la fila se queda y el QR se renueva en ella.
DROP INDEX IF EXISTS "account_claims_active_code";--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sinchi_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "link_requests" TO sinchi_app;
  END IF;
END $$;
