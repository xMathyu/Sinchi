/**
 * Invitaciones por enlace: las dos rutas publicas.
 *
 * Van aparte de `accounts.controller.ts` —que es todo del staff— porque estas
 * dos las llama alguien que todavia no tiene sesion ni gimnasio. Es justo lo que
 * el enlace va a decidir.
 */
import { Body, Controller, Get, Header, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Public } from '../auth/auth.guard';
import { parseWith } from '../common/zod.pipe';
import { InviteService } from '../auth/invite.service';
import { AuthService, type IssuedSession } from '../auth/auth.service';
import { FirebaseVerifier } from '../auth/firebase';
import { detectarSistema, paginaCaducada, paginaInvitacion } from './invite-page';
import { loadEnv } from '../config/env';

const claimSchema = z.object({
  /** El mismo ID token de Firebase que consume `/auth/google`. */
  idToken: z.string().min(100),
});

@Controller('invites')
export class InvitesController {
  constructor(
    private readonly invites: InviteService,
    private readonly auth: AuthService,
    private readonly firebase: FirebaseVerifier,
  ) {}

  /**
   * Que gimnasio, que plan y cuanto — antes de pedir que entre.
   *
   * Publica y sin consumir nada: quien recibe un enlace tiene derecho a ver a
   * que lo estan invitando antes de decidir si crea una cuenta.
   */
  @Public()
  @Get(':token')
  preview(@Param('token') token: string) {
    return this.invites.preview(token);
  }

  /**
   * La pagina que abre el enlace del correo.
   *
   * Hace falta porque `sinchi://` NO es un enlace que un cliente de correo pueda
   * abrir: Gmail no convierte esquemas propios en enlaces, y aunque lo hiciera,
   * en un ordenador no hay nada que responda. Asi que el correo lleva una URL
   * https de verdad, y es esta pagina la que salta a la app.
   *
   * Se sirve desde la api y no desde un sitio aparte porque es la unica
   * direccion publica y estable que el proyecto ya tiene. El dia que exista
   * `apps/web`, esta ruta se convierte en una redireccion de una linea.
   *
   * Un token vencido o inventado tiene su propia pagina: un 404 en blanco deja
   * a quien lo abre sin saber si se equivoco de enlace o si llego tarde.
   *
   * Y si no tiene la app, esta pagina es la que se lo dice. El enlace se
   * comparte por WhatsApp y se abre en telefonos que no la tienen instalada: sin
   * una salida a la tienda, el boton no hacia nada y ahi se acababa el alta.
   */
  @Public()
  @Get(':token/abrir')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async abrir(@Param('token') token: string, @Req() req: Request, @Res() res: Response) {
    const enlaceApp = `sinchi:///invite/${token}`;
    const env = loadEnv();
    try {
      const invitacion = await this.invites.preview(token);
      res.end(
        paginaInvitacion({
          gimnasio: invitacion.gymName,
          nombre: invitacion.fullName,
          plan: invitacion.planName,
          enlaceApp,
          sistema: detectarSistema(req.get('user-agent')),
          tiendas: {
            ios: env.IOS_STORE_URL ?? null,
            android: env.ANDROID_STORE_URL,
          },
        }),
      );
    } catch {
      res.end(paginaCaducada());
    }
  }

  /**
   * Acepta la invitacion.
   *
   * Primero se verifica quien es la persona ante Firebase y solo despues se
   * consume el enlace. Al reves, un token de Firebase invalido quemaria una
   * invitacion legitima y dejaria a alguien fuera sin haber entrado nunca.
   */
  @Public()
  @Post(':token/claim')
  async claim(
    @Param('token') token: string,
    @Body(parseWith(claimSchema)) body: z.infer<typeof claimSchema>,
  ): Promise<IssuedSession> {
    const identity = await this.firebase.verify(body.idToken);

    const { userId } = await this.invites.claim({
      token,
      firebaseUid: identity.uid,
      email: identity.email,
    });

    return this.auth.issueForLinkedUser(userId);
  }
}
