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
| clase reservada desde el directorio (prueba, suelta o inscripción) | `ClassBooking` |
| evento con fecha (seminario, taller) | `GymEvent` |
| plaza en un evento | `EventRegistration` |
| rutina o técnica en video | `Routine` |
| paso de una rutina (ejercicio, técnica) | `RoutineItem` |

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

## Conceptos de las reservas del directorio

Nacieron como la clase gratis y hoy son cualquier clase con fecha que alguien
reserva desde la ficha de un gimnasio. Ojo con `trial`: sigue nombrando SOLO la
clase de prueba —un `kind`—, aunque las rutas de la api se llamen `/trials` por
las apps instaladas (decisiones §13).

| Negocio | Código |
|---|---|
| clase reservada desde el directorio | `ClassBooking` / `class_bookings` |
| a qué viene | `BookingKind` (`trial`, `drop_in`, `enrollment`) |
| clase gratis / clase de prueba | `kind = 'trial'` |
| clase suelta reservada | `kind = 'drop_in'` |
| inscripción reservada (su primera clase) | `kind = 'enrollment'` |
| qué deja reservar un gimnasio | `BookingOffer` / `bookingOffer` |
| precio de una clase para quien no es alumno | `dropInClassPrice` |
| directorio de gimnasios | `directory` / `GymCard` |
| clase concreta con fecha (lo que se reserva) | `ClassSlot` |
| el gimnasio ofrece la prueba | `trialClassEnabled` |
| vino / no vino | `ClassBookingStatus` (`attended`, `no_show`) |
| motivo de rechazo de la reserva | `BookingDenialReason` / `BookingDenialCode` |
| ya la usó en este gimnasio / ya tiene esa | `already_booked` |
| ya entrena aquí | `already_member` |
| ese plan ya no se vende | `plan_unavailable` |
| el cargo con el que se pagó | `chargeId` |
| la ficha que salió de la inscripción | `membershipId` |
| sin atender, sigue por venir | `PENDING_DAYS` |

## Conceptos de la biblioteca

Una `Routine` cubre DOS cosas que parecen distintas y son la misma: el «día de
pecho», que son seis ejercicios con sus series, y el «uchimata», que es una
técnica con un video y una explicación. Por eso los pasos son opcionales.

Ojo con `visibility`: es la decisión que el gimnasio compra, y va por RUTINA, no
por gimnasio. La misma escuela publica unas para atraer y guarda otras para
retener.

| Negocio | Código |
|---|---|
| biblioteca del gimnasio | `library` / `routines` |
| quién la ve | `RoutineVisibility` (`public`, `members`) |
| la ve cualquiera, desde el directorio | `visibility = 'public'` |
| solo para alumnos | `visibility = 'members'` |
| con qué ojos se mira | `RoutineViewer` (`staff`, `member`, `visitor`) |
| motivo por el que no se ve | `RoutineAccessDenial` (`not_published`, `members_only`) |
| borrador / publicada | `RoutineStatus` (`draft`, `published`) |
| para quién es | `RoutineLevel` (`beginner`, `intermediate`, `advanced`); `null` = para todos |
| el anzuelo: título y de qué va, sin videos | `teaser` |
| cuántas se pierde quien no es alumno | `membersOnly` / `membersOnlyRoutines` |
| portada de la rutina | `coverVideoUrl` |
| series y repeticiones, o rondas, o minutos | `prescription` (texto libre) |
| enlace de video entendido | `VideoLink` / `parseVideoLink` |
| de dónde sale el video | `VideoProvider` (`youtube`, `vimeo`, `file`, `link`) |
| cómo se reproduce | `VideoPlayback` (`file`, `embed`, `external`) |
| video subido por el gimnasio | `RoutineVideo` / `routine_videos` |
| subiéndose / listo | `RoutineVideoStatus` (`pending`, `ready`) |
| ruta dentro del bucket | `objectPath` / `videoObjectPath` |
| permiso firmado para subir | `SignedUpload` / `signUpload` |
| URL firmada para ver | `signPlayback` |
| tope por video | `VIDEO_MAX_BYTES` |

`prescription` es texto libre a propósito: «4 series de 12» y «5 minutos de
uchikomi con el compañero» son la misma casilla para quien la escribe, y modelar
solo la primera deja al judoca rellenando repeticiones que no significan nada en
su deporte. Sinchi no cuenta series; las dice.

Ojo con `member`: aquí significa **suscripción viva en ese gimnasio, aunque
deba**. No es `Membership.status`, que existe y engaña —nada en el producto la
pone en `inactive`—. La baja de un gimnasio es una suscripción cancelada.

## Conceptos del chat

Ojo con `person`: es el lado de quien le escribe al gimnasio, y **no** se llama
`student` a propósito. Buena parte de quien escribe todavía no es alumno de nadie
—el curioso del directorio—, y una columna llamada `student` invita a filtrar la
bandeja por el padrón y perder justo los mensajes que traen alumnos nuevos.

| Negocio | Código |
|---|---|
| conversación / chat | `Conversation` / `conversations` |
| mensaje | `Message` / `messages` |
| quién lo escribió | `MessageSender` (`person`, `gym`) |
| quién del mostrador contestó | `staffName` (copiado, no resuelto) |
| por dónde empezó (se congela) | `ConversationTopic` |
| una duda sin inscribirse | `topic = 'general'` |
| su clase de prueba | `topic = 'trial'` |
| clase suelta / paga por clase | `topic = 'drop_in'` |
| su mensualidad | `topic = 'membership'` |
| un evento | `topic = 'event'` |
| abierta / archivada | `ConversationStatus` (`open`, `closed`) |
| bandeja del mostrador | `inbox` |
| hasta dónde leyó cada lado | `personReadAt`, `gymReadAt` |
| sin leer | `unread` / `countUnread` |
| mensajes seguidos sin respuesta | `unansweredStreak` / `MAX_UNANSWERED` |
| toca esperar respuesta | `MessageDenial = 'awaiting_reply'` |
| el gimnasio no recibe mensajes | `MessageDenial = 'gym_unavailable'` |
| aviso por correo de la tanda | `gymNotifiedAt`, `personNotifiedAt` |

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
| RUC | `taxId`, opcional (`null` si no lo tiene), validado con `checkRuc` cuando lo hay |
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

## Conceptos de la vinculación

Lo que une una cuenta con una ficha del padrón (decisiones §14). Ojo con
`claim`: nació como el código de 6 dígitos que se confirmaba en el mostrador, y
hoy `account_claims` es la cuenta sin ficha. El nombre de la tabla se quedó
porque renombrarla es una migración sin nada que ganar.

| Negocio | Código |
|---|---|
| cuenta sin ficha (entró, pero no abre ninguna) | `unlinked` / `account_claims` |
| QR de la cuenta, con el que la inscriben | `qrToken` / `SINCHI1:a:<token>` |
| solicitud de vínculo: el gimnasio agrega, la persona acepta | `LinkRequest` / `link_requests` |
| aceptada · rechazada · retirada por el gimnasio | `accepted` · `rejected` · `canceled` |
| no está en su billetera hasta que acepte | `notAwaitingPerson` |
| canjear el QR de alumno en el mostrador de otro gimnasio | `lookupMemberQr` / `verifyUserQr` |

## Nota sobre el MD

El esquema del documento de especificación (sección 5) nombra las columnas en
español y mezclado (`monto_centavos` junto a `next_billing_date`). Este
glosario es la traducción canónica: cuando exista la base de datos, las
columnas van en inglés `snake_case`, alineadas con la columna derecha de estas
tablas.
