/**
 * Tipos del dominio. Espejo del esquema del MD 5.
 *
 * Nota de arquitectura: `User` vive FUERA del tenant. El objetivo del producto
 * es que una persona tenga en una sola app todas sus suscripciones, de todos
 * los gimnasios a los que asiste. Si la identidad naciera dentro del tenant,
 * el mismo alumno quedaria duplicado en cada local y unificarlo despues seria
 * una migracion dolorosa. `Membership` es la que vincula usuario global con
 * cada gimnasio.
 *
 * Los identificadores del codigo van en ingles; el MD 5 los nombra en espanol.
 * La correspondencia esta en `docs/glosario.md`.
 */
import type { Cents } from '../money/cents.js';
import type { IsoWeekday, LocalTime, PlainDate } from '../time/plain-date.js';
import type { IanaTimeZone } from '../time/zone.js';

// ---------------------------------------------------------------------------
// Identificadores
// ---------------------------------------------------------------------------

declare const idBrand: unique symbol;
type Id<T extends string> = string & { readonly [idBrand]: T };

export type UserId = Id<'user'>;
export type TenantId = Id<'tenant'>;
export type MembershipId = Id<'membership'>;
export type PlanId = Id<'plan'>;
export type SubscriptionId = Id<'subscription'>;
export type ChargeId = Id<'charge'>;
export type PaymentMethodId = Id<'payment_method'>;
export type ClassScheduleId = Id<'class_schedule'>;
export type AttendanceId = Id<'attendance'>;
export type TrialBookingId = Id<'trial_booking'>;
export type GymEventId = Id<'gym_event'>;
export type EventRegistrationId = Id<'event_registration'>;
export type RoutineId = Id<'routine'>;
export type RoutineItemId = Id<'routine_item'>;
export type RoutineVideoId = Id<'routine_video'>;
export type DeviceId = Id<'device'>;
export type StaffId = Id<'staff'>;

/** Cast explicito para bordes de I/O (HTTP, SQL). Deliberadamente feo. */
export const asId = <T extends string>(raw: string): Id<T> => raw as Id<T>;

// ---------------------------------------------------------------------------
// Identidad global
// ---------------------------------------------------------------------------

export interface User {
  readonly id: UserId;
  readonly name: string;
  /** DNI o carne de extranjeria. */
  readonly documentId: string;
  readonly email: string | null;
  /** Unico en todo el sistema: es la llave con la que el alumno se reconoce. */
  readonly phone: string;
  readonly photoUrl: string | null;
  readonly createdAt: Date;
}

export type MembershipStatus = 'active' | 'inactive';

export interface Membership {
  readonly id: MembershipId;
  readonly userId: UserId;
  readonly tenantId: TenantId;
  /** Como lo llama el gimnasio en su padron (codigo de alumno, apodo). */
  readonly internalAlias: string | null;
  readonly status: MembershipStatus;
}

// ---------------------------------------------------------------------------
// Tenant
// ---------------------------------------------------------------------------

/**
 * Escalon de precio del gimnasio.
 *
 * `free` no es una promocion ni un periodo de prueba: es el precio de un local
 * de hasta 10 alumnos, para siempre. Un dojo que empieza con seis alumnos no
 * tiene con que pagar S/149 y tampoco tiene con que llevar un cuaderno bien;
 * cobrarle desde el primer dia lo deja fuera, y lo que queremos es que crezca
 * dentro. Cuando pasa de 10, empieza a costar.
 */
export type SaasTier = 'free' | 'up_to_60' | 'up_to_150' | 'unlimited';

/**
 * Politica de fecha de cobro.
 *
 * PENDIENTE (MD 8.1): el producto todavia no decide si se cobra el dia de
 * inscripcion de cada alumno o un dia fijo del mes para todos. Ambas formas
 * estan implementadas y la eleccion es configuracion del tenant, no una
 * constante en el codigo.
 */
export type BillingDatePolicy =
  | { readonly mode: 'anniversary' }
  | { readonly mode: 'fixed_day'; readonly dayOfMonth: number };

/**
 * Que hacer cuando el alumno agota su cupo semanal.
 *
 * PENDIENTE (MD 8.2). El motor solo informa; la decision comercial es del
 * gimnasio, y por eso vive en su configuracion.
 */
export type QuotaOverflowPolicy = 'block' | 'offer_drop_in';

