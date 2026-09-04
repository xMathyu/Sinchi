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
  PlainDate,
  Plan,
  PromoDenial,
  QuotaState,
  Receivable,
  SaasNotice,
  SaasState,
  SaasTier,
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
  /** Seminarios y talleres publicados que todavía no han pasado. */
  readonly events: readonly EventoConCupo[];
  /** Las rutinas PÚBLICAS: el escaparate. */
  readonly routines: readonly RutinaEnLista[];
  /** Cuántas hay solo para alumnos. El número vende; los títulos no se dan. */
  readonly membersOnlyRoutines: number;
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

export const fetchGym = async (slug: string): Promise<GymDetailDto> => {
  const ficha = await request<GymDetailDto>(`/gyms/${encodeURIComponent(slug)}`, {
    anonymous: true,
  });
  // Misma revivida que en la lista del staff: `date` llega como cadena y el tipo
  // promete `PlainDate`.
  return {
    ...ficha,
    events: (ficha.events ?? []).map((fila) => ({ ...fila, event: reviveEvento(fila.event) })),
    // `?? []` porque la app se actualiza sola y la api no: contra un despliegue
    // viejo estos campos no vienen, y una lista que no existe rompe la ficha
    // entera del gimnasio.
    routines: ficha.routines ?? [],
    membersOnlyRoutines: ficha.membersOnlyRoutines ?? 0,
  };
};

/** Coge plaza sin sesión de Sinchi, con la cuenta de Google verificada. */
export const bookEventAsGuest = (input: {
  readonly slug: string;
  readonly eventId: string;
  readonly idToken: string;
  readonly fullName: string;
  readonly phone: string;
}): Promise<BookEventDto> =>
  request(`/gyms/${encodeURIComponent(input.slug)}/events/${input.eventId}/book`, {
    method: 'POST',
    anonymous: true,
    body: { idToken: input.idToken, fullName: input.fullName, phone: input.phone },
  });

/** Coge plaza con la sesión puesta: no hace falta preguntarle nada. */
export const bookEvent = (input: {
  readonly slug: string;
  readonly eventId: string;
}): Promise<BookEventDto> => request('/me/events', { method: 'POST', body: input });

/**
 * Resultado de coger plaza.
 *
 * Union discriminada porque el servidor responde 200 también al rechazar: que se
 * agotaran las plazas no es un error de la petición, y la pantalla necesita el
 * motivo para decir si esperar al siguiente o si ya tenía la suya.
 */
export type BookEventDto =
  | { readonly booked: true; readonly registration: PlazaDto; readonly event: EventoDto }
  | {
      readonly booked: false;
      readonly reason: { readonly code: string; readonly paid?: boolean; readonly capacity?: number };
      readonly event: EventoDto;
    };

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
  /** Si ya pagó la clase de HOY. Solo significa algo en un plan de clase suelta. */
  readonly dropInPaidToday: boolean;
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

// ---------------------------------------------------------------------------
// La oferta del gimnasio (solo el dueño escribe)
// ---------------------------------------------------------------------------

/**
 * Un plan con lo que hace falta saber ANTES de tocarlo.
 *
 * `activeMembers` no es adorno: es la diferencia entre «esto se puede borrar» y
 * «esto lo están pagando catorce personas».
 */
export interface PlanConUso {
  readonly plan: Plan;
  readonly activeMembers: number;
  /** `false` cuando alguien lo tiene: entonces solo se puede archivar. */
  readonly deletable: boolean;
}

/** Lo que se manda al crear o editar. `id` no va: la ruta ya lo dice. */
export interface PlanEscrito {
  readonly name: string;
  readonly type: Plan['type'];
  readonly sessionsPerWeek: number | null;
  readonly allowedDays: readonly number[] | null;
  readonly priceCents: number;
  readonly active: boolean;
}

/** La lista del dueño: también los archivados, y con cuánta gente tiene cada uno. */
export const fetchPlanesDelDueno = (): Promise<readonly PlanConUso[]> =>
  request('/staff/plans/all');

export const crearPlan = (plan: PlanEscrito): Promise<Plan> =>
  request('/staff/plans', { method: 'POST', body: plan });

export const editarPlan = (planId: string, plan: PlanEscrito): Promise<Plan> =>
  request(`/staff/plans/${planId}`, { method: 'POST', body: plan });

/** Archiva o revive. Quien ya lo tiene lo conserva; deja de ofrecerse. */
export const archivarPlan = (planId: string, active: boolean): Promise<Plan> =>
  request(`/staff/plans/${planId}/active`, { method: 'POST', body: { active } });

