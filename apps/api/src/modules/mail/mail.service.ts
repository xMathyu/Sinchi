/**
 * Envío de correo, por Resend.
 *
 * Con `fetch` y sin SDK: es una petición HTTP con una cabecera, y la api ya
 * corre en Node 24. Una dependencia más que auditar no se paga por ahorrar
 * quince líneas.
 *
 * **Nada aquí puede tumbar lo que lo llama.** El correo es un canal de ENTREGA:
 * la invitación existe en la base y su enlace funciona aunque el correo no
 * llegue nunca. Si esto lanzara, un fallo de Resend impediría dar de alta a un
 * alumno que está esperando en el mostrador, y eso es peor que no avisarle.
 */
import { Injectable, Logger } from '@nestjs/common';
import { loadEnv } from '../../config/env';
import { inviteEmail } from './invite-email';

/**
 * El asunto del aviso de una reserva.
 *
 * Se lee entero en la notificación del móvil, que es donde de verdad se lee:
 * qué es, quién y qué día, sin adornos. Lo primero es QUÉ ES porque es lo que
 * decide qué hacer: una inscripción es un alumno que llega a pagar un mes, una
 * prueba es alguien a quien convencer.
 *
 * Decía «Clase de prueba» para las tres. El texto de dentro sí distinguía, pero
 * el dueño que leía «Clase de prueba: Ana viene el martes» en la notificación no
 * abría el correo para descubrir que Ana venía a inscribirse, y la inscripción
 * pasaba por una prueba más.
 */
export function bookingSubject(input: {
  readonly kind: 'trial' | 'drop_in' | 'enrollment';
  readonly personName: string;
  readonly when: string;
  readonly rescheduled?: boolean;
}): string {
  if (input.rescheduled === true) {
    return `Cambio de hora: ${input.personName} ahora viene el ${input.when}`;
  }
  const what =
    input.kind === 'enrollment'
      ? 'Inscripción'
      : input.kind === 'drop_in'
        ? 'Clase suelta'
        : 'Clase de prueba';
  return `${what}: ${input.personName} viene el ${input.when}`;
}

export interface SendOutcome {
  readonly enviado: boolean;
  /** Por qué no se envió, cuando no se envió. */
  readonly denial: string | null;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  /** `true` si este despliegue puede enviar. Las rutas lo consultan para no prometer. */
  get disponible(): boolean {
    return loadEnv().RESEND_API_KEY !== undefined;
  }

