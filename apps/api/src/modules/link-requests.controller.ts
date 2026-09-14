/**
 * Solicitudes de vínculo, del lado de quien todavía no tiene ficha.
 *
 * Públicas y firmadas con el ID token de Firebase en el cuerpo, igual que las
 * reservas de invitado (`/gyms/trials/mine`): esa persona no tiene sesión de
 * Sinchi, y es justo lo que aceptar le va a dar. Las de quien ya la tiene viven
 * en `/me/link-requests`.
 */
import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { z } from 'zod';
import { Public } from '../auth/auth.guard';
import { AuthService, type IssuedSession } from '../auth/auth.service';
import { FirebaseVerifier, type VerifiedIdentity } from '../auth/firebase';
import { parseWith } from '../common/zod.pipe';
import { LinkRequestsService, type LinkAnswerer } from './identity/link-requests.service';

const idTokenSchema = z.object({ idToken: z.string().min(100).max(4096) });

const asAccount = (identity: VerifiedIdentity): LinkAnswerer => ({
  kind: 'account',
  uid: identity.uid,
  email: identity.email,
});

@Controller('link-requests')
export class LinkRequestsController {
  constructor(
    private readonly firebase: FirebaseVerifier,
    private readonly linkRequests: LinkRequestsService,
    private readonly auth: AuthService,
  ) {}

  /** Los gimnasios que la agregaron y esperan su respuesta. */
  @Public()
  @Post('mine')
  async mine(@Body(parseWith(idTokenSchema)) body: z.infer<typeof idTokenSchema>) {
    return this.linkRequests.pendingFor(asAccount(await this.firebase.verify(body.idToken)));
  }

  /**
   * Acepta, y sale con su sesión.
   *
   * Aceptar es lo que la vincula a la ficha, así que desde aquí ya es alumna.
   * Devolver la sesión en la misma respuesta le ahorra a la app volver a
   * autenticarse para descubrir lo que la api acaba de decidir.
   */
  @Public()
  @Post(':requestId/accept')
  async accept(
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body(parseWith(idTokenSchema)) body: z.infer<typeof idTokenSchema>,
  ): Promise<IssuedSession> {
    const identity = await this.firebase.verify(body.idToken);
    const { userId } = await this.linkRequests.accept(asAccount(identity), requestId);
    return this.auth.issueForLinkedUser(userId);
  }

  @Public()
  @Post(':requestId/reject')
  async reject(
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body(parseWith(idTokenSchema)) body: z.infer<typeof idTokenSchema>,
  ) {
    await this.linkRequests.reject(asAccount(await this.firebase.verify(body.idToken)), requestId);
    return { rejected: true };
  }
}
