-- Se retira el turno del mostrador: token de equipo + PIN.
--
-- Estaba pensado para una tablet compartida con los turnos rotando: cada
-- recepcionista abria el suyo con un PIN de 4-6 digitos para que `recorded_by`
-- dijera la verdad sobre quien marco y quien cobro. El razonamiento era correcto
-- y el gimnasio que lo necesita no existe en esta red: el profesor ES la
-- recepcion, y entra con su propia cuenta desde su telefono.
--
-- No deja a nadie fuera, y eso es lo que lo hace seguro de borrar. Quien tiene
-- fila en `staff` entra con Google o con su correo como cualquiera, y
-- `issueForUser` le da sesion de `front_desk` leyendo esa fila. El turno era una
-- CUARTA puerta, no la unica de recepcion.
--
-- Lo que se va con el:
--
--   · las cuatro columnas de PIN en `staff`. El hash scrypt, cuando vuelva a
--     hacer falta, se vuelve a escribir; conservar hashes de un PIN que ya no
--     abre nada es guardar un secreto por si acaso, que es como se filtran;
--   · `checkin_devices` ENTERA. Nacio para el «Modo B» del MD 4.6 —tablet fija
--     mostrando el QR del local— y esa parte nunca se construyo: su columna
--     `totp_secret_encrypted` no la lee nadie, el TOTP que la puerta usa de
--     verdad es el de `users`. Lo unico vivo de la tabla era el token del turno.
--     Si el Modo B se construye algun dia, nacera con las columnas que necesite
--     en vez de heredar las que sobraron de otra cosa;
--   · `app_device_token_hash()` y la politica que la usaba. La excepcion de RLS
--     existia para descubrir el gimnasio a partir del token antes de saber cual
--     era; sin turno no hay nada que descubrir.
ALTER TABLE "staff" DROP COLUMN IF EXISTS "pin_hash";--> statement-breakpoint
ALTER TABLE "staff" DROP COLUMN IF EXISTS "pin_updated_at";--> statement-breakpoint
ALTER TABLE "staff" DROP COLUMN IF EXISTS "pin_failed_attempts";--> statement-breakpoint
ALTER TABLE "staff" DROP COLUMN IF EXISTS "pin_locked_until";--> statement-breakpoint

-- Se lleva por delante su politica RLS, sus indices y su clave foranea.
DROP TABLE IF EXISTS "checkin_devices";--> statement-breakpoint

-- Despues de la tabla: mientras exista la politica, la funcion esta en uso.
DROP FUNCTION IF EXISTS app_device_token_hash();