export interface Tenant {
  readonly id: TenantId;
  readonly name: string;
  readonly taxId: string;
  readonly slug: string;
  readonly timezone: IanaTimeZone;
  readonly saasTier: SaasTier;
  readonly graceDays: number;
  readonly billingDatePolicy: BillingDatePolicy;
  readonly quotaOverflowPolicy: QuotaOverflowPolicy;
  readonly dropInPriceCents: Cents | null;
  readonly status: 'active' | 'suspended';
}

export type StaffRole = 'owner' | 'front_desk';

export interface Staff {
  readonly id: StaffId;
  readonly tenantId: TenantId;
  readonly userId: UserId;
  readonly role: StaffRole;
  readonly displayName: string;
}

/** Rol con el que la app se abre. El mismo binario sirve a los tres (MD 4.6). */
export type AppRole = 'student' | 'front_desk' | 'owner';

// ---------------------------------------------------------------------------
// Planes
// ---------------------------------------------------------------------------

/**
 * Formas en que un gimnasio cobra el acceso.
 *
 * Las tres primeras son SUSCRIPCION: se paga por adelantado un periodo y el plan
 * dice cuanto se puede entrenar dentro de el. `drop_in` no lo es, y por eso no
 * es un cuarto sabor del mismo helado:
 *
 *  - no genera deuda. `computeReceivable` corta antes de mirar el calendario, y
 *    de ahi cae solo que no se le pueda suspender por mora: quien paga por
 *    clase no debe nada nunca, porque no prometio nada;
 *  - no tiene cupo semanal. Lo que limita cuanto entrena es su bolsillo;
 *  - la puerta le pide el pago DEL DIA (`validateCheckIn`).
 *
 * `priceCents` cambia de unidad con el tipo: es lo que cuesta un PERIODO en los
 * tres primeros y lo que cuesta UNA CLASE en este. Es la unica diferencia que el
 * dueno tiene que entender al escribir el precio.
 */
export type PlanType = 'unlimited' | 'sessions_per_week' | 'fixed_days' | 'drop_in';

export interface Plan {
  readonly id: PlanId;
  readonly tenantId: TenantId;
  readonly name: string;
  readonly type: PlanType;
  /** Solo para `sessions_per_week`. */
  readonly sessionsPerWeek: number | null;
  /**
   * Dias en que el plan habilita entrenar. `null` = cualquier dia.
   *
   * Se combina con `sessionsPerWeek`: un plan de 2 sesiones restringido a
   * lunes-viernes es `sessions_per_week` con `allowedDays` recortado (MD 4.3).
   */
  readonly allowedDays: readonly IsoWeekday[] | null;
  /** Del periodo; de UNA clase cuando el tipo es `drop_in`. */
  readonly priceCents: Cents;
  readonly active: boolean;
}

/**
 * Si el plan cobra por clase en vez de por periodo.
 *
 * La pregunta aparece en tres sitios que no pueden discrepar —la deuda, el cupo
 * y la puerta— asi que la respuesta vive en una linea. Comparar con la cadena a
 * mano en cada uno es como se olvida el tercero.
 */
export const isDropInPlan = (plan: Pick<Plan, 'type'>): boolean => plan.type === 'drop_in';

/** Los que si crean ciclo de cobro y por tanto pueden caer en mora. */
export const isSubscriptionPlan = (plan: Pick<Plan, 'type'>): boolean => !isDropInPlan(plan);

// ---------------------------------------------------------------------------
// Suscripciones
// ---------------------------------------------------------------------------

export type SubscriptionStatus = 'active' | 'in_grace' | 'suspended' | 'canceled';

export interface Subscription {
  readonly id: SubscriptionId;
  readonly tenantId: TenantId;
  readonly membershipId: MembershipId;
  readonly planId: PlanId;
  /** Downgrade aceptado que se aplica en la proxima renovacion (MD 4.2). */
  readonly pendingPlanId: PlanId | null;
  readonly status: SubscriptionStatus;
  readonly startDate: PlainDate;
  /** Inicio del periodo vigente. Con `nextBillingDate` define el periodo. */
  readonly periodStart: PlainDate;
  readonly nextBillingDate: PlainDate;
  readonly canceledAt: Date | null;
}

// ---------------------------------------------------------------------------
// Metodos de pago
// ---------------------------------------------------------------------------

