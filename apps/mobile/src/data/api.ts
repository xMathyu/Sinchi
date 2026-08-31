/**
 * Cliente HTTP de la api.
 *
 * Es la única puerta de salida a la red. Fuera de este archivo nadie llama a
 * `fetch`, y eso importa por el modo sin conexión: si las peticiones estuvieran
 * repartidas por las pantallas, cada una tendría que acordarse de qué hacer
 * cuando el wifi del gimnasio se cae.
 *
 * Devuelve los tipos del dominio, no JSON crudo. La api serializa fechas civiles
 * como `{ year, month, day }` y montos como enteros de céntimos; aquí se
 * reconstruyen para que las pantallas trabajen con `PlainDate` y `Cents` igual
 * que lo hacen con el store local.
 */
import type {
  AccessLevel,
  AccessMessage,
  AppRole,
  Attendance,
  Charge,
  CheckInResult,
  ClassSchedule,
  DelinquencyState,
  Membership,
  Plan,
  QuotaState,
  Receivable,
  Subscription,
  Tenant,
  TrialBooking,
  TrialBookingStatus,
  TrialDenialReason,
  TrialSlot,
  User,
} from '@sinchi/shared';
/**
 * De dónde salen las credenciales.
 *
 * Se inyectan en vez de importar el módulo de sesión, y no es por comodidad de
 * pruebas: la capa de red no tiene por qué saber que los tokens viven en el
 * llavero del dispositivo. Con la dependencia al revés, este archivo solo
 * funciona dentro de React Native y no hay forma de comprobar contra la api real
 * que las rutas y los tipos coinciden.
 *
 * La app las conecta al arrancar (`app/_layout.tsx`); un test las sustituye.
 */
export interface CredentialProvider {
  /** Token de sesión de Sinchi, o `null` si no hay. */
  readonly getToken: () => string | null;
  /** Token del equipo del mostrador. */
  readonly getDeviceToken: () => Promise<string | null>;
}

let credentials: CredentialProvider = {
  getToken: () => null,
  getDeviceToken: async () => null,
};

export function setCredentialProvider(provider: CredentialProvider): void {
  credentials = provider;
}

const DESPLEGADA = 'https://sinchi-api-961173851857.us-east4.run.app/v1';

/**
 * Base de la api.
 *
 * `EXPO_PUBLIC_API_URL` manda; sin ella, el servicio desplegado.
 *
 * El valor especial `auto` significa "la api local de la maquina que sirve el
 * bundle", y quien lo resuelve es `app/_layout.tsx` con `setApiBase`: hace falta
 * `expo-constants` para saber el host de Metro, y este archivo no puede
 * depender del runtime de React Native. No es purismo — `api.test.ts` verifica
 * las rutas contra una api de verdad ejecutandose en Node, y ese test es lo
 * unico que detecta que el cliente y el servidor se separen. Importar aqui un
 * modulo nativo lo rompe entero.
 *
 * Hasta que el layout lo resuelva, `auto` apunta al servicio desplegado: es una
 * direccion que funciona, no un hueco.
 */
let apiBase =
  process.env.EXPO_PUBLIC_API_URL === undefined || process.env.EXPO_PUBLIC_API_URL === 'auto'
    ? DESPLEGADA
    : process.env.EXPO_PUBLIC_API_URL;

export const getApiBase = (): string => apiBase;

/** Solo para pruebas y para apuntar a un servicio local. */
export function setApiBase(base: string): void {
  apiBase = base.replace(/\/$/, '');
}

/** Diez segundos. Más allá de eso, en la puerta conviene usar la caché local. */
const TIMEOUT_MS = 10_000;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** `true` cuando la sesión ya no vale y hay que volver al login. */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  /**
   * `true` cuando no se llegó al servidor.
   *
   * Es distinto de un error del servidor y las pantallas lo tratan distinto: sin
   * red se sigue operando contra la caché; con un 500 hay que parar.
   */
  get isOffline(): boolean {
    return this.status === 0;
  }
}

interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'DELETE';
  readonly body?: unknown;
  /** Rutas públicas: `/auth/google`, `/auth/shift`. */
  readonly anonymous?: boolean;
  /** Manda `X-Device-Token`: solo para abrir turno. */
  readonly withDeviceToken?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (options.anonymous !== true) {
    const token = credentials.getToken();
    if (token === null) {
      throw new ApiError(401, 'No hay sesión activa.');
    }
    headers.Authorization = `Bearer ${token}`;
  }

  if (options.withDeviceToken === true) {
    const deviceToken = await credentials.getDeviceToken();
    if (deviceToken === null) {
      throw new ApiError(400, 'Este equipo no está registrado en ningún gimnasio.');
    }
    headers['X-Device-Token'] = deviceToken;
  }

  // `AbortController` y no solo el timeout de fetch: en la red de un gimnasio una
  // petición se queda colgada sin resolver ni fallar, y la pantalla se queda
  // esperando para siempre.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${apiBase}${path}`, {
      method: options.method ?? 'GET',
      headers,
      // El balanceador de Google rechaza un POST sin `Content-Length`, así que
      // los POST sin datos van con un objeto vacío en vez de sin cuerpo.
      body:
        options.method === 'POST'
          ? JSON.stringify(options.body ?? {})
          : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    throw new ApiError(
      0,
      error instanceof Error && error.name === 'AbortError'
        ? 'La api no respondió a tiempo.'
        : 'No se pudo conectar con la api.',
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  const payload: unknown = text.length === 0 ? null : safeParse(text);

  if (!response.ok) {
    throw new ApiError(response.status, messageFrom(payload) ?? response.statusText, payload);
  }
  return payload as T;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // Una respuesta que no es JSON casi siempre viene del balanceador, no de la
    // api. Se conserva el texto para poder diagnosticarlo.
    return { raw: text };
  }
}

function messageFrom(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const message = (payload as { message?: unknown }).message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message)) return message.join('. ');
  return null;
}

// ---------------------------------------------------------------------------
// Sesión
// ---------------------------------------------------------------------------

export interface IssuedSessionDto {
  readonly linked: true;
  readonly accessToken: string;
  readonly expiresInSeconds: number;
  readonly role: AppRole;
  readonly userId: string;
  readonly tenantId: string | null;
}

export interface UnlinkedAccountDto {
  readonly linked: false;
  readonly claim: {
    readonly code: string;
    readonly expiresAt: string;
    readonly email: string | null;
    /** Como se presenta: lo que escribió al registrarse, o lo que dijo Google. */
    readonly displayName: string | null;
    /** Lo dio al crear la cuenta. Es con lo que reserva su clase gratis. */
    readonly phone: string | null;
  };
}

/**
 * Entra, y de paso guarda lo que escribió al crear la cuenta.
 *
 * `fullName` y `phone` solo viajan al REGISTRARSE. No autentican nada —eso lo
 * hace el token de Firebase— y no tocan el padrón de nadie: quedan con el código
 * pendiente para que reservar una clase gratis no le vuelva a preguntar lo que
 * acaba de escribir.
 */
export const signInWithGoogle = (
  idToken: string,
  datos: { readonly fullName?: string; readonly phone?: string } = {},
): Promise<IssuedSessionDto | UnlinkedAccountDto> =>
  request('/auth/google', {
    method: 'POST',
    body: { idToken, ...datos },
    anonymous: true,
  });

export interface ShiftCandidate {
  readonly id: string;
  readonly displayName: string;
  readonly hasPin: boolean;
}

/**
 * Que gimnasio y que plan hay detras de un enlace de invitacion.
 *
 * Anonima: quien abre el enlace todavia no tiene sesion — es justo lo que el
 * enlace va a producir. Mirar no consume la invitacion.
 */
export interface InvitePreviewDto {
  readonly gymName: string;
  readonly fullName: string;
  readonly planName: string;
  readonly priceCents: number;
  readonly enrollmentFeeCents: number;
  readonly expiresAt: string;
}

export const fetchInvite = (token: string): Promise<InvitePreviewDto> =>
  request(`/invites/${encodeURIComponent(token)}`, { anonymous: true });

/** Acepta la invitacion. Devuelve sesion ya inscrita. */
export const claimInvite = (token: string, idToken: string): Promise<IssuedSessionDto> =>
  request(`/invites/${encodeURIComponent(token)}/claim`, {
    method: 'POST',
    body: { idToken },
    anonymous: true,
  });

