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
}