export type CardBrand = 'Visa' | 'Mastercard' | 'Amex' | 'Diners' | 'Unknown';

export interface PaymentMethod {
  readonly id: PaymentMethodId;
  readonly tenantId: TenantId;
  readonly membershipId: MembershipId;
  readonly culqiCustomerId: string;
  readonly culqiCardId: string;
  readonly brand: CardBrand;
  readonly last4: string;
  readonly expMonth: number;
  readonly expYear: number;
  readonly active: boolean;
}

// ---------------------------------------------------------------------------
// Ledger de cargos
// ---------------------------------------------------------------------------

export type ChargeType =
  | 'renewal'
  | 'proration'
  | 'enrollment'
  | 'drop_in'
  | 'saas'
  /** Plaza en un evento con fecha: un seminario, un taller, una clase especial. */
  | 'event';
export type ChargeStatus = 'pending' | 'succeeded' | 'failed';

/**
 * Buena parte de los alumnos paga en efectivo o Yape en mostrador. Un pago
 * manual crea un cargo igual que uno con tarjeta y activa el mismo ciclo
 * (MD 4.5): el ledger es la unica fuente de verdad del estado de pago, sin
 * importar el metodo.
 */
export type PaymentRail = 'card' | 'yape' | 'cash' | 'bank_transfer';

export interface Charge {
  readonly id: ChargeId;
  readonly tenantId: TenantId;
  readonly subscriptionId: SubscriptionId | null;
  /**
   * `null` SOLO en un cargo de tipo `event`.
   *
   * Un seminario lo paga tambien quien no entrena aqui, y esa persona no tiene
   * membresia en este local — ni debe tenerla: viene a una clase, no se inscribe
   * en el padron. Su plata sigue siendo del gimnasio y tiene que salir en
   * "cobrado este mes", asi que va al MISMO ledger y no a una tabla aparte: dos
   * sitios donde vive el dinero es como se dejan de cuadrar las cuentas.
   *
   * La restriccion `charges_membership_unless_event` lo mantiene honesto: para
   * cualquier otro tipo la columna sigue siendo obligatoria.
   */
  readonly membershipId: MembershipId | null;
  readonly type: ChargeType;
  readonly amountCents: Cents;
  readonly status: ChargeStatus;
  readonly rail: PaymentRail;
  readonly culqiChargeId: string | null;
  readonly errorCode: string | null;
  readonly attempt: number;
  readonly periodStart: PlainDate | null;
  readonly periodEnd: PlainDate | null;
  /** Staff que registro el cobro manual. Es el hueco por donde entran favores. */
  readonly recordedBy: StaffId | null;
  readonly createdAt: Date;
}

// ---------------------------------------------------------------------------
// Eventos con fecha
// ---------------------------------------------------------------------------

/**
 * `draft` existe y no sobra: el dueno escribe el seminario el martes con el
 * precio a medias y lo publica el viernes, cuando el invitado confirmo.
 * `canceled` no es lo mismo que despublicar — hay gente con plaza que hay que
 * avisar, y esa diferencia se pierde con un booleano.
 */
export type GymEventStatus = 'draft' | 'published' | 'canceled';

/**
 * Una clase con FECHA que se vende aparte: un seminario, un taller, la clase
 * del invitado que viene una sola vez.
 *
 * No es un `ClassSchedule`, que es el horario semanal y se repite; ni un `Plan`,
 * que es una suscripcion. Es un evento suelto, con cupo y con dos precios —lo
 * que paga el alumno del local y lo que paga quien viene de fuera—, porque de
 * eso vive un seminario: se llena con gente que todavia no entrena aqui.
 */
export interface GymEvent {
  readonly id: GymEventId;
  readonly tenantId: TenantId;
  readonly name: string;
  readonly description: string | null;
  /** El invitado, si lo hay. Es lo que vende la plaza. */
  readonly instructor: string | null;
  readonly date: PlainDate;
  readonly startTime: LocalTime;
  readonly endTime: LocalTime;
  /** `null` = sin limite de plazas. */
  readonly capacity: number | null;
  readonly memberPriceCents: Cents;
  /** Lo que paga quien no entrena aqui. Suele ser mas alto, y ese es el punto. */
  readonly guestPriceCents: Cents;
  readonly status: GymEventStatus;
}

export type EventRegistrationStatus = 'booked' | 'attended' | 'no_show' | 'canceled';