/** Solo el que nunca se usó. Con un alumno detrás, la api responde 409. */
export const borrarPlan = (planId: string): Promise<unknown> =>
  request(`/staff/plans/${planId}`, { method: 'DELETE' });

/**
 * Lo que el local cobra aparte de los planes.
 *
 * Ojo con no confundir las dos clases sueltas: `dropInPriceCents` es lo que paga
 * el alumno CON PLAN que agota su cupo semanal. La de quien nunca tuvo cupo es
 * un plan de tipo `drop_in`, con su precio en `plans`.
 */
export interface PreciosDelLocal {
  readonly enrollmentFeeCents: number;
  readonly dropInPriceCents: number | null;
  readonly quotaOverflowPolicy: 'block' | 'offer_drop_in';
  readonly trialClassEnabled: boolean;
  readonly trialClassPriceCents: number;
}

export const fetchPrecios = (): Promise<PreciosDelLocal> => request('/staff/pricing');

// ---------------------------------------------------------------------------
// Eventos con fecha: seminarios, talleres, la clase del invitado
// ---------------------------------------------------------------------------

export interface EventoDto {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly description: string | null;
  readonly instructor: string | null;
  readonly date: PlainDate;
  readonly startTime: string;
  readonly endTime: string;
  readonly capacity: number | null;
  /** Lo que paga el alumno del local. */
  readonly memberPriceCents: number;
  /** Lo que paga quien viene de fuera. Suele ser más alto, y ese es el punto. */
  readonly guestPriceCents: number;
  readonly status: 'draft' | 'published' | 'canceled';
}

/** Un evento con lo que hace falta para decidir sobre él. */
export interface EventoConCupo {
  readonly event: EventoDto;
  /** Plazas vivas: reservadas, pagadas o no. */
  readonly seatsTaken: number;
  /** `null` cuando el evento no limita el cupo. */
  readonly seatsLeft: number | null;
  /** Cuántas están pagadas. Es la cifra que el dueño mira antes del día. */
  readonly paidSeats: number;
}

export interface PlazaDto {
  readonly registration: {
    readonly id: string;
    readonly eventId: string;
    readonly membershipId: string | null;
    readonly fullName: string;
    readonly phone: string;
    readonly email: string | null;
    readonly priceCents: number;
    readonly status: 'booked' | 'attended' | 'no_show' | 'canceled';
    readonly chargeId: string | null;
  };
  readonly paid: boolean;
  /** `true` cuando entrena aquí: explica por qué paga el precio que paga. */
  readonly isMember: boolean;
}

/** Lo que se manda al crear o editar un evento. */
export interface EventoEscrito {
  readonly name: string;
  readonly description: string | null;
  readonly instructor: string | null;
  /** `YYYY-MM-DD`. */
  readonly date: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly capacity: number | null;
  readonly memberPriceCents: number;
  readonly guestPriceCents: number;
  readonly published: boolean;
}

/**
 * Lo que viene, o el historial con `past`.
 *
 * Las dos listas son disjuntas: ver el mismo seminario en «lo que viene» y en
 * «lo que pasó» no es más información, es una duda.
 */
export const fetchEventos = async (
  opciones: { readonly past?: boolean; readonly drafts?: boolean } = {},
): Promise<readonly EventoConCupo[]> => {
  const query = [
    opciones.past === true ? 'past=true' : '',
    opciones.drafts === true ? 'drafts=true' : '',
  ]
    .filter((p) => p.length > 0)
    .join('&');
  const eventos = await request<readonly EventoConCupo[]>(
    query.length === 0 ? '/staff/events' : `/staff/events?${query}`,
  );
  return eventos.map((fila) => ({ ...fila, event: reviveEvento(fila.event) }));
};

export const fetchEvento = async (eventId: string): Promise<EventoConCupo> => {
  const fila = await request<EventoConCupo>(`/staff/events/${eventId}`);
  return { ...fila, event: reviveEvento(fila.event) };
};

export const crearEvento = (evento: EventoEscrito): Promise<EventoDto> =>
  request('/staff/events', { method: 'POST', body: evento });

export const editarEvento = (eventId: string, evento: EventoEscrito): Promise<EventoDto> =>
  request(`/staff/events/${eventId}`, { method: 'POST', body: evento });

/** Publicar, volver a borrador o cancelar. Cancelar NO borra a los inscritos. */
export const cambiarEstadoEvento = (
  eventId: string,
  status: 'draft' | 'published' | 'canceled',
): Promise<EventoDto> =>
  request(`/staff/events/${eventId}/status`, { method: 'POST', body: { status } });

