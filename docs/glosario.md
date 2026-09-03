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
| evento con fecha (seminario, taller) | `GymEvent` |
| plaza en un evento | `EventRegistration` |

## Tipos de plan

Los tres primeros son SUSCRIPCION: se paga un periodo por adelantado. El cuarto
no lo es, y por eso no genera deuda, no tiene cupo semanal y su precio es el de
UNA clase.

| Negocio | Código |
|---|---|
| ilimitado | `PlanType = 'unlimited'` |
| N veces por semana | `PlanType = 'sessions_per_week'` |
| días fijos | `PlanType = 'fixed_days'` |
| se paga por clase | `PlanType = 'drop_in'` |

Ojo con `drop_in`: nombra DOS cosas que no son la misma. Como `PlanType` es el
plan de quien no tiene mensualidad y paga cada vez que entrena, con su precio en
`plans.price_cents`. Como `ChargeType` es el cobro de una clase suelta, que
también paga el alumno CON plan que agota su cupo semanal — y ese precio vive en
`tenants.drop_in_price_cents`.

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
| plaza de un evento | `ChargeType = 'event'` |
| precio del alumno de casa | `memberPriceCents` |
| precio del que viene de fuera | `guestPriceCents` |
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

## Conceptos de la suscripción del gimnasio a Sinchi

Ojo con `trial`: ya es la clase gratis del **alumno**. El mes gratis del
**gimnasio** es otra cosa y no reusa esa palabra. Dos conceptos distintos con el
mismo identificador es el bug que aparece leyendo un reporte tres meses después.

| Negocio | Código |
|---|---|
| suscripción del gimnasio a Sinchi | `SaasSubscription` / `saas_subscriptions` |
| mes gratis del gimnasio | `freeUntil` (fecha en que termina) |
| escalón de precio | `SaasTier` (`free`, `up_to_60`, `up_to_150`, `unlimited`) |
| plan gratis (hasta 10 alumnos) | `free` / `isFreeTier` |
| alta de un gimnasio | `signUpGym` / `OnboardingService` |
| RUC | `taxId`, validado con `checkRuc` |
| código de promoción | `PromoCode` / `saas_promo_codes` |
| canje | `saas_redemptions` / `redeemPromo` |
| tope de usos | `maxRedemptions` / `redeemedCount` |
| meses de regalo | `freeMonths` |
| estado de la cuenta | `SaasStatus` |
| dentro del mes gratis | `trialing` |
| vencido pero todavía escribe | `in_grace` |
| cortado: solo lectura | `read_only` |
| lo que el gimnasio le paga a Sinchi | `saas_charges` |
| número de operación de la transferencia | `reference` |
| puede dar de alta y cobrar | `canWrite` |
| sale en el directorio público | `listed` |

`read_only` y no `suspended` a propósito, aunque el motor del alumno use esa
palabra: al alumno suspendido no lo dejan entrenar; al gimnasio impago no se le
cierra nada de lo que ya tiene, se le impide crear más. Llamarlos igual invita a
copiar el comportamiento equivocado.

## Nota sobre el MD

El esquema del documento de especificación (sección 5) nombra las columnas en
español y mezclado (`monto_centavos` junto a `next_billing_date`). Este
glosario es la traducción canónica: cuando exista la base de datos, las
columnas van en inglés `snake_case`, alineadas con la columna derecha de estas
tablas.
