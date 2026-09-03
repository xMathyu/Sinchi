# API

NestJS + Postgres (Neon), con Drizzle. Prefijo `/v1`.

Todo el dominio vive en `@sinchi/shared`: la api no reimplementa una regla, la
consume. Lo que sí hace la api y la app no puede es ser la autoridad final —
verificar la firma del QR, garantizar la idempotencia del cobro y aislar los
gimnasios entre sí.

---

## Arrancar

```bash
cd apps/api
cp .env.example .env        # y completa las tres variables obligatorias
npm run db:migrate          # aplica el esquema y verifica que RLS quedó activo
npm run db:seed             # tres gimnasios con los cuatro estados del semáforo
npm run dev                 # http://localhost:3000/v1
```

Variables obligatorias:

| Variable | Qué es |
|---|---|
| `DATABASE_URL` | La api. Rol `sinchi_app`, **sin BYPASSRLS**. Cadena del pooler. |
| `MIGRATION_DATABASE_URL` | Las migraciones. Rol dueño del esquema (`neondb_owner`). |
| `JWT_SECRET` | Firma de sesiones. `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `ENCRYPTION_KEY` | 32 bytes en base64. Cifra el secreto TOTP de cada alumno. `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |

Perder `ENCRYPTION_KEY` invalida todos los QR emitidos: los alumnos tendrían que
volver a vincular su dispositivo. Va en un gestor de secretos, no en el repo.

### Dar de alta un gimnasio real

`db:seed` es de demostración: **borra y rehace**. Para un cliente de verdad hay
un script por gimnasio con sus datos —planes, precios y horarios salen de sus
flyers— sobre el alta común de `seed-gym.ts`, que es idempotente por slug y no
borra nada:

```bash
npm run db:seed:kaizen -w @sinchi/api          # Asociación Deportiva Club Kaizen
npm run db:seed:fa-meng-chuen -w @sinchi/api   # Fa Meng Chuen
```

Volver a correrlo no actualiza nada: si el slug ya existe, lo dice y se va. Un
gimnasio que cambia de precios se toca desde el panel, no desde aquí.

### Por qué dos roles, y por qué no es opcional

**El rol que Neon crea por defecto tiene `BYPASSRLS = true`.** Conectando la api
con `neondb_owner`, las políticas de aislamiento por tenant no se le aplican:
`FORCE ROW LEVEL SECURITY` no cambia nada para un rol que puede saltárselo, y el
único filtro real pasa a ser el del repositorio.

Se comprueba en un segundo:

```sql
select rolsuper, rolbypassrls from pg_roles where rolname = current_user;
```

Por eso hay dos roles con dos trabajos:

| Rol | Trabajo |
|---|---|
| `neondb_owner` | Dueño del esquema. Corre migraciones. Nunca sirve tráfico. |
| `sinchi_app` | La api. Sin `BYPASSRLS`, sin ser dueño de nada, sin DDL. Sujeto a RLS. |

El rol de la api se crea una vez con `scripts/setup-app-role.sql`. `db:migrate`
verifica en cada corrida que el rol de `DATABASE_URL` no tenga `BYPASSRLS` y
avisa si lo tiene: es la diferencia entre tener aislamiento y creer que se tiene.

Verificado contra la base real con `sinchi_app`:

```
sin contexto                 -> 0 membresías          (falla cerrado)
contexto = dojo-shotokan     -> 6 membresías, 5 cargos
contexto = iron-muay-thai    -> 1 membresía,  1 cargo
en iron, pidiendo las de shotokan por su id -> 0 filas
insertar un plan en shotokan desde el contexto de iron -> rechazado (42501)
```

---

## Autenticación

`Authorization: Bearer <jwt>`. El guard es **global**: una ruta nueva nace
protegida y hay que marcarla `@Public()` para abrirla.

La forma del token refleja la del producto:

- **alumno** — el token lleva solo su identidad (`sub`). No fija gimnasio, porque
  pertenece a varios. El gimnasio sale de la membresía que pide, y se verifica
  que sea suya antes de tocar nada.
- **staff** — el token lleva `tenantId` y `staffId`. El `tenantId` **nunca** se
  acepta del cliente: un recepcionista no puede leer el padrón de otro local por
  más que escriba otro uuid en la URL.

