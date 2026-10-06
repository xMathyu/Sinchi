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
import { AppleRevocation } from '../auth/apple-revocation';
import { parseWith } from '../common/zod.pipe';
import { PlatformPeopleService } from './admin/platform-people.service';

const deleteSchema = z.object({
  idToken: z.string().min(100).max(4096),
  /** El código de una autorización de Apple recién hecha, si la cuenta es de Apple. */
  appleAuthorizationCode: z.string().min(10).max(4096).optional(),
  /** El teléfono no puede pedirlo (Android). */
  appleUnavailable: z.boolean().optional(),
});

@Controller('account')
export class OwnAccountController {
  constructor(
    private readonly firebase: FirebaseVerifier,
    private readonly people: PlatformPeopleService,
    private readonly apple: AppleRevocation,
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
  async remove(@Body(parseWith(deleteSchema)) body: z.infer<typeof deleteSchema>) {
    const identity = await this.firebase.decode(body.idToken);
    // En este orden: con ficha no es esta baja, y revocarle Apple antes de saberlo
    // la dejaría sin acceso y sin baja.
    await this.people.assertWithoutIdentity(identity.uid);
    // Si la cuenta es de Apple y no llegó el código, esto responde 409 y la app
    // abre la hoja de Apple: tiene que ser ANTES de borrar, que después no hay
    // cuenta con la que pedirlo.
    const apple = await this.apple.settle({
      isApple: identity.provider === 'apple.com',
      consent: { authorizationCode: body.appleAuthorizationCode, unavailable: body.appleUnavailable },
    });
    const outcome = await this.people.removeOwnAccount(identity.uid);
    return { deleted: true as const, firebase: outcome.firebase, apple };
  }
}