// ---------------------------------------------------------------------------
// Directorio y clase gratis
// ---------------------------------------------------------------------------

/**
 * Las rutas por las que alguien llega a Sinchi SIN pertenecer a ningun gimnasio.
 *
 * Van todas `anonymous: true` a proposito: quien busca dojo todavia no tiene
 * sesion de Sinchi, y varias de estas se llaman justamente para conseguirle una.
 * Lo que autentica al reservar es el ID token de Firebase, igual que al aceptar
 * una invitacion.
 */
export interface GymCardDto {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly trialClassEnabled: boolean;
  /** Lo que cuesta la clase de prueba. 0 = gratis. */
  readonly trialClassPriceCents: number;
  readonly fromPriceCents: number | null;
  readonly weeklyClasses: number;
  readonly disciplines: readonly string[];
}

export interface GymDetailDto extends GymCardDto {
  readonly timezone: string;
  readonly enrollmentFeeCents: number;
  readonly dropInPriceCents: number | null;
  readonly plans: readonly Plan[];
  readonly schedules: readonly ClassSchedule[];
  /** Las clases concretas que se pueden reservar, ya con fecha. */
  readonly slots: readonly TrialSlot[];
}

export interface TrialBookingDto extends TrialBooking {
  readonly gymName: string;
  readonly gymSlug: string;
}

/**
 * Resultado de reservar.
 *
 * Union discriminada porque el servidor responde 200 tambien cuando rechaza: no
 * es un error de la peticion sino el resultado del negocio, y la pantalla
 * necesita el motivo para decir si elegir otra hora o si ya la habia usado.
 */
export type BookTrialDto =
  | { readonly booked: true; readonly booking: TrialBookingDto }
  | {
      readonly booked: false;
      readonly reason: TrialDenialReason;
      readonly message: { readonly title: string; readonly detail: string };
    };

const reviveTrial = <T extends TrialBooking>(b: T): T => ({ ...b, createdAt: fecha(b.createdAt) });

const reviveBooking = (out: BookTrialDto): BookTrialDto =>
  out.booked ? { ...out, booking: reviveTrial(out.booking) } : out;

export const fetchGyms = (): Promise<readonly GymCardDto[]> =>
  request('/gyms', { anonymous: true });

export const fetchGym = (slug: string): Promise<GymDetailDto> =>
  request(`/gyms/${encodeURIComponent(slug)}`, { anonymous: true });

/**
 * Reserva sin ficha en ningun padron.
 *
 * Nombre y celular viajan porque no hay de donde sacarlos: es lo unico con lo
 * que el gimnasio puede reconocer y llamar a quien dijo que vendria.
 */
export const bookTrialAsGuest = async (input: {
  readonly slug: string;
  readonly idToken: string;
  readonly fullName: string;
  readonly phone: string;
  readonly classScheduleId: string;
  /** `YYYY-MM-DD`. */
  readonly date: string;
}): Promise<BookTrialDto> =>
  reviveBooking(
    await request<BookTrialDto>(`/gyms/${encodeURIComponent(input.slug)}/trial`, {
      method: 'POST',
      anonymous: true,
      body: {
        idToken: input.idToken,
        fullName: input.fullName,
        phone: input.phone,
        classScheduleId: input.classScheduleId,
        date: input.date,
      },
    }),
  );

/** Reserva con sesion: el nombre y el celular ya se saben. */
export const bookTrial = async (input: {
  readonly slug: string;
  readonly classScheduleId: string;
  readonly date: string;
}): Promise<BookTrialDto> =>
  reviveBooking(await request<BookTrialDto>('/me/trials', { method: 'POST', body: input }));

export const fetchMyTrials = async (): Promise<readonly TrialBookingDto[]> =>
  (await request<readonly TrialBookingDto[]>('/me/trials')).map(reviveTrial);

/**
 * Las reservas de quien todavia es solo una cuenta.
 *
 * Va POST con el token en el cuerpo y no GET con el token en la URL: un ID token
 * en la query string acaba en los logs del balanceador.
 */