La autenticación es **Google Sign-In vía Firebase** para alumnos y dueños, y
**token de equipo + PIN** para el staff del mostrador. El detalle está en
[`autenticacion.md`](autenticacion.md), incluido el problema que Firebase no
resuelve —vincular la cuenta con la ficha que la recepcionista ya creó— y cómo se
cierra sin agujeros.

`POST /v1/auth/dev-login` sigue existiendo para los tests de punta a punta: **no
verifica nada**, solo funciona con `ALLOW_DEV_LOGIN=true`, y la api se niega a
arrancar con esa bandera en producción.

---

## Rutas

### Sesión

| Método | Ruta | Qué hace |
|---|---|---|
| `POST` | `/auth/google` | Cambia un ID token de Firebase por sesión, o devuelve código de vinculación. Al registrarse acepta `fullName` y `phone`, que quedan con el código para no volver a pedirlos al reservar. |
| `GET` | `/auth/shift/staff` | Quiénes pueden abrir turno en este equipo (`X-Device-Token`). |
| `POST` | `/auth/shift` | Abre turno: token del equipo + PIN. Sesión de 12 h. |
| `POST` | `/auth/switch-to-student` | El dueño del dojo también entrena en él: puede mirar su propia billetera. |
| `POST` | `/auth/dev-login` | Emite sesión por celular. Sin verificar. Solo desarrollo. |

### Alumno (`/me`)

| Método | Ruta | Qué hace |
|---|---|---|
| `GET` | `/me` | Identidad + billetera. Es la primera pantalla de la app. |
| `GET` | `/me/wallet` | Membresías en todos los gimnasios de la red. |
| `POST` | `/me/device` | Siembra el secreto TOTP. `{ rotate: true }` cuando pierde el celular. |
| `GET` | `/me/memberships/:id` | Detalle con historial de pagos y asistencia. |
| `GET` | `/me/memberships/:id/checkin-preview` | Qué pasaría si marcara ahora. |
| `GET` | `/me/memberships/:id/plans` | Planes a los que puede cambiar. |
| `GET` `POST` | `/me/trials` | Sus clases gratis reservadas, y reservar una nueva. |
| `POST` | `/me/trials/:id/cancel` | Cancela una reserva suya. |
| `POST` | `/me/memberships/:id/plan` | Cambio de plan. Devuelve la decisión completa. |
| `POST` | `/me/memberships/:id/cancel` | Cancela. Sin congelamiento en el MVP. |

### Directorio y clase gratis (`/gyms`)

Las únicas rutas públicas que devuelven datos de negocio. Las llama alguien que
todavía no tiene sesión de Sinchi —y muchas veces ni ficha en ningún padrón—,
que es exactamente la persona que la clase gratis quiere convertir en alumno.

| Método | Ruta | Qué hace |
|---|---|---|
| `GET` | `/gyms` | Gimnasios activos, con desde cuánto, cuántas clases por semana y qué cuesta su clase de prueba (0 = gratis). Anónima. |
| `GET` | `/gyms/:slug` | Horarios, precios y las clases concretas —con fecha— que se pueden reservar. Anónima. |
| `POST` | `/gyms/:slug/trial` | Reserva la clase gratis. Firma con un ID token de Firebase; nombre y celular si no tiene ficha. |
| `POST` | `/gyms/signup` | **Da de alta un gimnasio** y devuelve sesión de dueño. La única ruta pública que crea un tenant: exige cuenta de Google verificada, RUC con dígito verificador y un gimnasio por persona. |
| `POST` | `/gyms/trials/mine` | Sus reservas. POST porque el token va en el cuerpo: en la query acabaría en los logs del balanceador. |
| `POST` | `/gyms/trials/:id/cancel` | Cancela la suya. Libera el cupo del gimnasio. |

Con sesión de alumno hay dos equivalentes que no vuelven a pedir el nombre ni el
celular —ya se saben—: `GET`/`POST /me/trials` y `POST /me/trials/:id/cancel`.

### Staff (`/staff`)

