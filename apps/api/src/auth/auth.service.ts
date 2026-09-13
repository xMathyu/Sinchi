/**
 * Emisión de sesiones.
 *
 * La autenticación real es Google vía Firebase (`signInWithGoogle`), y vale para
 * los tres: alumno, recepción y dueño. Lo que distingue a cada uno es su fila en
 * `staff`, que `issueForUser` lee para decidir el rol — no la forma de entrar.
 *
 * Hubo una cuarta puerta, `openShift`: token del equipo del mostrador más un PIN
 * de 4-6 dígitos, pensada para una tablet compartida con turnos rotando. Se
 * retiró porque los gimnasios reales de la red no son así —el profesor es la
 * recepción, y entra con su propia cuenta desde su teléfono—, y sostenerla
 * costaba dos rutas públicas, un registro de equipos, hasheo scrypt con bloqueo
 * por intentos y una excepción de RLS.
 *
 * Queda además `devLogin`, que:
 *  - solo funciona con `ALLOW_DEV_LOGIN=true`;
 *  - se niega a arrancar con esa bandera en producción (ver `config/env.ts`);
 *  - no verifica NADA: si conoces el celular, entras.
 *
 * Está aislada en un método con ese nombre para que nadie la confunda con
 * autenticación real al leer el código.
 */