export const fetchGuestTrials = async (idToken: string): Promise<readonly TrialBookingDto[]> =>
  (
    await request<readonly TrialBookingDto[]>('/gyms/trials/mine', {
      method: 'POST',
      anonymous: true,
      body: { idToken },
    })
  ).map(reviveTrial);

export const cancelTrial = (bookingId: string): Promise<{ readonly canceled: true }> =>
  request(`/me/trials/${bookingId}/cancel`, { method: 'POST' });

export const cancelGuestTrial = (
  bookingId: string,
  idToken: string,
): Promise<{ readonly canceled: true }> =>
  request(`/gyms/trials/${bookingId}/cancel`, {
    method: 'POST',
    anonymous: true,
    body: { idToken },
  });

export const staffForDevice = (): Promise<readonly ShiftCandidate[]> =>
  request('/auth/shift/staff', { anonymous: true, withDeviceToken: true });

export const openShift = (staffId: string, pin: string): Promise<IssuedSessionDto> =>
  request('/auth/shift', {
    method: 'POST',
    body: { staffId, pin },
    anonymous: true,
    withDeviceToken: true,
  });

// ---------------------------------------------------------------------------
// Vistas del dominio
// ---------------------------------------------------------------------------

/**
 * Lo que la api devuelve por membresía.
 *
 * Es el mismo `MembershipView` del servidor: el semáforo, el cupo y la deuda
 * vienen ya calculados por `@sinchi/shared` allá. La app NO los recalcula sobre
 * datos de la api — sería la misma función dando el mismo resultado, y cualquier
 * diferencia sería un bug de serialización disfrazado.
 *
 * Donde la app sí calcula por su cuenta es sin conexión, sobre la caché local, y
 * ahí usa exactamente las mismas funciones.
 */
export interface MembershipViewDto {
  readonly membership: Membership;
  readonly user: User;
  readonly tenant: Tenant;
  readonly plan: Plan;
  readonly subscription: Subscription;
  readonly pendingPlan: Plan | null;
  readonly quota: QuotaState;
  readonly receivable: Receivable;
  readonly delinquency: DelinquencyState;
  readonly level: AccessLevel;
  readonly badge: string;
}

export interface MembershipDetailDto extends MembershipViewDto {
  readonly charges: readonly Charge[];
  readonly attendances: readonly Attendance[];
}

export interface MeDto {
  readonly user: User;
  readonly wallet: readonly MembershipViewDto[];
}

/**
 * JSON no sabe de fechas, y los tipos de arriba dicen que sí.
 *
 * `Charge.createdAt` está declarado como `Date`, pero lo que llega por la red es
 * la cadena ISO que produjo `JSON.stringify` en el servidor. El tipo mentía, y
 * la mentira no explota aquí sino donde alguien confía en él: el store ordena
 * los cargos con `b.createdAt.getTime()` y la app se cae con "undefined is not a
 * function" a tres saltos de distancia del origen.
 *
 * Se revive aquí y no en quien consume porque este módulo es la única salida a
 * la red. Arreglarlo en un consumidor dejaría a los demás con el mismo campo
 * roto y sin forma de saberlo.
 *
 * `PlainDate` no necesita nada: es `{ year, month, day }`, un objeto plano que
 * sobrevive al viaje intacto. Esa fue exactamente la razón de elegirlo sobre
 * `Date` para las fechas civiles.
 */
const fecha = (valor: unknown): Date => new Date(valor as string);
const fechaOpcional = (valor: unknown): Date | null =>
  valor === null || valor === undefined ? null : new Date(valor as string);

const reviveUser = (u: User): User => ({ ...u, createdAt: fecha(u.createdAt) });

const reviveSubscription = (s: Subscription): Subscription => ({
  ...s,
  canceledAt: fechaOpcional(s.canceledAt),
});

const reviveCharge = (c: Charge): Charge => ({ ...c, createdAt: fecha(c.createdAt) });

const reviveAttendance = (a: Attendance): Attendance => ({
  ...a,
  checkedInAt: fecha(a.checkedInAt),
  syncedAt: fechaOpcional(a.syncedAt),
});

const reviveView = <T extends MembershipViewDto>(v: T): T => ({
  ...v,
  user: reviveUser(v.user),
  subscription: reviveSubscription(v.subscription),
});

