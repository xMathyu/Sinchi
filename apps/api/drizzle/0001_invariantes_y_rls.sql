-- Migración escrita a mano. Dos cosas que el esquema de Drizzle no expresa y
-- que no deberían vivir solo en el código de la aplicación.
--
-- 1. INVARIANTES. Una regla que solo existe en TypeScript se rompe el día que
--    alguien corre un UPDATE desde la consola de Neon. Las que definen dinero y
--    acceso van en la base.
--
-- 2. AISLAMIENTO POR TENANT (RLS). El MD 5 lo pide explícito: "nunca confiando
--    en que el query lo recuerde". El filtro por `tenant_id` en el repositorio
--    es la primera defensa; esto es la segunda, la que aguanta un olvido.

-- ---------------------------------------------------------------------------
-- 1. Invariantes
-- ---------------------------------------------------------------------------

-- Un día fijo de cobro exige el día, y solo del 1 al 28: con 29, 30 o 31 el
-- cobro se corre en febrero y el periodo deja de ser mensual limpio.
--
-- Va como CASE y no como cadena de OR por la lógica trivaluada de SQL: un CHECK
-- solo rechaza cuando la expresión da FALSE, y `'fixed_day' AND NULL BETWEEN 1
-- AND 28` da NULL, no FALSE. Escrito con OR, un tenant con `fixed_day` y sin día
-- pasaba la restricción. Un CASE que cubre todas las ramas del enum siempre
-- devuelve booleano.
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_billing_day_valid" CHECK (
  CASE billing_mode
    WHEN 'anniversary' THEN billing_day_of_month IS NULL
    WHEN 'fixed_day'   THEN billing_day_of_month IS NOT NULL
                            AND billing_day_of_month BETWEEN 1 AND 28
  END
);--> statement-breakpoint

ALTER TABLE "tenants" ADD CONSTRAINT "tenants_grace_days_valid" CHECK (grace_days BETWEEN 0 AND 60);--> statement-breakpoint

ALTER TABLE "tenants" ADD CONSTRAINT "tenants_drop_in_price_valid" CHECK (
  drop_in_price_cents IS NULL OR drop_in_price_cents >= 0
);--> statement-breakpoint

-- Cobrar la mensualidad de una tarifa de céntimos negativos es un abono, y en
-- este ledger los abonos no existen: se crea un cargo nuevo, no uno negativo.
ALTER TABLE "plans" ADD CONSTRAINT "plans_price_non_negative" CHECK (price_cents >= 0);--> statement-breakpoint

-- El tipo de plan y sus parámetros tienen que concordar. Un plan
-- `sessions_per_week` sin número de sesiones deja el cupo sin límite sin querer:
-- `weeklyLimit()` devuelve null y el alumno entra todos los días pagando 2x.
--
-- Mismo motivo que arriba para el CASE: con OR, el NULL se colaba.
ALTER TABLE "plans" ADD CONSTRAINT "plans_type_consistent" CHECK (
  CASE type
    WHEN 'unlimited'         THEN sessions_per_week IS NULL
    WHEN 'sessions_per_week' THEN sessions_per_week IS NOT NULL
                                  AND sessions_per_week BETWEEN 1 AND 7
    WHEN 'fixed_days'        THEN sessions_per_week IS NULL
                                  AND allowed_days IS NOT NULL
  END
);--> statement-breakpoint

-- Días ISO: 1 = lunes .. 7 = domingo. Un 0 o un 8 hace que el check-in
-- rechace por "día no permitido" sin que nadie entienda por qué.
-- `array_length` de un arreglo vacío devuelve NULL, no 0, así que sin el
-- `coalesce` un plan con `allowed_days = '{}'` pasaba la restricción y dejaba al
-- alumno sin ningún día permitido.
ALTER TABLE "plans" ADD CONSTRAINT "plans_allowed_days_valid" CHECK (
  allowed_days IS NULL
  OR (
    coalesce(array_length(allowed_days, 1), 0) BETWEEN 1 AND 7
    AND allowed_days <@ ARRAY[1,2,3,4,5,6,7]::smallint[]
  )
);--> statement-breakpoint

ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_period_ordered" CHECK (
  next_billing_date >= period_start
);--> statement-breakpoint

ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_canceled_has_date" CHECK (
  (status = 'canceled') = (canceled_at IS NOT NULL)
);--> statement-breakpoint

ALTER TABLE "charges" ADD CONSTRAINT "charges_amount_non_negative" CHECK (amount_cents >= 0);--> statement-breakpoint

ALTER TABLE "charges" ADD CONSTRAINT "charges_attempt_positive" CHECK (attempt >= 1);--> statement-breakpoint

-- Un cargo de renovación cubre un periodo; los demás no. Sin esto, una
-- renovación sin periodo se escapa del índice único de idempotencia y se puede
-- cobrar dos veces el mismo mes.
ALTER TABLE "charges" ADD CONSTRAINT "charges_renewal_has_period" CHECK (
  (type <> 'renewal')
  OR (period_start IS NOT NULL AND period_end IS NOT NULL AND period_end > period_start)
);--> statement-breakpoint

