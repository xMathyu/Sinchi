-- El otro lado del producto: quien administra Sinchi.
--
-- Hasta aqui todo el poder del sistema era de gimnasio hacia adentro. Lo que
-- cruza gimnasios —cobrar la suscripcion, repartir codigos, borrar una siembra
-- que se colo en el directorio— vivia en la linea de comandos
-- (`saas-cli`, `db:purge`), y ahi estuvo bien mientras el unico que lo hacia
-- estaba sentado frente al repo con la cadena de Neon a mano.
--
-- Tres cosas lo cambiaron: hay que poder suspender a un local que abusa sin
-- abrir un terminal, hay que dejar un rastro de quien lo hizo y por que, y hay
-- que poder darle acceso a una segunda persona sin darle la base de datos.
--
-- Lo que este archivo crea:
--
--   platform_admins   quien puede entrar al panel de Sinchi. Por CORREO, y se
--                     comprueba verificado por Google al entrar.
--   platform_actions  que hizo cada uno. Un registro, no un cache: nada lo lee
--                     para decidir, y por eso puede sobrevivir a lo que nombra.
--   tenants.suspended_* por que y desde cuando un gimnasio esta fuera.
--
-- Lo que NO crea: ninguna politica RLS nueva, y ninguna puerta en las que ya
-- hay. El panel lee los datos de un gimnasio con el MISMO contexto de tenant que
-- usa el mostrador —una transaccion por gimnasio— porque abrir un
-- `app.platform_admin` en cada politica seria agregarle una llave maestra al
-- aislamiento que sostiene el producto entero, a cambio de ahorrarse unas
-- consultas en una pantalla que mira una persona. Ver docs/decisiones.md §21.

-- ---------------------------------------------------------------------------
-- Quien administra Sinchi
-- ---------------------------------------------------------------------------

-- El correo es la llave y no el `firebase_uid`, y es lo que permite invitar a
-- alguien que todavia no ha entrado nunca: el uid no existe hasta su primer
-- login. Se rellena ahi, y desde entonces sirve para saber con que cuenta entro.
CREATE TABLE IF NOT EXISTS "platform_admins" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" text NOT NULL,
  "name" text,
  "firebase_uid" text,
  -- Quien lo invito. `set null` y no `cascade`: que a alguien se le retire el
  -- acceso no puede borrar a la gente que invito mientras lo tuvo.
  "invited_by" uuid REFERENCES "platform_admins"("id") ON DELETE SET NULL,
  "last_seen_at" timestamp with time zone,
  -- Se retira, no se borra. La fila es el rastro de que esa persona tuvo acceso
  -- —y `platform_actions` apunta a ella—, asi que un DELETE dejaria el registro
  -- hablando de un id que ya no nombra a nadie.
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

-- Normalizado en minusculas por la aplicacion, y comprobado aqui: sin esto,
-- `XMathyu@Gmail.com` crea una segunda fila que el login nunca encuentra — y
-- peor, retirarle el acceso a una deja la otra viva.
ALTER TABLE "platform_admins" ADD CONSTRAINT "platform_admins_email_normalized"
  CHECK (email = lower(email) AND email <> '' AND length(email) <= 254);--> statement-breakpoint

-- Uno por correo, contando a los retirados: volver a invitar a alguien reabre
-- SU fila. Con un indice parcial sobre los vivos, cada vuelta crearia una fila
-- nueva y se perderia quien lo invito la primera vez.
CREATE UNIQUE INDEX IF NOT EXISTS "platform_admins_email_key"
  ON "platform_admins" ("email");--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "platform_admins_firebase_uid_key"
  ON "platform_admins" ("firebase_uid") WHERE firebase_uid IS NOT NULL;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- El registro
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "platform_actions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  -- `restrict` y no `cascade`: borrar a un administrador no puede borrar lo que
  -- hizo. Como el acceso se retira en vez de borrarse, esto no bloquea nada en
  -- la practica; es la red por si alguien escribe el DELETE a mano.
  "admin_id" uuid NOT NULL REFERENCES "platform_admins"("id") ON DELETE RESTRICT,
  "action" text NOT NULL,
  -- SIN clave foranea a `tenants`, a proposito. La accion que mas importa
  -- registrar es justo la que borra el gimnasio: con `cascade` se borraria con
  -- el, y con `restrict` impediria borrarlo. Queda el uuid suelto y, al lado,
  -- el nombre legible en `subject` — que es lo que se lee cuando el gimnasio ya
  -- no existe.
  "tenant_id" uuid,
  "subject" text,
  "reason" text,
  -- Lo que cambio, para poder mirar el antes y el despues de una edicion.
  "detail" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "platform_actions_recent_idx"
  ON "platform_actions" ("created_at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_actions_tenant_idx"
  ON "platform_actions" ("tenant_id");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Un gimnasio fuera de Sinchi
-- ---------------------------------------------------------------------------

-- `tenants.status` existia desde la migracion 0000 y nadie la escribia nunca:
-- el directorio ya filtraba por ella y no habia forma de ponerla en
-- `suspended`. Estas dos columnas son lo que faltaba para que suspender sea una
-- decision con dueno y motivo, y no una columna que alguien cambia en la consola
-- de Neon.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "suspended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "suspended_reason" text;--> statement-breakpoint

-- La misma forma que `subscriptions_canceled_has_date`: el estado y su fecha no
-- pueden separarse. Un gimnasio suspendido sin fecha es uno del que nadie sabe
-- desde cuando esta fuera, y uno activo con fecha es basura que se lee como una
-- suspension viva.
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_suspended_has_date" CHECK (
  (status = 'suspended') = (suspended_at IS NOT NULL)
);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- El primero
-- ---------------------------------------------------------------------------

-- El arranque del panel tiene el problema del huevo y la gallina: solo un
-- administrador puede invitar a otro, asi que el primero no puede entrar por el
-- panel. Nace aqui, escrito y versionado, que es mejor que una variable de
-- entorno —invisible en el repo, distinta en cada despliegue— y mucho mejor que
-- un endpoint de arranque que quede abierto para siempre.
--
-- El correo no es un secreto: es el del autor de cada commit de este repo. Lo
-- que da acceso no es conocerlo, sino presentarlo VERIFICADO por Google.
INSERT INTO "platform_admins" ("email", "name")
VALUES ('xmathyu@gmail.com', 'Mathyu Cardozo')
ON CONFLICT ("email") DO NOTHING;
