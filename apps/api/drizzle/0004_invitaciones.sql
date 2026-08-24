-- Invitaciones por enlace.
--
-- El codigo de 6 digitos existe porque la recepcionista confirma la identidad
-- con el alumno delante. La invitacion mueve esa confirmacion ANTES: el staff
-- elige la ficha y el plan al invitar, y quien abre el enlace queda vinculado
-- sin pasar por el mostrador.
--
-- Eso cambia quien autoriza: pasa a ser **la posesion del enlace**. Es el mismo
-- trato que hace GitHub o Slack al invitar a una organizacion, y el riesgo real
-- es que el enlace se reenvie por WhatsApp y lo abra otra persona. Se acota:
--
--   · token de 32 bytes — no se adivina, a diferencia de los 6 digitos;
--   · un solo uso  (`consumed_at`);
--   · caduca       (`expires_at`, 7 dias por defecto);
--   · revocable    (`revoked_at`);
--   · auditable    — queda quien invito y quien lo reclamo.
--
-- Y queda una asimetria deliberada: invitar a una ficha NUEVA solo puede crear
-- una cuenta; invitar a una ficha EXISTENTE, con su historial de pagos, es lo
-- unico que un enlace filtrado podria robar. Por eso `membership_id` es
-- opcional y el caso normal es null.
-- La matricula es del gimnasio, no del plan: se cobra una vez al entrar y no
-- cambia segun cuantas veces por semana venga la persona. En Kaizen son S/50 al
-- ano; un gimnasio que no cobre matricula la deja en 0.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "enrollment_fee_cents" integer NOT NULL DEFAULT 0;--> statement-breakpoint
-- `ADD CONSTRAINT` no admite IF NOT EXISTS, y una migracion tiene que poder
-- reaplicarse sin explotar.
DO $$ BEGIN
  ALTER TABLE "tenants" ADD CONSTRAINT "tenants_enrollment_fee_non_negative"
    CHECK (enrollment_fee_cents >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "invites" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  -- sha256, no scrypt: 32 bytes de entropia no hay que estirarlos, y hace falta
  -- BUSCAR la invitacion por su hash — con sal aleatoria habria que recorrerlas
  -- todas. Mismo razonamiento que el token de equipo.
  "token_hash" text NOT NULL,
  "full_name" text NOT NULL,
  -- El DNI viaja en la invitacion porque `users.document_id` es NOT NULL y el
  -- staff esta creando la ficha igual: el enlace no sustituye el alta, sustituye
  -- el intercambio del codigo. Pedirselo despues a la persona seria volver al
  -- problema que el codigo evitaba — que cualquiera escriba un DNI ajeno.
  "document_id" text NOT NULL,
  "phone" text NOT NULL,
  "plan_id" uuid NOT NULL REFERENCES "plans"("id") ON DELETE CASCADE,
  -- El precio se congela al invitar. Si el gimnasio sube tarifas entre que manda
  -- el enlace y la persona lo abre, se respeta lo que el staff le prometio.
  "price_cents" integer NOT NULL,
  "enrollment_fee_cents" integer NOT NULL DEFAULT 0,
  -- null = crear ficha nueva al reclamar. Con valor = vincular a una existente.
  "membership_id" uuid REFERENCES "memberships"("id") ON DELETE CASCADE,
  "created_by" uuid REFERENCES "staff"("id") ON DELETE SET NULL,
  "expires_at" timestamptz NOT NULL,
  "consumed_at" timestamptz,
  "consumed_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "revoked_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "invites_amounts_non_negative"
    CHECK (price_cents >= 0 AND enrollment_fee_cents >= 0),
  -- Consumida implica que se sepa por quien: sin esto la auditoria puede quedar
  -- a medias y no habria forma de saber quien uso un enlace.
  CONSTRAINT "invites_consumed_has_user"
    CHECK ((consumed_at IS NULL) = (consumed_by IS NULL))
);--> statement-breakpoint

-- Unico entre las vigentes, no en toda la tabla: un token consumido o revocado
-- ya no compite, y conservarlo es lo que permite auditar.
CREATE UNIQUE INDEX IF NOT EXISTS "invites_active_token" ON "invites" ("token_hash")
  WHERE consumed_at IS NULL AND revoked_at IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invites_tenant_idx" ON "invites" ("tenant_id");--> statement-breakpoint

ALTER TABLE "invites" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invites" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_invite_token_hash() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.invite_token_hash', true), '')
$$;--> statement-breakpoint

-- Misma excepcion que `checkin_devices`: quien reclama una invitacion todavia no
-- tiene tenant —es justo lo que el enlace va a decidir—, asi que sin esta puerta
-- la consulta que la busca no veria ninguna fila. Presentar el token es lo que
-- abre exactamente esa.
CREATE POLICY "invites_tenant_or_token" ON "invites"
  USING (tenant_id = app_current_tenant() OR token_hash = app_invite_token_hash())
  WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint

-- El rol de la api no existe en toda base: las pruebas de esquema migran contra
-- una base limpia donde solo esta el superusuario. Mismo resguardo que 0002.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sinchi_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "invites" TO sinchi_app;
  END IF;
END $$;
