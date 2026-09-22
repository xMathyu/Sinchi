-- El gimnasio dice dónde más encontrarlo: su página web y sus redes.
--
-- Muchos dojos no tienen web; casi todos tienen Instagram, Facebook o TikTok, y
-- ahí es donde se ve cómo entrenan. A quien los encuentra en el directorio le
-- sirve poder ir a mirar antes de reservar.
--
-- TODO OPCIONAL y todo NULL por defecto, como el logo (0025).
--
-- Una columna por red y no una tabla de enlaces, porque son cuatro y fijas, y
-- porque cada una lleva su propia regla: la de Instagram garantiza que el enlace
-- abre Instagram. Con una tabla genérica (red, url), esa garantía sería un CASE.
--
-- Se guardan las direcciones CANÓNICAS que arma `normalizeGymLink`, nunca lo que
-- pegó el dueño. Los CHECK de abajo repiten la forma de esa dirección por lo de
-- siempre: la ficha dice «Instagram» al lado del enlace, y una fila escrita por
-- otro camino no puede poner ahí una dirección que abra otra cosa.
--
-- WhatsApp no está a propósito: con el alumno se habla por el chat de Sinchi
-- (decisiones §12).
--
-- RLS: `tenants` es la tabla global que el directorio lee sin sesión, y estas
-- columnas son públicas por lo mismo que la dirección: sirven para que alguien
-- encuentre el local.

ALTER TABLE "tenants" ADD COLUMN "website_url" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "instagram_url" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "facebook_url" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "tiktok_url" text;--> statement-breakpoint

-- La web: http o https, y nada más. Un `javascript:` en la ficha es un botón que
-- ejecuta código ajeno en el teléfono de quien lo toca. Y detrás del host solo
-- puede venir puerto, ruta o consulta: `https://midojo.pe@otro.com` abre
-- `otro.com`, aunque empiece como la web del gimnasio.
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_website_url_valid"
  CHECK (website_url IS NULL OR (
    website_url ~ '^https?://[^\s@/?#:]+\.[^\s@/?#:]+(:[0-9]{1,5})?([/?#][^\s]*)?$'
    AND length(website_url) <= 200
  ));--> statement-breakpoint

-- Cada red, con la forma exacta del perfil que arma el dominio.
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_instagram_url_valid"
  CHECK (instagram_url IS NULL OR instagram_url ~ '^https://www\.instagram\.com/[a-z0-9._]{1,30}$');--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_tiktok_url_valid"
  CHECK (tiktok_url IS NULL OR tiktok_url ~ '^https://www\.tiktok\.com/@[a-z0-9._]{2,24}$');--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_facebook_url_valid"
  CHECK (facebook_url IS NULL OR (facebook_url ~ '^https://www\.facebook\.com/[^\s]+$' AND length(facebook_url) <= 200));
