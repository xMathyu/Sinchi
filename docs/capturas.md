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
los dos píxeles por punto que pide una pantalla retina y ni uno más. Sale con
`sips`, que ya está en la Mac — no hace falta instalar nada:

```bash
sips -Z 1087 -s format avif -s formatOptions 75 captura.png --out roster-dark.avif
sips -Z 1087 -s format jpeg -s formatOptions 82 captura.png --out roster-dark.jpg
```

Los dos formatos, no uno: el AVIF pesa un tercio y lo entiende todo lo que no
sea un Safari anterior al 16.4, y el JPEG es el suelo para ese. `sips` **no**
sabe escribir WebP, que sería el término medio; si algún día hace falta, hay que
traer un codificador de fuera.
