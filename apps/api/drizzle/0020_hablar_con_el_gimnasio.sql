-- Hablar con el gimnasio: el chat de Sinchi.
--
-- Hasta aqui la conversacion era de WhatsApp, a proposito (decisiones §7): el
-- gimnasio recibia el nombre, el celular y un enlace `wa.me`, porque WhatsApp
-- «ya esta abierto en los dos telefonos». Esa decision se revierte, y la razon
-- no es tecnica sino de producto: el objetivo ahora es que la persona y el
-- gimnasio se QUEDEN en Sinchi. El enlace los sacaba a los dos de la app justo
-- en el momento de mas interes —la primera pregunta, la clase de prueba de
-- manana, la duda con el cobro— y lo que se hablaba alli no volvia nunca. Por
-- eso esta migracion llega con el enlace retirado del correo y del mostrador, y
-- no conviviendo con el: dos canales para lo mismo es elegir el de fuera.
--
-- Y habia quien no tenia ni ese enlace:
--
--   · el curioso del directorio que todavia no reservo nada. Quiere saber si hay
--     clases de noche y cuanto cuesta el mes, y esa pregunta es el primer paso de
--     casi toda inscripcion;
--   · el alumno de casa, cuya duda —«me cobraron dos veces», «¿puedo cambiar de
--     horario?»— sale de datos que estan en Sinchi.
--
-- De la decision vieja se conservan sus dos objeciones, con respuesta:
--
--   · sin push, un chat es un buzon que nadie mira. Cada lado lleva su marca de
--     aviso (`gym_notified_at`, `person_notified_at`) y el correo sale UNA vez
--     por tanda de mensajes sin leer. Es el canal con el que ya se avisa de una
--     clase de prueba, que es el que el dueno si lee;
--   · la moderacion vive en `checkMessageDraft` como racha de mensajes sin
--     respuesta, no aqui. La base guarda los hechos; cuantos seguidos se toleran
--     es regla de producto y cambia sin migracion.

