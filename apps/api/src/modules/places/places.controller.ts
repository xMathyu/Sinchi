/**
 * El buscador de direcciones del alta.
 *
 * PUBLICA pero NO anonima, que es la unica forma de exponer sin regalar la
 * factura. Quien registra un gimnasio todavia no tiene sesion de Sinchi —eso es
 * justo lo que el alta produce— pero si tiene una cuenta de Google o de correo
 * ya verificada por Firebase, porque es la credencial con la que se firma el
 * registro. Asi que estas rutas piden ESE token y lo verifican antes de gastar
 * una sola llamada a Places.
 *
 * Es el mismo patron que ya usan `POST /gyms/signup`, `/gyms/trials/mine` y las
 * reservas de invitado: publicas para quien no tiene ficha, cerradas a quien no
 * ha probado quien es. No hace falta un limitador nuevo — hace falta el que ya
 * existe, aplicado igual.
 */
import { Body, Controller, Logger, Post } from '@nestjs/common';
import { z } from 'zod';
import { Public } from '../../auth/auth.guard';
import { FirebaseVerifier } from '../../auth/firebase';
import { parseWith } from '../../common/zod.pipe';
import { PlacesService } from './places.service';

const idTokenSchema = z.object({ idToken: z.string().min(20) });

const suggestSchema = idTokenSchema.extend({
  /** Lo escrito hasta ahora. El minimo real lo decide el servicio. */
  query: z.string().min(1).max(200),
});

const detailSchema = idTokenSchema.extend({
  placeId: z.string().min(4).max(300),
});

@Controller('places')
export class PlacesController {
  private readonly logger = new Logger(PlacesController.name);

  constructor(
    private readonly places: PlacesService,
    private readonly firebase: FirebaseVerifier,
  ) {}

  /**
   * Sugerencias para lo que se lleva escrito.
   *
   * Va POST y no GET porque lleva el ID token en el cuerpo: un token en la query
   * string acaba en los logs del balanceador. Mismo motivo que `/gyms/trials/mine`.
   *
   * Sin clave configurada devuelve la lista vacia en vez de fallar: la pantalla
   * ya sabe seguir sin sugerencias —se escribe la direccion y se mueve el pin— y
   * un 503 la haria pintar un error por una funcion que es opcional.
   */
  @Public()
  @Post('suggest')
  async suggest(@Body(parseWith(suggestSchema)) body: z.infer<typeof suggestSchema>) {
    await this.firebase.verify(body.idToken);
    if (!this.places.disponible) return { suggestions: [] };
    return { suggestions: await this.places.suggest(body.query) };
  }

  /** La direccion y el punto del sitio que se toco en la lista. */
  @Public()
  @Post('detail')
  async detail(@Body(parseWith(detailSchema)) body: z.infer<typeof detailSchema>) {
    await this.firebase.verify(body.idToken);
    return this.places.detail(body.placeId);
  }
}