const reviveDetail = (d: MembershipDetailDto): MembershipDetailDto => ({
  ...reviveView(d),
  charges: d.charges.map(reviveCharge),
  attendances: d.attendances.map(reviveAttendance),
});

export const fetchMe = async (): Promise<MeDto> => {
  const me = await request<MeDto>('/me');
  return { user: reviveUser(me.user), wallet: me.wallet.map(reviveView) };
};

export const fetchWallet = async (): Promise<readonly MembershipViewDto[]> =>
  (await request<readonly MembershipViewDto[]>('/me/wallet')).map(reviveView);

export const fetchMembership = async (membershipId: string): Promise<MembershipDetailDto> =>
  reviveDetail(await request<MembershipDetailDto>(`/me/memberships/${membershipId}`));

export interface CheckInPreviewDto {
  readonly result: CheckInResult;
  readonly message: AccessMessage;
  readonly quota: QuotaState;
  readonly receivable: Receivable;
}

export const fetchCheckInPreview = (membershipId: string): Promise<CheckInPreviewDto> =>
  request(`/me/memberships/${membershipId}/checkin-preview`);

/**
 * Horario de clases del gimnasio de esta membresia.
 *
 * Va por membresia porque el horario es del LOCAL: la billetera puede tener tres
 * gimnasios y cada uno tiene el suyo.
 */
export const fetchMySchedules = (membershipId: string): Promise<readonly ClassSchedule[]> =>
  request(`/me/memberships/${membershipId}/schedules`);

export const fetchPlansFor = (membershipId: string): Promise<readonly Plan[]> =>
  request(`/me/memberships/${membershipId}/plans`);

export const changePlan = (membershipId: string, planId: string): Promise<unknown> =>
  request(`/me/memberships/${membershipId}/plan`, { method: 'POST', body: { planId } });

export const cancelMembership = (membershipId: string): Promise<unknown> =>
  request(`/me/memberships/${membershipId}/cancel`, { method: 'POST' });

/**
 * Siembra el secreto TOTP.
 *
 * Se llama una vez al vincular. A partir de ahí el QR se genera en el dispositivo
 * sin internet, que es el requisito del MD 4.6.
 */
export interface DeviceLinkDto {
  readonly secret: string;
  readonly algorithm: 'HMAC-SHA256';
  readonly digits: number;
  readonly periodSeconds: number;
  readonly userId: string;
}

export const linkDevice = (rotate = false): Promise<DeviceLinkDto> =>
  request('/me/device', { method: 'POST', body: { rotate } });

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

export interface RosterEntryDto extends MembershipViewDto {}

/**
 * Padron del local.
 *
 * `incluirBajas` trae tambien a quien cancelo. No entra en el padron normal —el
 * mostrador mira "quien entrena aqui" todo el dia— pero hace falta poder verlas:
 * sin ellas, `resubscribe` no tiene forma de recibir un `membershipId`.
 */
export const fetchRoster = async (incluirBajas = false): Promise<readonly RosterEntryDto[]> =>
  (
    await request<readonly RosterEntryDto[]>(
      incluirBajas ? '/staff/roster?includeCanceled=true' : '/staff/roster',
    )
  ).map(reviveView);

export const fetchStaffMember = async (membershipId: string): Promise<MembershipDetailDto> =>
  reviveDetail(await request<MembershipDetailDto>(`/staff/members/${membershipId}`));

/**
 * ¿Hay ya una identidad Sinchi con ese correo?
 *
 * Un booleano y nada mas, a proposito: `users` es global, y devolver el nombre o
 * el documento convertiria esto en un buscador de personas que entrenan en otros
 * locales. Lo que se ahorra igual es saber si hara falta pedir el nombre y el
 * celular.
 */
export const identityExists = (email: string): Promise<{ readonly existe: boolean }> =>
  request(`/staff/members/identity?email=${encodeURIComponent(email)}`);

export interface EnrollResultDto {
  readonly view: MembershipViewDto;
  /** `true` si la persona ya existia en la red y solo se le sumo este gimnasio. */
  readonly reusedIdentity: boolean;
}

