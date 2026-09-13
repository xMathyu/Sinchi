/**
 * Lo no leido y como se nombra un hilo.
 *
 * Lo no leido se DERIVA, igual que el cupo semanal se deriva contando
 * asistencias (MD 5): no hay contador mutable en ninguna tabla. Un contador se
 * desincroniza el dia que un mensaje se borra o que dos peticiones lo suben a la
 * vez, y entonces el gimnasio ve un «3» eterno sobre una bandeja vacia y deja de
 * mirar la insignia — que es perder la funcion entera.
 *
 * Lo que si se guarda es la MARCA de hasta donde leyo cada lado
 * (`person_read_at`, `gym_read_at`), que es un hecho, no una cuenta.
 */
import type { ConversationTopic, MessageSender } from '../domain/types.js';

/**
 * Cuantos mensajes del otro lado hay sin leer.
 *
 * `readAt` en `null` significa que ese lado no abrio el hilo nunca: entonces
 * todo lo del otro esta sin leer. Los propios no cuentan jamas — verse un «1»
 * por lo que uno mismo acaba de escribir es el bug clasico de las bandejas.
 */
export function countUnread(
  messages: readonly { readonly sender: MessageSender; readonly sentAt: Date }[],
  side: MessageSender,
  readAt: Date | null,
): number {
  return messages.filter(
    (message) =>
      message.sender !== side && (readAt === null || message.sentAt.getTime() > readAt.getTime()),
  ).length;
}

/**
 * Como se nombra en una linea por donde empezo la conversacion.
 *
 * Lo pintan tres sitios —la bandeja del mostrador, la lista de la persona y el
 * correo de aviso— y en los tres tiene que decir lo mismo.
 */
export function conversationTopicLabel(topic: ConversationTopic): string {
  switch (topic) {
    case 'general':
      return 'Consulta';
    case 'trial':
      return 'Clase de prueba';
    case 'drop_in':
      return 'Clase suelta';
    case 'membership':
      return 'Su mensualidad';
    case 'event':
      return 'Un evento';
  }
}

/**
 * La primera linea que la app propone segun de donde vino el toque.
 *
 * No se envia sola: se deja escrita en el campo y la persona la borra o la
 * completa. Existe porque el campo vacio delante de un desconocido es la razon
 * numero uno por la que nadie escribe — y quien no escribe no se inscribe.
 */
export function conversationOpener(topic: ConversationTopic): string {
  switch (topic) {
    case 'general':
      return 'Hola, quería preguntarles ';
    case 'trial':
      return 'Hola, tengo una clase de prueba reservada y quería preguntarles ';
    case 'drop_in':
      return 'Hola, quería ir a una clase suelta. ';
    case 'membership':
      return 'Hola, tengo una duda con mi mensualidad: ';
    case 'event':
      return 'Hola, quería preguntarles por el evento: ';
  }
}
