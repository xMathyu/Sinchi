-- La reserva deja de ser solo de prueba.
--
-- `trial_bookings` nacio para la clase gratis (0006) y es el unico sitio donde
-- alguien que todavia no es de ningun gimnasio deja dicho que viene: el martes a
-- las 19:00, a esa clase. La migracion siguiente le suma la clase suelta y la
-- inscripcion desde el directorio, y las tres son la misma fila —persona, clase
-- con fecha, precio congelado, vino o no vino— con un `kind` distinto.
--
-- Por eso se renombra ANTES de ensancharla, y en una migracion aparte. Con el
-- nombre viejo, un `select count(*) from trial_bookings` contaria inscripciones
-- como pruebas, que es justo lo que el glosario pide no fabricar: dos conceptos
-- con el mismo identificador. Renombrar no rompe a nadie de dentro: politicas,
-- GRANT y claves foraneas siguen a la tabla por su OID, no por su nombre.
--
-- Lo que NO se renombra, a proposito:
--  · las rutas `/trials` de la api, que las llaman las apps ya instaladas;
--  · `app_trial_account()`, que abre tambien `event_registrations` y
--    `conversations` y nombra la CUENTA sin ficha, no la reserva.

ALTER TABLE "trial_bookings" RENAME TO "class_bookings";--> statement-breakpoint
ALTER TYPE "trial_booking_status" RENAME TO "class_booking_status";--> statement-breakpoint

-- Indices y restricciones seguirian llamandose `trial_bookings_*`, y ese nombre
-- es lo que devuelve Postgres en el error que lee quien depura. Se recorren por
-- prefijo y no uno a uno: los de las claves foraneas los eligio Postgres en
-- 0006, y escribirlos a mano es apostar a que coinciden en cada base.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'class_bookings'::regclass
       AND contype <> 'p'
       AND conname LIKE 'trial\_bookings\_%'
  LOOP
    EXECUTE format(
      'ALTER TABLE class_bookings RENAME CONSTRAINT %I TO %I',
      r.conname,
      'class_bookings_' || substr(r.conname, length('trial_bookings_') + 1)
    );
  END LOOP;

  -- La clave primaria va por aqui: renombrar su indice renombra la restriccion.
  FOR r IN
    SELECT indexname FROM pg_indexes
     WHERE tablename = 'class_bookings'
       AND indexname LIKE 'trial\_bookings\_%'
  LOOP
    EXECUTE format(
      'ALTER INDEX %I RENAME TO %I',
      r.indexname,
      'class_bookings_' || substr(r.indexname, length('trial_bookings_') + 1)
    );
  END LOOP;
END $$;--> statement-breakpoint

ALTER POLICY "trial_bookings_tenant_user_or_account" ON "class_bookings"
  RENAME TO "class_bookings_tenant_user_or_account";
