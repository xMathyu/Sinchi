/**
 * Hablar con el gimnasio, de punta a punta.
 *
 * Que un mensaje llegue lo prueba cualquier formulario. Lo que importa aqui son
 * los limites: que el gimnasio de al lado no lea la bandeja ajena, que otra
 * cuenta no abra el hilo de alguien, que la racha sin respuesta se corte y que
 * contestar la reabra — y que el hilo de quien escribio antes de tener ficha
 * siga siendo suyo.
 *
 * Necesita `TEST_DATABASE_URL` con un rol SIN BYPASSRLS: con BYPASSRLS la
 * prueba de aislamiento pasaria sin probar nada.
 */
import { randomBytes, randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UnauthorizedException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { MAX_UNANSWERED } from '@sinchi/shared';
import { FirebaseVerifier, type VerifiedIdentity } from './auth/firebase';
import { MailService } from './modules/mail/mail.service';

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const suite = DATABASE_URL === undefined ? describe.skip : describe;

let app: INestApplication;
let http: ReturnType<typeof request>;

/** Firebase, sustituido: cada token declarado aqui es una persona distinta. */
const identities = new Map<string, VerifiedIdentity>();

const fakeVerifier = {
  verify: async (idToken: string): Promise<VerifiedIdentity> => {
    const identity = identities.get(idToken);
    if (identity === undefined) throw new UnauthorizedException('Sesion invalida.');
    return identity;
  },
};

/**
 * El correo, sustituido.
 *
 * Sin esto la prueba avisaba DE VERDAD: la siembra importa `dotenv/config`, que
 * carga la clave de Resend del `.env` local, y cada respuesta del mostrador
 * intentaba mandar un correo a un `@example.com`. En CI no pasaba solo porque
 * alli no hay `.env`. De paso deja comprobar la regla del aviso que importa: uno
 * por tanda, no uno por mensaje.
 */
interface Notice {
  readonly audience: 'gym' | 'person';
  readonly recipient: string;
  readonly body: string;
}
const notices: Notice[] = [];
const fakeMail = {
  disponible: true,
  notifyMessage: async (input: Notice) => {
    notices.push({ audience: input.audience, recipient: input.recipient, body: input.body });
    return { enviado: true, denial: null };
  },
  notifyBooking: async () => ({ enviado: true, denial: null }),
  sendInvite: async () => ({ enviado: true, denial: null }),
};

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** El aviso sale sin esperar a la respuesta HTTP: se espera a que llegue, con tope. */
async function eventually(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('El aviso no llego a tiempo.');
    await pause(25);
  }
}

function declareIdentity(uid: string): string {
  const token = `${uid}.${'x'.repeat(120)}`;
  identities.set(token, {
    uid,
    email: `${uid}@example.com`,
    emailVerified: true,
    displayName: uid,
    provider: 'google.com',
  });
  return token;
}

const auth = (bearer: string) => ({ Authorization: `Bearer ${bearer}` });

/** Celulares distintos por corrida: la reserva de prueba los exige unicos por gimnasio. */
const runId = randomInt(10_000_000, 89_000_000);
let personCounter = 0;
const nextPhone = (): string => `+51${String(runId + ++personCounter).padStart(9, '9')}`;

/** Escribe como alguien que todavia no tiene ficha en ningun padron. */
const escribir = (
  slug: string,
  input: { token: string; body: string; fullName?: string; phone?: string; topic?: string },
) =>
  http.post(`/v1/gyms/${slug}/messages`).send({
    idToken: input.token,
    body: input.body,
    ...(input.topic === undefined ? {} : { topic: input.topic }),
    ...(input.fullName === undefined ? {} : { fullName: input.fullName }),
    ...(input.phone === undefined ? {} : { phone: input.phone }),
  });

let novaFrontDesk = '';
let shotokanFrontDesk = '';
let mathyu = '';

interface InboxEntry {
  id: string;
  fullName: string;
  topic: string;
  status: string;
  unread: number;
  membershipId: string | null;
  lastMessage: { body: string; sender: string };
}

