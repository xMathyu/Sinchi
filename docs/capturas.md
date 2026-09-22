# Las capturas de la landing

Los cuatro teléfonos de [`apps/web`](../apps/web) son capturas de la app
corriendo, no dibujos. Esto es cómo se vuelven a sacar cuando una pantalla
cambia y la landing empieza a enseñar un producto que ya no existe.

Viven en `apps/web/public/screenshots/`, ocho archivos por formato:
`roster`, `plan`, `qr` y `denied`, cada uno en `-dark` y `-light`. Los coloca
`components/Screens.tsx`, que es donde está escrito por qué son capturas.

## De dónde salen los datos

**De la base local de Docker, nunca de la de producción.** Los nombres que se
ven —Nayeli Chávez, Luis Ttito, Mathyu Quispe— son de la siembra y de los
treinta alumnos de relleno; no existen. Una captura de un gimnasio real pondría
el nombre, el plan y la deuda de una persona en una página pública, que es el
motivo por el que esto estuvo dibujado durante meses.

La receta de la base y del simulador está en [`api.md`](api.md) y en
[`probar-app.md`](probar-app.md). En corto, con la api en el 3100 y Metro en el
8082 para no pisar los puertos de trabajo:

```bash
(cd apps/api && PORT=3100 DATABASE_URL=… npm run dev)
(cd apps/mobile && EXPO_PUBLIC_API_URL=http://localhost:3100/v1 npx expo start --dev-client --port 8082)
```

El padrón de la siembra son cinco alumnos, y cinco filas no se parecen a un
gimnasio. Para las capturas se le añaden veinticinco más, con los estados
repartidos, hasta los treinta que se leen en la portada. Va como SQL a mano y no
como script en `apps/api/src/db/`: un seeder versionado es un seeder que alguien
puede correr contra la base buena, y esto solo existe para una tarde de fotos.

```sql
-- Contra la base LOCAL de Docker. `dias` es cuándo le toca pagar respecto de
-- hoy —negativo es mora— y `pago` marca a quien ya pagó este mes.
DO $$
DECLARE
  t uuid; st uuid; u uuid; m uuid; s uuid; rec record; precio int;
  hoy date := (now() at time zone 'America/Lima')::date;
BEGIN
  select id into t from tenants where slug = 'dojo-shotokan';
  select id into st from staff where tenant_id = t limit 1;

  for rec in select * from (values
    ('Luis Ttito',      '44120981', '+51981000001', '2x por semana',    -9, 0),
    ('Carmen Ayala',    '44120982', '+51981000002', 'Ilimitado',        12, 1),
    ('Nayeli Chávez',   '44120992', '+51981000012', 'Ilimitado',       -16, 0)
    -- …hasta veinticinco, variando plan y días.
  ) as v(nombre, dni, cel, plan, dias, pago)
  loop
    insert into users (name, document_id, phone) values (rec.nombre, rec.dni, rec.cel)
      returning id into u;
    insert into memberships (user_id, tenant_id, status) values (u, t, 'active')
      returning id into m;
    select price_cents into precio from plans where tenant_id = t and name = rec.plan;
    insert into subscriptions (tenant_id, membership_id, plan_id, status,
                               start_date, period_start, next_billing_date)
      select t, m, id, 'active', hoy - 120, hoy + rec.dias - 30, hoy + rec.dias
      from plans where tenant_id = t and name = rec.plan returning id into s;
    if rec.pago = 1 then
      insert into charges (tenant_id, subscription_id, membership_id, type, amount_cents,
                           status, rail, attempt, period_start, period_end, recorded_by, created_at)
      values (t, s, m, 'renewal', precio, 'succeeded', 'cash', 1,
              hoy + rec.dias - 30, hoy + rec.dias, st,
              (hoy + rec.dias - 30)::timestamptz + interval '10 hours');
    end if;
  end loop;
END $$;
```

Al alumno de la captura se le cambia el plan a uno por sesiones y se le marca
una asistencia de esta semana: «1 de 2» es lo que la landing promete enseñar, y
un plan ilimitado dice «sin límite». La `iso_week` va como `to_char(dia,
'IYYY-"W"IW')`, que es el mismo formato que escribe `isoWeekOf`.

Al terminar se quitan —`delete from memberships` por esos celulares y luego
`delete from users`, en ese orden porque `memberships.user_id` es
`on delete restrict`— o se resiembra entera con `npm run db:seed -- --reset`.

## Quién entra a cada pantalla

| Captura  | Ruta                        | Sesión                          |
| -------- | --------------------------- | ------------------------------- |
| `roster` | `/staff/roster`             | Ana Ríos, `+51987000111`        |
| `plan`   | `/student/plan`             | Mathyu Quispe, `+51987654321`   |
| `qr`     | `/student/qr`               | Mathyu Quispe, `+51987654321`   |
| `denied` | `/result/<membershipId>`    | Ana Ríos, sobre un suspendido   |

Con `ALLOW_DEV_LOGIN=true`, `POST /v1/auth/dev-login { phone }` da la sesión.
Sin ventana de Simulator no se puede tocar la pantalla, así que se entra y se
navega con dos marcas `// QA-TEMP` —una llamada a `dev-login` al principio de
`restoreSession`, y un `router.push` en el arranque de `RootLayout`— que se
quitan antes de commitear. Está contado entero en [`probar-app.md`](probar-app.md).

**Si el QR se queda en «Preparando código…»** es que una corrida de las pruebas
de punta a punta volvió a cifrar el secreto TOTP con otra clave. Se arregla
rotándolo: `POST /v1/me/device {"rotate":true}` con el token del alumno.

