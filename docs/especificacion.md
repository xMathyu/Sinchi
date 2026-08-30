# Sinchi — plataforma de gestión para gimnasios y escuelas de artes marciales

> **Sinchi** (quechua: fuerte, valiente, guerrero). La app es la billetera de membresías del alumno:
> una sola identidad que contiene sus suscripciones en todos los gimnasios a los que asiste.

> Documento de contexto y especificación. Léelo completo antes de escribir código.
> Las secciones marcadas **[DECIDIDO]** ya se discutieron: no las re-litigues, impleméntalas.
> Las marcadas **[PENDIENTE]** requieren respuesta del dueño del producto antes de codificar esa parte.

> **Nota de implementación.** Los comentarios del código citan este documento por número de
> sección ("MD 4.3", "MD 8.1"). Lo que se decidió al implementar, y las desviaciones respecto
> de aquí, están en [`decisiones.md`](decisiones.md).

---

## 1. El producto en una frase

SaaS multi-tenant donde escuelas de artes marciales y gimnasios pequeños gestionan alumnos, cobran mensualidades recurrentes y controlan asistencia por QR — con corte automático de acceso al alumno moroso.

**El dolor que resuelve:** un dojo de 60 alumnos con 20% de morosidad pierde ~S/ 1,500 al mes en gente que entrena y no paga. Hoy lo controlan con cuaderno o Excel y no cortan el acceso porque es incómodo hacerlo cara a cara. El sistema lo hace por ellos.

**Mercado:** Lima, Perú. Dojos de karate, taekwondo, BJJ, muay thai, boxeo. 30–150 alumnos por local.

**Competidor directo:** Fitco (peruana). Nuestra diferenciación: rieles de pago locales (Culqi, Yape, soles) y foco en artes marciales, no en estudios boutique de pilates/yoga.

---

## 2. Modelo de negocio **[DECIDIDO]**

- Cobramos **suscripción mensual fija al gimnasio**, no porcentaje por transacción.
  - Razón: el porcentaje le da al dueño un incentivo diario para sacarnos del flujo ("págame por Yape directo"). Con precio fijo nos da igual por dónde entre el pago.
- Tramos por **alumnos activos** (que marcaron asistencia o pagaron ese mes), no registrados:
  - Hasta 60 alumnos → S/ 149/mes
  - 61 a 150 → S/ 299/mes
  - Más de 150 o multi-sede → S/ 499/mes
- El alumno paga su mensualidad al **gimnasio**, no a nosotros.
- **Dogfooding obligatorio:** la suscripción SaaS del gimnasio se cobra con nuestro propio motor de cobro recurrente. Si falla con nosotros, nos enteramos antes que el cliente.

---

## 3. Decisiones de arquitectura ya tomadas **[DECIDIDO]**

| Decisión | Elección | Razón |
|---|---|---|
| App móvil | **Expo (React Native)** | Un solo lenguaje (TS) en app + web + backend; la lógica de prorrateo se escribe una vez. Además usa vistas nativas, así que hereda el diseño de iOS automáticamente. |
| Panel del gimnasio | **Next.js web** | El staff opera desde mostrador, no desde celular. |
| Backend | **NestJS + PostgreSQL** | |
| Estilo visual | iOS-flavored en ambas plataformas | En iOS sale nativo; en Android se replica con design system propio (`expo-blur`), sin componentes Material. **Los patrones de navegación sí se respetan por plataforma** (botón atrás de Android, share sheet). |
| Pasarela | **Culqi** | Stripe no admite entidades peruanas ni cobros en soles; requeriría LLC en EE.UU., y los gimnasios peruanos tampoco podrían tener cuenta. Culqi además soporta Yape. |
| Motor de facturación | **Propio, no Culqi Suscripciones** | La API de Culqi fija el `plan_id` al crear la suscripción y su endpoint de actualización solo modifica metadata. No permite cambio de plan in-place. Nosotros llevamos el ciclo; a Culqi solo le pedimos "cóbrale S/ X a esta tarjeta". |
| Pagos en tiendas | Sin IAP | Las clases son servicio del mundo real → excepción de Apple 3.1.3(e) y Google. **Si algún día se venden rutinas o video dentro de la app, eso sí exige IAP.** |