/** Solo el que nadie reservó. Con una plaza vendida, la api responde 409. */
export const borrarEvento = (eventId: string): Promise<unknown> =>
  request(`/staff/events/${eventId}`, { method: 'DELETE' });

export const fetchPlazas = (eventId: string): Promise<readonly PlazaDto[]> =>
  request(`/staff/events/${eventId}/registrations`);

/** El mostrador mete a un alumno del padrón. Un rechazo vuelve con 200. */
export const inscribirEnEvento = (
  eventId: string,
  membershipId: string,
): Promise<
  | { readonly booked: true; readonly registration: PlazaDto }
  | { readonly booked: false; readonly reason: { readonly code: string } }
> =>
  request(`/staff/events/${eventId}/registrations`, {
    method: 'POST',
    body: { membershipId },
  });

export const cambiarEstadoPlaza = (
  registrationId: string,
  status: 'booked' | 'attended' | 'no_show' | 'canceled',
): Promise<PlazaDto> =>
  request(`/staff/events/registrations/${registrationId}/status`, {
    method: 'POST',
    body: { status },
  });

/** Idempotente: tocar dos veces no cobra dos veces. */
export const cobrarPlaza = (
  registrationId: string,
  rail: 'cash' | 'yape' | 'bank_transfer',
): Promise<PlazaDto> =>
  request(`/staff/events/registrations/${registrationId}/pay`, {
    method: 'POST',
    body: { rail },
  });

/**
 * `date` llega como `YYYY-MM-DD` y el tipo dice `PlainDate`.
 *
 * Misma mentira que la de `Charge.createdAt`, y explota igual de lejos de su
 * origen: quien compara la fecha del evento con la de hoy recibe una cadena
 * donde espera `{ year, month, day }`.
 */
function reviveEvento(raw: EventoDto): EventoDto {
  const fecha = raw.date as unknown;
  if (typeof fecha !== 'string') return raw;
  const [year, month, day] = fecha.split('-').map(Number);
  return { ...raw, date: { year: year!, month: month!, day: day! } as PlainDate };
}


// ---------------------------------------------------------------------------
// Rutinas: lo que el gimnasio ensena en video
// ---------------------------------------------------------------------------

export interface RutinaDto {
  readonly id: string;
  readonly tenantId: string;
  readonly title: string;
  readonly summary: string | null;
  /**
   * La direccion con la que se REPRODUCE.
   *
   * Para un enlace es el enlace; para un video subido es una URL firmada que
   * caduca, y que la api solo entrega a quien tiene acceso.
   */
  readonly videoUrl: string | null;
  /** El archivo subido del que sale, si viene de uno. */
  readonly videoAssetId: string | null;
  readonly level: 'beginner' | 'intermediate' | 'advanced' | null;
  readonly visibility: 'public' | 'members';
  readonly status: 'draft' | 'published';
  readonly updatedAt: string;
}

export interface PasoDto {
  readonly id: string;
  readonly routineId: string;
  readonly position: number;
  readonly title: string;
  readonly instructions: string | null;
  readonly videoUrl: string | null;
  readonly videoAssetId: string | null;
  /** "4 series de 12", "5 minutos de uchikomi". */
  readonly prescription: string | null;
}

/** Una rutina en la lista. Sin los pasos: la ficha del gimnasio se abre con datos. */
export interface RutinaEnLista {
  readonly routine: RutinaDto;
  readonly itemCount: number;
  /**
   * El video que representa a la rutina, elegido por la api: el suyo o el del
   * primer paso que tenga uno. La miniatura sale de aqui con `parseVideoLink`,
   * sin subir ninguna imagen.
   */
  readonly coverVideoUrl: string | null;
  /**
   * Tiene video, venga de enlace o de archivo subido.
   *
   * Existe porque `coverVideoUrl` es `null` para los subidos: en una lista no se
   * reproduce nada, asi que la api no firma una URL por fila. Con esto la
   * tarjeta pinta igual su marcador de video.
   */
  readonly hasVideo: boolean;
}

export interface BibliotecaDto {
  readonly routines: readonly RutinaEnLista[];
  /**
   * Cuantas se pierde quien no es alumno.
   *
   * Es el gancho de la ficha publica —«12 rutinas mas para alumnos»— y vale 0
   * para quien ya las tiene.
   */
  readonly membersOnly: number;
}

