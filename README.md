# Sinchi

**Sinchi** (quechua: fuerte, valiente, guerrero). Plataforma de gestión para
gimnasios y escuelas de artes marciales. La app es la billetera de membresías
del alumno: una sola identidad que contiene sus suscripciones en todos los
gimnasios a los que asiste.

---

## Estado

| Parte | Estado |
|---|---|
| `packages/shared` — dominio y reglas puras | **Completo y con tests** (147 tests) |
| `packages/ui` — design system | **Completo** (tokens, semáforo, marca; 9 tests) |
| `apps/mobile` — app Expo, modo alumno y modo staff | **Completo** (11 pantallas del diseño + ajustes + directorio y clase gratis) |
| `apps/api` — NestJS + Postgres (Neon) | **Completo y conectado a Neon** (81 tests, 37 de punta a punta) |
| `apps/web` — panel Next.js | **No empezado** |
| Despliegue | api en **Cloud Run** (us-east4), contra Neon |
| Autenticación | Google vía Firebase + PIN de turno. Falta activar el proveedor en la consola |
| CI/CD | GitHub Actions con federación de identidad. Sin secretos en el repo |

La app todavía corre contra un store en memoria (`apps/mobile/src/data`) que pasa
por las mismas funciones puras que la api. Conectarla a la api real es cambiar ese
archivo por llamadas HTTP; las pantallas no se tocan.

### Versión 1: solo pagos manuales

**No hay cobro automático con tarjeta.** El único camino por el que entra dinero
es un pago que el staff registra en mostrador (efectivo, Yape o transferencia).
Culqi entra después.

El corte de acceso al moroso —que es el valor del producto— sí funciona
completo: gracia configurable, suspensión automática y check-in que deja de
validar. Ver [`docs/decisiones.md`](docs/decisiones.md) para el detalle.

---

## Arrancar

```bash
nvm use            # Node 24.8.0 (.nvmrc)
npm ci
npm run build      # compila shared y ui: la app los consume compilados
npm test           # 224 tests (282 con TEST_DATABASE_URL apuntando a una base)

cd apps/mobile
npm start          # Expo: pulsa i (iOS), a (Android)
```

`packages/shared` y `packages/ui` se consumen **compilados** (`dist/`), no como
fuente. Después de tocarlos, `npm run build` antes de recargar la app.

### Recorrido de la app

Abre en **modo alumno**. Para llegar al modo staff: toca el avatar arriba a la
derecha en Billetera → Ajustes → Rol de la sesión → Recepción.

Quien entra con una cuenta nueva —sin ficha en ningún padrón— aterriza en el
directorio, no en el código de 6 dígitos: ese código sigue existiendo, a un toque,
para el alumno al que su gimnasio dio de alta por DNI.

Desde la billetera, «¿Entrenas en otro gimnasio?» abre el **directorio**: los
gimnasios activos de la red con sus horarios y sus precios, y la reserva de la
primera clase gratis eligiendo día y hora. Es el único camino de alta que empieza
fuera del gimnasio, y el que atiende a quien todavía no entrena en ninguno. Lo
que reserva sale en el modo staff, en la pestaña «Clases gratis».

En el modo staff, «Simular escaneo» recorre el padrón, que está sembrado para
que salgan los cuatro veredictos del semáforo: al día, última sesión, cupo
agotado y suspendido por mora. «Simular corte de wifi» en Dispositivo ejercita
la cola offline.

---

## Estructura

```
/apps
  /mobile        Expo — la app (alumno + staff)
  /api           NestJS + Drizzle — dominio, cobro, check-in
  /web           Next.js — panel del gimnasio (pendiente)
/packages
  /shared        tipos, reglas puras (prorrateo, cupos, fechas, dunning)
  /ui            design system iOS-flavored
/docs
  especificacion.md  el documento de producto. El código lo cita por sección
  glosario.md        dominio en español ↔ código en inglés
  decisiones.md      qué se decidió y por qué; desviaciones del diseño
  api.md             rutas, autenticación, idempotencia, aislamiento por tenant
  autenticacion.md   Google vía Firebase, vinculación con el padrón, PIN de turno
  probar-en-dispositivo.md  por qué Expo Go no sirve; dev build con EAS
  decisiones-repo.md un repo o varios; CI/CD sin secretos en GitHub
  despliegue.md      Cloud Run: costo, el cron que no corre, cómo redesplegar
```

Los comentarios del código citan la especificación por número ("MD 4.3", "MD 8.1").
Está en [docs/especificacion.md](docs/especificacion.md).

### `apps/api` — la autoridad

Consume `packages/shared` tal cual: no reimplementa ninguna regla. Lo que hace y
la app no puede es ser la autoridad final.

