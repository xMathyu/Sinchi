/**
 * El directorio y la clase gratis: las rutas que atienden a quien no es de nadie.
 *
 * Van aparte de `student.controller.ts` —que es todo `/me`— porque estas las
 * llama alguien que **todavia no tiene sesion de Sinchi**, y muchas veces ni
 * ficha en ningun padron. Es justo lo que la reserva puede llegar a producir:
 * un interesado al que el gimnasio conoce por su nombre.
 *
 * Mirar es anonimo. Reservar exige un ID token de Firebase verificado, por la
 * misma razon que lo exige `/invites/:token/claim`: sin una cuenta detras, la
 * lista del mostrador se llena de reservas inventadas y deja de servir.
 */
import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { Public } from '../auth/auth.guard';
import { parseWith } from '../common/zod.pipe';
import { FirebaseVerifier } from '../auth/firebase';
import { TrialsService, type TrialAccount } from './trials/trials.service';

/** El mismo ID token de Firebase que consume `/auth/google`. */
const idTokenSchema = z.object({ idToken: z.string().min(100) });

const bookSchema = idTokenSchema.extend({
  /**
   * Nombre y celular solo se le piden a quien no tiene ficha: con identidad
   * Sinchi ya se saben, y volver a preguntarlos deja dos versiones de la misma
   * persona en la lista del gimnasio.
   */
  fullName: z.string().min(2).max(120).optional(),
  phone: z.string().min(6).max(20).optional(),
  classScheduleId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha va en formato YYYY-MM-DD.'),
});

@Controller('gyms')
export class GymsController {
  constructor(
    private readonly trials: TrialsService,
    private readonly firebase: FirebaseVerifier,
  ) {}

  /**
   * Gimnasios activos de la red.
   *
   * Publica y sin sesion: quien busca dojo todavia no tiene cuenta, y pedirle
   * que se registre para mirar una lista es perderlo en la primera pantalla.
   */
  @Public()
  @Get()
  directory() {
    return this.trials.directory();
  }

  /**
   * Mis reservas, para quien todavia no tiene ficha.
   *
   * Va POST y no GET porque lleva el ID token en el cuerpo: un token en la query
   * string acaba en los logs del balanceador. Se declara antes que `:slug` para
   * que ningun gimnasio con slug "trials" pueda taparla.
   */
  @Public()
  @Post('trials/mine')
  async mine(@Body(parseWith(idTokenSchema)) body: z.infer<typeof idTokenSchema>) {
    const identity = await this.firebase.verify(body.idToken);
    return this.trials.forAccount(identity.uid);
  }

  /** Cancelar libera el cupo: quien avisa que no puede el martes puede el jueves. */
  @Public()
  @Post('trials/:bookingId/cancel')
  async cancel(
    @Param('bookingId') bookingId: string,
    @Body(parseWith(idTokenSchema)) body: z.infer<typeof idTokenSchema>,
  ) {
    const identity = await this.firebase.verify(body.idToken);
    return this.trials.cancelOwn(
      { kind: 'firebase', uid: identity.uid, email: identity.email, displayName: identity.displayName },
      bookingId,
    );
  }

  /** Horarios, precios y las clases concretas que se pueden probar. */
  @Public()
  @Get(':slug')
  gym(@Param('slug') slug: string) {
    return this.trials.gym(slug);
  }

  /**
   * Reserva la clase gratis.
   *
   * Primero se verifica quien es la persona ante Firebase y solo despues se
   * escribe, igual que al aceptar una invitacion: un token invalido no puede
   * gastar el unico intento de alguien en ese gimnasio.
   *
   * Un rechazo vuelve con 200 y `booked: false` — no es un error de la peticion
   * sino el resultado del negocio, y quien lo lee necesita el motivo para saber
   * si elegir otra hora o si ya la habia usado (`docs/api.md`).
   */
  @Public()
  @Post(':slug/trial')
  async book(
    @Param('slug') slug: string,
    @Body(parseWith(bookSchema)) body: z.infer<typeof bookSchema>,
  ) {
    const identity = await this.firebase.verify(body.idToken);
    const account: TrialAccount = {
      kind: 'firebase',
      uid: identity.uid,
      email: identity.email,
      displayName: identity.displayName,
    };

    return this.trials.book({
      slug,
      account,
      fullName: body.fullName,
      phone: body.phone,
      classScheduleId: body.classScheduleId,
      date: body.date,
    });
  }
}