/**
 * Lo que devuelve pedir UNA rutina.
 *
 * Union discriminada, y las dos ramas vienen con 200: que sea contenido de
 * alumnos no es un error de la peticion. Cuando esta cerrada, el cuerpo NO trae
 * los videos ni las instrucciones —eso lo garantiza la api, no la pantalla— y
 * si el titulo y de que va, que es lo que hace querer entrar.
 */
export type RutinaDetalleDto =
  | { readonly unlocked: true; readonly card: RutinaEnLista; readonly items: readonly PasoDto[] }
  | {
      readonly unlocked: false;
      readonly reason: { readonly code: 'not_published' | 'members_only' };
      readonly teaser: {
        readonly id: string;
        readonly title: string;
        readonly summary: string | null;
        readonly level: 'beginner' | 'intermediate' | 'advanced' | null;
        readonly itemCount: number;
      };
    };

/** Lo que se manda al crear o editar. */
export interface PasoEscrito {
  readonly title: string;
  readonly instructions: string | null;
  readonly videoUrl: string | null;
  readonly videoAssetId: string | null;
  readonly prescription: string | null;
}

export interface RutinaEscrita {
  readonly title: string;
  readonly summary: string | null;
  readonly videoUrl: string | null;
  readonly videoAssetId: string | null;
  readonly level: 'beginner' | 'intermediate' | 'advanced' | null;
  readonly visibility: 'public' | 'members';
  readonly published: boolean;
  readonly items: readonly PasoEscrito[];
}

// -- Del gimnasio (mostrador y dueno) ---------------------------------------

export const fetchRutinas = (): Promise<BibliotecaDto> => request('/staff/routines');

export const fetchRutina = (routineId: string): Promise<RutinaDetalleDto> =>
  request(`/staff/routines/${routineId}`);

export const crearRutina = (rutina: RutinaEscrita): Promise<RutinaDetalleDto> =>
  request('/staff/routines', { method: 'POST', body: rutina });

export const editarRutina = (
  routineId: string,
  rutina: RutinaEscrita,
): Promise<RutinaDetalleDto> =>
  request(`/staff/routines/${routineId}`, { method: 'POST', body: rutina });

export const cambiarEstadoRutina = (
  routineId: string,
  status: 'draft' | 'published',
): Promise<RutinaDto> =>
  request(`/staff/routines/${routineId}/status`, { method: 'POST', body: { status } });

/** De escaparate a contenido de alumnos, y al reves, sin abrir el editor. */
export const cambiarPublicoRutina = (
  routineId: string,
  visibility: 'public' | 'members',
): Promise<RutinaDto> =>
  request(`/staff/routines/${routineId}/visibility`, { method: 'POST', body: { visibility } });

/** Solo si esta sin publicar: la api responde 409 si no. */
export const borrarRutina = (routineId: string): Promise<unknown> =>
  request(`/staff/routines/${routineId}`, { method: 'DELETE' });

/** Lo que hace falta para subir UN archivo, firmado por la api. */
export interface PermisoDeSubida {
  readonly assetId: string;
  readonly uploadUrl: string;
  /** Van tal cual: estan firmadas, no son una sugerencia. */
  readonly headers: Record<string, string>;
  readonly expiresInSeconds: number;
}

export const pedirSubidaDeVideo = (input: {
  readonly contentType: string;
  readonly sizeBytes?: number;
  readonly originalName?: string;
}): Promise<PermisoDeSubida> =>
  request('/staff/routines/videos', { method: 'POST', body: input });

export const confirmarSubidaDeVideo = (
  assetId: string,
): Promise<{ readonly assetId: string; readonly sizeBytes: number | null }> =>
  request(`/staff/routines/videos/${assetId}/ready`, { method: 'POST' });

/**
 * Sube el archivo DIRECTO al almacenamiento, sin pasar por la api.
 *
 * Va con `XMLHttpRequest` y no con `fetch`, que es lo que usa el resto del
 * cliente: `fetch` no informa del progreso, y una barra que no se mueve durante
 * cuatro minutos con un video de 200 MB es indistinguible de una app colgada.
 * La persona cancela y vuelve a empezar, que es la peor version de esto.
 *
 * Tampoco lleva la sesion de Sinchi: la autorizacion ya viaja DENTRO de la URL
 * firmada, y mandar el token a un tercero seria regalarlo.
 */
