import { Body, Controller, Post } from '@nestjs/common';
import { z } from 'zod';
import { AuthService, type IssuedSession } from './auth.service';
import { CurrentSession, Public } from './auth.guard';
import type { Session } from './session';
import { parseWith } from '../common/zod.pipe';

const devLoginSchema = z.object({
  /** Celular en formato internacional, tal como esta en `users.phone`. */
  phone: z.string().min(6).max(20),
});

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * Puerta de desarrollo. No verifica identidad.
   * Se apaga con ALLOW_DEV_LOGIN=false y no arranca en produccion.
   */
  @Public()
  @Post('dev-login')
  devLogin(@Body(parseWith(devLoginSchema)) body: z.infer<typeof devLoginSchema>): Promise<IssuedSession> {
    return this.auth.devLogin(body.phone);
  }

  /** El dueno del dojo tambien entrena en el: puede mirar su propia billetera. */
  @Post('switch-to-student')
  switchToStudent(@CurrentSession() session: Session): Promise<IssuedSession> {
    return this.auth.switchToStudent(session.sub);
  }
}