---

## 4. Reglas de negocio críticas **[DECIDIDO]**

Estas son el corazón del producto. Van con tests unitarios antes que cualquier pantalla.

### 4.1 Ciclo de cobro

- **Se cobra por adelantado**, en la fecha de renovación, por el periodo que empieza. Nunca al final del periodo consumido.
- Zona horaria de referencia: `America/Lima`. Toda fecha de corte se evalúa en hora local.
- Montos en **enteros de céntimos**, moneda `PEN`. Nunca floats.
- El job de cobro es **idempotente**: índice único en `(subscription_id, periodo_inicio)` para cargos de tipo `renovacion`. Si el cron corre dos veces, no cobra dos veces.

### 4.2 Cambio de plan (2x ↔ 3x por semana)

- **Upgrade:** se cobra el diferencial prorrateado **hoy mismo** como cargo único a la tarjeta guardada; el plan cambia de inmediato; `next_billing_date` **no se toca**.
- **Downgrade:** no se cobra nada; se guarda en `plan_pendiente_id` y se aplica en la próxima renovación. Así nunca hay devoluciones.

### 4.3 Tipos de plan y cupos de asistencia

El plan no es solo "N veces por semana". Hay tres formas, y el motor de validación debe soportar las tres desde el inicio:

| Tipo | Qué significa | Validación |
|---|---|---|
| `ilimitado` | Paga el mes y entra cuando quiera | Solo suscripción al día |
| `sesiones_semana` | 2x o 3x por semana, cualquier día | Suscripción al día + cupo semanal disponible |
| `dias_fijos` | Asignado a días concretos (ej. lunes y miércoles) | Suscripción al día + hoy está en `dias_permitidos` |

Los dos últimos se pueden combinar: un plan de 2 sesiones semanales restringido a lunes–viernes (sin sábados) es `sesiones_semana` con `dias_permitidos` recortado.

Reglas del cupo:

- El cupo es **semanal**, no mensual. "3 veces por semana" ≠ "12 al mes".
- Semana ISO, de lunes a domingo, en hora de Lima.
- Las sesiones no usadas **no se acumulan** (si se acumulan, revienta el aforo del sábado).
- Orden de validación del check-in: suscripción al día → día permitido → cupo semanal disponible → hay clase en ese horario.
- La función de validación vive en `packages/shared` como función pura y devuelve un **motivo estructurado** cuando rechaza (`morosidad`, `dia_no_permitido`, `cupo_agotado`, `fuera_de_horario`). El motivo se muestra al staff en pantalla — "acceso denegado" a secas es inútil en la puerta.

### 4.4 Morosidad y corte de acceso (dunning)

- Reintentos de cobro: día 0, +3, +7.
- Periodo de gracia configurable por gimnasio (default 5 días) durante el cual el alumno **sí** puede entrenar.
- Vencida la gracia: la suscripción pasa a `suspendida` y el check-in deja de validar.
- Cada intento fallido guarda el **código de error de Culqi**. La política de reintentos depende de ese código: no es lo mismo fondos insuficientes que tarjeta bloqueada.
- Notificación al alumno en cada fallo y al suspender.
- **Esto es feature del producto, no manejo de errores.** Es lo que define cuánto recupera cada escuela.

### 4.5 Pagos fuera de la app

Buena parte de los alumnos paga en efectivo o Yape en mostrador. Si el sistema no lo contempla, se desincroniza de la realidad y el dueño lo abandona.

- El staff puede registrar un **pago manual** (efectivo / Yape / transferencia) desde el panel.
- Un pago manual crea un `charge` igual que un cobro con tarjeta y **activa el mismo ciclo**: extiende `next_billing_date`, reactiva la suscripción, libera el check-in.
- El ledger de `charges` es la única fuente de verdad del estado de pago, sin importar el método.

### 4.6 Check-in

La misma app sirve al alumno y al staff; el rol define qué ve al abrirla. Hay **dos modos de marcado** y el gimnasio elige cuál usa según tenga recepcionista o no:

**Modo A — staff escanea (recepción con persona).** El alumno muestra su QR, el staff lo escanea con la cámara desde su rol admin. Al validar, la pantalla del staff muestra en grande: nombre, **foto del alumno**, plan, sesiones restantes de la semana y semáforo verde/rojo con el motivo.
- La foto no es decorativa: es lo único que impide que un alumno le pase el celular a un amigo en la puerta.

**Modo B — alumno escanea (puerta sin personal).** Tablet o celular fijo mostrando el QR del local; el alumno lo escanea con su app.

**Requisito común, no negociable:** todo QR es **de vida corta y firmado** (TOTP, ventana de 30s), lo genere quien lo genere. Un QR estático del alumno circula por WhatsApp en una semana y se pierde el control de aforo.

- El código del alumno se genera **en su dispositivo** a partir de un secreto sembrado al vincular la cuenta, así funciona sin internet en su celular.
- **Offline-first en el lado del staff:** el wifi de los gimnasios es malo. El dispositivo de staff mantiene caché del padrón y de suscripciones vigentes, valida localmente, registra y sincroniza después. El servidor reconcilia y es la autoridad final.
- El staff puede además **marcar asistencia manual** (alumno sin celular o batería muerta) buscando por nombre o documento. Queda registrado como `metodo = manual` y con `registrado_por`, porque es el hueco por donde se cuelan favores.
- No prometer integración con torniquetes ni biométricos existentes. Cada marca es un mundo.

**Roles dentro de la app:** `alumno` (su plan, su QR, su historial), `recepcion` (escanear, marcar manual, registrar pago en efectivo/Yape), `owner` (todo lo anterior + reportes). El panel web sigue siendo para la administración pesada: planes, precios, morosidad, alta masiva.

### 4.7 Congelamiento

- **No hay congelamiento en el MVP.** Si un alumno para, se cancela y se vuelve a suscribir.
- La tarjeta guardada (objeto `card` de Culqi) **sobrevive a la cancelación**, así que volver debe ser un tap, sin re-ingresar datos.
- Nota comercial: cancelar y renovar *es* pausar visto desde el alumno. La retención depende de que volver sea trivial.

### 4.8 Clase gratis y directorio **[DECIDIDO al implementar]**

- La app lista los **gimnasios activos** de la red, sin necesidad de sesión: quien busca dojo todavía no tiene cuenta.
- De cada uno se ven sus **horarios y sus precios**, y si ofrece la **primera clase gratis** (configuración del gimnasio, por defecto sí).
- El interesado **elige día y hora** entre las clases reales de las próximas dos semanas y queda anotado. El gimnasio recibe un aviso por correo y la lista de quién viene, con el celular de cada uno: son sus posibles alumnos.
- Reservar exige una cuenta (Google o correo) pero **no** una ficha en ningún padrón: es justo la persona que todavía no entrena en ningún sitio.
- Una por persona y por gimnasio. El mostrador marca quién vino y quién no.
- No controla aforo: ver 8.3, que sigue abierto.

---

## 5. Modelo de datos (borrador)

Todo dato operativo lleva `tenant_id`. Aislamiento por RLS de Postgres o middleware que inyecta el contexto de tenant en cada query — nunca confiando en que el query lo recuerde.

**Excepción crítica: la identidad del alumno es global.** El objetivo del producto es que una persona tenga en una sola app todas sus suscripciones, de todos los gimnasios a los que asiste. Por eso `users` existe **fuera** del tenant y `memberships` lo vincula a cada gimnasio. Si la identidad naciera dentro del tenant, el mismo alumno quedaría duplicado en cada local y unificarlo después sería una migración dolorosa. Esta separación va desde la primera migración, aunque el MVP tenga un solo gimnasio.

```
users              id, nombre, doc, email, celular (único), foto_url,
                   totp_secret_cifrado, created_at
memberships        id, user_id, tenant_id, alias_interno, estado
                   -- un mismo user puede tener N memberships activas
```

El QR del alumno se deriva de su secreto **global**: un solo código lo identifica en cualquier gimnasio de la red, y el servidor resuelve contra qué membresía y suscripción validarlo.

Resto del esquema, todo dentro del tenant:

```
tenants            id, nombre, ruc, slug, timezone, plan_saas, dias_gracia, estado
tenant_gateway     tenant_id, culqi_public_key, culqi_secret_key_cifrada, activo
members            (ver `users` + `memberships` arriba — identidad global)
staff              id, tenant_id, user_id, rol (owner|recepcion)
plans              id, tenant_id, nombre,
                   tipo (ilimitado|sesiones_semana|dias_fijos),
                   sesiones_por_semana, dias_permitidos (array 1..7),
                   precio_centavos, activo
subscriptions      id, tenant_id, member_id, plan_id, plan_pendiente_id,
                   estado (activa|en_gracia|suspendida|cancelada),
                   fecha_inicio, next_billing_date, cancelada_at
payment_methods    id, tenant_id, member_id, culqi_customer_id, culqi_card_id,
                   marca, last4, exp_mes, exp_anio, activa
charges            id, tenant_id, subscription_id, member_id, tipo
                   (renovacion|prorrateo|matricula|clase_suelta|saas),
                   monto_centavos, estado (pendiente|exitoso|fallido),
                   metodo (tarjeta|yape|efectivo|transferencia),
                   culqi_charge_id, codigo_error, intento_n,
                   periodo_inicio, periodo_fin, registrado_por, created_at
class_schedule     id, tenant_id, nombre, dia_semana, hora_inicio, hora_fin,
                   aforo, instructor
attendance         id, tenant_id, member_id, subscription_id, class_session_id,
                   marcado_at, semana_iso, metodo (qr|manual),
                   device_id, sincronizado_at
checkin_devices    id, tenant_id, nombre, totp_secret, activo
webhook_events     id, culqi_event_id (único), tipo, payload, procesado_at
```

Notas:
- El cupo semanal se **deriva** contando `attendance` de la semana ISO actual. No se guarda un contador mutable.
- `charges` es un ledger append-only. Nada de actualizar montos: se crea un cargo nuevo.
- Credenciales de Culqi por tenant **cifradas en reposo**, nunca en texto plano ni en logs.

> Los nombres de columna reales están en inglés `snake_case`; la correspondencia con este
> borrador está en [`glosario.md`](glosario.md).

---

## 6. Integración con Culqi

- Flujo: tokenizar tarjeta → crear `customer` → asociar `card` → cargos posteriores contra el `card_id`.
- Yape sirve para pagos únicos (matrícula, clase suelta, mes en mostrador) pero **no para cobro automático**: exige número de celular y código de verificación en cada transacción. El recurrente va sí o sí por tarjeta.
- Webhooks: verificar firma, procesar de forma idempotente por `culqi_event_id`.
- **Riesgo a validar en la primera semana, antes de construir encima:** Culqi tiene librerías nativas de iOS y Android pero no SDK oficial de React Native. Hay que evaluar dev client de Expo con wrapper nativo, o tokenización vía checkout web en WebView. Probar en sandbox el flujo completo de **tarjeta rechazada** y anotar los códigos de error reales.
- Los cargos recurrentes sobre débito peruano fallan bastante. La tasa de aprobación importa más que cualquier optimización de UI.

---

## 7. Quién cobra: modelo de cuentas **[PENDIENTE — decisión abierta]**

Dos caminos, con consecuencias muy distintas:

**A. Cada gimnasio con su propia cuenta Culqi (recomendado).** Credenciales por tenant. Nosotros nunca tocamos la plata del alumno. Sin riesgo regulatorio ni tributario. La fricción de afiliación se resuelve haciendo el trámite con el dueño en la reunión de venta (media hora con su RUC).

**B. Una sola cuenta Culqi a nombre de Mathyu's Solutions, con depósitos a los gimnasios.** Onboarding más fácil, pero nos convierte en agregador de pagos:
- Las reglas de marca prohíben procesar transacciones de terceros no afiliados salvo estar registrado como facilitador ante el adquirente. Riesgo real de retención de fondos.
- SUNAT presume ingreso propio todo lo que entra al RUC: IGV y renta sobre plata ajena, salvo contrato de mandato bien armado y comprobante válido de cada gimnasio.
- Los contracargos los asumimos nosotros, por locales que no controlamos.

