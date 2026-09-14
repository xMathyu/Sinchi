/**
 * El chat de Sinchi: la persona escribe, el mostrador contesta.
 *
 * Reemplaza al enlace de WhatsApp, no convive con el (migracion 0020): el
 * objetivo es que la conversacion entre alguien y su gimnasio —o el gimnasio que
 * todavia esta mirando— ocurra dentro de la app.
 *
 * Dos lados con dos formas de entrar, y cada una abre su puerta de RLS:
 *
 *  · la PERSONA —con sesion o solo con su cuenta de Google— entra por las puertas
 *    de identidad y de cuenta. Lee sus hilos en toda la red sin contexto de
 *    gimnasio, y para escribir se adopta el gimnasio del hilo DESPUES de haberlo
 *    leido por esas puertas, igual que al presentar una invitacion;
 *  · el GIMNASIO entra con su tenant, como todo lo del mostrador.
 *
 * Las reglas —cuando se puede escribir, cuanto se tolera sin respuesta— las
 * decide `checkMessageDraft` en `@sinchi/shared`, la misma funcion que corre la
 * app antes de dejar enviar. Aqui solo se le dan los hechos.
 */
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  and,
  count,
  countDistinct,
  desc,
  eq,
  exists,
  gt,
  inArray,
  isNull,
  min,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import {
  MAX_UNANSWERED,
  checkMessageDraft,
  conversationTopicLabel,
  countUnread,
  messageDenialText,
  unansweredStreak,
  type Conversation,
  type ConversationStatus,
  type ConversationTopic,
  type Message,
  type MessageDenial,
  type MessageSender,
} from '@sinchi/shared';
import { InjectDb } from '../../db/db.module';
import {
  adoptTenant,
  schema,
  withContext,
  withTenant,
  withoutTenantIsolation,
  type Database,
  type QueryContext,
  type Tx,
} from '../../db/client';
import { toConversation, toMessage } from '../../common/mappers';
import { MailService } from '../mail/mail.service';
import { SaasService } from '../saas/saas.service';
import { VisitorService, normalizePhone, type VisitorAccount } from '../identity/visitor.service';

/**
 * Cuantos mensajes trae un hilo.
 *
 * Los ultimos doscientos. Un dojo no tiene conversaciones de mil mensajes con
 * una persona, y si alguna llega, lo de hace un ano no es lo que alguien abre el
 * hilo a buscar. Paginar hacia atras se construye el dia que un gimnasio lo pida.
 */
const THREAD_LIMIT = 200;

/** Cuantos hilos trae una lista. La bandeja de un dojo de 150 alumnos cabe de sobra. */
const LIST_LIMIT = 100;

export interface ConversationSummary extends Conversation {
  /** Lo no leido DESDE EL LADO DE QUIEN MIRA. */
  readonly unread: number;
  readonly lastMessage: Message;
}

/** Un hilo en la lista de la persona: con que gimnasio es. */
export interface PersonConversation extends ConversationSummary {
  readonly gymName: string;
  readonly gymSlug: string;
}

/**
 * Un hilo en la bandeja del mostrador.
 *
 * `membershipId` lo decide el padron de HOY y no el `topic`: quien pregunto de
 * curioso en enero y se inscribio en marzo es alumno cuando el mostrador abre la
 * bandeja, y la pantalla tiene que poder llevarlo a su ficha.
 */
export interface InboxEntry extends ConversationSummary {
  readonly membershipId: string | null;
}

/**
 * El hilo con un gimnasio, visto por la persona.
 *
 * `conversation` es `null` mientras no se han escrito nunca: la pantalla abre
 * «hablar con Nova BJJ» exista o no el hilo, y lo que necesita la primera vez
 * son los hechos con los que la app corre `checkMessageDraft` antes de dejar
 * escribir. La racha sin respuesta no viaja: la saca la app de `messages` con
 * `unansweredStreak`, la misma funcion que usa este servicio.
 */
export interface PersonThread {
  readonly gymName: string;
  readonly gymSlug: string;
  readonly conversation: Conversation | null;
  readonly messages: readonly Message[];
  readonly gymOpen: boolean;
  readonly alreadyMember: boolean;
}

export interface GymThread {
  readonly conversation: Conversation;
  readonly membershipId: string | null;
  readonly messages: readonly Message[];
}

