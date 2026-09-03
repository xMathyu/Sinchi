-- Plan gratis: hasta 10 alumnos, sin costo y para siempre.
--
-- No es una promocion ni un periodo de prueba: es el precio de un local
-- pequeno. Un dojo que empieza con seis alumnos no tiene con que pagar S/149 y
-- tampoco tiene con que llevar un cuaderno bien; cobrarle desde el primer dia lo
-- deja fuera, y lo que queremos es que crezca DENTRO. Al pasar de 10 empieza a
-- costar, y ahi si se le da su mes por delante.
--
-- La consecuencia que ordena el codigo: un gimnasio en este escalon NO SE PUEDE
-- CORTAR. No debe nada, asi que no hay fecha que se le pase. `evaluateSaas` lo
-- resuelve antes que cualquier otra regla.
--
-- Los dos valores se AGREGAN a los enums existentes en vez de recrearlos:
-- recrear un tipo obliga a soltar y rehacer todas las columnas que lo usan
-- —`tenants`, `saas_subscriptions`, `saas_charges`— y eso es una migracion que
-- puede fallar a la mitad sobre datos reales. Postgres 12+ permite ADD VALUE
-- dentro de una transaccion mientras el valor no se USE en la misma, y aqui no
-- se usa: quien lo escribe es el trabajo diario, despues.

ALTER TYPE "public"."saas_tier" ADD VALUE IF NOT EXISTS 'free' BEFORE 'up_to_60';--> statement-breakpoint

ALTER TYPE "public"."saas_status" ADD VALUE IF NOT EXISTS 'free' BEFORE 'trialing';