export function subirArchivoDeVideo(input: {
  readonly permiso: PermisoDeSubida;
  readonly fileUri: string;
  readonly onProgreso?: (fraccion: number) => void;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', input.permiso.uploadUrl);
    for (const [nombre, valor] of Object.entries(input.permiso.headers)) {
      xhr.setRequestHeader(nombre, valor);
    }
    xhr.upload.onprogress = (evento) => {
      if (evento.lengthComputable && input.onProgreso !== undefined) {
        input.onProgreso(evento.loaded / evento.total);
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`El almacenamiento rechazó el video (${xhr.status}).`));
    };
    xhr.onerror = () => reject(new Error('Se cortó la subida. Revisa la conexión.'));
    xhr.onabort = () => reject(new Error('Subida cancelada.'));

    /**
     * En React Native se manda el `file://` envuelto: el puente nativo lee el
     * archivo del disco y lo sube en trozos. Leerlo a memoria antes seria
     * cargar 300 MB en el proceso de la app para volver a escribirlos.
     */
    xhr.send({ uri: input.fileUri, type: input.permiso.headers['Content-Type'] } as unknown as Blob);
  });
}

// -- Del alumno --------------------------------------------------------------

/**
 * La biblioteca de SU gimnasio, por membresia.
 *
 * Por membresia y no suelta porque la biblioteca es del LOCAL: un alumno con
 * tres gimnasios tiene tres.
 */
export const fetchRutinasDeMiGimnasio = (membershipId: string): Promise<BibliotecaDto> =>
  request(`/me/memberships/${membershipId}/routines`);

export const fetchRutinaDeMiGimnasio = (
  membershipId: string,
  routineId: string,
): Promise<RutinaDetalleDto> =>
  request(`/me/memberships/${membershipId}/routines/${routineId}`);

// -- De la calle -------------------------------------------------------------

/** Anonima: es la unica ruta que entrega contenido a quien no tiene cuenta. */
export const fetchRutinaPublica = (
  slug: string,
  routineId: string,
): Promise<RutinaDetalleDto> =>
  request(`/gyms/${encodeURIComponent(slug)}/routines/${routineId}`, { anonymous: true });

export const guardarPrecios = (precios: PreciosDelLocal): Promise<PreciosDelLocal> =>
  request('/staff/pricing', { method: 'POST', body: precios });

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

/**
 * La suscripción del gimnasio a Sinchi.
 *
 * Del dueño: a recepción le responde 403, igual que `/staff/summary`. Es la
 * relación comercial del local, no la operación del mostrador.
 */
export interface SaasSubscriptionDto {
  readonly state: SaasState;
  readonly tier: SaasTier;
  readonly priceCents: number;
  readonly freeUntil: PlainDate;
  readonly nextBillingDate: PlainDate;
  readonly notice: SaasNotice;
}

export const fetchSaasSubscription = (): Promise<SaasSubscriptionDto> =>
  request('/staff/subscription');

/**
 * Canje de un código de promoción.
 *
 * Un código mal escrito vuelve con 200 y `redeemed: false`, como el rechazo de
 * un check-in: no es un fallo de la petición, es un resultado que la persona
 * necesita entender.
 */
export type RedeemPromoDto =
  | { readonly redeemed: true; readonly code: string; readonly freeMonths: number; readonly freeUntil: PlainDate }
  | { readonly redeemed: false; readonly reason: PromoDenial };

export const redeemPromoCode = (code: string): Promise<RedeemPromoDto> =>
  request('/staff/promo', { method: 'POST', body: { code } });

/**
 * Alta de un gimnasio. Anónima salvo por el token de Firebase, igual que la
 * reserva de una clase de prueba: quien la llama todavía no es staff de nada.
 */
export interface SignUpGymInput {
  readonly idToken: string;
  readonly gymName: string;
  readonly taxId: string;
  readonly saasTier: SaasTier;
  readonly ownerName?: string;
  readonly documentId: string;
  readonly phone?: string;
  readonly promoCode?: string;
}

export interface SignUpGymDto {
  readonly tenantId: string;
  readonly slug: string;
  readonly name: string;
  readonly freeUntil: string;
  readonly promo:
    | { readonly applied: true; readonly freeMonths: number }
    | { readonly applied: false; readonly reason: PromoDenial }
    | null;
  readonly session: IssuedSessionDto;
}

export const signUpGym = (input: SignUpGymInput): Promise<SignUpGymDto> =>
  request('/gyms/signup', { method: 'POST', body: input, anonymous: true });

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
 * no para leer el historial. `soloPasadas` pide la otra mitad, y son mitades de
 * verdad: ninguna reserva sale en las dos.
 */
export const fetchTrials = async (soloPasadas = false): Promise<readonly TrialBooking[]> =>
  (
    await request<readonly TrialBooking[]>(
      soloPasadas ? '/staff/trials?onlyPast=true' : '/staff/trials',
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