export interface PersonMessageInput {
  readonly body: string;
  /** Solo cuenta al ABRIR el hilo: despues, el origen ya esta congelado. */
  readonly topic?: ConversationTopic | undefined;
  /** Solo hacen falta para abrir el hilo, y solo si no tiene ficha. */
  readonly fullName?: string | undefined;
  readonly phone?: string | undefined;
}

/** Quien es la persona, con las dos llaves con las que puede tener hilos. */
interface Who {
  readonly userId: string | null;
  readonly firebaseUid: string | null;
}

/** Lo que el gimnasio necesita para abrir un hilo con alguien. */
interface Person extends Who {
  readonly fullName: string;
  readonly phone: string;
  readonly email: string | null;
}

type ConversationRow = typeof schema.conversations.$inferSelect;

/** `23505` es la violacion de un indice unico en Postgres. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === '23505'
  );
}

/**
 * Abrir un hilo compite consigo mismo: dos toques con la red lenta son dos
 * peticiones, y el `select` previo no ve el hilo que la otra esta creando. Lo
 * atrapa el indice unico, y al segundo intento el hilo ya esta ahi.
 *
 * Se reintenta la transaccion ENTERA y no el INSERT: en Postgres una sentencia
 * fallida deja la transaccion abortada, y seguir dentro de ella no funciona.
 */
async function retryOnRace<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    return run();
  }
}

/** 400 con el motivo estructurado: la app lo muestra tal cual bajo el campo. */
function deny(reason: MessageDenial): never {
  throw new BadRequestException({
    code: reason,
    message: messageDenialText(reason),
  });
}

/**
 * ¿Ya salio un correo por esta tanda?
 *
 * La tanda empieza en el primer mensaje que el otro lado no ha leido. Se compara
 * el aviso contra ESE mensaje y no contra la marca de lectura: la marca guarda la
 * hora del ultimo mensaje leido, que es anterior al correo que lo aviso, y
 * compararla con el aviso dejaba al gimnasio sin correo para siempre despues de
 * la primera vez. Y si el correo fallo, el siguiente mensaje de la tanda lo
 * reintenta, porque el aviso nunca llego a escribirse.
 */
const batchNeedsNotice = (firstUnread: Date | null, notifiedAt: Date | null): boolean =>
  firstUnread !== null && (notifiedAt === null || notifiedAt.getTime() < firstUnread.getTime());

/** Las puertas de RLS que abre esta persona. */
function contextOf(who: Who): QueryContext {
  return {
    ...(who.userId === null ? {} : { userId: who.userId }),
    ...(who.firebaseUid === null ? {} : { trialAccount: who.firebaseUid }),
  };
}

/**
 * Los hilos de esta persona.
 *
 * Por identidad Y por cuenta, por lo mismo que `TrialsService.forUser`: quien
 * escribio ANTES de tener ficha dejo el hilo con `user_id` nulo, y el dia que
 * recepcion lo inscribe ese hilo —el que lo trajo al gimnasio— no puede
 * desaparecer de su app.
 */
function belongsTo(who: Who): SQL {
  const conditions = [
    ...(who.userId === null ? [] : [eq(schema.conversations.userId, who.userId)]),
    ...(who.firebaseUid === null ? [] : [eq(schema.conversations.firebaseUid, who.firebaseUid)]),
  ];
  return or(...conditions)!;
}

/** Hilos con al menos un mensaje. Abrir desde el mostrador y no escribir no deja rastro. */
const hasMessages = (tx: Tx): SQL =>
  exists(
    tx
      .select({ one: sql`1` })
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, schema.conversations.id)),
  );

