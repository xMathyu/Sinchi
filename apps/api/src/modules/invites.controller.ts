/**
 * Invitaciones por enlace: las dos rutas publicas.
 *
 * Van aparte de `accounts.controller.ts` —que es todo del staff— porque estas
 * dos las llama alguien que todavia no tiene sesion ni gimnasio. Es justo lo que
 * el enlace va a decidir.
 */
import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { Public } from '../auth/auth.guard';
import { parseWith } from '../common/zod.pipe';
import { InviteService } from '../auth/invite.service';
import { AuthService, type IssuedSession } from '../auth/auth.service';
import { FirebaseVerifier } from '../auth/firebase';

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