/**
 * Da de alta a un alumno en el local.
 *
 * La identidad es GLOBAL: si el celular o el documento ya existen en la red, se
 * reutiliza esa persona en vez de crear otra. Por eso puede responder 409 —
 * coincide uno de los dos datos pero no el otro, que es o un tipeo o dos
 * personas distintas, y adivinarlo es como se fusionan dos alumnos por error.
 */
export const enrollMember = async (input: {
  /** Solo si la persona es nueva: reutilizando identidad ya se sabe. */
  readonly name?: string;
  readonly documentId: string;
  readonly phone?: string;
  readonly email?: string;
  readonly planId: string;
}): Promise<EnrollResultDto> => {
  const out = await request<EnrollResultDto>('/staff/members', { method: 'POST', body: input });
  return { ...out, view: reviveView(out.view) };
};

/**
 * Horarios de clase del local.
 *
 * Los necesita la validacion SIN CONEXION. Con la lista vacia, `validateCheckIn`
 * entiende "este gimnasio no controla horarios" y deja pasar a cualquier hora —
 * asi que el dispositivo de la puerta decia que si a quien el servidor rechaza
 * por fuera de horario. Es exactamente la divergencia que el modo offline no
 * puede tener (MD 4.6).
 */
export const fetchSchedules = (): Promise<readonly ClassSchedule[]> =>
  request('/staff/schedules');

/** Planes del local. Los del staff, no los del alumno: `/me/...` es su billetera. */
export const fetchStaffPlans = (): Promise<readonly Plan[]> => request('/staff/plans');

/**
 * Vuelve a suscribir a alguien que canceló, sin volver a registrarlo.
 *
 * La ficha y el historial siguen ahí: cancelar apaga la suscripción, no borra a
 * la persona. Por eso esto existe y no es un alta nueva.
 */
export const resubscribe = (membershipId: string, planId: string): Promise<unknown> =>
  request(`/staff/members/${membershipId}/resubscribe`, { method: 'POST', body: { planId } });

/**
 * Marcados de las ultimas horas en este local.
 *
 * Alimenta "Ultimos marcados" de la puerta. Sale del servidor y no de las
 * asistencias en memoria porque el equipo del mostrador no tiene las de los
 * turnos anteriores: la lista es del LOCAL, no de esta sesion.
 */
export interface RecentCheckInDto extends Attendance {
  readonly userName: string;
}

export const fetchRecentCheckIns = async (): Promise<readonly RecentCheckInDto[]> =>
  (await request<readonly RecentCheckInDto[]>('/staff/checkin/recent')).map((row) => ({
    ...reviveAttendance(row),
    userName: row.userName,
  }));

export interface CheckInOutcomeDto {
  readonly registered: boolean;
  readonly alreadyRegistered?: boolean;
  readonly result: CheckInResult;
  readonly message: AccessMessage;
  readonly view: MembershipViewDto;
  readonly attendance?: Attendance;
}

const reviveOutcome = (o: CheckInOutcomeDto): CheckInOutcomeDto => ({
  ...o,
  view: reviveView(o.view),
  ...(o.attendance === undefined ? {} : { attendance: reviveAttendance(o.attendance) }),
});

export const scanQr = async (
  payload: string,
  options: { readonly record?: boolean; readonly clientId?: string } = {},
): Promise<CheckInOutcomeDto> =>
  reviveOutcome(
    await request<CheckInOutcomeDto>('/staff/checkin/qr', {
      method: 'POST',
      body: { payload, record: options.record ?? true, clientId: options.clientId },
    }),
  );

export const markManual = async (input: {
  readonly membershipId: string;
  readonly overrideDenial?: boolean;
  readonly clientId?: string;
  readonly occurredAt?: string;
}): Promise<CheckInOutcomeDto> =>
  reviveOutcome(
    await request<CheckInOutcomeDto>('/staff/checkin/manual', { method: 'POST', body: input }),
  );

export interface PaymentResultDto {
  readonly charge: Charge;
  readonly view: MembershipViewDto;
  readonly alreadyRecorded: boolean;
}