-- En la versión 1 no hay cobro con tarjeta: un cargo con `rail = 'card'` sería
-- un cargo que nadie hizo. Cuando entre Culqi, se borra esta restricción en su
-- propia migración, que es la señal de que el riel quedó abierto.
ALTER TABLE "charges" ADD CONSTRAINT "charges_no_card_rail_yet" CHECK (rail <> 'card');--> statement-breakpoint

ALTER TABLE "class_schedules" ADD CONSTRAINT "class_schedules_weekday_valid" CHECK (weekday BETWEEN 1 AND 7);--> statement-breakpoint

-- `HH:MM` se compara como texto sin sorpresas porque va con cero a la izquierda.
ALTER TABLE "class_schedules" ADD CONSTRAINT "class_schedules_time_format" CHECK (
  start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  AND end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  AND end_time > start_time
);--> statement-breakpoint

ALTER TABLE "attendance" ADD CONSTRAINT "attendance_iso_week_format" CHECK (iso_week ~ '^\d{4}-W\d{2}$');--> statement-breakpoint

-- Dejar pasar a alguien rechazado se registra con el motivo. Un override sin
-- motivo es exactamente el favor invisible que esta columna existe para evitar.
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_override_has_reason" CHECK (
  overrode_denial = false OR denial_reason IS NOT NULL
);--> statement-breakpoint

-- Un marcado manual lo registra siempre una persona identificable.
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_manual_has_staff" CHECK (
  method <> 'manual' OR recorded_by IS NOT NULL
);--> statement-breakpoint

ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_expiry_valid" CHECK (
  exp_month BETWEEN 1 AND 12 AND exp_year BETWEEN 2024 AND 2099
);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Aislamiento por tenant
-- ---------------------------------------------------------------------------
--
-- El contexto se pasa por variable de sesión, fijada por transacción con
-- `SET LOCAL` desde `withTenant()`:
--
--   app.current_tenant  gimnasio de la petición
--   app.current_user    identidad global de quien pide (para la billetera)
--
-- Si la variable no está puesta, `nullif(...)::uuid` da NULL, la comparación da
-- NULL y no se ve ninguna fila. Falla cerrado, que es lo que se quiere: una
-- consulta que olvidó el contexto devuelve vacío en vez de devolver todo.
--
-- `FORCE ROW LEVEL SECURITY` hace que la política aplique también al dueño de
-- la tabla, que en Neon es el rol con el que se conecta la api. Sin FORCE, RLS
-- sería decorativo aquí.

CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.current_tenant', true), '')::uuid
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_current_user() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.current_user', true), '')::uuid
$$;--> statement-breakpoint

-- `staff` lleva la misma excepción que `memberships`, y por el mismo motivo: al
-- iniciar sesión todavía no se sabe el gimnasio — se descubre leyendo la fila de
-- staff de esa persona. Con aislamiento estricto, el login no encontraba nada y
-- todo el mundo entraba como alumno.
--
-- Es una comparación de columna, sin subconsultas: cualquiera puede leer su
-- propia fila, nadie puede leer la de otro.
ALTER TABLE "staff" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "staff" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "staff_tenant_or_self" ON "staff"
  USING (tenant_id = app_current_tenant() OR user_id = app_current_user())
  WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE INDEX "staff_user_idx" ON "staff" USING btree ("user_id");--> statement-breakpoint

ALTER TABLE "plans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "plans" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "plans_tenant_isolation" ON "plans" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint

ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "subscriptions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "subscriptions_tenant_isolation" ON "subscriptions" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint

ALTER TABLE "payment_methods" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payment_methods" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "payment_methods_tenant_isolation" ON "payment_methods" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint

ALTER TABLE "charges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "charges" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "charges_tenant_isolation" ON "charges" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint

ALTER TABLE "class_schedules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "class_schedules" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "class_schedules_tenant_isolation" ON "class_schedules" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint

ALTER TABLE "attendance" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attendance" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "attendance_tenant_isolation" ON "attendance" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint

ALTER TABLE "checkin_devices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "checkin_devices" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "checkin_devices_tenant_isolation" ON "checkin_devices" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint

ALTER TABLE "tenant_gateway" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenant_gateway" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_gateway_tenant_isolation" ON "tenant_gateway" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint

-- `memberships` lleva una excepción, y es deliberada.
--
-- La billetera del alumno tiene que listar sus membresías en TODOS los
-- gimnasios: eso es el producto (MD 5). Con aislamiento estricto no podría ni
-- averiguar a qué gimnasios pertenece, porque para eso necesitaría saberlo
-- antes. La excepción es una comparación de columna, sin subconsultas: barata e
-- indexable. Todo lo demás (suscripción, cargos, asistencia) sigue exigiendo
-- contexto de gimnasio, una transacción por gimnasio.
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "memberships_tenant_or_self" ON "memberships"
  USING (tenant_id = app_current_tenant() OR user_id = app_current_user())
  WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint

CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");
