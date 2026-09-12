-- El gimnasio dice DONDE queda, y la app sabe llevarte.
--
-- El directorio listaba dojos con su precio, su horario y sus disciplinas, y
-- callaba lo primero que pregunta quien busca donde entrenar: donde esta. Nadie
-- cruza Lima para una clase de prueba, asi que una lista sin direcciones obliga
-- a abrir los cinco para descartar cuatro — o a no abrir ninguno.
--
-- DOS COLUMNAS Y NO UNA, y no es redundancia:
--
--   · `address` es el texto, escrito como se lo dirias a un taxista. Es lo que
--     se lee, lo que se copia y lo que sirve de busqueda cuando no hay pin;
--   · `latitude`/`longitude` es el punto exacto, si el dueno lo puso.
--
-- No se deriva la segunda de la primera. Geocodificar un texto escrito a mano
-- acierta casi siempre y falla justo donde importa: la cuadra sin numero, el
-- pasaje que el mapa no conoce, el «espalda del mercado». Un pin equivocado no
-- es un dato peor, es una persona parada frente a otra puerta a las siete de la
-- tarde. Lo pone el dueno, que sabe donde esta parado.
--
-- TODO NULLABLE, y eso si es una decision. Los gimnasios que ya existen no
-- tienen direccion y no se les puede inventar una: un NOT NULL con DEFAULT ''
-- convierte «no lo sabemos» en «esta en ninguna parte», y la ficha publica
-- ensenaria una linea vacia donde deberia decir que falta el dato. El alta si la
-- exige —igual que la mensualidad—, asi que los locales nuevos nacen con ella.
--
-- `double precision` y no `numeric`: son coordenadas, no dinero. Sobra precision
-- para el metro y medio que hace falta para encontrar una puerta, y se compara y
-- se ordena sin coste.
--
-- RLS: `tenants` es la tabla GLOBAL —dice que gimnasios existen y el directorio
-- publico la lee sin sesion— asi que no lleva politica por tenant y estas
-- columnas no cambian eso. Son publicas a proposito: una direccion que solo
-- vieran los alumnos no serviria para que alguien encuentre el local.
ALTER TABLE "tenants" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "latitude" double precision;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "longitude" double precision;--> statement-breakpoint

-- Un punto imposible es un error de tipeo, no una ubicacion. Sin esto, una
-- longitud de 770 —teclear «-77.0» sin el punto— pasa a la base y el mapa de la
-- app se va a un sitio que no existe.
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_coords_range" CHECK (
  ("latitude" IS NULL AND "longitude" IS NULL)
  OR ("latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180)
);
