/**
 * Quien puede escribirle al gimnasio, y por que no.
 *
 * Misma forma que `checkPlanDraft` y `validateTrialBooking`: devuelve el MOTIVO
 * o `null`, nunca un booleano. La pantalla apaga el boton de enviar por el mismo
 * motivo exacto por el que la api responderia 400, y la persona lee una sola
 * frase que le dice que hacer.
 *
 * La corren los dos lados, como el resto de las reglas de este paquete: la app
 * para no dejar escribir lo que va a rebotar, la api para no confiar en que la
 * app lo hizo.
 *
 * La regla que mas se piensa aqui no es ninguna de las obvias sino
 * `awaiting_reply`, y lo que frena es lo que hundio esta funcion la primera vez
 * que se penso: una bandeja donde cualquiera con una cuenta de Google puede
 * dejar veinte mensajes a un dojo que no ha abierto la app en tres dias. Al
 * quinto sin respuesta se corta — con el celular de la persona ya en manos del
 * gimnasio, asi que el canal no se pierde, solo deja de poder usarse como
 * megafono.
 */
import type { MessageSender } from '../domain/types.js';

/**
 * Tope de un mensaje.
 *
 * Mil caracteres son cuatro parrafos: de sobra para «¿tienen clases de noche y
 * cuanto cuesta el mes?», que es el mensaje real. No es una regla de negocio
 * sino un tope de almacenamiento y de pantalla — lo que no cabe en el hilo del
 * mostrador no lo lee nadie.
 */
export const MESSAGE_MAX_LENGTH = 1000;

/**
 * Cuantos mensajes seguidos sin respuesta se toleran.
 *
 * Cinco y no uno porque asi es como escribe la gente: el saludo, la pregunta y
 * el «ah, y una cosa mas» son tres mensajes y una sola consulta. Cinco y no
 * cincuenta porque el gimnasio que abre la app el lunes tiene que encontrar
 * personas, no muros de texto de una.
 */
export const MAX_UNANSWERED = 5;

export type MessageDenial = 'gym_unavailable' | 'empty' | 'too_long' | 'awaiting_reply';

export interface MessageDraft {
  readonly sender: MessageSender;
  readonly body: string;
  /**
   * El gimnasio esta activo y dentro del directorio.
   *
   * Solo frena a la PERSONA, y solo si no entrena ahi: quien ya es alumno
   * conserva su canal aunque el local salga de la lista publica, por lo mismo
   * que la puerta nunca se cierra por lo que el gimnasio le deba a Sinchi
   * (`saas.guard.ts`). Cortarle el canal a quien si pago castiga a quien no debe
   * nada.
   */
  readonly gymOpen: boolean;
  /** Ya entrena aqui. */
  readonly alreadyMember: boolean;
  /** Cuantos lleva escritos seguidos sin que el gimnasio conteste. */
  readonly unanswered: number;
}

/**
 * `null` si el mensaje se puede enviar; el motivo si no.
 *
 * El orden es el mismo criterio que en la puerta y en la clase de prueba:
 * primero lo que NO depende de lo que se escribio —si hay con quien hablar, si
 * toca esperar— y solo al final el texto. Al reves, a quien lleva cinco mensajes
 * sin respuesta se le diria «escribe algo», que no es su problema.
 */
export function checkMessageDraft(draft: MessageDraft): MessageDenial | null {
  if (draft.sender === 'person') {
    if (!draft.gymOpen && !draft.alreadyMember) return 'gym_unavailable';
    if (draft.unanswered >= MAX_UNANSWERED) return 'awaiting_reply';
  }

  const body = draft.body.trim();
  if (body.length === 0) return 'empty';
  if (body.length > MESSAGE_MAX_LENGTH) return 'too_long';

  return null;
}

/**
 * El rechazo, dicho a quien lo lee.
 *
 * Vive con la regla y no en la pantalla por lo mismo que `accessMessage` y
 * `trialMessage`: el mismo hecho se cuenta en la app del alumno y en la del
 * mostrador, y contarlo distinto en cada una es como se llega a dos versiones de
 * la misma verdad.
 */
export function messageDenialText(reason: MessageDenial): string {
  switch (reason) {
    case 'gym_unavailable':
      return 'Este gimnasio no está recibiendo mensajes ahora mismo.';
    case 'empty':
      return 'Escribe tu mensaje antes de enviarlo.';
    case 'too_long':
      return `El mensaje no puede pasar de ${MESSAGE_MAX_LENGTH} caracteres. Cuéntaselo en corto y el resto se lo dices allí.`;
    case 'awaiting_reply':
      return 'Ya les escribiste y todavía no te contestan. Espera su respuesta: tienen tu mensaje y tu celular.';
  }
}

/**
 * Cuantos mensajes seguidos lleva la persona sin respuesta del gimnasio.
 *
 * Se cuenta hacia atras desde el final y se para en el primer mensaje del
 * gimnasio: lo que importa no es el total del hilo —una conversacion viva de
 * cuarenta mensajes esta sana— sino la RACHA de ahora. Contestar una vez la
 * pone a cero, que es justo lo que debe pasar.
 *
 * Espera `messages` en orden cronologico, del mas viejo al mas nuevo, que es
 * como se lee un hilo y como lo devuelve la api.
 */
export function unansweredStreak(messages: readonly { readonly sender: MessageSender }[]): number {
  let streak = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]!.sender === 'gym') break;
    streak += 1;
  }
  return streak;
}
