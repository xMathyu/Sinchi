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
| `GET` | `/gyms` | Gimnasios activos, con desde cuánto, cuántas clases por semana y si dan clase gratis. Anónima. |
| `GET` | `/gyms/:slug` | Horarios, precios y las clases concretas —con fecha— que se pueden reservar. Anónima. |
| `POST` | `/gyms/:slug/trial` | Reserva la clase gratis. Firma con un ID token de Firebase; nombre y celular si no tiene ficha. |
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
| `GET` | `/staff/trials` | Quién viene a probar. `?includePast=true` trae el historial. |
| `GET` | `/staff/trials/settings` | ¿Este gimnasio ofrece clase gratis? |
| `POST` | `/staff/trials/settings` | Solo el dueño: la enciende o la apaga. No cancela lo ya reservado. |
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

Los endpoints aceptan `clientId` para eso. Un reintento devuelve el registro que
ya existía con `alreadyRegistered: true` en vez de fallar.

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
