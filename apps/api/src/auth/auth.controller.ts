/**
 * Rutas de sesión.
 *
 * Tres caminos, uno por tipo de persona:
 *
 *  · **alumno** — entra con Google. Si su cuenta ya está vinculada a una ficha
 *    del padrón, recibe sesión. Si no, recibe un código para que recepción lo
 *    confirme.
 *  · **staff** — abre turno con el token del equipo del mostrador más su PIN.
 *    El equipo es compartido y los turnos rotan, así que la sesión es de la
 *    persona, no del aparato: `recorded_by` tiene que decir la verdad.
 *  · **dueño** — entra con Google como el alumno. Su vínculo se resuelve solo
 *    por email verificado en el arranque (ver `AccountLinkService`).
 */
import { BadRequestException, Body, Controller, Get, Headers, Post } from '@nestjs/common';
import { z } from 'zod';
import {
  AuthService,
  type AvailableModes,
  type IssuedSession,
  type UnlinkedAccount,
} from './auth.service';
import { CurrentSession, Public } from './auth.guard';
import type { Session } from './session';
import { parseWith } from '../common/zod.pipe';
import { PIN_MAX_LENGTH, PIN_MIN_LENGTH } from './secrets';

export const DEVICE_TOKEN_HEADER = 'x-device-token';

const googleSchema = z.object({
  /** ID token que devuelve Firebase en el cliente. */
  idToken: z.string().min(100).max(4096),
  /**
   * Lo que la persona escribio al CREAR su cuenta, si la esta creando.
   *
   * No autentica nada —eso lo hace el token— y no toca `users`: se guarda con el
   * codigo pendiente para que reservar una clase gratis no le vuelva a preguntar
   * el nombre y el celular que acaba de escribir. Opcionales porque quien ya
   * tiene cuenta no los manda.
   */
  fullName: z.string().min(2).max(120).optional(),
  phone: z.string().min(6).max(20).optional(),
});

const shiftSchema = z.object({
  staffId: z.string().uuid(),
  pin: z.string().regex(new RegExp(`^\\d{${PIN_MIN_LENGTH},${PIN_MAX_LENGTH}}$`)),
});

const devLoginSchema = z.object({
  phone: z.string().min(6).max(20),
});

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * Entrar con Google.
   *
   * La respuesta tiene dos formas y el cliente debe distinguirlas por `linked`:
   * con `true` viene la sesión; con `false` viene el código de vinculación y hay
   * que mandar al alumno al mostrador.
   */
  @Public()
  @Post('google')
  signInWithGoogle(
    @Body(parseWith(googleSchema)) body: z.infer<typeof googleSchema>,
  ): Promise<IssuedSession | UnlinkedAccount> {
    return this.auth.signInWithGoogle(body.idToken, {
      fullName: body.fullName,
      phone: body.phone,
    });
  }

  /** Quiénes pueden abrir turno en este equipo. Alimenta el selector. */
  @Public()
  @Get('shift/staff')
  staffForDevice(@Headers(DEVICE_TOKEN_HEADER) deviceToken: string | undefined) {
    return this.auth.staffForDevice(requireDeviceToken(deviceToken));
  }

  /** Abrir turno: token del equipo + PIN de la persona. */
  @Public()
  @Post('shift')
  openShift(
    @Headers(DEVICE_TOKEN_HEADER) deviceToken: string | undefined,
    @Body(parseWith(shiftSchema)) body: z.infer<typeof shiftSchema>,
  ): Promise<IssuedSession> {
    return this.auth.openShift({
      deviceToken: requireDeviceToken(deviceToken),
      staffId: body.staffId,
      pin: body.pin,
    });
  }

  /**
   * Qué otros modos tiene quien pregunta.
   *
   * La pantalla de ajustes la necesita para decidir si enseña el cambio de modo.
   * No sale del token: el rol firmado dice con qué entró, no qué más es.
   */
  @Get('modes')
  modes(@CurrentSession() session: Session): Promise<AvailableModes> {
    return this.auth.modesFor(session.sub);
  }

  /** El dueño del dojo también entrena en él: puede mirar su propia billetera. */
  @Post('switch-to-student')
  switchToStudent(@CurrentSession() session: Session): Promise<IssuedSession> {
    return this.auth.switchToStudent(session);
  }

  /**
   * Y la vuelta a su puesto.
   *
   * Sin esto el cambio era de ida y sin regreso: la otra entrada al modo staff
   * es `POST /auth/shift`, que pide el token del equipo del mostrador.
   */
  @Post('switch-to-staff')
  switchToStaff(@CurrentSession() session: Session): Promise<IssuedSession> {
    return this.auth.switchToStaff(session);
  }

  /**
   * Puerta de desarrollo. No verifica identidad.
   *
   * Se apaga con `ALLOW_DEV_LOGIN=false` y la api se niega a arrancar con esa
   * bandera activa en producción. Sigue existiendo porque los tests de punta a
   * punta la usan para no depender de Firebase.
   */
  @Public()
  @Post('dev-login')
  devLogin(
    @Body(parseWith(devLoginSchema)) body: z.infer<typeof devLoginSchema>,
  ): Promise<IssuedSession> {
    return this.auth.devLogin(body.phone);
  }
}

function requireDeviceToken(token: string | undefined): string {
  if (token === undefined || token.length === 0) {
    // `BadRequestException` y no un Error suelto: un Error se convierte en 500 y
    // parece una falla del servidor cuando el problema esta en la peticion.
    throw new BadRequestException(`Falta la cabecera ${DEVICE_TOKEN_HEADER}.`);
  }
  return token;
}
