/**
 * El teléfono se apunta para recibir avisos, y se borra al cerrar sesión.
 *
 * Bajo `/me` porque el teléfono es de la persona (migración 0029): el mismo sirve
 * a quien trabaja en un local y entrena en otro, y la sesión que lo apunta puede
 * ser de alumno o de staff.
 *
 * Las dos abiertas aunque el gimnasio deba su suscripción: apuntar un teléfono
 * no crea nada que Sinchi cobre, y dejar sin avisos al mostrador de un local
 * moroso castiga a quien reservó en él.
 */
import { Body, Controller, Post } from '@nestjs/common';
import { z } from 'zod';
import { CurrentSession } from '../../auth/auth.guard';
import type { Session } from '../../auth/session';
import { parseWith } from '../../common/zod.pipe';
import { AllowedWhenReadOnly } from '../saas/saas.guard';
import { EXPO_PUSH_TOKEN, PushService } from './push.service';

// `refine` y no `regex`: `ZodPipe` solo deja subir la frase de las reglas
// propias, y la de `regex` llegaría a la app como «Datos invalidos.».
const tokenSchema = z
  .string()
  .max(200)
  .refine((token) => EXPO_PUSH_TOKEN.test(token), {
    message: 'Ese no es un token de avisos de Expo.',
  });

const registerSchema = z.object({
  token: tokenSchema,
  platform: z.enum(['ios', 'android']),
});

const removeSchema = z.object({ token: tokenSchema });

@Controller('me/push-devices')
export class PushController {
  constructor(private readonly push: PushService) {}

  @AllowedWhenReadOnly()
  @Post()
  async register(
    @CurrentSession() session: Session,
    @Body(parseWith(registerSchema)) body: z.infer<typeof registerSchema>,
  ) {
    await this.push.register(session.sub, body.token, body.platform);
    return { registered: true as const };
  }

  /**
   * POST y no DELETE con el token en la ruta: el token lleva corchetes
   * (`ExponentPushToken[…]`), y un segmento que hay que escapar para que el
   * router no lo parta es una trampa que se pisa la primera vez que alguien lo
   * pruebe con `curl`.
   */
  @AllowedWhenReadOnly()
  @Post('remove')
  async remove(
    @CurrentSession() session: Session,
    @Body(parseWith(removeSchema)) body: z.infer<typeof removeSchema>,
  ) {
    await this.push.unregister(session.sub, body.token);
    return { removed: true as const };
  }
}
