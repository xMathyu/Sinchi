-- La clase de prueba puede tener precio.
--
-- Nacio gratis porque el primer gimnasio la regalaba. El segundo la vende: Fa
-- Meng Chuen cobra S/40 por la clase suelta y esa ES su prueba, asi que la
-- eleccion no es «la ofrezco o no» sino «cuanto cuesta». Con solo el
-- interruptor, un local asi tenia que quedarse fuera del directorio para no
-- regalar su producto — que es justo lo contrario de lo que el directorio busca.
--
-- Columna propia y NO `drop_in_price_cents`, aunque en Fa Meng Chuen coincidan.
-- Son dos precios distintos y un gimnasio normal los tiene distintos:
--
--   drop_in_price_cents        lo que paga un ALUMNO que agota su cupo semanal
--   trial_class_price_cents    lo que paga quien VIENE A CONOCER el local
--
-- Regalar la primera y cobrar las siguientes a S/40 es el caso mas comun de los
-- dos, y con una sola columna no se puede ni escribir.
--
-- Cero = gratis, que es lo que ya hacian todos. Por eso el DEFAULT no cambia el
-- comportamiento de nadie.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "trial_class_price_cents" integer NOT NULL DEFAULT 0;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "tenants" ADD CONSTRAINT "tenants_trial_class_price_non_negative"
    CHECK (trial_class_price_cents >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

-- El precio se congela en la reserva, como el de la invitacion: si el gimnasio
-- sube la tarifa entre que alguien reserva y el dia de la clase, se respeta lo
-- que se le prometio al reservar.
ALTER TABLE "trial_bookings" ADD COLUMN IF NOT EXISTS "price_cents" integer NOT NULL DEFAULT 0;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "trial_bookings" ADD CONSTRAINT "trial_bookings_price_non_negative"
    CHECK (price_cents >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