/**
 * La plaza de una persona en un evento.
 *
 * Lleva su propio estado y NO crea una fila en `attendance`, a proposito: el
 * indice `attendance_once_per_day` deja una asistencia por alumno y dia, asi que
 * el que entreno el sabado por la manana no podria marcar en el seminario de esa
 * tarde. Son dos cosas distintas contadas por separado.
 */
export interface EventRegistration {
  readonly id: EventRegistrationId;
  readonly tenantId: TenantId;
  readonly eventId: GymEventId;
  /** `null` cuando quien viene no entrena en este local. */
  readonly membershipId: MembershipId | null;
  /** Identidad Sinchi, cuando ya la tiene. */
  readonly userId: UserId | null;
  readonly fullName: string;
  readonly phone: string;
  readonly email: string | null;
  /** Congelado al inscribirse: se respeta lo que se le prometio a la persona. */
  readonly priceCents: Cents;
  readonly status: EventRegistrationStatus;
  /**
   * El cargo que pago la plaza. `null` = reservada sin pagar.
   *
   * En la version 1 todo cargo manual nace `succeeded`, asi que tenerlo equivale
   * a estar pagada. Cuando entre el cobro con tarjeta habra que mirar tambien su
   * estado, y por eso se guarda la referencia y no un booleano.
   */
  readonly chargeId: ChargeId | null;
}

/** Lo que le toca pagar a esta persona: no es lo mismo venir de fuera. */
export const eventPriceFor = (
  event: Pick<GymEvent, 'memberPriceCents' | 'guestPriceCents'>,
  isMember: boolean,
): Cents => (isMember ? event.memberPriceCents : event.guestPriceCents);

// ---------------------------------------------------------------------------
// Rutinas: lo que el gimnasio ensena
// ---------------------------------------------------------------------------

/**
 * Quien ve una rutina.
 *
 * Va en la RUTINA y no en el gimnasio, y esa es la decision entera: la misma
 * escuela usa unas para atraer —el video que hace que alguien la elija— y otras
 * para retener, que son la razon de seguir pagando la mensualidad. La regla de
 * quien pasa vive en `checkRoutineAccess`.
 */
export type RoutineVisibility = 'public' | 'members';

/**
 * `draft` o `published`, y no hay tercero.
 *
 * A diferencia de `GymEventStatus` aqui no existe `canceled`: un seminario se
 * CAE —habia gente con plaza y hay que avisarle— y una rutina simplemente deja
 * de ofrecerse. Despublicar es todo lo que hace falta.
 */
export type RoutineStatus = 'draft' | 'published';

/** Para quien es. `null` = para cualquiera. */
export type RoutineLevel = 'beginner' | 'intermediate' | 'advanced';

/**
 * Una rutina o una tecnica que el gimnasio publica: "Dia de pecho", "Uchimata".
 *
 * Las dos caben en la misma fila a proposito. Un dia de entrenamiento son varios
 * `RoutineItem` con sus series; una tecnica de judo es esta fila con su video y
 * su explicacion, y ni un paso. Separarlas en dos entidades habria dado dos
 * pantallas, dos editores y la misma pregunta —"donde subo el video"— con dos
 * respuestas.
 */
export interface Routine {
  readonly id: RoutineId;
  readonly tenantId: TenantId;
  readonly title: string;
  /** De que va, en dos lineas. Es lo que se lee en la lista. */
  readonly summary: string | null;
  /**
   * La direccion con la que se REPRODUCE el video.
   *
   * Para un enlace es el enlace. Para un archivo subido es una URL firmada que
   * caduca, y por eso no se guarda en ninguna parte: se calcula al servir, y
   * solo para quien pasa `checkRoutineAccess`. Eso es lo que hace que el
   * contenido de alumnos sea exclusivo de verdad y no solo "no listado".
   */
  readonly videoUrl: string | null;
  /** El archivo subido del que sale, si viene de uno. */
  readonly videoAssetId: RoutineVideoId | null;
  readonly level: RoutineLevel | null;
  readonly visibility: RoutineVisibility;
  readonly status: RoutineStatus;
  /**
   * Cuando se toco por ultima vez.
   *
   * Se ensena, y por eso se guarda: una biblioteca sin fechas no se distingue de
   * una abandonada, y "actualizada la semana pasada" es media razon para volver.
   */
  readonly updatedAt: Date;
}

