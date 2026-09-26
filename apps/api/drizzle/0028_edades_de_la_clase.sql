-- La clase dice para qué edades es.
--
-- Lo pidió un dojo con estas palabras: «hay judo kids de 3 a 7 años y después
-- de esa clase, en otro horario, judo kids de 8 a 13». Dos bloques con el mismo
-- nombre y horas distintas que hasta ahora solo se podían distinguir escribiendo
-- la edad dentro del nombre —«Judo kids (3-7)»—, que es texto libre: cada dueño
-- lo escribe a su manera y el directorio no puede decir nada con él.
--
-- Dos columnas y no un texto porque el rango se LEE: «3 a 7 años», «desde 18»,
-- «hasta 13» los arma `formatAgeRange` para que se escriban igual en todos los
-- gimnasios. Las dos opcionales y por separado: «adultos, desde 16» no tiene
-- máximo y «hasta 5 años» no tiene mínimo. Sin ninguna, la clase es para todos,
-- que es lo que era cada bloque antes de esta migración.
--
-- No restringe quién reserva ni quién entra: quien reserva la clase de un niño
-- es casi siempre su padre, con su cuenta, y la puerta no sabe la edad de nadie.
-- Es información para elegir bien, no una regla de acceso.
--
-- Los CHECK repiten `checkScheduleDraft` por lo de siempre: una fila escrita por
-- otro camino no puede dejar en la ficha un «de 13 a 8 años».

ALTER TABLE "class_schedules" ADD COLUMN "min_age" smallint;--> statement-breakpoint
ALTER TABLE "class_schedules" ADD COLUMN "max_age" smallint;--> statement-breakpoint

ALTER TABLE "class_schedules" ADD CONSTRAINT "class_schedules_ages_valid"
  CHECK (
    (min_age IS NULL OR min_age BETWEEN 0 AND 99)
    AND (max_age IS NULL OR max_age BETWEEN 0 AND 99)
    AND (min_age IS NULL OR max_age IS NULL OR min_age <= max_age)
  );