## Las dos caras

El tema del simulador se cambia en vivo y React Native reacciona solo, así que
las dos capturas salen del mismo arranque:

```bash
xcrun simctl ui booted appearance dark   # …captura…
xcrun simctl ui booted appearance light  # …y otra
xcrun simctl io booted screenshot salida.png
```

La hora de la barra de estado se fija al reloj de verdad y no al 9:41 de la App
Store: la pantalla del corte pinta la hora del intento, y una barra clavada la
contradice dentro de la misma imagen.

```bash
xcrun simctl status_bar booted override --time "$(date +%H:%M)" \
  --batteryState charged --batteryLevel 100 \
  --cellularMode active --cellularBars 4 --wifiMode active --wifiBars 3
```

## Cómo se preparan para la web

El marco de la landing mide 242 px de contenido, así que 500 px de ancho son
los dos píxeles por punto que pide una pantalla retina y ni uno más. Van en dos
formatos: AVIF, que pesa la mitad que el JPEG y lo entiende todo lo que no sea
un Safari anterior al 16.4, y JPEG de suelo para ese.

**Con `sharp`, no con `sips`.** Es la trampa que costó una portada publicada en
blanco y merece las tres líneas: el AVIF que escribe `sips` no es una imagen,
es un **mosaico de tres tiles con un ítem `grid`**, y Chrome se lo descarga
entero y lo pinta VACÍO. No hay red de seguridad que lo ataje — `<picture>`
elige la fuente por el `type` que declara, no por si el navegador consiguió
decodificarla, así que el JPEG de debajo no entra nunca. El síntoma es
exactamente cuatro marcos de teléfono vacíos, con el alto correcto.

`sharp` no es dependencia de nadie aquí; se instala al vuelo en un directorio
de usar y tirar:

```bash
mkdir -p /tmp/enc && cd /tmp/enc && npm install sharp
node -e '
const sharp = require("sharp");
for (const n of ["roster", "plan", "qr", "denied"])
  for (const t of ["dark", "light"]) {
    const base = sharp(`/ruta/a/${n}-${t}.png`).resize({ width: 500 });
    base.clone().avif({ quality: 58, effort: 6 }).toFile(`${n}-${t}.avif`);
    base.clone().jpeg({ quality: 82, mozjpeg: true }).toFile(`${n}-${t}.jpg`);
  }
'
```

**Y se miran en Chrome antes de subirlas**, que es el paso que faltaba. Sin
Chrome abierto vale headless, y tarda lo que tarda arrancar:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --no-first-run --virtual-time-budget=4000 \
  --user-data-dir=/tmp/cp --window-size=1060,620 \
  --screenshot=/tmp/prueba.png "file:///tmp/prueba.html"
```

WebP sería el término medio —lo entiende todo desde 2020— y `sharp` también lo
escribe; se descartó por no sostener tres formatos para ahorrar diez kilobytes.

## Las de la ficha de App Store

Las ocho que había en `store/appstore/` eran **dibujos**: una reconstrucción de
la app con los tokens de `@sinchi/ui`, no la app. En la landing ese argumento ya
se había caído (ver el commit que las cambió); en la tienda se cae más fuerte,
porque quien instala esperando lo que vio en las capturas y encuentra otra cosa
desinstala, y esa desinstalación cuenta.

Ahora son las **mismas capturas del simulador** que usa la landing, compuestas
con un titular encima. Se rehacen con:

```bash
cd store/appstore/fuente && npm i sharp && node generar.mjs
```

Y salen las diez de `store/appstore/`: cinco de `iphone67` (1290×2796) y cinco
de `ipad13` (2064×2752).

Las diez PNG de `store/appstore/` son **las que están publicadas**, byte por
byte. `generar.mjs` las reconstruye desde `fuente/*.jpg` y el resultado no es
idéntico —el JPEG mueve algo los degradados oscuros del fondo, y a simple vista
no se distingue—, así que si algún día hay que volver a subirlas, se suben las
que salgan del generador y se commitean esas mismas.

**Las fuentes son `fuente/*.jpg`**, el original de 1206 px de ancho en JPEG de
calidad 94. En PNG pesaban 4,5 MB y aquí no aportan nada: se muestran reducidas
a 1046 px (iPhone) y 1000 px (iPad), así que siempre se reduce y nunca se
amplía. Si hay que sacar capturas nuevas, la receta entera —los datos sembrados,
quién entra a cada pantalla, cómo se navega sin poder tocar el simulador— es la
de arriba en este mismo archivo.

**Dos trampas del render, las dos costaron una tarde:**

- **Chrome se cuelga, sin error y sin log, si la página trae un PNG de 2 MB.**
  Siempre en la misma lámina, que era justo la de la captura más pesada. El
  síntoma engaña porque parece lentitud —la primera lámina sí sale— y se va
  reduciendo la imagen al tamaño en que de verdad se muestra antes de dárselo.
- **Los cuerpos de letra van en píxeles, no en fracción del ancho.** El lienzo
  de iPad es 1,6 veces más ancho que el de iPhone y casi igual de alto: con
  tipografía proporcional al ancho, el titular de iPad crecía hasta empujar el
  subtítulo por debajo del teléfono y lo dejaba cortado a media frase.

Y **las cinco se rinden en una sola tira** que se corta después con `sharp`:
arrancar Chrome cuesta cerca de un minuto en esta Mac y dibujar la página no
cuesta nada, así que cinco arranques por plataforma eran diez minutos de reloj
para algo que tarda dos.