import {
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { and, eq, inArray } from 'drizzle-orm';
import type { AppRole } from '@sinchi/shared';
import { InjectDb } from '../db/db.module';
import { withTenant, withUser, withoutTenantIsolation, type Database } from '../db/client';
import { schema } from '../db/client';
import { loadEnv } from '../config/env';
import type { Session, SessionClaims } from './session';
import { FirebaseVerifier } from './firebase';
import {
  AccountLinkService,
  type SignUpDetails,
  type PendingClaim,
} from './account-link.service';
import { InviteService } from './invite.service';

/**
 * La cuenta de Google es valida pero no esta vinculada a ninguna ficha del
 * padron. No se emite sesion: se devuelve el codigo que la recepcionista
 * confirma en el mostrador.
 */
export interface UnlinkedAccount {
  readonly linked: false;
  readonly claim: PendingClaim;
}

export interface IssuedSession {
  readonly linked: true;
  readonly accessToken: string;
  readonly expiresInSeconds: number;
  readonly role: AppRole;
  readonly userId: string;
  readonly tenantId: string | null;
}

/** La fila de `staff` de una persona: su puesto y dónde. */
interface StaffRow {
  readonly id: string;
  readonly tenantId: string;
  readonly role: string;
}

/** Un puesto con el nombre del local puesto, que es lo que se enseña. */
export interface StaffPost {
  readonly role: AppRole;
  readonly tenantId: string;
  readonly tenantName: string | null;
}

/**
 * Los dos lados de una misma persona.
 *
 * `student` es true si tiene ficha activa en algún padrón; `staff` son sus
 * puestos, uno por gimnasio donde trabaja. Que los dos vengan llenos es el caso
 * que el producto no sabía enseñar: el dueño que entrena en su propio dojo.
 *
 * `staff` es una LISTA y no un puesto suelto porque una persona puede trabajar
 * en varios locales: el profesor que lleva la escuela de la universidad y da
 * clases por su cuenta el fin de semana es un solo `users` con dos filas en
 * `staff`. Va vacía —no nula— cuando no trabaja en ninguno: así el cliente
 * pregunta por `length` y no tiene dos formas de decir «ninguno».
 */
export interface AvailableModes {
  readonly student: boolean;
  readonly staff: readonly StaffPost[];
}

/**
 * Una semana.
 *
 * El alumno abre la app en la puerta del gimnasio, muchas veces sin datos: una
 * sesión corta lo dejaría fuera justo cuando la necesita. El QR es de vida
 * corta y firmado, así que la sesión larga no relaja el control de acceso.
 */
const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly jwt: JwtService,
    private readonly firebase: FirebaseVerifier,
    private readonly accountLink: AccountLinkService,
    private readonly invites: InviteService,
  ) {}

  // -------------------------------------------------------------------------
  // Entrar con Google
  // -------------------------------------------------------------------------

  /**
   * Cambia un ID token de Firebase por una sesion de Sinchi.
   *
   * Son dos preguntas distintas y se responden por separado: Firebase certifica
   * QUIEN es el humano, y el token de Sinchi dice QUE puede hacer y en que
   * gimnasio. Por eso el token de Firebase no se usa en el resto de la api —
   * cambiar de proveedor de identidad no deberia tocar la autorizacion.
   *
   * Si la cuenta no esta vinculada a una ficha del padron no se emite sesion: se
   * devuelve un codigo para que la recepcionista lo confirme.
   */
  async signInWithGoogle(
    idToken: string,
    details: SignUpDetails = {},
  ): Promise<IssuedSession | UnlinkedAccount> {
    const identity = await this.firebase.verify(idToken);

    let userId = await this.accountLink.findLinkedUser(identity.uid);

    // Arranque del dueno: la unica vinculacion automatica, y solo por email
    // verificado que nosotros registramos al dar de alta el gimnasio.
    userId ??= await this.accountLink.tryLinkOwnerByEmail(identity);

    // El gimnasio registro este correo en el mostrador: la cuenta se activa
    // sola, y en TODOS los gimnasios que lo hayan registrado. Va antes del
    // codigo porque es el camino normal; el codigo queda para quien no dio
    // correo, que en este mercado es gente real.
    userId ??= await this.invites.claimByVerifiedEmail(identity);

    if (userId === null) {
      // Los datos van al codigo pendiente, no a `users`: todavia no hay ficha a
      // la que atarlos. Sirven para que reservar una clase gratis no le vuelva a
      // preguntar lo que acaba de escribir.
      return { linked: false, claim: await this.accountLink.issueClaim(identity, details) };
    }

    return this.issueForUser(userId);
  }


  // -------------------------------------------------------------------------
  // Emision
  // -------------------------------------------------------------------------

  /** Sesion para una ficha del padron ya vinculada. */
  /**
   * Emite sesion para un usuario ya vinculado.
   *
   * Publica porque la invitacion tambien termina en una sesion: vincula por otro
   * camino, pero lo que emite despues tiene que ser identico — mismo rol, mismo
   * gimnasio, misma caducidad. Duplicar esa logica seria la forma segura de que
   * un dia diverjan.
   */
  issueForLinkedUser(userId: string): Promise<IssuedSession> {
    return this.issueForUser(userId);
  }

  /**
   * Sesion para una identidad ya resuelta.
   *
   * Publica porque el alta de un gimnasio tambien la necesita: quien acaba de
   * crear su local tiene que entrar como dueno sin volver a autenticarse.
   */
  async issueForUser(userId: string): Promise<IssuedSession> {
    const staffRow = await this.primaryStaffRow(userId);

    const claims: SessionClaims =
      staffRow === undefined
        ? { sub: userId, role: 'student' }
        : {
            sub: userId,
            role: staffRow.role === 'owner' ? 'owner' : 'front_desk',
            tenantId: staffRow.tenantId,
            staffId: staffRow.id,
          };

    return {
      linked: true,
      accessToken: await this.jwt.signAsync(claims, { expiresIn: TOKEN_TTL_SECONDS }),
      expiresInSeconds: TOKEN_TTL_SECONDS,
      role: claims.role,
      userId: claims.sub,
      tenantId: claims.tenantId ?? null,
    };
  }

  async devLogin(phone: string): Promise<IssuedSession> {
    if (!loadEnv().ALLOW_DEV_LOGIN) {
      throw new ServiceUnavailableException(
        'El login de desarrollo está desactivado en este servidor. Entra con Google, ' +
          'o apunta la app a una api local con ALLOW_DEV_LOGIN=true.',
      );
    }

    const normalized = phone.trim();

    // Paso 1: la identidad. `users` vive fuera del tenant y no lleva RLS.
    const [user] = await withoutTenantIsolation(this.db, (tx) =>
      tx
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.phone, normalized))
        .limit(1),
    );

    if (user === undefined) {
      throw new UnauthorizedException(`No hay ningún usuario con el celular ${normalized}.`);
    }

    // Paso 2: el rol. Va en una transacción aparte —no anidada— porque anidar
    // `withUser` dentro de otra transacción tomaría una segunda conexión del
    // pool sin necesidad.
    const staffRow = await this.primaryStaffRow(user.id);

    // El mismo binario sirve a los tres roles (MD 4.6) y el rol lo define la
    // sesión, no una preferencia de la persona.
    const claims: SessionClaims =
      staffRow === undefined
        ? { sub: user.id, role: 'student' }
        : {
            sub: user.id,
            role: staffRow.role === 'owner' ? 'owner' : 'front_desk',
            tenantId: staffRow.tenantId,
            staffId: staffRow.id,
          };

    return {
      linked: true,
      accessToken: await this.jwt.signAsync(claims, { expiresIn: TOKEN_TTL_SECONDS }),
      expiresInSeconds: TOKEN_TTL_SECONDS,
      role: claims.role,
      userId: claims.sub,
      tenantId: claims.tenantId ?? null,
    };
  }

  /**
   * Sesión de alumno para una persona que es staff.
   *
   * El dueño de un dojo también entrena en él. Sin esto tendría que cerrar
   * sesión para ver su propia billetera.
   */
  async switchToStudent(session: Session): Promise<IssuedSession> {
    const vida = remainingSeconds(session);
    const claims: SessionClaims = { sub: session.sub, role: 'student' };
    return {
      linked: true,
      accessToken: await this.jwt.signAsync(claims, { expiresIn: vida }),
      expiresInSeconds: vida,
      role: 'student',
      userId: session.sub,
      tenantId: null,
    };
  }

  /**
   * La vuelta: de alumno a su puesto.
   *
   * `switchToStudent` existía sin par, y eso dejaba al dueño encerrado: quien
   * cambiaba a alumno para mirar su billetera se quedaba sin forma de volver que
   * no fuera cerrar sesión y entrar de nuevo.
   *
   * No concede nada nuevo: vuelve a leer `staff` y devuelve exactamente lo que
   * `issueForUser` le habría dado al entrar con Google. Si la fila ya no está
   * —lo sacaron del equipo mientras miraba su billetera— no hay vuelta, y eso es
   * lo correcto.
   *
   * Con `tenantId` es además el CAMBIO DE LOCAL, y es la misma operación mirada
   * de cerca: «emíteme una sesión de staff, en este gimnasio». Tener una sola
   * puerta importa — dos rutas que firman tokens de staff son dos sitios donde
   * comprobar que el puesto es suyo, y la segunda es la que un día se olvida.
   *
   * Cambiar de local NO alarga la sesión: `remainingSeconds` la deja con lo que
   * le quedaba. Si no, un turno de doce horas se renovaría solo saltando de un
   * gimnasio al otro y de vuelta.
   */
  async switchToStaff(session: Session, tenantId?: string): Promise<IssuedSession> {
    const posts = await this.staffRowsOf(session.sub);

    /**
     * Sin gimnasio pedido, el de siempre. Con uno pedido, tiene que ser SUYO.
     *
     * Este `find` es el control de acceso entero del cambio de local, y se
     * sostiene en que `staffRowsOf` lee bajo contexto de identidad: la política
     * de `staff` solo deja ver las filas propias, así que la lista contra la que
     * se busca no puede contener el puesto de otra persona. Comprobar contra la
     * base «¿existe un staff en ese tenant?» sí sería un agujero — existe, pero
     * puede no ser el suyo.
     */
    const staffRow =
      tenantId === undefined ? posts[0] : posts.find((p) => p.tenantId === tenantId);

    if (staffRow === undefined) {
      throw new ForbiddenException(
        tenantId === undefined
          ? 'Esta cuenta no trabaja en ningún gimnasio.'
          : 'Esta cuenta no trabaja en ese gimnasio.',
      );
    }

    const vida = remainingSeconds(session);
    const claims: SessionClaims = {
      sub: session.sub,
      role: staffRow.role === 'owner' ? 'owner' : 'front_desk',
      tenantId: staffRow.tenantId,
      staffId: staffRow.id,
    };

    return {
      linked: true,
      accessToken: await this.jwt.signAsync(claims, { expiresIn: vida }),
      expiresInSeconds: vida,
      role: claims.role,
      userId: session.sub,
      tenantId: staffRow.tenantId,
    };
  }

  /**
   * Qué otros modos tiene esta persona.
   *
   * Lo pregunta la pantalla de ajustes, y la respuesta NO se puede deducir del
   * token: el rol firmado dice con qué entró, no qué más es. Un dueño con ficha
   * en su propio dojo y uno sin ella llevan sesiones idénticas.
   *
   * `student` dice si tiene ficha activa en algún padrón, y eso ya NO decide si
   * se le ofrece el modo alumno —eso se ofrece siempre, porque cualquiera puede
   * mirar su billetera y el directorio— sino qué se le promete al ofrecerlo. La
   * lista `staff` sí decide: `switch-to-staff` relee `staff` y rechaza a quien
   * no trabaja en ningún gimnasio.
   *
   * Se consulta en vivo y no se guarda en el JWT a propósito. Un dueño que se
   * inscribe hoy vería el botón recién la semana que viene, cuando caducara su
   * sesión — y un recepcionista al que sacaron del equipo seguiría viendo una
   * vuelta que la api ya rechaza. Son dos consultas por índice.
   *
   * Es además de donde sale el selector de local: los puestos vienen con el
   * nombre del gimnasio puesto, porque «cambiar a b3f1-…» no lo elige nadie.
   */
  async modesFor(userId: string): Promise<AvailableModes> {
    const [posts, membership] = await Promise.all([
      this.staffRowsOf(userId),
      withUser(this.db, userId, (tx) =>
        tx
          .select({ id: schema.memberships.id })
          .from(schema.memberships)
          .where(
            and(eq(schema.memberships.userId, userId), eq(schema.memberships.status, 'active')),
          )
          .limit(1),
      ).then((rows) => rows[0]),
    ]);

    const student = membership !== undefined;
    if (posts.length === 0) return { student, staff: [] };

    /**
     * Los nombres, en UNA consulta y sin adoptar ningún gimnasio.
     *
     * `tenants` no lleva RLS —la identidad y el catálogo de locales son
     * globales, y hay un test que lo fija— así que un `IN` los trae todos de
     * golpe. Antes esto era un `withTenant` por puesto; con un solo local daba
     * igual, con cinco son cinco transacciones para leer cinco nombres.
     */
    const names = await withoutTenantIsolation(this.db, (tx) =>
      tx
        .select({ id: schema.tenants.id, name: schema.tenants.name })
        .from(schema.tenants)
        .where(
          inArray(
            schema.tenants.id,
            posts.map((p) => p.tenantId),
          ),
        ),
    );
    const nameById = new Map(names.map((t) => [t.id, t.name]));

    return {
      student,
      staff: posts.map((post) => ({
        role: post.role === 'owner' ? ('owner' as const) : ('front_desk' as const),
        tenantId: post.tenantId,
        tenantName: nameById.get(post.tenantId) ?? null,
      })),
    };
  }

  /**
   * TODAS las filas de `staff` de esta persona, de la más antigua a la más nueva.
   *
   * Va con contexto de IDENTIDAD y no de gimnasio: el gimnasio es justo lo que
   * se averigua, y la política de `staff` permite leer las filas propias sin
   * importar el tenant (`user_id = app_current_user()`, migración 0001). Por eso
   * una sola consulta devuelve los puestos de todos sus locales.
   *
   * El orden es el del alta y se desempata por `id`. Tiene que ser TOTAL, no
   * solo estable: sin el desempate, dos filas sembradas en la misma
   * transacción comparten `created_at` y Postgres puede devolverlas en
   * cualquier orden — que es como el login de un dueño con dos locales acabaría
   * llevándolo a uno distinto cada vez.
   */
  private async staffRowsOf(userId: string): Promise<readonly StaffRow[]> {
    return withUser(this.db, userId, (tx) =>
      tx
        .select({
          id: schema.staff.id,
          tenantId: schema.staff.tenantId,
          role: schema.staff.role,
        })
        .from(schema.staff)
        .where(eq(schema.staff.userId, userId))
        .orderBy(schema.staff.createdAt, schema.staff.id),
    );
  }

  /**
   * A qué local entra quien no pidió ninguno.
   *
   * El primero por antigüedad: el local de siempre. Abrir un segundo no puede
   * cambiar dónde amanece la app del dueño al día siguiente, y de ahí que el
   * criterio sea el alta y no algo que se mueve, como el nombre.
   */
  private async primaryStaffRow(userId: string): Promise<StaffRow | undefined> {
    return (await this.staffRowsOf(userId))[0];
  }
}

/**
 * Lo que le queda de vida a la sesión que pide el cambio.
 *
 * El cambio de modo REEMITE el token, y sin esto reemitir regalaba vida nueva:
 * un turno del mostrador dura 12 horas a propósito —«quien entra a las seis no
 * hereda la sesión de mediodía»— y bastaba pasar por alumno y volver para
 * convertirlo en los 7 días del login normal, en una tablet compartida.
 *
 * Así el cambio es lo que dice ser: la misma sesión con otra etiqueta. Tampoco
 * se renueva indefinidamente yendo y viniendo.
 *
 * El `exp` lo pone el propio JWT y el guard ya rechazó los vencidos; el suelo de
 * un minuto solo evita firmar un `expiresIn` de cero o negativo si el token
 * caduca entre la verificación y la firma.
 */
function remainingSeconds(session: Session): number {
  if (session.exp === undefined) return TOKEN_TTL_SECONDS;
  return Math.max(60, session.exp - Math.floor(Date.now() / 1000));
}
