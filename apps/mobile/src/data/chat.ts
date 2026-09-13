/**
 * Hablar con un gimnasio, venga con sesión o solo con su cuenta de Google.
 *
 * Mismo criterio que `trials.ts`, y por lo mismo: quien escribe puede no ser
 * alumno de nadie todavía. El estado de la sesión decide por dónde va:
 *
 *   sesión de Sinchi      ──> `/me/conversations`, que ya sabe quién es
 *   solo cuenta de Google ──> `/gyms/...` firmando con el ID token de Firebase
 *
 * Es lo que reemplaza al enlace de WhatsApp (decisiones §12): la conversación
 * con el gimnasio se queda dentro de Sinchi.
 */
import type { ConversationTopic, Message } from '@sinchi/shared';
import {
  fetchGuestConversations,
  fetchGuestThread,
  fetchMyConversations,
  fetchThread,
  sendGuestMessage,
  sendMessage,
  type PersonConversationDto,
  type PersonThreadDto,
  type SentMessageDto,
} from './api';
import { currentAccountDetails, saveAccountDetails } from './session';
import { bookingCredential, present } from './trials';

/** Sus hilos, vengan por donde vengan. Sin cuenta no hay ninguno. */
export async function myConversations(): Promise<readonly PersonConversationDto[]> {
  const credential = bookingCredential();
  if (credential.kind === 'session') return fetchMyConversations();
  if (credential.kind === 'none') return [];
  return fetchGuestConversations(credential.idToken);
}

/** El hilo con un gimnasio. `null` sin cuenta: la pantalla ofrece entrar. */
export async function threadWith(slug: string): Promise<PersonThreadDto | null> {
  const credential = bookingCredential();
  if (credential.kind === 'session') return fetchThread(slug);
  if (credential.kind === 'none') return null;
  return fetchGuestThread(slug, credential.idToken);
}

export async function writeToGym(input: {
  readonly slug: string;
  readonly body: string;
  readonly topic: ConversationTopic;
  /** Solo se usan como invitado, y solo al abrir el hilo. Con sesión se ignoran. */
  readonly fullName?: string;
  readonly phone?: string;
}): Promise<SentMessageDto> {
  const credential = bookingCredential();

  if (credential.kind === 'session') {
    return sendMessage({ slug: input.slug, body: input.body, topic: input.topic });
  }
  if (credential.kind === 'none') {
    throw new Error('Entra con tu correo o con Google para escribirle al gimnasio.');
  }

  // Lo que la pantalla haya recogido manda; si no, lo que escribió al
  // registrarse. Y se recuerda, igual que al reservar: la próxima vez —aquí o en
  // otro gimnasio— no se le vuelve a preguntar.
  const guardado = currentAccountDetails();
  const fullName = present(input.fullName) ?? present(guardado?.fullName);
  const phone = present(input.phone) ?? present(guardado?.phone);
  await saveAccountDetails({ fullName, phone });

  return sendGuestMessage({
    slug: input.slug,
    idToken: credential.idToken,
    body: input.body,
    topic: input.topic,
    ...(fullName === null ? {} : { fullName }),
    ...(phone === null ? {} : { phone }),
  });
}

/**
 * Lo que trajo el servidor más lo recién enviado que todavía no trae.
 *
 * Sin esto, el mensaje desaparece del campo y tarda lo que tarde la recarga en
 * aparecer en el hilo: medio segundo en el que parece que no se envió, y el
 * dedo lo vuelve a mandar. Se deduplica por id, así que cuando la recarga lo
 * trae no sale dos veces.
 */
export function mergeMessages(
  server: readonly Message[],
  local: readonly Message[],
): readonly Message[] {
  const known = new Set(server.map((message) => message.id));
  const extra = local.filter((message) => !known.has(message.id));
  if (extra.length === 0) return server;
  return [...server, ...extra].sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
}