  async sendInvite(input: {
    readonly recipient: string;
    readonly personName: string;
    readonly gym: string;
    readonly plan: string;
    readonly href: string;
  }): Promise<SendOutcome> {
    const env = loadEnv();
    if (env.RESEND_API_KEY === undefined) {
      return { enviado: false, denial: 'El envío por correo no está configurado.' };
    }

    const firstName = input.personName.trim().split(/\s+/)[0] ?? input.personName;
    const text = [
      `Hola ${firstName},`,
      '',
      `${input.gym} te dio de alta con el plan ${input.plan}.`,
      '',
      'Abre este enlace para activar tu cuenta:',
      input.href,
      '',
      'Desde la app verás tu plan, tu cupo de la semana y el código QR con',
      'el que entras al gimnasio. El código cambia cada 30 segundos y',
      'funciona sin internet.',
      '',
      'Si no esperabas este correo, ignóralo: sin abrir el enlace no se',
      'activa nada.',
    ].join('\n');

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: env.MAIL_FROM,
          to: [input.recipient],
          subject: `${input.gym} te inscribió en Sinchi`,
          // Las dos versiones. El texto plano no es un trámite: es lo que ven
          // los clientes que bloquean HTML y lo que leen los filtros de spam,
          // que desconfían de un correo que solo trae imágenes y un botón.
          text: text,
          html: inviteEmail({
            firstName,
            gym: input.gym,
            plan: input.plan,
            href: input.href,
            logo: `${env.PUBLIC_BASE_URL}/v1/brand/logo.png`,
          }),
        }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        const denial =
          typeof body === 'object' && body !== null && 'message' in body
            ? String((body as { message: unknown }).message)
            : `Resend respondió ${response.status}.`;
        this.logger.warn(`No se pudo enviar la invitación a ${input.recipient}: ${denial}`);
        return { enviado: false, denial };
      }

      return { enviado: true, denial: null };
    } catch (error) {
      const denial = error instanceof Error ? error.message : 'No se pudo llegar a Resend.';
      this.logger.warn(`No se pudo enviar la invitación a ${input.recipient}: ${denial}`);
      return { enviado: false, denial };
    }
  }

  /**
   * Avisa al gimnasio de que alguien reservó una clase de prueba.
   *
   * Es el correo que convierte la función en producto: sin aviso, la reserva es
   * una fila en una tabla que nadie mira, y el interesado aparece en la puerta
   * un martes sin que nadie lo espere.
   *
   * Va en texto plano y sin plantilla HTML a propósito. La invitación tiene una
   * porque la lee un alumno y hay que convencerlo de instalar algo; esta la lee
   * el dueño en el móvil entre clase y clase, y lo único que necesita es el
   * nombre, el celular y cuándo viene. Un botón verde no ayudaría.
   *
   * Como el resto de este archivo: **no puede tumbar lo que lo llama**. La
   * reserva ya existe y sale en la app del mostrador aunque Resend esté caído.
   */
  async notifyBooking(input: {
    readonly recipient: string;
    readonly gym: string;
    /** Prueba, clase suelta o inscripción: cambia qué se cobra y cuándo. */
    readonly kind: 'trial' | 'drop_in' | 'enrollment';
    readonly personName: string;
    readonly telefono: string;
    readonly klass: string;
    /** "martes 2 de setiembre", ya formateado por quien conoce la zona. */
    readonly when: string;
    readonly time: string;
    /** Lo que esa clase le cuesta —en una inscripción, el primer mes—. 0 = gratis. */
    readonly priceCents: number;
    /** Solo en una inscripción. */
    readonly planName?: string | null;
    readonly enrollmentFeeCents?: number;
    /**
     * La persona MOVIO una reserva que ya tenia, no reservo por primera vez.
     *
     * Sin esto, al dueno le llegan dos correos identicos —«Ana viene el martes»,
     * «Ana viene el jueves»— y no tiene forma de saber si son dos personas, dos
     * clases o un cambio. Con el tatami de por medio, esa duda se resuelve
     * preparando sitio para dos.
     */
    readonly rescheduled?: boolean;
  }): Promise<SendOutcome> {
    const env = loadEnv();
    if (env.RESEND_API_KEY === undefined) {
      return { enviado: false, denial: 'El envío por correo no está configurado.' };
    }

    // Sin enlace de WhatsApp, y es a propósito: llevaba al dueño a coordinar
    // FUERA de Sinchi justo con quien acaba de llegar por Sinchi. La respuesta
    // va por el chat de la app (migración 0020); el celular sigue en el correo
    // porque es un dato de la persona, no una invitación a salir.
    const soles = (value: number): string => `S/ ${(value / 100).toFixed(2)}`;
    const fee = input.enrollmentFeeCents ?? 0;
    const what =
      input.kind === 'enrollment'
        ? 'su inscripción'
        : input.kind === 'drop_in'
          ? 'una clase suelta'
          : 'una clase de prueba';

    /**
     * Qué se cobra, y dónde.
     *
     * En la inscripción el cobro es del día que llegue, no del que eligió: la
     * mensualidad cuenta desde que recepción hace la ficha. Decir «al llegar el
     * martes» invitaría a cobrarle el martes aunque aparezca el jueves.
     */
    const charge =
      input.kind === 'enrollment'
        ? `${input.planName ?? 'su plan'}: primer mes ${soles(input.priceCents)}${
            fee > 0 ? ` + matrícula ${soles(fee)}` : ''
          }, al inscribirse`
        : input.priceCents === 0
          ? 'gratis'
          : `${soles(input.priceCents)} al llegar`;

    const change = input.rescheduled === true;

    const text = [
      change
        ? `${input.personName} cambió la hora de ${what} en ${input.gym}.`
        : input.kind === 'enrollment'
          ? `${input.personName} quiere inscribirse en ${input.gym}.`
          : `${input.personName} reservó ${what} en ${input.gym}.`,
      '',
      `Clase:    ${input.klass}`,
      `Cuándo:   ${input.when}, ${input.time}`,
      `Celular:  ${input.telefono}`,
      `Cobro:    ${charge}`,
      '',
      ...(change
        ? [
            'Es la MISMA persona y la misma reserva, movida: no esperes a dos.',
            'La hora de arriba es la que vale.',
          ]
        : input.kind === 'enrollment'
          ? [
              'Todavía no es alumno: la ficha la haces cuando llegue, con su',
              'documento, desde Reservas. Su mensualidad empieza el día que venga.',
            ]
          : [
              'Todavía no es alumno de ningún gimnasio tuyo: te encontró en la lista',
              'de Sinchi y eligió este horario.',
            ]),
      '',
      'Escríbele desde la app: en Reservas, toca «Escribirle» en su reserva.',
      'La lista completa de quién viene también está ahí.',
    ].join('\n');

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: env.MAIL_FROM,
          to: [input.recipient],
          subject: bookingSubject(input),
          text: text,
        }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        const denial =
          typeof body === 'object' && body !== null && 'message' in body
            ? String((body as { message: unknown }).message)
            : `Resend respondió ${response.status}.`;
        this.logger.warn(`No se pudo avisar a ${input.recipient}: ${denial}`);
        return { enviado: false, denial };
      }

      return { enviado: true, denial: null };
    } catch (error) {
      const denial = error instanceof Error ? error.message : 'No se pudo llegar a Resend.';
      this.logger.warn(`No se pudo avisar a ${input.recipient}: ${denial}`);
      return { enviado: false, denial };
    }
  }

  /**
   * Avisa de un mensaje nuevo en el chat, a quien le toca leerlo.
   *
   * Es la mitad que la migración 0020 le debe a la decisión vieja: sin push, un
   * chat del que nadie se entera es un buzón que nadie abre. El servicio decide
   * CUÁNDO —uno por tanda de mensajes sin leer—; aquí solo se dice.
   *
   * Lleva el texto del mensaje y NO un enlace para contestar por correo ni por
   * WhatsApp: la respuesta se escribe en la app, que es donde queremos que esté
   * la conversación entera.
   */
  async notifyMessage(input: {
    readonly recipient: string;
    /** A quién va: al gimnasio, o a la persona que le escribió. */
    readonly audience: 'gym' | 'person';
    readonly gym: string;
    readonly personName: string;
    /** «Clase de prueba», «Consulta»…: por dónde empezó, ya en palabras. */
    readonly topic: string;
    /** Quién del mostrador contestó, cuando va a la persona. */
    readonly staffName: string | null;
    readonly body: string;
  }): Promise<SendOutcome> {
    // Lo justo para decidir si abrir la app ya. El mensaje entero está allí.
    const preview =
      input.body.length > 280 ? `${input.body.slice(0, 277).trimEnd()}…` : input.body;
    const firstName = input.personName.trim().split(/\s+/)[0] ?? input.personName;

    const toGym = input.audience === 'gym';
    const subject = toGym
      ? `Mensaje de ${input.personName} en Sinchi`
      : `${input.gym} te respondió en Sinchi`;
    const text = toGym
      ? [
          `${input.personName} te escribió en Sinchi.`,
          '',
          `Sobre:  ${input.topic}`,
          '',
          `«${preview}»`,
          '',
          'Respóndele desde la app, en Mensajes. La conversación está entera allí,',
          'y no te llegará otro correo por lo que siga escribiendo hasta que la abras.',
        ].join('\n')
      : [
          `Hola ${firstName},`,
          '',
          `${input.gym} te respondió en Sinchi:`,
          '',
          `«${preview}»`,
          ...(input.staffName === null ? [] : [`— ${input.staffName}`]),
          '',
          'Abre Sinchi para seguir la conversación: está en Mensajes.',
        ].join('\n');

    return this.deliver(input.recipient, subject, text);
  }

  /**
   * Un correo en texto plano, sin poder lanzar.
   *
   * Solo lo usa el aviso de mensajes. Las dos de arriba llevan su propia copia
   * del mismo `fetch`, y juntarlas no es parte de este cambio: son correos que ya
   * salen bien y que no hay por qué tocar para añadir uno.
   */
  private async deliver(recipient: string, subject: string, text: string): Promise<SendOutcome> {
    const env = loadEnv();
    if (env.RESEND_API_KEY === undefined) {
      return { enviado: false, denial: 'El envío por correo no está configurado.' };
    }

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from: env.MAIL_FROM, to: [recipient], subject, text }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        const denial =
          typeof body === 'object' && body !== null && 'message' in body
            ? String((body as { message: unknown }).message)
            : `Resend respondió ${response.status}.`;
        this.logger.warn(`No se pudo avisar a ${recipient}: ${denial}`);
        return { enviado: false, denial };
      }

      return { enviado: true, denial: null };
    } catch (error) {
      const denial = error instanceof Error ? error.message : 'No se pudo llegar a Resend.';
      this.logger.warn(`No se pudo avisar a ${recipient}: ${denial}`);
      return { enviado: false, denial };
    }
  }
}
