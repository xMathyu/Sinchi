-- Invitacion por correo verificado.
--
-- El gimnasio pide el correo en el mostrador, lo registra, y cuando la persona
-- entra con Google su cuenta ya esta activa. Sin codigo que dictar.
--
-- Es MAS fuerte que el enlace, no mas debil, y conviene ver por que: un enlace
-- autoriza a quien lo posea —reenviado por WhatsApp funciona para cualquiera—
-- mientras que un correo verificado solo lo puede reclamar quien controla ese
-- buzon. Reenviarlo no sirve de nada.
--
-- Queda un riesgo real y distinto: **el typo**. Si recepcion escribe mal el
-- correo y la direccion equivocada existe y su dueno usa Sinchi, se vincularia a
-- la persona equivocada. Se acota igual que el resto:
--
--   · exige `email_verified` de Google: nadie reclama un buzon que no controla;
--   · la invitacion caduca y es de un solo uso;
--   · el dueno puede desvincular;
--   · queda auditado quien invito y quien reclamo.
--
-- El codigo de 6 digitos NO desaparece: es el camino de quien no tiene correo,
-- que en este mercado es gente real.
ALTER TABLE "invites" ADD COLUMN IF NOT EXISTS "email" text;--> statement-breakpoint

-- Se normaliza a minusculas al escribir; la restriccion lo hace explicito para
-- que una insercion a mano no rompa la busqueda por igualdad.
DO $$ BEGIN
  ALTER TABLE "invites" ADD CONSTRAINT "invites_email_lowercase"
    CHECK (email IS NULL OR email = lower(email));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

-- Solo sobre las vigentes: una consumida o revocada ya no compite, y conservarla
-- es lo que permite auditar. Sin el parcial, reinvitar al mismo correo tras
-- revocar seria imposible.
CREATE UNIQUE INDEX IF NOT EXISTS "invites_active_email_per_tenant"
  ON "invites" ("tenant_id", "email")
  WHERE email IS NOT NULL AND consumed_at IS NULL AND revoked_at IS NULL;--> statement-breakpoint

-- La busqueda al entrar es por correo y sin contexto de gimnasio: la hace quien
-- todavia no tiene ninguno.
CREATE INDEX IF NOT EXISTS "invites_email_idx" ON "invites" ("email")
  WHERE email IS NOT NULL AND consumed_at IS NULL AND revoked_at IS NULL;--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_invite_email() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.invite_email', true), '')
$$;--> statement-breakpoint

-- Tercera puerta de la misma politica: presentar un correo verificado abre las
-- invitaciones dirigidas a el, igual que el token abre la suya.
DROP POLICY IF EXISTS "invites_tenant_or_token" ON "invites";--> statement-breakpoint
CREATE POLICY "invites_tenant_token_or_email" ON "invites"
  USING (
    tenant_id = app_current_tenant()
    OR token_hash = app_invite_token_hash()
    OR (email IS NOT NULL AND email = app_invite_email())
  )
  WITH CHECK (tenant_id = app_current_tenant());