const inbox = async (token: string, status = 'open'): Promise<InboxEntry[]> => {
  const { body } = await http
    .get(`/v1/staff/conversations?status=${status}`)
    .set(auth(token))
    .expect(200);
  return body as InboxEntry[];
};

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;

  process.env.DATABASE_URL = DATABASE_URL;
  process.env.JWT_SECRET ??= randomBytes(48).toString('base64url');
  process.env.ENCRYPTION_KEY ??= randomBytes(32).toString('base64');
  process.env.ALLOW_DEV_LOGIN = 'true';
  process.env.NODE_ENV = 'test';

  const { runSeed } = await import('./db/seed');
  await runSeed({ reset: true, quiet: true });

  const { AppModule } = await import('./app.module');
  const { configureApp } = await import('./bootstrap');
  const { loadEnv } = await import('./config/env');

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(FirebaseVerifier)
    .useValue(fakeVerifier)
    .overrideProvider(MailService)
    .useValue(fakeMail)
    .compile();

  app = moduleRef.createNestApplication();
  configureApp(app, loadEnv());
  await app.init();
  http = request(app.getHttpServer());

  const login = async (phone: string): Promise<string> => {
    const { body } = await http.post('/v1/auth/dev-login').send({ phone }).expect(201);
    return body.accessToken as string;
  };

  novaFrontDesk = await login('+51987000222'); // Carlos, Nova BJJ
  shotokanFrontDesk = await login('+51987000111'); // Ana, Dojo Shotokan
  mathyu = await login('+51987654321'); // alumno en los tres gimnasios
});

afterAll(async () => {
  await app?.close();
});

suite('el curioso del directorio', () => {
  const token = () => declareIdentity(`curioso-${runId}`);
  let conversationId = '';

  it('escribe sin haberse inscrito ni reservado nada', async () => {
    const { status, body } = await escribir('nova-bjj', {
      token: token(),
      body: '  ¿Tienen clases de noche?  ',
      fullName: 'Rosa Curiosa',
      phone: nextPhone(),
    });

    expect(status).toBe(201);
    expect(body.conversation.topic).toBe('general');
    expect(body.conversation.fullName).toBe('Rosa Curiosa');
    // Se guarda recortado: los espacios de los bordes no son parte del mensaje.
    expect(body.message.body).toBe('¿Tienen clases de noche?');
    expect(body.message.sender).toBe('person');
    conversationId = body.conversation.id as string;
  });

  it('para abrir el hilo hace falta un celular con el que el gimnasio pueda reconocerlo', async () => {
    const { status } = await escribir('nova-bjj', {
      token: declareIdentity(`sin-celular-${runId}`),
      body: 'Hola',
    });
    expect(status).toBe(400);
  });

  it('el segundo mensaje no vuelve a pedir nombre ni celular', async () => {
    const { status } = await escribir('nova-bjj', { token: token(), body: '¿Y los sábados?' });
    expect(status).toBe(201);
  });

  it('vuelve a ver su hilo, con lo necesario para saber si puede escribir', async () => {
    const { body } = await http
      .post('/v1/gyms/nova-bjj/conversation')
      .send({ idToken: token() })
      .expect(201);

    expect(body.conversation.id).toBe(conversationId);
    expect(body.messages).toHaveLength(2);
    expect(body.gymOpen).toBe(true);
    expect(body.alreadyMember).toBe(false);
  });

  it('otra cuenta no abre el hilo ajeno', async () => {
    const { body } = await http
      .post('/v1/gyms/nova-bjj/conversation')
      .send({ idToken: declareIdentity(`vecino-${runId}`) })
      .expect(201);

    expect(body.conversation).toBeNull();
    expect(body.messages).toEqual([]);
  });

  it('su lista dice con que gimnasio habla y que fue lo ultimo', async () => {
    const { body } = await http
      .post('/v1/gyms/conversations/mine')
      .send({ idToken: token() })
      .expect(201);

    const hilo = (body as { id: string; gymSlug: string; lastMessage: { body: string } }[]).find(
      (row) => row.id === conversationId,
    );
    expect(hilo?.gymSlug).toBe('nova-bjj');
    expect(hilo?.lastMessage.body).toBe('¿Y los sábados?');
  });

  it('un gimnasio que no existe es 404', async () => {
    const { status } = await escribir('no-existe', { token: token(), body: 'Hola' });
    expect(status).toBe(404);
  });

  it('un mensaje vacio no se envia, y dice por que', async () => {
    const { status, body } = await escribir('nova-bjj', { token: token(), body: '   ' });
    expect(status).toBe(400);
    expect(body.code).toBe('empty');
  });

  suite('la bandeja del mostrador', () => {
    it('nova lo ve arriba, con lo no leido y sin ficha', async () => {
      const entry = (await inbox(novaFrontDesk)).find((row) => row.id === conversationId);

      expect(entry?.fullName).toBe('Rosa Curiosa');
      expect(entry?.unread).toBe(2);
      expect(entry?.membershipId).toBeNull();
    });

    it('el gimnasio de al lado no lo ve ni sabiendo el id', async () => {
      const ajena = (await inbox(shotokanFrontDesk)).find((row) => row.id === conversationId);
      expect(ajena).toBeUndefined();

      await http
        .get(`/v1/staff/conversations/${conversationId}`)
        .set(auth(shotokanFrontDesk))
        .expect(404);
    });

    it('abrirlo lo marca leido', async () => {
      const antes = await http
        .get('/v1/staff/conversations/unread')
        .set(auth(novaFrontDesk))
        .expect(200);
      expect(antes.body.unread).toBeGreaterThan(0);

      const { body } = await http
        .get(`/v1/staff/conversations/${conversationId}`)
        .set(auth(novaFrontDesk))
        .expect(200);
      expect(body.messages).toHaveLength(2);

      const entry = (await inbox(novaFrontDesk)).find((row) => row.id === conversationId);
      expect(entry?.unread).toBe(0);
    });

    it('contesta firmado, y a la persona le aparece sin leer hasta que lo abre', async () => {
      const { body: reply } = await http
        .post(`/v1/staff/conversations/${conversationId}/messages`)
        .set(auth(novaFrontDesk))
        .send({ body: 'Sí, de lunes a viernes a las 20:00.' })
        .expect(201);
      expect(reply.message.sender).toBe('gym');
      expect(reply.message.staffName).toBeTruthy();

      const mine = async () =>
        (
          (await http.post('/v1/gyms/conversations/mine').send({ idToken: token() }).expect(201))
            .body as { id: string; unread: number }[]
        ).find((row) => row.id === conversationId);

      expect((await mine())?.unread).toBe(1);

      await http.post('/v1/gyms/nova-bjj/conversation').send({ idToken: token() }).expect(201);
      expect((await mine())?.unread).toBe(0);
    });

    it('archivar lo saca de la bandeja, y escribir lo devuelve', async () => {
      await http
        .post(`/v1/staff/conversations/${conversationId}/status`)
        .set(auth(novaFrontDesk))
        .send({ status: 'closed' })
        .expect(201);

      expect((await inbox(novaFrontDesk)).some((row) => row.id === conversationId)).toBe(false);
      expect((await inbox(novaFrontDesk, 'closed')).some((row) => row.id === conversationId)).toBe(
        true,
      );

      await escribir('nova-bjj', { token: token(), body: 'Gracias, voy el lunes.' }).expect(201);
      expect((await inbox(novaFrontDesk)).some((row) => row.id === conversationId)).toBe(true);
    });
  });
});

