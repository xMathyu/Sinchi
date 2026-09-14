-- Desde el directorio ya no solo se prueba: se viene a una clase suelta, y se
-- inscribe uno.
--
-- En un gimnasio sin clase de prueba la ficha del directorio no ofrecia NADA
-- que hacer —ni pagar una clase ni inscribirse—, y quien ya habia decidido
-- entrenar ahi solo podia presentarse sin avisar. Las dos cosas nuevas se piden
-- igual que la prueba: eligiendo una clase con fecha, que es lo que el mostrador
-- puede preparar.
--
-- Por eso son la MISMA fila con otro `kind` (la 0021 cuenta el cambio de
-- nombre), y lo que las distingue es lo que pasa en el mostrador:
--
--   trial        se marca vino / no vino; si tiene precio, se cobra.
--   drop_in      se cobra al llegar, y el cargo queda en `charge_id`.
--   enrollment   recepcion la convierte en ficha: lee el documento, crea la
--                membresia y la suscripcion, y la fila queda en `membership_id`.
--
-- La inscripcion NO crea la membresia al reservar, y es la decision que ordena
-- todo lo demas. Quien dice «empiezo el martes» muchas veces llega el jueves, y
-- su mensualidad tiene que contar desde el jueves: el dia que pago y entreno, no
-- el que escribio en la app. Crearla al reservar la haria deber desde un martes
-- en que no estuvo, y a quien no aparece nunca lo dejaria en el padron como
-- moroso, contando para el escalon del gimnasio. Ademas `users` exige documento,
-- y el documento lo lee recepcion del carne que tiene delante.

DO $$ BEGIN
  CREATE TYPE "public"."booking_kind" AS ENUM('trial', 'drop_in', 'enrollment');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

-- Todas las reservas que ya existen son pruebas: el DEFAULT no cambia a nadie.
ALTER TABLE "class_bookings" ADD COLUMN IF NOT EXISTS "kind" "booking_kind" NOT NULL DEFAULT 'trial';--> statement-breakpoint

-- El plan va por id Y copiado por nombre, como la clase: el dueno puede
-- archivarlo entre la reserva y el dia, y la lista del mostrador tiene que seguir
-- diciendo con que dijo que entraba.
ALTER TABLE "class_bookings" ADD COLUMN IF NOT EXISTS "plan_id" uuid REFERENCES "plans"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "class_bookings" ADD COLUMN IF NOT EXISTS "plan_name" text;--> statement-breakpoint
ALTER TABLE "class_bookings" ADD COLUMN IF NOT EXISTS "enrollment_fee_cents" integer NOT NULL DEFAULT 0;--> statement-breakpoint

-- SET NULL y no CASCADE, igual que en `event_registrations`: borrar un cargo o
-- una ficha no puede borrar el rastro de por donde llego la persona.
ALTER TABLE "class_bookings" ADD COLUMN IF NOT EXISTS "charge_id" uuid REFERENCES "charges"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "class_bookings" ADD COLUMN IF NOT EXISTS "membership_id" uuid REFERENCES "memberships"("id") ON DELETE SET NULL;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "class_bookings" ADD CONSTRAINT "class_bookings_enrollment_has_plan"
    CHECK ((kind = 'enrollment') = (plan_name IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "class_bookings" ADD CONSTRAINT "class_bookings_enrollment_fee_non_negative"
    CHECK (enrollment_fee_cents >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

-- Solo una inscripcion se convierte en ficha, y una inscripcion no se cobra como
-- clase: su primer mes y su matricula se cobran en la ficha, que es lo que el
-- ciclo de cobro lee. Un cargo colgado de la reserva seria un mes pagado donde
-- nadie lo busca.
DO $$ BEGIN
  ALTER TABLE "class_bookings" ADD CONSTRAINT "class_bookings_only_enrollment_enrolls"
    CHECK (membership_id IS NULL OR kind = 'enrollment');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "class_bookings" ADD CONSTRAINT "class_bookings_enrollment_not_charged_here"
    CHECK (charge_id IS NULL OR kind <> 'enrollment');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

-- «Una por gimnasio» era la regla de la PRUEBA y se queda en la prueba. Sin el
-- filtro por `kind`, quien probo el martes no podria inscribirse el jueves.
DROP INDEX IF EXISTS "class_bookings_one_per_phone";--> statement-breakpoint
DROP INDEX IF EXISTS "class_bookings_one_per_user";--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "class_bookings_one_trial_per_phone"
  ON "class_bookings" ("tenant_id", "phone")
  WHERE kind = 'trial' AND status <> 'canceled';--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "class_bookings_one_trial_per_user"
  ON "class_bookings" ("tenant_id", "user_id")
  WHERE kind = 'trial' AND user_id IS NOT NULL AND status <> 'canceled';--> statement-breakpoint

-- Una inscripcion PENDIENTE a la vez. Solo `booked`: la que termino en ficha ya
-- la frena «ya estas inscrito», y quien no vino tiene que poder volver a pedirla.
CREATE UNIQUE INDEX IF NOT EXISTS "class_bookings_one_enrollment_per_phone"
  ON "class_bookings" ("tenant_id", "phone")
  WHERE kind = 'enrollment' AND status = 'booked';--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "class_bookings_one_enrollment_per_user"
  ON "class_bookings" ("tenant_id", "user_id")
  WHERE kind = 'enrollment' AND user_id IS NOT NULL AND status = 'booked';--> statement-breakpoint

-- La clase suelta se repite —el martes y el jueves son dos clases— pero la MISMA
-- clase no: dos toques con la red lenta no pueden dejar dos cobros esperando.
CREATE UNIQUE INDEX IF NOT EXISTS "class_bookings_one_drop_in_per_class"
  ON "class_bookings" ("tenant_id", "phone", "local_date", "class_schedule_id")
  WHERE kind = 'drop_in' AND status <> 'canceled';--> statement-breakpoint

-- La clase suelta la paga tambien quien no entrena aqui, igual que un seminario:
-- sin membresia en este local ni motivo para inventarsela. Su plata va al MISMO
-- ledger (0013), y la restriccion que lo permitia solo para `event` se ensancha.
-- Compara `type::text` por lo mismo que alli.
ALTER TABLE "charges" DROP CONSTRAINT IF EXISTS "charges_membership_unless_event";--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "charges" ADD CONSTRAINT "charges_membership_unless_walk_in" CHECK (
    membership_id IS NOT NULL OR type::text IN ('event', 'drop_in')
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