| Método | Ruta | Qué hace |
|---|---|---|
| `GET` | `/staff/roster` | Padrón con estado. Dos consultas, sin N+1. |
| `GET` | `/staff/roster/search?q=` | Por nombre o documento. |
| `GET` | `/staff/members/:id` | Detalle para la pantalla de cobro. |
| `POST` | `/staff/members` | Alta. Reutiliza la identidad si ya existe en la red. |
| `POST` | `/staff/members/:id/resubscribe` | Vuelve tras cancelar, sin re-registrar a la persona. |
| `GET` | `/staff/plans` · `/staff/schedules` | Configuración del local. |
| `POST` | `/staff/checkin/qr` | Modo A: el staff escanea. Verifica la firma TOTP. |
| `POST` | `/staff/checkin/manual` | Alumno sin celular. Queda auditado. |
| `GET` | `/staff/checkin/recent` | "Últimos marcados" de la puerta. |
| `POST` | `/staff/payments` | Registra un pago en mostrador. |
| `POST` | `/staff/sync` | Sube la cola offline en un solo viaje. |
| `GET` | `/staff/summary` | Solo el dueño: cobrado, deuda, morosos. |
| `GET` | `/staff/subscription` | Solo el dueño: su suscripción a Sinchi, cuánto le queda de mes gratis y qué pasa al terminar. |
| `POST` | `/staff/promo` | Solo el dueño: canjea un código y suma meses gratis. Abierta en solo lectura — es por donde un gimnasio cortado vuelve. |
| `GET` | `/staff/trials` | Quién viene a probar, de hoy en adelante. `?onlyPast=true` trae el historial. Las dos listas son disjuntas. |
| `GET` | `/staff/trials/settings` | ¿Este gimnasio ofrece clase gratis? |
| `POST` | `/staff/trials/settings` | Solo el dueño: la enciende o la apaga. No cancela lo ya reservado. El precio se fija al dar de alta el gimnasio. |
| `POST` | `/staff/trials/:id/status` | Vino, no vino o canceló. |
| `GET` | `/staff/claims` | Códigos de vinculación vigentes. |
| `POST` | `/staff/claims/confirm` | Vincula una cuenta de Google a una ficha del padrón. |
| `DELETE` | `/staff/members/:id/account` | Solo el dueño: desvincula. |
| `POST` | `/staff/pin` | Fija el PIN de turno. |
| `GET` `POST` | `/staff/devices` | Solo el dueño: equipos del mostrador. |
| `DELETE` | `/staff/devices/:id` | Solo el dueño: revoca un equipo. |

### Salud

| Método | Ruta | Qué hace |
|---|---|---|
| `GET` | `/health` | ¿Vive el proceso? |
| `GET` | `/health/ready` | ¿Además llega a la base? |

Separadas a propósito: mezclarlas hace que un balanceador reinicie la api por una
caída de Neon, que es justo lo que no ayuda.

---

## Decisiones que se notan al usarla

### Un rechazo de check-in devuelve 200

Lo mismo vale para la reserva de una clase gratis: `booked: false` con el motivo
—ya la usaste, el gimnasio no la ofrece, esa clase ya no existe— y cada uno
tiene una salida distinta para quien lo lee.

No es un error de la petición: es el resultado del negocio. El staff necesita el
motivo estructurado en pantalla para saber qué hacer, y un 4xx lo convierte en un
"algo falló" genérico.

```json
{
  "registered": false,
  "result": { "allowed": false, "level": "alert",
              "reason": { "code": "quota_exhausted", "limit": 2, "used": 2,
                          "offerDropIn": true, "dropInPriceCents": 2500 } },
  "message": { "title": "Cupo semanal agotado",
               "reason": "2 de 2 sesiones usadas esta semana.",
               "action": "Cobrar clase suelta S/ 25" }
}
```

El `message` viene de `@sinchi/shared`, así que la app del alumno y la del staff
dicen exactamente lo mismo del mismo hecho.

### El estado se calcula, no se lee

`subscriptions.status` es un **caché** para poder filtrar en SQL. La verdad la
calcula `evaluateDelinquency` en cada lectura, y la deuda la deriva
`computeReceivable` del ledger. No hay columna de saldo: un saldo guardado se
desincroniza y después nadie sabe cuál de los dos miente.

El cron `refresh-delinquency` (06:00 Lima) refresca el caché y es el momento
definido del día para notificar. **La notificación no está implementada**: el
canal no está decidido, y un `console.log` disfrazado de aviso es peor que nada
porque parece que el alumno fue avisado.

### Idempotencia

Tres garantías, todas en la base y no en el código:

- `charges_renewal_once_per_period` — un solo cargo de renovación exitoso por
  periodo. Si el cron corre dos veces, el segundo insert choca.
