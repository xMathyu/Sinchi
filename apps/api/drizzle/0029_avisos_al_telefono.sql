-- Los teléfonos a los que Sinchi puede mandar un aviso (push).
--
-- Lo pidió un gimnasio: «que llegue notificación y correo cuando un alumno se
-- inscriba». El correo ya salía; la notificación no existía, y las decisiones lo
-- venían dejando pendiente en cuatro sitios (§7, §8, §12 y la morosidad). Sin
-- ella, la reserva de quien viene a pagar un mes depende de que el dueño abra el
-- correo o la app a tiempo.
--
-- Una fila por TELÉFONO, con su token de Expo como clave. El token es del
-- aparato, no de la persona: si en el mostrador se cierra la sesión de Ana y se
-- abre la de Luis, el mismo token pasa a Luis. Con la clave en `(user_id,
-- token)` ese teléfono quedaría a nombre de los dos, y Ana recibiría en su casa
-- los avisos de un local donde ya no está de turno.
--
-- Fuera de TENANT_SCOPED_TABLES y sin RLS por tenant, igual que
-- `account_deletion_requests`: el teléfono es de la persona, que puede trabajar
-- en un gimnasio y entrenar en otros dos. Se escribe filtrando por el `sub` de la
-- sesión, que es lo único que el cliente no puede elegir.
--
-- CASCADE con `users`: una cuenta que se borra no deja teléfonos a los que
-- seguir avisando.

CREATE TABLE IF NOT EXISTS "push_devices" (
  "token" text PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "platform" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  -- La última vez que la app lo registró. Un teléfono que no vuelve en meses es
  -- uno que ya no existe, y es lo que permite limpiarlo sin esperar a que Expo
  -- diga `DeviceNotRegistered`.
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "push_devices_platform_valid" CHECK (platform IN ('ios', 'android')),
  -- La forma que da `getExpoPushTokenAsync`. Una fila con otra cosa es un envío
  -- que Expo va a rechazar siempre, y no hay por qué guardarla.
  CONSTRAINT "push_devices_token_shape"
    CHECK (token ~ '^Expo(nent)?PushToken\[[^]]+\]$' AND length(token) <= 200)
);--> statement-breakpoint

-- Avisar al staff de un local es buscar los teléfonos de tres o cuatro personas.
CREATE INDEX IF NOT EXISTS "push_devices_user_idx" ON "push_devices" ("user_id");