- **Aislamiento por tenant en dos capas.** El repositorio filtra por `tenant_id`
  y las políticas RLS lo fuerzan en la base. Sin contexto de gimnasio no se ve
  ninguna fila: falla cerrado, verificado contra la base real. Requiere que la
  api se conecte con un rol **sin `BYPASSRLS`** — el que Neon crea por defecto lo
  tiene, y con él el aislamiento sería decorativo (`scripts/setup-app-role.sql`).
- **Idempotencia en la base, no en el código.** Un cargo de renovación por
  periodo, un marcado por alumno y día, y `client_id` único para la cola offline.
- **Verificación de la firma del QR**, que es justo lo que el dispositivo de la
  puerta no puede hacer sin conexión.
- **Secretos cifrados en reposo** con AES-256-GCM: el TOTP del alumno y las
  credenciales de pasarela del gimnasio.

Las migraciones se prueban contra Postgres de verdad (PGlite, en WASM, sin
Docker) y hay 37 pruebas de punta a punta que recorren la api por HTTP contra un
Postgres con RLS activo. Entre las dos encontraron cuatro bugs que habrían
llegado a producción: dos `CHECK` que pasaban con `NULL`, una ruta de import que
fallaba solo en tiempo de ejecución, y RLS bloqueando el propio login del staff.
Ver `docs/api.md`.

### `packages/shared` — el corazón

Todo lo que decide dinero o acceso vive aquí, como función pura y con tests.
Escribir el prorrateo dos veces es el bug que se descubre en el estado de cuenta
de un cliente tres meses después.

```
time/       fecha civil, semana ISO, zona horaria de Lima sin `Intl`
money/      céntimos enteros con tipo marcado, aritmética de prorrateo
domain/     entidades. `User` vive FUERA del tenant: la identidad es global
billing/    ciclo, prorrateo, cambio de plan, deuda derivada, dunning
checkin/    cupo semanal, validación con motivo estructurado, textos
security/   TOTP con HMAC inyectado, payload del QR
```

Las cuatro reglas que sostienen el producto:

- **Se cobra por adelantado.** `nextBillingDate` es el inicio del primer periodo
  no pagado; la deuda se deriva del ledger, nunca se guarda.
- **Upgrade cobra el diferencial prorrateado hoy y no mueve la fecha de cobro.
  Downgrade se aplica en la próxima renovación.** Así nunca hay devoluciones.
- **El cupo es semanal, no mensual,** en semana ISO y hora de Lima, y no se
  acumula. Se deriva contando asistencias, sin contador mutable.
- **El check-in valida en orden** —suscripción al día → día permitido → cupo →
  horario— y devuelve un motivo estructurado. «Acceso denegado» a secas es
  inútil frente al alumno.

### Convenciones

- Identificadores en **inglés**, comentarios y textos de interfaz en **español**.
  Nunca los dos idiomas en el mismo nombre. Ver `docs/glosario.md`.
- TypeScript estricto. Nada de `any` en el dominio de pagos.
- Montos en céntimos enteros con tipo marcado (`Cents`). Nunca floats.
- `ios/` y `android/` **no se versionan**: Expo los regenera con
  `npm run prebuild` desde `app.json`.
- `* text=auto eol=lf` y `forceConsistentCasingInFileNames` desde el primer
  commit: se desarrolla en Windows y macOS, el CI es Linux.
- Node fijado en `.nvmrc`, `npm ci` limpio en cada máquina. Nunca copiar
  `node_modules` entre sistemas.

---

## Lo siguiente

1. **Conectar la app a la api.** Reemplazar `apps/mobile/src/data/store.ts` por
   llamadas HTTP contra `/v1`. Las pantallas y el dominio no cambian.
2. **`apps/web` — panel del gimnasio.** La superficie que el cliente que paga usa
   a diario: alta de alumnos, planes, registro de pago manual, lista de morosos.
   La api ya expone todo lo que necesita.
3. **Activar el proveedor de Google en la consola de Firebase.** Tres clics; es
   lo único que falta para que la autenticación funcione de punta a punta. Ver
   [docs/autenticacion.md](docs/autenticacion.md).
4. **Notificaciones.** El cron de morosidad ya detecta cuándo alguien entra en
   gracia o se suspende; falta el canal. La reserva de clase gratis avisa al
   dueño por correo porque no puede esperar a que ese canal exista — un
   interesado del que el gimnasio se entera tarde no es un interesado.
5. **Culqi.** Antes de construir encima: sandbox completo (tokenizar, cobrar,
   cobrar con tarjeta rechazada, recibir webhook) y anotar los códigos de error
   reales para corregir la tabla de `billing/dunning.ts`, que hoy sale de la
   documentación pública. Evaluar tokenización desde React Native: Culqi tiene
   librerías nativas de iOS y Android pero no SDK oficial de RN.
6. **Verificación de firma del QR offline** en el dispositivo del staff. La api
   ya la verifica; lo que falta es que el equipo de la puerta pueda hacerlo sin
   conexión, y eso exige decidir si cachea las claves del padrón.
