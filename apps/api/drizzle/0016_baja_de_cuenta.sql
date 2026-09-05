-- El alumno puede pedir su baja desde la app, y no solo escribiendo un correo.
--
-- Lo exige Google Play para cualquier app que permita registrarse: tiene que
-- haber un camino DENTRO de la app y ademas una URL publica. La URL ya existe
-- (sinchi.fit/eliminar-cuenta); esto es el otro lado.
--
-- POR QUE UNA SOLICITUD Y NO UN BORRADO INMEDIATO. Porque la baja no es una
-- operacion de una tabla. La ficha del alumno vive en el gimnasio, sus cobros
-- son asientos contables que el gimnasio necesita para cuadrar caja, y su
-- historial de asistencias es de los dos. Un `DELETE` en cascada disparado
-- desde un boton del telefono borraria en un gimnasio ajeno sin que nadie lo
-- revise, y eso no se deshace. Queda la solicitud, con su rastro, y el borrado
-- lo ejecuta quien puede comprobar que corresponde — dentro de los 30 dias que
-- promete la politica publicada.
--
-- La fila NO es de un gimnasio: es de la persona, que puede entrenar en varios.
-- Por eso vive fuera de TENANT_SCOPED_TABLES y sin RLS por tenant, igual que
-- `users`. Se filtra por `user_id` contra el `sub` de la sesion, que es lo unico
-- que el cliente no puede elegir.

CREATE TYPE "public"."account_deletion_status" AS ENUM('pending', 'done', 'canceled');--> statement-breakpoint

CREATE TABLE "account_deletion_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "account_deletion_status" DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	-- Cuando se ejecuto o se cancelo. Sin esto no hay forma de demostrar que se
	-- cumplio el plazo si alguien reclama.
	"resolved_at" timestamp with time zone,
	-- Lo que escribio la persona al pedirla. Opcional, y util: la mitad de las
	-- bajas son en realidad "no puedo entrar a mi cuenta".
	"reason" text
);--> statement-breakpoint

ALTER TABLE "account_deletion_requests"
	ADD CONSTRAINT "account_deletion_requests_user_id_users_id_fk"
	FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
	ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- Una pendiente por persona, y el indice es lo que lo garantiza: dos toques
-- seguidos al boton son dos peticiones, y sin esto quedan dos filas y dos
-- correos al soporte por la misma baja.
CREATE UNIQUE INDEX "account_deletion_requests_one_pending"
	ON "account_deletion_requests" ("user_id")
	WHERE "status" = 'pending';--> statement-breakpoint

CREATE INDEX "account_deletion_requests_status_idx"
	ON "account_deletion_requests" ("status", "requested_at");