DO $$ BEGIN
  CREATE TYPE "public"."conversation_topic" AS ENUM('general', 'trial', 'drop_in', 'membership', 'event');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE "public"."conversation_status" AS ENUM('open', 'closed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

-- `person` y no `student`: la mitad del valor de esto es que escriba quien
-- todavia no es alumno de nadie. Llamar `student` a la columna invita a que
-- alguien filtre la bandeja por el padron y haga desaparecer justo los mensajes
-- que traen alumnos nuevos.
DO $$ BEGIN
  CREATE TYPE "public"."message_sender" AS ENUM('person', 'gym');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

-- UN hilo por persona y por gimnasio, no uno por pregunta.
--
-- Un dojo de sesenta alumnos no tiene a nadie que administre una bandeja con
-- hilos duplicados de la misma persona. `topic` cuenta por donde empezo —y se
-- congela, como `class_name` en la reserva— pero el hilo sigue siendo el mismo
-- cuando esa persona vuelva a preguntar otra cosa tres meses despues.
CREATE TABLE IF NOT EXISTS "conversations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  -- Identidad Sinchi cuando la tiene. Nulo mientras solo es una cuenta de
  -- Google, que es el caso del curioso del directorio.
  --
  -- CASCADE y no SET NULL como en `trial_bookings`, y el porque se vio al
  -- escribir esta tabla: con SET NULL, borrar a quien escribio con sesion y sin
  -- cuenta de Firebase deja la fila sin ninguna de las dos llaves, y el CHECK
  -- `has_account` rechaza el borrado ENTERO. A `trial_bookings` le pasa hoy al
  -- resetear la siembra. Y lo que se pierde es lo correcto: los mensajes de una
  -- persona son suyos, no asientos contables del gimnasio, y con su baja se van.
  "user_id" uuid REFERENCES "users"("id") ON DELETE CASCADE,
  "firebase_uid" text,
  -- Viajan en la fila por lo mismo que en `trial_bookings`: son lo unico con lo
  -- que el gimnasio puede reconocer y llamar a quien escribe si el hilo se queda
  -- corto.
  "full_name" text NOT NULL,
  "phone" text NOT NULL,
  "email" text,
  "topic" "conversation_topic" DEFAULT 'general' NOT NULL,
  -- `closed` no es un candado: escribir reabre. Es lo que saca de la bandeja lo
  -- ya resuelto, que es la unica forma de que una bandeja siga sirviendo al
  -- tercer mes.
  "status" "conversation_status" DEFAULT 'open' NOT NULL,
  -- Con esto se ordena la bandeja: lo ultimo que se dijeron, no cuando se abrio.
  "last_message_at" timestamptz DEFAULT now() NOT NULL,
  -- Hasta donde leyo cada lado. Lo NO LEIDO se deriva contando mensajes
  -- posteriores a esta marca, igual que el cupo semanal se deriva contando
  -- asistencias: un contador mutable se desincroniza y entonces el gimnasio ve
  -- un «3» eterno sobre una bandeja vacia y deja de mirar la insignia.
  "person_read_at" timestamptz,
  "gym_read_at" timestamptz,
  -- Cuando se le aviso por correo a cada lado. Un aviso por TANDA de mensajes
  -- sin leer: mientras quien lo recibio no abra el hilo, los siguientes no
  -- mandan otro, o un dojo con una persona escribiendo tres seguidas recibe tres
  -- correos identicos.
  "gym_notified_at" timestamptz,
  "person_notified_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  -- Sin una de las dos, el hilo no es de nadie: ni el gimnasio sabe con quien
  -- habla ni la persona puede volver a abrirlo. Mismo invariante que 0006.
  CONSTRAINT "conversations_has_account"
    CHECK (user_id IS NOT NULL OR firebase_uid IS NOT NULL),
  CONSTRAINT "conversations_email_lowercase"
    CHECK (email IS NULL OR email = lower(email))
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "conversations_one_per_user"
  ON "conversations" ("tenant_id", "user_id")
  WHERE user_id IS NOT NULL;--> statement-breakpoint

-- El hilo de quien todavia no tiene ficha. Parcial sobre `user_id IS NULL`: en
-- cuanto se le conoce identidad, el servicio la escribe aqui y manda el indice
-- de arriba. Sin esa condicion, la misma persona tendria dos hilos abiertos el
-- dia que se inscribe — el de antes y el de despues— y el mostrador estaria
-- contestando a dos.
CREATE UNIQUE INDEX IF NOT EXISTS "conversations_one_per_account"
  ON "conversations" ("tenant_id", "firebase_uid")
  WHERE user_id IS NULL AND firebase_uid IS NOT NULL;--> statement-breakpoint

-- La consulta de la bandeja: lo ultimo hablado, arriba.
CREATE INDEX IF NOT EXISTS "conversations_tenant_activity_idx"
  ON "conversations" ("tenant_id", "last_message_at" DESC);--> statement-breakpoint

-- Las dos de la app de la persona: sus hilos en toda la red, con ficha o sin ella.
CREATE INDEX IF NOT EXISTS "conversations_user_idx"
  ON "conversations" ("user_id")
  WHERE user_id IS NOT NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "conversations_account_idx"
  ON "conversations" ("firebase_uid")
  WHERE firebase_uid IS NOT NULL;--> statement-breakpoint

-- Existe para que `messages` pueda apuntar al hilo Y a su gimnasio a la vez.
CREATE UNIQUE INDEX IF NOT EXISTS "conversations_id_tenant_key"
  ON "conversations" ("id", "tenant_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "conversation_id" uuid NOT NULL,
  "sender" "message_sender" NOT NULL,
  -- Quien del mostrador contesto. La fila se conserva si esa persona deja el
  -- gimnasio, por eso `SET NULL` y por eso el nombre va COPIADO: el hilo de hace
  -- seis meses tiene que seguir diciendo quien respondio.
  "staff_id" uuid REFERENCES "staff"("id") ON DELETE SET NULL,
  "staff_name" text,
  "body" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  -- La clave foranea va COMPUESTA, y no es adorno: con una simple sobre
  -- `conversation_id`, un `tenant_id` mal puesto en el INSERT meteria el mensaje
  -- en la bandeja de otro gimnasio y la politica RLS lo dejaria pasar, porque
  -- solo mira esa columna. Asi el desajuste no es representable.
  CONSTRAINT "messages_conversation_tenant"
    FOREIGN KEY ("conversation_id", "tenant_id")
    REFERENCES "conversations" ("id", "tenant_id") ON DELETE CASCADE,
  -- El mismo tope que `MESSAGE_MAX_LENGTH` en `packages/shared`. Repetido a
  -- proposito, como los CHECK de `plans`: la regla de arriba evita que el
  -- usuario llegue hasta aqui, y esta es la que no se puede saltar.
  CONSTRAINT "messages_body_length"
    CHECK (length(btrim(body)) BETWEEN 1 AND 1000),
  -- Un mensaje de la persona no puede venir firmado por el mostrador.
  CONSTRAINT "messages_staff_only_from_gym"
    CHECK (sender = 'gym' OR (staff_id IS NULL AND staff_name IS NULL))
);--> statement-breakpoint

-- La unica consulta que hace esta tabla: un hilo, en orden.
CREATE INDEX IF NOT EXISTS "messages_thread_idx"
  ON "messages" ("conversation_id", "created_at");--> statement-breakpoint

ALTER TABLE "conversations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "conversations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "messages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Las mismas tres puertas que `trial_bookings`: el gimnasio, la identidad
-- global y la cuenta de Firebase ya verificada.
--
-- `app_trial_account()` se llama asi porque nacio con la clase gratis, y hoy es
-- la tercera tabla que la usa (0013 fue la segunda). El nombre se le quedo
-- corto; renombrar una funcion de la que cuelgan tres politicas vivas, para
-- arreglar una palabra, es mas riesgo del que vale.
CREATE POLICY "conversations_tenant_user_or_account" ON "conversations"
  USING (
    tenant_id = app_current_tenant()
    OR user_id = app_current_user()
    OR (firebase_uid IS NOT NULL AND firebase_uid = app_trial_account())
  )
  -- Escribir sigue exigiendo gimnasio: el hilo nace dentro de uno, y el servicio
  -- lo adopta despues de resolver el slug o de comprobar que el hilo es suyo.
  WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint

-- Un mensaje se ve si se ve su hilo.
--
-- La subconsulta es deliberada y es la excepcion a la regla de 0001 —«una
-- comparacion de columna, sin subconsultas»—. La alternativa era copiar
-- `user_id` y `firebase_uid` en CADA mensaje, y eso son dos columnas que hay que
-- mantener sincronizadas con el hilo el dia que la persona se inscribe: cuando
-- se desincronicen, unos mensajes del hilo se veran y otros no, que es un fallo
-- mucho peor de diagnosticar que una subconsulta lenta.
--
-- No es cara: `conversations` esta bajo su propia politica dentro de la
-- subconsulta, asi que devuelve los hilos de quien pregunta —uno o dos— y del
-- lado del gimnasio ni se evalua, porque la primera rama corta antes.
CREATE POLICY "messages_visible_with_thread" ON "messages"
  USING (
    tenant_id = app_current_tenant()
    OR conversation_id IN (SELECT id FROM "conversations")
  )
  WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint

-- El rol de la api no existe en toda base: las pruebas de esquema migran contra
-- una base limpia donde solo esta el superusuario. Mismo resguardo que 0002.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sinchi_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "conversations" TO sinchi_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "messages" TO sinchi_app;
  END IF;
END $$;
