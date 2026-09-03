-- El mes gratis del gimnasio, y lo que pasa cuando termina.
--
-- Hasta aqui Sinchi era gratis para siempre sin quererlo: el esquema tenia
-- `saas_tier` y `charge_type = 'saas'` desde el primer commit, pero nada leia
-- `tenants.status` y nadie tenia fecha de vencimiento. Faltaba la mitad que
-- convierte una oferta en un negocio.
--
-- OJO CON LA PALABRA `trial`. En este repo ya significa la clase gratis del
-- ALUMNO (`trial_bookings`, `trial_class_enabled`). El mes gratis del GIMNASIO
-- es otra cosa y por eso no la reusa: dos conceptos distintos con el mismo
-- identificador es el bug que aparece leyendo un reporte tres meses despues.
--
-- Tablas propias y NO `charges`, por dos razones que no se arreglan con un
-- `ALTER`:
--
--  1. `charges.membership_id` es NOT NULL. Un cobro a Sinchi no tiene membresia
--     de alumno detras. Para meterlo ahi habria que inventar un tenant ficticio
--     del que cada gimnasio fuera "alumno", que es exactamente el tipo de
--     modelo que se paga tres meses despues.
--  2. `charges` esta bajo RLS por tenant. Esta relacion no es del gimnasio: es
--     de Sinchi CON el gimnasio. Que el cliente pueda leer su propia fila esta
--     bien; que el aislamiento la trate como dato suyo, no.
--
-- Sin RLS, igual que `tenants`: el mismo modelo de confianza que ya tiene la
-- tabla a la que apunta. La api sirve la fila del gimnasio de la sesion y el job
-- diario las recorre todas, que es justo lo que RLS por tenant impediria.

DO $$ BEGIN
  CREATE TYPE "public"."saas_status" AS ENUM('trialing', 'active', 'in_grace', 'read_only', 'canceled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

-- Una fila por gimnasio. La clave primaria ES el tenant: un gimnasio no puede
-- tener dos suscripciones a Sinchi, y con un `id` propio si podria.
CREATE TABLE IF NOT EXISTS "saas_subscriptions" (
  "tenant_id" uuid PRIMARY KEY REFERENCES "tenants"("id") ON DELETE CASCADE,
  "tier" "saas_tier" NOT NULL DEFAULT 'up_to_60',
  -- CACHE, no verdad. La define `evaluateSaas` en `packages/shared`; esta
  -- columna existe para poder listar en SQL quien vence esta semana sin traer
  -- todos los gimnasios a memoria. Mismo trato que `subscriptions.status`.
  "status" "saas_status" NOT NULL DEFAULT 'trialing',
  -- Primer dia en que el gimnasio ya tiene que haber pagado.
  "free_until" date NOT NULL,
  "period_start" date NOT NULL,
  "next_billing_date" date NOT NULL,
  -- Propia, y NO `tenants.grace_days`: esa es la gracia que el gimnasio le da a
  -- SUS alumnos y la configura el. Compartirlas dejaria que el cliente se
  -- regale su propia gracia subiendola en sus ajustes.
  "grace_days" smallint NOT NULL DEFAULT 7,
  "canceled_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "saas_subscriptions" ADD CONSTRAINT "saas_subscriptions_grace_days_sane"
    CHECK (grace_days >= 0 AND grace_days <= 60);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "saas_subscriptions_status_idx"
  ON "saas_subscriptions" ("status", "next_billing_date");--> statement-breakpoint

-- Ledger de lo que el gimnasio le paga a Sinchi. Append-only, como `charges`:
-- nada de actualizar montos, se crea una fila nueva.
CREATE TABLE IF NOT EXISTS "saas_charges" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "amount_cents" integer NOT NULL,
  "tier" "saas_tier" NOT NULL,
  -- El mismo enum que el pago del alumno. En la version 1 el gimnasio paga por
  -- transferencia o Yape, igual que sus alumnos pagan en mostrador.
  "rail" "payment_rail" NOT NULL,
  "status" "charge_status" NOT NULL,
  "period_start" date NOT NULL,
  "period_end" date NOT NULL,
  -- Numero de operacion de la transferencia. Es lo que se busca cuando el
  -- dueno llama diciendo que ya pago.
  "reference" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "saas_charges" ADD CONSTRAINT "saas_charges_amount_non_negative"
    CHECK (amount_cents >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "saas_charges" ADD CONSTRAINT "saas_charges_period_ordered"
    CHECK (period_end > period_start);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

-- La misma garantia que `charges_renewal_once_per_period` le da al alumno: un
-- solo cobro exitoso por periodo. Registrar dos veces la misma transferencia
-- —que es lo que pasa cuando dos personas atienden el mismo correo— choca aqui
-- en vez de regalarle un mes al gimnasio.
CREATE UNIQUE INDEX IF NOT EXISTS "saas_charges_once_per_period"
  ON "saas_charges" ("tenant_id", "period_start")
  WHERE status = 'succeeded';--> statement-breakpoint

-- El numero de operacion es la llave de idempotencia del pago manual, el mismo
-- papel que `client_id` juega en la cola offline del mostrador.
--
-- Hace falta ADEMAS del indice por periodo, porque no cubren el mismo caso:
-- registrar un pago adelanta la fecha de cobro, asi que registrar dos veces la
-- misma transferencia NO choca por periodo — le cobraria al gimnasio dos meses
-- por un solo deposito. Choca por aqui.
CREATE UNIQUE INDEX IF NOT EXISTS "saas_charges_reference_once"
  ON "saas_charges" ("tenant_id", "reference")
  WHERE reference IS NOT NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "saas_charges_tenant_idx" ON "saas_charges" ("tenant_id");--> statement-breakpoint

-- Los gimnasios que ya estaban.
--
-- Su mes gratis cuenta desde HOY, no desde su `created_at`. Kaizen y Fa Meng
-- Chuen llevan meses dentro: arrancarlos ya vencidos por una fecha que nadie les
-- comunico es una conversacion fea por un backfill. Que la oferta empiece
-- cuando la oferta existe.
--
-- La fecha se calcula en la zona del LOCAL, no con `current_date`. Neon corre en
-- UTC: desde las 19:00 de Lima el servidor ya cree que es manana, y un backfill
-- lanzado por la tarde le regalaria un dia a cada gimnasio. Es el mismo motivo
-- por el que `Clock.today()` pide zona horaria en vez de leer el reloj a secas.
INSERT INTO "saas_subscriptions" ("tenant_id", "free_until", "period_start", "next_billing_date")
SELECT t."id",
       ((now() AT TIME ZONE t."timezone")::date + interval '1 month')::date,
       (now() AT TIME ZONE t."timezone")::date,
       ((now() AT TIME ZONE t."timezone")::date + interval '1 month')::date
  FROM "tenants" t
ON CONFLICT ("tenant_id") DO NOTHING;
