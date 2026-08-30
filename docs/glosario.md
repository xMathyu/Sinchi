# Glosario: dominio en español, código en inglés

El producto se habla en español (es un producto peruano, para dojos peruanos) y
el código se escribe en inglés (es la convención de TypeScript y evita mezclar
los dos idiomas dentro de un mismo identificador).

Regla: **identificadores en inglés, comentarios y textos de interfaz en
español**. Nunca los dos idiomas en el mismo nombre.

## Entidades

| Negocio | Código |
|---|---|
| usuario (identidad global) | `User` |
| membresía | `Membership` |
| gimnasio / local / inquilino | `Tenant` |
| plan | `Plan` |
| suscripción | `Subscription` |
| método de pago | `PaymentMethod` |
| cargo | `Charge` |
| horario de clase | `ClassSchedule` |
| asistencia | `Attendance` |
| staff / recepción / dueño | `Staff`, `front_desk`, `owner` |
| clase gratis reservada | `TrialBooking` |

## Conceptos de cobro

| Negocio | Código |
|---|---|
| céntimos | `Cents` |
| fecha de cobro / renovación | `nextBillingDate` |
| periodo | `Period` (`periodStart`, `periodEnd`) |
| prorrateo | `proration` / `prorateUpgrade` |
| deuda / por cobrar | `Receivable` / `computeReceivable` |
| morosidad | `delinquency` / `evaluateDelinquency` |
| días de mora | `daysPastDue` |
| periodo de gracia | `graceDays`, `graceDaysLeft` |
| suspendida | `suspended` |
| plan pendiente (downgrade) | `pendingPlanId` |
| mensualidad | `ChargeType = 'renewal'` |
| matrícula | `ChargeType = 'enrollment'` |
| clase suelta | `ChargeType = 'drop_in'` |
| medio de pago (efectivo, Yape…) | `PaymentRail` (`cash`, `yape`, `bank_transfer`, `card`) |

## Conceptos de check-in

| Negocio | Código |
|---|---|
| cupo semanal | `QuotaState` / `computeQuota` |
| sesiones por semana | `sessionsPerWeek` |
| días permitidos | `allowedDays` |
| semáforo de acceso | `AccessLevel` (`ok`, `warn`, `alert`, `blocked`) |
| motivo de rechazo | `DenialReason` / `DenialCode` |
| morosidad | `delinquent` |
| día no permitido | `day_not_allowed` |
| cupo agotado | `quota_exhausted` |
| fuera de horario | `outside_schedule` |
| marcado manual | `CheckInMethod = 'manual'` |

## Conceptos de la clase gratis

| Negocio | Código |
|---|---|
| clase gratis / clase de prueba | `trial` |
| directorio de gimnasios | `directory` / `GymCard` |
| clase concreta con fecha (lo que se reserva) | `TrialSlot` |
| el gimnasio la ofrece | `trialClassEnabled` |
| vino / no vino | `TrialBookingStatus` (`attended`, `no_show`) |
| motivo de rechazo de la reserva | `TrialDenialReason` / `TrialDenialCode` |
| ya la usó en este gimnasio | `already_booked` |
| ya entrena aquí | `already_member` |

## Nota sobre el MD

El esquema del documento de especificación (sección 5) nombra las columnas en
español y mezclado (`monto_centavos` junto a `next_billing_date`). Este
glosario es la traducción canónica: cuando exista la base de datos, las
columnas van en inglés `snake_case`, alineadas con la columna derecha de estas
tablas.
