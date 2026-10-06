/**
 * La persona elimina su propia cuenta SIN ficha.
 *
 * Pública y firmada con el ID token de Firebase en el cuerpo, como las demás
 * rutas de quien todavía no tiene sesión de Sinchi (`/link-requests`): esa
 * cuenta no tiene otra credencial. Quien ya tiene ficha pide su baja por
 * `/me/account/deletion-request`, que es una solicitud de 30 días.
 *
 * Existe porque Apple rechazó la 1.0.0 por la 5.1.1(v): con Google o con Apple
 * se podía CREAR una cuenta, y hasta que un gimnasio la inscribía no había forma
 * de borrarla desde la app.
 */
import { Body, Controller, Post } from '@nestjs/common';
import { z } from 'zod';
import { Public } from '../auth/auth.guard';
import { FirebaseVerifier } from '../auth/firebase';
import { parseWith } from '../common/zod.pipe';
import { PlatformPeopleService } from './admin/platform-people.service';

const idTokenSchema = z.object({ idToken: z.string().min(100).max(4096) });

@Controller('account')
export class OwnAccountController {
  constructor(
    private readonly firebase: FirebaseVerifier,
    private readonly people: PlatformPeopleService,
  ) {}

  /**
   * Borra la cuenta en el acto: sus reservas, sus conversaciones, sus datos y su
   * usuario de Firebase.
   *
   * `decode` y no `verify`: `verify` frena a las cuentas baneadas, y borrarse es
   * un derecho también para ellas. El baneo no se va con la cuenta —vive en
   * `account_bans` con su correo—, así que eliminarse no es la forma de
   * quitárselo.
   */
  @Public()
  @Post('delete')
  async remove(@Body(parseWith(idTokenSchema)) body: z.infer<typeof idTokenSchema>) {
    const identity = await this.firebase.decode(body.idToken);
    const outcome = await this.people.removeOwnAccount(identity.uid);
    return { deleted: true as const, firebase: outcome.firebase };
  }
}