/**
 * Un paso: el ejercicio del dia de pecho, la entrada del uchimata.
 *
 * Todo es opcional menos el nombre. El gimnasio que solo pega enlaces publica
 * igual que el que escribe la tecnica entera, y ninguno de los dos tiene que
 * rellenar campos que no usa.
 */
export interface RoutineItem {
  readonly id: RoutineItemId;
  readonly routineId: RoutineId;
  /** Orden dentro de la rutina. Un calentamiento despues del trabajo fuerte no es la misma rutina. */
  readonly position: number;
  readonly title: string;
  readonly instructions: string | null;
  /** Reproducible: el enlace, o una URL firmada. Ver `Routine.videoUrl`. */
  readonly videoUrl: string | null;
  readonly videoAssetId: RoutineVideoId | null;
  /** "4 series de 12", "5 minutos de uchikomi". Texto libre: ver `RoutineItemDraft`. */
  readonly prescription: string | null;
}

/** La rutina con sus pasos: es lo que se abre al tocarla. */
export interface RoutineDetail {
  readonly routine: Routine;
  readonly items: readonly RoutineItem[];
}

// ---------------------------------------------------------------------------
// Horarios y asistencia
// ---------------------------------------------------------------------------

export interface ClassSchedule {
  readonly id: ClassScheduleId;
  readonly tenantId: TenantId;
  readonly name: string;
  readonly weekday: IsoWeekday;
  readonly startTime: LocalTime;
  readonly endTime: LocalTime;
  readonly capacity: number | null;
  readonly instructor: string | null;
}

/**
 * Estado de una clase gratis reservada.
 *
 * `no_show` existe separado de `canceled` porque no son lo mismo para el
 * gimnasio: quien avisa que no viene sigue siendo un interesado; quien no
 * aparece sin avisar es un dato distinto sobre el mismo lead.
 */
export type TrialBookingStatus = 'booked' | 'attended' | 'no_show' | 'canceled';

/**
 * La clase de prueba que alguien reservo desde la app.
 *
 * No hay `membershipId` ni `userId` obligatorio a proposito: quien reserva
 * todavia NO es alumno de este gimnasio, y muchas veces todavia no es nadie en
 * Sinchi — es una cuenta de Google recien creada, sin ficha en ningun padron. Lo
 * unico que el gimnasio necesita para atenderlo es como se llama, su celular y a
 * que clase dijo que iria.
 *
 * `className`, `startTime` y `endTime` van copiados y no resueltos por
 * `classScheduleId`: el gimnasio puede reordenar su horario entre la reserva y
 * el dia de la clase, y la lista del mostrador tiene que seguir diciendo lo que
 * se le prometio a la persona.
 */
export interface TrialBooking {
  readonly id: TrialBookingId;
  readonly tenantId: TenantId;
  readonly classScheduleId: ClassScheduleId | null;
  /** Identidad Sinchi, cuando ya la tiene. `null` mientras solo es una cuenta. */
  readonly userId: UserId | null;
  readonly fullName: string;
  readonly phone: string;
  readonly email: string | null;
  readonly className: string;
  readonly date: PlainDate;
  readonly startTime: LocalTime;
  readonly endTime: LocalTime;
  /** Lo que cuesta esa clase, congelado al reservar. 0 = gratis. */
  readonly priceCents: Cents;
  readonly status: TrialBookingStatus;
  readonly createdAt: Date;
}

export type CheckInMethod = 'qr' | 'manual';

export interface Attendance {
  readonly id: AttendanceId;
  readonly tenantId: TenantId;
  readonly membershipId: MembershipId;
  readonly subscriptionId: SubscriptionId;
  readonly classScheduleId: ClassScheduleId | null;
  readonly checkedInAt: Date;
  /** Clave `YYYY-Www`, desnormalizada para contar el cupo sin recalcular. */
  readonly isoWeek: string;
  readonly method: CheckInMethod;
  readonly deviceId: DeviceId | null;
  readonly recordedBy: StaffId | null;
  /**
   * `true` cuando el staff dejo pasar a alguien a quien la validacion rechazo.
   *
   * Se expone a proposito: es el rastro que permite ver, en el panel del dueno,
   * cuantas excepciones hace cada recepcionista. Un flag de auditoria que solo
   * vive en la base y nunca sale no audita nada.
   */
  readonly overrodeDenial: boolean;
  readonly syncedAt: Date | null;
}