**Antes de codificar esta parte hay que (a) preguntarle al ejecutivo de Culqi si existe figura de marketplace/payfac y qué exige, y (b) validarlo con el contador.**

Mientras tanto: implementar la capa de pagos detrás de una **interfaz que abstraiga de qué cuenta sale el cargo**, para poder cambiar de A a B sin reescribir el dominio.

---

## 8. Preguntas abiertas **[PENDIENTE]**

1. **Fecha de cobro:** ¿el día de inscripción de cada alumno, o un día fijo del mes para todos (con primer mes prorrateado)?
2. **Exceso de cupo:** si un alumno de plan 2x quiere entrenar una tercera vez en la semana, ¿se bloquea o se le cobra clase suelta?
3. **Reserva de clases:** ¿el alumno reserva horario con aforo limitado, o solo marca asistencia libre? (Cambia bastante el alcance.)
4. **Matrícula inicial:** ¿existe cobro único de inscripción además de la mensualidad?
5. **Boleta electrónica SUNAT:** ¿entra al MVP integrando un facturador (Nubefact / Bsale), o el gimnasio la emite por fuera al inicio?
6. **Multi-sede:** ¿desde el arranque, o un local por tenant en el MVP?

> Cómo quedó cada una al implementar: [`decisiones.md`](decisiones.md) §2.

---

## 9. Estructura del repo

Monorepo TypeScript, tipos compartidos entre las tres superficies.

```
/apps
  /mobile        Expo — app del alumno
  /web           Next.js — panel del gimnasio
  /api           NestJS — dominio, cobro, webhooks
/packages
  /shared        tipos, DTOs, reglas puras (prorrateo, cupos, fechas)
  /ui            design system iOS-flavored
```

La lógica de prorrateo, cupo semanal y cálculo de fechas vive en `packages/shared` como **funciones puras testeables**, y se consume desde las tres apps. Escribirla dos veces es el bug que se descubre en el estado de cuenta de un cliente tres meses después.

---

## 10. Convenciones de trabajo

- **No versionar `ios/` ni `android/`.** Expo los regenera con prebuild desde `app.json`. Versionarlos arrastra configuración específica de máquina.
- `.gitattributes` con `* text=auto eol=lf` desde el primer commit.
- `forceConsistentCasingInFileNames: true` en el `tsconfig`. Se desarrolla en Windows y macOS (ambos case-insensitive) pero el CI es Linux.
- Versión de Node fijada en `.nvmrc`, mismo lockfile, `npm ci` limpio en cada máquina. Nunca copiar `node_modules` entre sistemas.
- TypeScript estricto. Nada de `any` en el dominio de pagos.

---

## 11. Orden de construcción

**Fase 0 — Riesgos primero.** Sandbox de Culqi: tokenizar, cobrar, cobrar con tarjeta rechazada, recibir webhook. Documentar códigos de error reales. Evaluar tokenización desde React Native. Nada más se construye hasta que esto funcione.

**Fase 1 — Dominio y ciclo de cobro.** Esquema de datos, funciones puras de `packages/shared` con tests, cron de renovación idempotente, dunning, ledger de cargos. Sin UI. Es la parte que no depende de plataforma y donde está el riesgo real.

**Fase 2 — Panel web del gimnasio.** Alta de alumnos, planes, registro de pago manual, estado de morosidad. Es la superficie que el cliente que paga usa a diario.

**Fase 3 — App, modo staff.** Escaneo de QR con cámara, pantalla de validación con foto y motivo de rechazo, marcado manual, registro de pago en efectivo/Yape. Va antes que el modo alumno: sin ella el gimnasio no puede operar, y es lo que el cliente que paga necesita en la puerta desde el día uno.

**Fase 4 — App, modo alumno.** Onboarding, registro de tarjeta, estado de suscripción, generación del QR, sesiones restantes de la semana, historial.

**Fase 5 — Cobro SaaS a los gimnasios** usando el mismo motor.

> Se desarrolla en Windows hasta que aparezca la necesidad de módulo nativo (el wrapper de Culqi). A partir de ahí, en la Mac con Xcode. Las fases 1 y 2 son enteramente independientes de plataforma.