suite('la racha sin respuesta', () => {
  it(`al mensaje ${MAX_UNANSWERED + 1} sin respuesta se espera, y contestar la reabre`, async () => {
    const token = declareIdentity(`insistente-${runId}`);
    const phone = nextPhone();

    let conversationId = '';
    for (let i = 0; i < MAX_UNANSWERED; i += 1) {
      const { status, body } = await escribir('nova-bjj', {
        token,
        body: `Mensaje ${i + 1}`,
        fullName: 'Pepe Insistente',
        phone,
      });
      expect(status).toBe(201);
      conversationId = body.conversation.id as string;
    }

    const cortado = await escribir('nova-bjj', { token, body: '¿Hola?' });
    expect(cortado.status).toBe(400);
    expect(cortado.body.code).toBe('awaiting_reply');

    await http
      .post(`/v1/staff/conversations/${conversationId}/messages`)
      .set(auth(novaFrontDesk))
      .send({ body: 'Perdón por la demora, dime.' })
      .expect(201);

    await escribir('nova-bjj', { token, body: '¿Cuánto cuesta el mes?' }).expect(201);
  });
});

suite('el alumno de casa', () => {
  it('escribe con su sesion, y el mostrador lo reconoce por su ficha', async () => {
    const { body } = await http
      .post('/v1/me/conversations/nova-bjj/messages')
      .set(auth(mathyu))
      .send({ body: 'Me cobraron dos veces este mes.', topic: 'membership' })
      .expect(201);

    expect(body.conversation.topic).toBe('membership');

    const entry = (await inbox(novaFrontDesk)).find((row) => row.id === body.conversation.id);
    expect(entry?.membershipId).not.toBeNull();
    expect(entry?.lastMessage.body).toBe('Me cobraron dos veces este mes.');

    const thread = await http.get('/v1/me/conversations/nova-bjj').set(auth(mathyu)).expect(200);
    expect(thread.body.alreadyMember).toBe(true);

    const unread = await http.get('/v1/me/conversations/unread').set(auth(mathyu)).expect(200);
    expect(unread.body.unread).toBe(0);
  });

  /**
   * Un hilo por persona y gimnasio, no uno por pregunta: la segunda duda de otra
   * cosa cae en el mismo hilo, y el origen se queda en lo que fue.
   */
  it('la segunda pregunta de otra cosa sigue en el mismo hilo', async () => {
    const primera = await http.get('/v1/me/conversations/nova-bjj').set(auth(mathyu)).expect(200);

    const { body } = await http
      .post('/v1/me/conversations/nova-bjj/messages')
      .set(auth(mathyu))
      .send({ body: '¿Hay seminario este mes?', topic: 'event' })
      .expect(201);

    expect(body.conversation.id).toBe(primera.body.conversation.id);
    expect(body.conversation.topic).toBe('membership');
  });
});