@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly visitors: VisitorService,
    private readonly saas: SaasService,
    private readonly mail: MailService,
  ) {}

  // -------------------------------------------------------------------------
  // La persona
  // -------------------------------------------------------------------------

  /** Sus hilos en toda la red, lo ultimo hablado arriba. */
  async mine(account: VisitorAccount): Promise<readonly PersonConversation[]> {
    const who = await this.who(account);

    return withContext(this.db, contextOf(who), async (tx) => {
      const rows = await tx
        .select({
          conversation: schema.conversations,
          gymName: schema.tenants.name,
          gymSlug: schema.tenants.slug,
        })
        .from(schema.conversations)
        // `tenants` no tiene RLS: el JOIN funciona sin contexto de gimnasio, que es
        // justo lo que no hay aqui.
        .innerJoin(schema.tenants, eq(schema.tenants.id, schema.conversations.tenantId))
        .where(and(belongsTo(who), hasMessages(tx)))
        .orderBy(desc(schema.conversations.lastMessageAt))
        .limit(LIST_LIMIT);

      const stats = await this.summaries(
        tx,
        rows.map((row) => row.conversation),
        'person',
      );

      return rows.flatMap((row) => {
        const summary = stats.get(row.conversation.id);
        if (summary === undefined) return [];
        return [
          {
            ...toConversation(row.conversation),
            ...summary,
            gymName: row.gymName,
            gymSlug: row.gymSlug,
          },
        ];
      });
    });
  }

  /** Cuantos hilos tienen algo sin leer. Es la insignia, no la lista. */
  async unreadCount(account: VisitorAccount): Promise<number> {
    return (await this.mine(account)).filter((conversation) => conversation.unread > 0).length;
  }

  /**
   * El hilo con un gimnasio. Abrirlo es leerlo.
   *
   * Se lee por las puertas de la PERSONA y sin contexto de gimnasio: la politica
   * de `messages` deja ver un mensaje solo si se ve su hilo, asi que aunque la
   * consulta tuviera un error, no alcanzaria la bandeja de nadie mas. El gimnasio
   * se adopta al final y solo para mover la marca de lectura, que es escribir.
   */
  async personThread(account: VisitorAccount, slug: string): Promise<PersonThread> {
    const gym = await this.findGym(slug);
    const who = await this.who(account);
    const gymOpen = await this.isOpen(gym);

    return withContext(this.db, contextOf(who), async (tx) => {
      const alreadyMember = await this.isMember(tx, who, gym.id);
      const row = await this.findOwn(tx, who, gym.id);
      const base = {
        gymName: gym.name,
        gymSlug: gym.slug,
        gymOpen,
        alreadyMember,
      };

      if (row === null) return { ...base, conversation: null, messages: [] };

      const messages = await this.messagesOf(tx, row.id);
      if (countUnread(messages, 'person', row.personReadAt) > 0) {
        await adoptTenant(tx, gym.id);
        await this.markRead(tx, row.id, 'person', messages);
      }

      return { ...base, conversation: toConversation(row), messages };
    });
  }

  /**
   * Escribe. La primera vez abre el hilo.
   *
   * Nombre y celular solo se piden al ABRIR: son lo que el gimnasio necesita para
   * saber con quien habla. A quien ya tiene hilo no se le vuelven a preguntar —la
   * fila los tiene—, y exigirselos en cada mensaje convertia la segunda pregunta
   * en un formulario.
   */
  async personSend(
    account: VisitorAccount,
    slug: string,
    input: PersonMessageInput,
  ): Promise<{
    readonly conversation: Conversation;
    readonly message: Message;
  }> {
    const gym = await this.findGym(slug);
    const who = await this.who(account);
    const gymOpen = await this.isOpen(gym);

    const known = await withContext(this.db, contextOf(who), (tx) => this.findOwn(tx, who, gym.id));
    const person =
      known === null
        ? await this.visitors.resolve(account, {
            fullName: input.fullName,
            phone: input.phone,
          })
        : null;

    const result = await retryOnRace(() =>
      withTenant(this.db, gym.id, async (tx) => {
        // Se vuelve a buscar DENTRO: en el reintento, el hilo que no estaba ya lo
        // creo la otra peticion. Con contexto de gimnasio RLS abre todo el local,
        // asi que el filtro por la persona es lo que protege aqui.
        const existing = await this.findOwn(tx, who, gym.id);
        const alreadyMember = await this.isMember(tx, who, gym.id);
        const recent = existing === null ? [] : await this.recentSenders(tx, existing.id);

        const denial = checkMessageDraft({
          sender: 'person',
          body: input.body,
          gymOpen,
          alreadyMember,
          unanswered: unansweredStreak(recent),
        });
        if (denial !== null) deny(denial);

        let conversationId: string;
        if (existing !== null) {
          conversationId = existing.id;
        } else {
          if (person === null) throw new NotFoundException('No encontramos esa conversación.');
          conversationId = await this.open(tx, gym.id, person, input.topic ?? 'general');
        }

        const [message] = await tx
          .insert(schema.messages)
          .values({
            tenantId: gym.id,
            conversationId,
            sender: 'person',
            body: input.body.trim(),
          })
          .returning();

        const [conversation] = await tx
          .update(schema.conversations)
          .set({
            // `now()` y no `message.createdAt`: dentro de la misma transaccion es
            // EXACTAMENTE la hora del mensaje, microsegundos incluidos. La fecha
            // de JavaScript se queda en milisegundos, y una marca un pelo anterior
            // al mensaje lo deja contando como no leido para siempre.
            lastMessageAt: sql`now()`,
            // Escribir en el hilo es haberlo tenido abierto delante.
            personReadAt: sql`now()`,
            // Escribir reabre: `closed` archiva, no prohibe.
            status: 'open',
            // Si ya se le conoce identidad, se escribe: es lo que hace que el hilo
            // de antes de inscribirse sea el mismo que el de despues.
            ...(who.userId === null ? {} : { userId: who.userId }),
          })
          .where(eq(schema.conversations.id, conversationId))
          .returning();

        return {
          conversation: toConversation(conversation!),
          message: toMessage(message!),
        };
      }),
    );

    // Sin esperar: un chat no puede tardar lo que tarde Resend en contestar.
    void this.notify(gym.id, gym.name, result.conversation.id, 'gym');
    return result;
  }

  // -------------------------------------------------------------------------
  // El gimnasio
  // -------------------------------------------------------------------------

  /** La bandeja: lo abierto por defecto, lo archivado aparte. */
  async inbox(tenantId: string, status: ConversationStatus): Promise<readonly InboxEntry[]> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(schema.conversations)
        .where(and(eq(schema.conversations.status, status), hasMessages(tx)))
        .orderBy(desc(schema.conversations.lastMessageAt))
        .limit(LIST_LIMIT);

      // Seguidas y no con `Promise.all`: la transaccion es UNA conexion, y `pg`
      // no admite dos consultas a la vez sobre ella.
      const stats = await this.summaries(tx, rows, 'gym');
      const members = await this.membershipsOf(tx, rows);

      return rows.flatMap((row) => {
        const summary = stats.get(row.id);
        if (summary === undefined) return [];
        return [
          {
            ...toConversation(row),
            ...summary,
            membershipId: row.userId === null ? null : (members.get(row.userId) ?? null),
          },
        ];
      });
    });
  }

  /** Cuantos hilos esperan respuesta. La insignia de la pestana del mostrador. */
  async inboxUnread(tenantId: string): Promise<number> {
    const [row] = await withTenant(this.db, tenantId, (tx) =>
      tx
        .select({ unread: countDistinct(schema.conversations.id) })
        .from(schema.conversations)
        .innerJoin(schema.messages, eq(schema.messages.conversationId, schema.conversations.id))
        .where(
          and(
            eq(schema.messages.sender, 'person'),
            or(
              isNull(schema.conversations.gymReadAt),
              gt(schema.messages.createdAt, schema.conversations.gymReadAt),
            ),
          ),
        ),
    );
    return row?.unread ?? 0;
  }

  async gymThread(tenantId: string, conversationId: string): Promise<GymThread> {
    return withTenant(this.db, tenantId, async (tx) => {
      const row = await this.findInTenant(tx, conversationId);
      const messages = await this.messagesOf(tx, row.id);
      const members = await this.membershipsOf(tx, [row]);

      if (countUnread(messages, 'gym', row.gymReadAt) > 0) {
        await this.markRead(tx, row.id, 'gym', messages);
      }

      return {
        conversation: toConversation(row),
        membershipId: row.userId === null ? null : (members.get(row.userId) ?? null),
        messages,
      };
    });
  }

  /**
   * El mostrador contesta.
   *
   * Firmado con el nombre de quien escribe, copiado: en un dojo con dos
   * profesores la persona tiene que saber quien le dijo que el martes si hay
   * clase, y el hilo de hace seis meses tambien.
   */
  async reply(
    staff: { readonly tenantId: string; readonly staffId: string },
    conversationId: string,
    body: string,
  ): Promise<{ readonly message: Message }> {
    const result = await withTenant(this.db, staff.tenantId, async (tx) => {
      const row = await this.findInTenant(tx, conversationId);

      // El gimnasio contesta siempre: la racha y el directorio son frenos para
      // quien escribe desde fuera, y la regla los ignora para este lado. Solo el
      // texto se comprueba.
      const denial = checkMessageDraft({
        sender: 'gym',
        body,
        gymOpen: true,
        alreadyMember: true,
        unanswered: 0,
      });
      if (denial !== null) deny(denial);

      const [author] = await tx
        .select({ displayName: schema.staff.displayName })
        .from(schema.staff)
        .where(eq(schema.staff.id, staff.staffId))
        .limit(1);

      const [message] = await tx
        .insert(schema.messages)
        .values({
          tenantId: staff.tenantId,
          conversationId: row.id,
          sender: 'gym',
          staffId: staff.staffId,
          staffName: author?.displayName ?? null,
          body: body.trim(),
        })
        .returning();

      await tx
        .update(schema.conversations)
        .set({
          // `now()` por lo mismo que en `personSend`: es la hora exacta del mensaje.
          lastMessageAt: sql`now()`,
          gymReadAt: sql`now()`,
          status: 'open',
        })
        .where(eq(schema.conversations.id, row.id));

      const [gym] = await tx
        .select({ name: schema.tenants.name })
        .from(schema.tenants)
        .where(eq(schema.tenants.id, staff.tenantId))
        .limit(1);

      return { message: toMessage(message!), gymName: gym?.name ?? '' };
    });

    void this.notify(staff.tenantId, result.gymName, conversationId, 'person');
    return { message: result.message };
  }

  /**
   * Archiva o recupera un hilo.
   *
   * No borra ni prohibe nada: saca de la bandeja lo ya resuelto, y el siguiente
   * mensaje de cualquiera de los dos lados lo devuelve arriba.
   */
  async setStatus(
    tenantId: string,
    conversationId: string,
    status: ConversationStatus,
  ): Promise<Conversation> {
    return withTenant(this.db, tenantId, async (tx) => {
      const [row] = await tx
        .update(schema.conversations)
        .set({ status })
        .where(eq(schema.conversations.id, conversationId))
        .returning();
      if (row === undefined) throw new NotFoundException('No encontramos esa conversación.');
      return toConversation(row);
    });
  }

  /**
   * Abre —o encuentra— el hilo con quien reservo una clase.
   *
   * Es lo que reemplaza al celular que abria WhatsApp en la tarjeta de la
   * reserva: el mostrador quiere confirmar, mover la hora o decir como llegar, y
   * eso ahora se escribe aqui.
   *
   * El tema sale del tipo de reserva y se congela con el hilo: quien reservo su
   * inscripcion habla de su mensualidad; la clase suelta, de esa clase.
   */
  async openForBooking(
    tenantId: string,
    bookingId: string,
  ): Promise<{ readonly conversationId: string }> {
    return retryOnRace(() =>
      withTenant(this.db, tenantId, async (tx) => {
        const [booking] = await tx
          .select()
          .from(schema.classBookings)
          .where(eq(schema.classBookings.id, bookingId))
          .limit(1);
        if (booking === undefined) throw new NotFoundException('No encontramos esa reserva.');

        const person: Person = {
          userId: booking.userId,
          firebaseUid: booking.firebaseUid ?? (await this.firebaseUidOf(tx, booking.userId)),
          fullName: booking.fullName,
          phone: booking.phone,
          email: booking.email,
        };
        return {
          conversationId: await this.open(
            tx,
            tenantId,
            person,
            booking.kind === 'enrollment' ? 'membership' : booking.kind,
          ),
        };
      }),
    );
  }

  /** Lo mismo desde la ficha de un alumno: su gimnasio le escribe a el. */
  async openForMember(
    tenantId: string,
    membershipId: string,
  ): Promise<{ readonly conversationId: string }> {
    return retryOnRace(() =>
      withTenant(this.db, tenantId, async (tx) => {
        const [member] = await tx
          .select({
            userId: schema.users.id,
            firebaseUid: schema.users.firebaseUid,
            name: schema.users.name,
            phone: schema.users.phone,
            email: schema.users.email,
          })
          .from(schema.memberships)
          .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
          .where(eq(schema.memberships.id, membershipId))
          .limit(1);
        if (member === undefined) throw new NotFoundException('No encontramos esa membresía.');

        const person: Person = {
          userId: member.userId,
          firebaseUid: member.firebaseUid,
          fullName: member.name,
          phone: normalizePhone(member.phone),
          // A minusculas porque la tabla lo exige y `users.email` no lo garantiza.
          email: member.email === null ? null : member.email.toLowerCase(),
        };
        return {
          conversationId: await this.open(tx, tenantId, person, 'membership'),
        };
      }),
    );
  }

  // -------------------------------------------------------------------------

  /**
   * Quien es la persona, con sus dos llaves.
   *
   * Con sesion se busca su cuenta de Google; con cuenta de Google se busca su
   * ficha. Las dos mitades hacen falta para encontrar el hilo que abrio antes de
   * que existiera la otra.
   */
  private async who(account: VisitorAccount): Promise<Who> {
    return withoutTenantIsolation(this.db, async (tx) => {
      const [row] = await tx
        .select({ id: schema.users.id, firebaseUid: schema.users.firebaseUid })
        .from(schema.users)
        .where(
          account.kind === 'user'
            ? eq(schema.users.id, account.userId)
            : eq(schema.users.firebaseUid, account.uid),
        )
        .limit(1);

      if (account.kind === 'user') {
        // El token de sesion apunta a una identidad que ya no existe.
        if (row === undefined) throw new NotFoundException('No encontramos tu cuenta.');
        return { userId: row.id, firebaseUid: row.firebaseUid };
      }
      return { userId: row?.id ?? null, firebaseUid: account.uid };
    });
  }

  /** `users` es global: se lee sin contexto aunque la transaccion tenga uno. */
  private async firebaseUidOf(tx: Tx, userId: string | null): Promise<string | null> {
    if (userId === null) return null;
    const [row] = await tx
      .select({ firebaseUid: schema.users.firebaseUid })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    return row?.firebaseUid ?? null;
  }

  /** El gimnasio por su slug. `tenants` es global: no lleva RLS. */
  private async findGym(slug: string) {
    const gym = await withoutTenantIsolation(this.db, async (tx) => {
      const [row] = await tx
        .select({
          id: schema.tenants.id,
          slug: schema.tenants.slug,
          name: schema.tenants.name,
          status: schema.tenants.status,
        })
        .from(schema.tenants)
        .where(eq(schema.tenants.slug, slug))
        .limit(1);
      return row ?? null;
    });
    if (gym === null) throw new NotFoundException('Ese gimnasio no existe.');
    return gym;
  }

  /**
   * Activo y en el directorio: la misma condicion con la que acepta una reserva
   * de clase de prueba. Un gimnasio que no recibe alumnos nuevos no abre canal
   * con desconocidos — y `checkMessageDraft` se lo perdona a quien ya entrena ahi.
   */
  private async isOpen(gym: { readonly id: string; readonly status: string }): Promise<boolean> {
    if (gym.status !== 'active') return false;
    return (await this.saas.stateFor(gym.id)).listed;
  }

  /**
   * Tiene ficha en ese gimnasio, aunque se haya dado de baja.
   *
   * Por la fila de `memberships` y no por la suscripcion viva: quien entreno aqui
   * y quiere preguntar por volver es exactamente quien no hay que dejar sin
   * canal porque el local salio del directorio.
   */
  private async isMember(tx: Tx, who: Who, tenantId: string): Promise<boolean> {
    if (who.userId === null) return false;
    const rows = await tx
      .select({ id: schema.memberships.id })
      .from(schema.memberships)
      .where(
        and(eq(schema.memberships.userId, who.userId), eq(schema.memberships.tenantId, tenantId)),
      )
      .limit(1);
    return rows.length > 0;
  }

  /**
   * El hilo de esta persona en este gimnasio.
   *
   * Si por un camino raro hubiera dos —uno de antes de tener ficha y otro de
   * despues— manda el que ya tiene identidad.
   */
  private async findOwn(tx: Tx, who: Who, tenantId: string): Promise<ConversationRow | null> {
    const [row] = await tx
      .select()
      .from(schema.conversations)
      .where(and(eq(schema.conversations.tenantId, tenantId), belongsTo(who)))
      .orderBy(sql`${schema.conversations.userId} is null`)
      .limit(1);
    return row ?? null;
  }

  /** Un hilo del local. Otro gimnasio recibe el mismo 404 que uno que no existe. */
  private async findInTenant(tx: Tx, conversationId: string): Promise<ConversationRow> {
    const [row] = await tx
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.id, conversationId))
      .limit(1);
    if (row === undefined) throw new NotFoundException('No encontramos esa conversación.');
    return row;
  }

  /**
   * Encuentra el hilo de esta persona o lo abre. Devuelve su id.
   *
   * Uno por persona y gimnasio: si ya existe, no se abre otro aunque venga por
   * otro camino, y el `topic` no se toca porque cuenta por donde EMPEZO.
   */
  private async open(
    tx: Tx,
    tenantId: string,
    person: Person,
    topic: ConversationTopic,
  ): Promise<string> {
    const existing = await this.findOwn(tx, person, tenantId);
    if (existing !== null) {
      if (existing.userId === null && person.userId !== null) {
        await tx
          .update(schema.conversations)
          .set({ userId: person.userId })
          .where(eq(schema.conversations.id, existing.id));
      }
      return existing.id;
    }

    const [row] = await tx
      .insert(schema.conversations)
      .values({
        tenantId,
        userId: person.userId,
        firebaseUid: person.firebaseUid,
        fullName: person.fullName,
        phone: person.phone,
        email: person.email,
        topic,
      })
      .returning({ id: schema.conversations.id });
    return row!.id;
  }

  /** Los ultimos `THREAD_LIMIT`, en orden de lectura. */
  private async messagesOf(tx: Tx, conversationId: string): Promise<readonly Message[]> {
    const rows = await tx
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, conversationId))
      .orderBy(desc(schema.messages.createdAt), desc(schema.messages.id))
      .limit(THREAD_LIMIT);
    return rows.reverse().map(toMessage);
  }

  /** Lo justo para contar la racha: los ultimos `MAX_UNANSWERED`, en orden. */
  private async recentSenders(
    tx: Tx,
    conversationId: string,
  ): Promise<readonly { readonly sender: MessageSender }[]> {
    const rows = await tx
      .select({ sender: schema.messages.sender })
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, conversationId))
      .orderBy(desc(schema.messages.createdAt), desc(schema.messages.id))
      .limit(MAX_UNANSWERED);
    return rows.reverse();
  }

  /**
   * Mueve la marca de lectura hasta el ultimo mensaje VISTO.
   *
   * La hora de ese mensaje y no `now()`: un mensaje que otra peticion confirma
   * mientras esta lee no esta en `messages`, y con `now()` quedaria marcado como
   * leido sin haberse visto nunca.
   */
  private async markRead(
    tx: Tx,
    conversationId: string,
    side: MessageSender,
    messages: readonly Message[],
  ): Promise<void> {
    const last = messages.at(-1);
    if (last === undefined) return;
    // Leida de la base y no de `last.sentAt`: Postgres guarda microsegundos y
    // JavaScript los pierde, asi que la marca quedaba justo ANTES del ultimo
    // mensaje y ese mensaje seguia contando como no leido. Lo encontro el e2e.
    const seenAt = sql`(
      select ${schema.messages.createdAt} from ${schema.messages}
      where ${schema.messages.id} = ${last.id}
    )`;
    await tx
      .update(schema.conversations)
      .set(side === 'person' ? { personReadAt: seenAt } : { gymReadAt: seenAt })
      .where(eq(schema.conversations.id, conversationId));
  }

  /**
   * Ultimo mensaje y cuantos sin leer, para una lista entera en dos consultas.
   *
   * Lo no leido se cuenta en SQL con la MISMA definicion que `countUnread` —lo
   * del otro lado posterior a la marca— porque traer todos los mensajes de cien
   * hilos para contarlos en memoria es pagar por lo que nadie va a ver.
   */
  private async summaries(
    tx: Tx,
    rows: readonly ConversationRow[],
    side: MessageSender,
  ): Promise<Map<string, { readonly lastMessage: Message; readonly unread: number }>> {
    if (rows.length === 0) return new Map();
    const ids = rows.map((row) => row.id);
    const readAt =
      side === 'person' ? schema.conversations.personReadAt : schema.conversations.gymReadAt;

    // Seguidas, no en paralelo: es la misma conexion (ver `inbox`).
    const last = await tx
      .selectDistinctOn([schema.messages.conversationId])
      .from(schema.messages)
      .where(inArray(schema.messages.conversationId, ids))
      .orderBy(
        schema.messages.conversationId,
        desc(schema.messages.createdAt),
        desc(schema.messages.id),
      );
    const unread = await tx
      .select({
        conversationId: schema.messages.conversationId,
        unread: count(),
      })
      .from(schema.messages)
      .innerJoin(schema.conversations, eq(schema.conversations.id, schema.messages.conversationId))
      .where(
        and(
          inArray(schema.messages.conversationId, ids),
          ne(schema.messages.sender, side),
          or(isNull(readAt), gt(schema.messages.createdAt, readAt)),
        ),
      )
      .groupBy(schema.messages.conversationId);

    const unreadBy = new Map(unread.map((row) => [row.conversationId, row.unread]));
    return new Map(
      last.map((row) => [
        row.conversationId,
        {
          lastMessage: toMessage(row),
          unread: unreadBy.get(row.conversationId) ?? 0,
        },
      ]),
    );
  }

  /** userId → membershipId en este gimnasio. Con contexto de tenant, solo ve el suyo. */
  private async membershipsOf(
    tx: Tx,
    rows: readonly ConversationRow[],
  ): Promise<Map<string, string>> {
    const userIds = [...new Set(rows.flatMap((row) => (row.userId === null ? [] : [row.userId])))];
    if (userIds.length === 0) return new Map();

    const members = await tx
      .select({ id: schema.memberships.id, userId: schema.memberships.userId })
      .from(schema.memberships)
      .where(inArray(schema.memberships.userId, userIds));
    return new Map(members.map((row) => [row.userId, row.id]));
  }

  /**
   * Avisa por correo al lado que tiene que leer, sin poder romper el envio.
   *
   * Uno por tanda (`batchNeedsNotice`). El fallo se traga a proposito, como en la
   * clase de prueba: el mensaje ya esta en el hilo y sale en la app aunque el
   * correo no salga nunca. La marca de aviso deja ver cual si salio.
   */
  private async notify(
    tenantId: string,
    gymName: string,
    conversationId: string,
    audience: MessageSender,
  ): Promise<void> {
    if (!this.mail.disponible) return;

    try {
      const target = await withTenant(this.db, tenantId, async (tx) => {
        const row = await this.findInTenant(tx, conversationId);
        const from: MessageSender = audience === 'gym' ? 'person' : 'gym';
        const readAt = audience === 'gym' ? row.gymReadAt : row.personReadAt;

        const [pending] = await tx
          .select({ first: min(schema.messages.createdAt) })
          .from(schema.messages)
          .where(
            and(
              eq(schema.messages.conversationId, row.id),
              eq(schema.messages.sender, from),
              readAt === null ? undefined : gt(schema.messages.createdAt, readAt),
            ),
          );

        const notifiedAt = audience === 'gym' ? row.gymNotifiedAt : row.personNotifiedAt;
        if (!batchNeedsNotice(pending?.first ?? null, notifiedAt)) return null;

        const [last] = await tx
          .select()
          .from(schema.messages)
          .where(eq(schema.messages.conversationId, row.id))
          .orderBy(desc(schema.messages.createdAt))
          .limit(1);

        let recipient: string | null = row.email;
        if (audience === 'gym') {
          // Al dueno; si el local no tiene dueno registrado, a recepcion. Mismo
          // criterio que el aviso de la clase de prueba.
          const staff = await tx
            .select({ email: schema.users.email })
            .from(schema.staff)
            .innerJoin(schema.users, eq(schema.users.id, schema.staff.userId))
            .orderBy(schema.staff.role);
          recipient = staff.find((member) => member.email !== null)?.email ?? null;
        }

        return recipient === null || last === undefined ? null : { row, last, recipient };
      });

      if (target === null) return;

      const sent = await this.mail.notifyMessage({
        recipient: target.recipient,
        audience,
        gym: gymName,
        personName: target.row.fullName,
        topic: conversationTopicLabel(target.row.topic),
        staffName: target.last.staffName,
        body: target.last.body,
      });

      if (sent.enviado) {
        await withTenant(this.db, tenantId, (tx) =>
          tx
            .update(schema.conversations)
            .set(
              audience === 'gym' ? { gymNotifiedAt: sql`now()` } : { personNotifiedAt: sql`now()` },
            )
            .where(eq(schema.conversations.id, conversationId)),
        );
      }
    } catch (error) {
      this.logger.warn(
        `No se pudo avisar del mensaje: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
}
