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
import { correoInvitacion } from './invite-email';

export interface ResultadoEnvio {
  readonly enviado: boolean;
  /** Por qué no se envió, cuando no se envió. */
  readonly motivo: string | null;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  /** `true` si este despliegue puede enviar. Las rutas lo consultan para no prometer. */
  get disponible(): boolean {
    return loadEnv().RESEND_API_KEY !== undefined;
  }

  async enviarInvitacion(input: {
    readonly para: string;
    readonly nombre: string;
    readonly gimnasio: string;
    readonly plan: string;
    readonly enlace: string;
  }): Promise<ResultadoEnvio> {
    const env = loadEnv();
    if (env.RESEND_API_KEY === undefined) {
      return { enviado: false, motivo: 'El envío por correo no está configurado.' };
    }

    const primerNombre = input.nombre.trim().split(/\s+/)[0] ?? input.nombre;
    const texto = [
      `Hola ${primerNombre},`,
      '',
      `${input.gimnasio} te dio de alta con el plan ${input.plan}.`,
      '',
      'Abre este enlace para activar tu cuenta:',
      input.enlace,
      '',
      'Desde la app verás tu plan, tu cupo de la semana y el código QR con',
      'el que entras al gimnasio. El código cambia cada 30 segundos y',
      'funciona sin internet.',
      '',
      'Si no esperabas este correo, ignóralo: sin abrir el enlace no se',
      'activa nada.',
    ].join('\n');

    try {
      const respuesta = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: env.MAIL_FROM,
          to: [input.para],
          subject: `${input.gimnasio} te inscribió en Sinchi`,
          // Las dos versiones. El texto plano no es un trámite: es lo que ven
          // los clientes que bloquean HTML y lo que leen los filtros de spam,
          // que desconfían de un correo que solo trae imágenes y un botón.
          text: texto,
          html: correoInvitacion({
            primerNombre,
            gimnasio: input.gimnasio,
            plan: input.plan,
            enlace: input.enlace,
            logo: `${env.PUBLIC_BASE_URL}/v1/brand/logo.png`,
          }),
        }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!respuesta.ok) {
        const cuerpo: unknown = await respuesta.json().catch(() => null);
        const motivo =
          typeof cuerpo === 'object' && cuerpo !== null && 'message' in cuerpo
            ? String((cuerpo as { message: unknown }).message)
            : `Resend respondió ${respuesta.status}.`;
        this.logger.warn(`No se pudo enviar la invitación a ${input.para}: ${motivo}`);
        return { enviado: false, motivo };
      }

      return { enviado: true, motivo: null };
    } catch (error) {
      const motivo = error instanceof Error ? error.message : 'No se pudo llegar a Resend.';
      this.logger.warn(`No se pudo enviar la invitación a ${input.para}: ${motivo}`);
      return { enviado: false, motivo };
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
  async avisarClaseDePrueba(input: {
    readonly para: string;
    readonly gimnasio: string;
    readonly nombre: string;
    readonly telefono: string;
    readonly clase: string;
    /** "martes 2 de setiembre", ya formateado por quien conoce la zona. */
    readonly cuando: string;
    readonly hora: string;
    /** Lo que esa clase le cuesta. 0 = gratis. */
    readonly precioCents: number;
  }): Promise<ResultadoEnvio> {
    const env = loadEnv();
    if (env.RESEND_API_KEY === undefined) {
      return { enviado: false, motivo: 'El envío por correo no está configurado.' };
    }

    // Enlace de WhatsApp: es por donde se coordina de verdad en este mercado, y
    // el dueño lee este correo en el móvil. Sin esto tendría que copiar el
    // número a mano justo cuando quiere responder rápido.
    const soloDigitos = input.telefono.replace(/\D/g, '');
    const whatsapp = soloDigitos.length >= 9 ? `https://wa.me/${soloDigitos}` : null;
    const gratis = input.precioCents === 0;

    const texto = [
      `${input.nombre} reservó una clase de prueba en ${input.gimnasio}.`,
      '',
      `Clase:    ${input.clase}`,
      `Cuándo:   ${input.cuando}, ${input.hora}`,
      `Celular:  ${input.telefono}`,
      `Cobro:    ${gratis ? 'gratis' : `S/ ${(input.precioCents / 100).toFixed(2)} al llegar`}`,
      ...(whatsapp === null ? [] : ['', `Escríbele: ${whatsapp}`]),
      '',
      'Todavía no es alumno de ningún gimnasio tuyo: te encontró en la lista',
      'de Sinchi y eligió este horario.',
      '',
      'La lista completa de quién viene está en la app, en Clases de prueba.',
    ].join('\n');

    try {
      const respuesta = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: env.MAIL_FROM,
          to: [input.para],
          // El asunto se lee entero en la notificación del móvil, que es donde
          // de verdad se lee: nombre y día, sin adornos.
          subject: `Clase de prueba: ${input.nombre} viene el ${input.cuando}`,
          text: texto,
        }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!respuesta.ok) {
        const cuerpo: unknown = await respuesta.json().catch(() => null);
        const motivo =
          typeof cuerpo === 'object' && cuerpo !== null && 'message' in cuerpo
            ? String((cuerpo as { message: unknown }).message)
            : `Resend respondió ${respuesta.status}.`;
        this.logger.warn(`No se pudo avisar a ${input.para}: ${motivo}`);
        return { enviado: false, motivo };
      }

      return { enviado: true, motivo: null };
    } catch (error) {
      const motivo = error instanceof Error ? error.message : 'No se pudo llegar a Resend.';
      this.logger.warn(`No se pudo avisar a ${input.para}: ${motivo}`);
      return { enviado: false, motivo };
    }
  }
}