suite('el mostrador escribe primero', () => {
  it('desde la reserva de clase de prueba, en vez de por WhatsApp', async () => {
    const token = declareIdentity(`reserva-${runId}`);
    const { body: nova } = await http.get('/v1/gyms/nova-bjj').expect(200);
    const slot = nova.slots[0];
    const date = `${slot.date.year}-${String(slot.date.month).padStart(2, '0')}-${String(slot.date.day).padStart(2, '0')}`;

    const { body: reserva } = await http
      .post('/v1/gyms/nova-bjj/trial')
      .send({
        idToken: token,
        fullName: 'Lucho Prueba',
        phone: nextPhone(),
        classScheduleId: slot.scheduleId,
        date,
      })
      .expect(201);
    expect(reserva.booked).toBe(true);

    const abierto = await http
      .post(`/v1/staff/trials/${reserva.booking.id}/conversation`)
      .set(auth(novaFrontDesk))
      .expect(201);
    const conversationId = abierto.body.conversationId as string;

    // Abrir sin escribir no deja rastro: ni en su bandeja ni en la de la persona.
    expect((await inbox(novaFrontDesk)).some((row) => row.id === conversationId)).toBe(false);

    // Tocar dos veces no abre dos hilos.
    const otraVez = await http
      .post(`/v1/staff/trials/${reserva.booking.id}/conversation`)
      .set(auth(novaFrontDesk))
      .expect(201);
    expect(otraVez.body.conversationId).toBe(conversationId);

    await http
      .post(`/v1/staff/conversations/${conversationId}/messages`)
      .set(auth(novaFrontDesk))
      .send({ body: 'Hola Lucho, te esperamos. Trae ropa cómoda.' })
      .expect(201);

    const { body: mine } = await http
      .post('/v1/gyms/conversations/mine')
      .send({ idToken: token })
      .expect(201);
    const hilo = (mine as { id: string; topic: string; unread: number }[]).find(
      (row) => row.id === conversationId,
    );
    expect(hilo?.topic).toBe('trial');
    expect(hilo?.unread).toBe(1);
  });

  it('una reserva de otro gimnasio es 404', async () => {
    const { body } = await http.get('/v1/staff/trials').set(auth(novaFrontDesk)).expect(200);
    const ajena = (body as { id: string }[])[0];
    if (ajena === undefined) return;

    await http
      .post(`/v1/staff/trials/${ajena.id}/conversation`)
      .set(auth(shotokanFrontDesk))
      .expect(404);
  });
});

suite('el aviso por correo', () => {
  /**
   * Tres respuestas seguidas a alguien que no abrio la app son UN correo, no
   * tres: con tres identicos se aprende a ignorarlos. Cuando abre el hilo la
   * tanda se cierra, y la siguiente respuesta vuelve a avisar.
   */
  it('a la persona le llega uno por tanda, no uno por mensaje', async () => {
    const uid = `aviso-${runId}`;
    const token = declareIdentity(uid);
    const recipient = `${uid}@example.com`;
    const mine = () => notices.filter((notice) => notice.recipient === recipient);

    const { body } = await escribir('nova-bjj', {
      token,
      body: '¿Hay clase el feriado?',
      fullName: 'Tere Aviso',
      phone: nextPhone(),
    }).expect(201);
    const conversationId = body.conversation.id as string;

    const reply = (text: string) =>
      http
        .post(`/v1/staff/conversations/${conversationId}/messages`)
        .set(auth(novaFrontDesk))
        .send({ body: text })
        .expect(201);

    await reply('Sí, en horario normal.');
    await eventually(() => mine().length === 1);
    // Margen para que la marca del aviso quede escrita antes de la siguiente.
    await pause(300);

    await reply('Y el sábado también.');
    await reply('Te esperamos.');
    await pause(300);
    expect(mine()).toHaveLength(1);
    expect(mine()[0]!.audience).toBe('person');
    expect(mine()[0]!.body).toBe('Sí, en horario normal.');

    await http.post('/v1/gyms/nova-bjj/conversation').send({ idToken: token }).expect(201);
    await reply('¿Te animas?');
    await eventually(() => mine().length === 2);
    expect(mine()[1]!.body).toBe('¿Te animas?');
  });
});