export const recordPayment = async (input: {
  readonly membershipId: string;
  readonly type: 'renewal' | 'enrollment' | 'drop_in';
  readonly rail: 'cash' | 'yape' | 'bank_transfer';
  readonly periods?: number;
  readonly amountCents?: number;
  readonly clientId?: string;
}): Promise<PaymentResultDto> => {
  const out = await request<PaymentResultDto>('/staff/payments', { method: 'POST', body: input });
  return { ...out, charge: reviveCharge(out.charge), view: reviveView(out.view) };
};

/**
 * Resumen del local. Solo el dueño.
 *
 * `collectedThisMonthCents` cuenta cargos con estado `succeeded` desde el 1 del
 * mes; `checkInsToday` son las últimas 18 horas, no el día civil, para que un
 * turno de noche no se corte a medias.
 */
export interface SummaryDto {
  readonly activeMembers: number;
  readonly delinquentMembers: number;
  readonly collectedThisMonthCents: number;
  readonly outstandingCents: number;
  readonly checkInsToday: number;
}

export const fetchSummary = (): Promise<SummaryDto> => request('/staff/summary');

export const fetchClaims = (): Promise<
  readonly {
    readonly id: string;
    readonly code: string;
    readonly email: string | null;
    readonly displayName: string | null;
    readonly expiresAt: string;
  }[]
> => request('/staff/claims');

export const confirmClaim = (code: string, membershipId: string): Promise<unknown> =>
  request('/staff/claims/confirm', { method: 'POST', body: { code, membershipId } });

export const setOwnPin = (pin: string): Promise<unknown> =>
  request('/staff/pin', { method: 'POST', body: { pin } });

/**
 * Quien viene a probar. La lista de posibles alumnos del local.
 *
 * Por defecto solo lo que falta: el mostrador la abre para saber a quien espera,
 * no para leer el historial.
 */
export const fetchTrials = async (incluirPasadas = false): Promise<readonly TrialBooking[]> =>
  (
    await request<readonly TrialBooking[]>(
      incluirPasadas ? '/staff/trials?includePast=true' : '/staff/trials',
    )
  ).map(reviveTrial);

/**
 * ¿Este gimnasio ofrece la clase gratis?
 *
 * La lee también recepción, que no puede cambiarla: la pantalla tiene que poder
 * decir por qué no llega nadie a probar.
 */
export const fetchTrialSettings = (): Promise<{ readonly trialClassEnabled: boolean }> =>
  request('/staff/trials/settings');

/** Enciende o apaga la clase gratis del local. Solo el dueño. */
export const setTrialClassEnabled = (
  enabled: boolean,
): Promise<{ readonly trialClassEnabled: boolean }> =>
  request('/staff/trials/settings', { method: 'POST', body: { enabled } });

/** Vino, no vino, o canceló. Es lo que convierte la lista en un dato. */
export const setTrialStatus = async (
  bookingId: string,
  status: TrialBookingStatus,
): Promise<TrialBooking> =>
  reviveTrial(
    await request<TrialBooking>(`/staff/trials/${bookingId}/status`, {
      method: 'POST',
      body: { status },
    }),
  );

/**
 * Sube la cola acumulada sin conexión.
 *
 * Un solo viaje: en la red de un gimnasio, veinte peticiones sueltas son veinte
 * oportunidades de que se corte a la mitad. Devuelve el padrón fresco, porque el
 * momento de recuperar la conexión es justo cuando conviene refrescar la caché.
 */
export interface SyncResultDto {
  readonly attendances: readonly { readonly clientId: string; readonly ok: boolean }[];
  readonly payments: readonly { readonly clientId: string; readonly ok: boolean }[];
  readonly syncedAt: string;
  readonly roster: readonly RosterEntryDto[];
}

export const syncQueue = (payload: {
  readonly attendances: readonly unknown[];
  readonly payments: readonly unknown[];
}): Promise<SyncResultDto> => request('/staff/sync', { method: 'POST', body: payload });

// ---------------------------------------------------------------------------
// Salud
// ---------------------------------------------------------------------------

/** ¿Hay api al otro lado? Alimenta el indicador de "sin conexión" del mostrador. */
export async function ping(): Promise<boolean> {
  try {
    await request('/health', { anonymous: true });
    return true;
  } catch {
    return false;
  }
}