- `attendance_once_per_day` — un marcado por alumno y día local. Un doble escaneo
  en la puerta no le come una sesión del cupo.
- `client_id` único por tenant en `charges` y `attendance` — reintentar la cola
  offline no duplica nada.
- `saas_charges_reference_once` — el número de operación de la transferencia con
  la que el gimnasio paga Sinchi. Hace falta **además** del índice por periodo:
  registrar un pago adelanta la fecha de cobro, así que anotar dos veces el mismo
  depósito no chocaría por periodo, le cobraría dos meses.

Los endpoints aceptan `clientId` para eso. Un reintento devuelve el registro que
ya existía con `alreadyRegistered: true` en vez de fallar.

### Hasta 10 alumnos no se paga nada

El primer escalón es **gratis y permanente**: un dojo de seis alumnos no tiene
con qué pagar S/ 149, y cobrarle desde el primer día lo deja fuera cuando lo que
queremos es que crezca dentro.

La consecuencia ordena el código: **un gimnasio del plan gratis no se puede
cortar**. No debe nada, así que no hay fecha que se le pase. `evaluateSaas` lo
resuelve antes que cualquier otra regla, y por eso el escalón es un campo
obligatorio de su entrada: si faltara, un local pequeño acabaría en solo lectura
por una deuda de cero soles.

Al pasar de 10 empieza a costar, y **el cambio no corta a nadie de golpe**: el
trabajo diario le da un mes por delante, el mismo que tuvo al darse de alta. Sin
eso, un gimnasio con un año gratis a la espalda tendría su fecha de cobro un año
atrás y quedaría cortado el mismo día que creció.

El escalón se **deriva del padrón**, no de lo que el dueño declaró al
registrarse: esa columna se fija una vez y nadie la vuelve a tocar. Se cachea en
`saas_subscriptions.tier` y lo refresca el trabajo diario, para que el guard no
tenga que contar alumnos en cada escritura — y para que la franja del dueño y el
corte cuenten siempre lo mismo.

### El gimnasio que no paga queda en solo lectura, nunca sin puerta

Todo gimnasio entra con **un mes gratis** desde su alta. Al vencer se cobra por
adelantado con la tarifa de su escalón (S/ 149 / 299 / 499 según el padrón) y,
pasados 7 días de gracia, la cuenta cae a solo lectura.

Qué significa exactamente:

| Sigue funcionando | Se bloquea |
|---|---|
| `POST /staff/checkin/qr` y `/checkin/manual` | `POST /staff/members` y `/members/:id/resubscribe` |
| `POST /staff/sync` — repite lo que ya pasó en el mostrador | `POST /staff/payments` |
| `POST /staff/pin` y `/staff/devices` — sin PIN ni equipo no hay puerta | `POST /staff/trials/settings` |
| Los `DELETE`: revocar invitación, desvincular cuenta, revocar equipo — solo quitan acceso | `POST /staff/invites` y `/staff/claims/confirm` |
| Todos los `GET`: padrón, deuda, historial, reportes | Sale del directorio: `GET /gyms` y `GET /gyms/:slug` |

Vincular una cuenta de Google a una ficha (`claims/confirm`) sí se bloquea, y es
el caso más discutible de la tabla: el alumno ya existe y ya paga. No queda
tirado —en la puerta lo marcan a mano igual, que es lo que importa— y esperar
unos días a tener la app no es que le nieguen la entrada.

La regla que ordena esa tabla: **el corte de Sinchi al gimnasio nunca cae sobre
el alumno**. Cerrar la puerta castigaría a quien sí le pagó a su gimnasio,
delante de todos, y la reacción del dueño sería volver al cuaderno ese mismo día.
Lo que se corta es crear futuro —alumnos nuevos, cobros nuevos, interesados
nuevos— y eso hace imposible operar el día a día sin quitarle nada de lo que ya
tiene. Los datos siguen siendo suyos y siguen visibles.

Lo aplica `SaasGuard`, global y **cerrado por defecto**: cualquier ruta de
escritura nueva nace cortada para el gimnasio impago, y abrirla exige
`@AllowedWhenReadOnly()`. Al revés, cada ruta nueva regalaría el producto sin que
nada fallara nunca.

El estado se calcula (`evaluateSaas` en `packages/shared`);
`saas_subscriptions.status` es un caché que refresca el mismo trabajo diario que
la morosidad. Registrar el pago levanta el corte en el acto:

```bash
npm run saas:status -w @sinchi/api                       # todos los gimnasios
npm run saas:pay -w @sinchi/api -- kaizen transferencia 00123456
```

### Códigos de promoción

Un código no descuenta el precio: mueve `free_until` hacia adelante. Así el motor
de cobro sigue sin saber que las promociones existen y lo único que cambia es una
fecha.

```bash
npm run saas:promo -w @sinchi/api -- new VERANO2026 1 20 "campaña de enero"
npm run saas:promo -w @sinchi/api -- list
npm run saas:promo -w @sinchi/api -- off VERANO2026
```

El tope de usos **no** se comprueba en el código: vive en un `CHECK` y en un
`UPDATE ... WHERE redeemed_count < max_redemptions`. Dos gimnasios canjeando el
último uso en el mismo segundo leen los dos «9 de 10» y los dos entrarían con un
`if`. Y `saas_redemptions` tiene índice único por `(código, gimnasio)`: sin él, un
solo gimnasio podría gastar los diez usos.

Un código mal escrito vuelve con **200 y `redeemed: false`** más el motivo, como
el rechazo de un check-in.

No hay pantalla para cobrar a propósito: con un puñado de gimnasios, quien cobra
es una persona mirando el correo del banco una vez al mes.

### Aislamiento por tenant

Dos capas. El repositorio filtra por `tenant_id`; **y** las políticas RLS de la
migración `0001` lo fuerzan en la base con `FORCE ROW LEVEL SECURITY`, que aplica
también al dueño de la tabla (en Neon, el rol con el que se conecta la api).

El contexto se fija por transacción con `set_config(..., true)`:

```ts
withTenant(db, tenantId, (tx) => tx.select().from(schema.charges))
```

Sin contexto, `app_current_tenant()` devuelve NULL, la comparación da NULL y no
se ve ninguna fila. **Falla cerrado**: una consulta que olvidó el contexto
devuelve vacío en vez de devolver todo.

Una excepción, deliberada: `memberships` permite además leer las propias
(`user_id = app_current_user()`). Sin ella, la billetera no podría ni averiguar a
qué gimnasios pertenece el alumno, porque para eso necesitaría saberlo antes. Es
una comparación de columna, sin subconsultas. Todo lo demás sigue exigiendo
contexto de gimnasio, una transacción por gimnasio.

---

## Migraciones

```bash
npm run db:generate          # tras tocar src/db/schema.ts
npm run db:migrate           # aplica y verifica que RLS siga activo
npm test                     # migraciones contra Postgres en WASM, sin base
```

Para las pruebas de punta a punta hace falta un Postgres con un rol que **no**
tenga BYPASSRLS, o el aislamiento no se prueba:

```bash
docker run -d --name sinchi-pg -e POSTGRES_PASSWORD=postgres -p 55432:5432 postgres:17
docker exec -i sinchi-pg psql -U postgres -c "create role sinchi_app login password 'app_local' nosuperuser nobypassrls"
docker exec -i sinchi-pg psql -U postgres -c "create database sinchi_test owner sinchi_app"

DATABASE_URL="postgresql://sinchi_app:app_local@localhost:55432/sinchi_test" npm run db:migrate
TEST_DATABASE_URL="postgresql://sinchi_app:app_local@localhost:55432/sinchi_test" npm test
```

`src/app.e2e.test.ts` levanta la api completa y la recorre por HTTP: 37 pruebas
que van desde el login hasta que el QR firmado en el dispositivo del alumno
valida en la puerta. Se resiembra la base en `beforeAll`, así que corre dos veces
seguidas con el mismo resultado.

`0000_inicial.sql` lo genera Drizzle. `0001_invariantes_y_rls.sql` está **escrito
a mano**: son los invariantes que Drizzle no expresa (índices únicos parciales,
CHECK con CASE) y las políticas RLS.

`src/db/schema.test.ts` aplica las migraciones sobre **PGlite** (Postgres
compilado a WASM: sin Docker, dos segundos) y comprueba que los CHECK realmente
rechacen. No es ceremonia: encontró dos restricciones que pasaban con `NULL` por
la lógica trivaluada de SQL —`fixed_day` sin día de cobro, y `sessions_per_week`
sin número de sesiones— y las dos habrían llegado a producción. La segunda dejaba
al alumno de plan 2x entrando todos los días.
