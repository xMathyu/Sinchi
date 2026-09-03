-- Codigos de promocion: meses de Sinchi de regalo para el gimnasio.
--
-- Un codigo no descuenta el precio, mueve `free_until` hacia adelante. Se eligio
-- asi para no tocar el motor de cobro por una promocion: `evaluateSaas` sigue
-- sin saber que los codigos existen, y lo unico que cambia es una fecha.
--
-- Fuera de `TENANT_SCOPED_TABLES`, como `saas_subscriptions` y por lo mismo: no
-- es dato del gimnasio, es de Sinchi con el gimnasio, y quien los crea y los
-- lista somos nosotros.

CREATE TABLE IF NOT EXISTS "saas_promo_codes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  -- Normalizado a mayusculas y sin separadores. El mismo codigo llega escrito
  -- "sinchi-2026", "SINCHI 2026" y "Sinchi2026" segun quien lo copie de donde;
  -- guardarlo canonico hace que el indice unico compare lo mismo que la busqueda.
  "code" text NOT NULL,
  "free_months" smallint NOT NULL DEFAULT 1,
  -- NULL = sin tope. Un codigo para una campana abierta.
  "max_redemptions" integer,
  "redeemed_count" integer NOT NULL DEFAULT 0,
  "expires_on" date,
  "active" boolean NOT NULL DEFAULT true,
  -- Para que dentro de seis meses se sepa a quien se le dio y por que.
  "note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "saas_promo_codes_code_key" ON "saas_promo_codes" ("code");--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "saas_promo_codes" ADD CONSTRAINT "saas_promo_codes_code_canonical"
    CHECK (code ~ '^[A-Z0-9]{4,24}$');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "saas_promo_codes" ADD CONSTRAINT "saas_promo_codes_months_sane"
    CHECK (free_months >= 1 AND free_months <= 12);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "saas_promo_codes" ADD CONSTRAINT "saas_promo_codes_max_positive"
    CHECK (max_redemptions IS NULL OR max_redemptions > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

-- EL tope de verdad. No es una comprobacion redundante del codigo: es la unica
-- que sobrevive a dos gimnasios canjeando el ultimo uso en el mismo segundo.
-- Con un `if` en la aplicacion, los dos leen 9 de 10 y los dos escriben 10.
DO $$ BEGIN
  ALTER TABLE "saas_promo_codes" ADD CONSTRAINT "saas_promo_codes_within_cap"
    CHECK (redeemed_count >= 0 AND (max_redemptions IS NULL OR redeemed_count <= max_redemptions));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "saas_redemptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "promo_code_id" uuid NOT NULL REFERENCES "saas_promo_codes"("id") ON DELETE CASCADE,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "free_months" smallint NOT NULL,
  -- Hasta cuando quedo gratis DESPUES de canjear. Es el rastro que permite
  -- responder "¿por que este gimnasio no paga desde marzo?" sin recalcular nada.
  "free_until_after" date NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

-- Un gimnasio no canjea el mismo codigo dos veces. Es la otra mitad del tope:
-- sin esto, un solo gimnasio podria gastar los diez usos de un codigo.
CREATE UNIQUE INDEX IF NOT EXISTS "saas_redemptions_once_per_tenant"
  ON "saas_redemptions" ("promo_code_id", "tenant_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "saas_redemptions_tenant_idx" ON "saas_redemptions" ("tenant_id");
