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
import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { z } from 'zod';
import { Public } from '../auth/auth.guard';
import { parseWith } from '../common/zod.pipe';
import { FirebaseVerifier } from '../auth/firebase';
import { TrialsService, type TrialAccount } from './trials/trials.service';
import { OnboardingService } from './onboarding/onboarding.service';
import { EventsService } from './events/events.service';
import { EventRegistrationsService } from './events/registrations.service';
import { RoutinesService } from './routines/routines.service';

/** El mismo ID token de Firebase que consume `/auth/google`. */
const idTokenSchema = z.object({ idToken: z.string().min(100) });

/** Nombre y celular solo hacen falta si la persona no tiene ficha en ningun padron. */
const bookEventSchema = idTokenSchema.extend({
  fullName: z.string().min(2).max(120).optional(),
  phone: z.string().min(6).max(20).optional(),
});

/**
 * Alta de un gimnasio.
 *
 * El RUC y el documento se validan de verdad en el servicio —digito verificador
 * incluido—; aqui solo se acotan tamanos. El escalon lo DECLARA el dueno para
 * saber cuanto le va a costar; el cobro lo deriva del padron igual.
 */
const signUpSchema = idTokenSchema.extend({
  gymName: z.string().min(3).max(120),
  taxId: z.string().min(8).max(20),
  saasTier: z.enum(['free', 'up_to_60', 'up_to_150', 'unlimited']),
  ownerName: z.string().min(2).max(120).optional(),
  documentId: z.string().min(6).max(20),
  phone: z.string().min(6).max(20).optional(),
  promoCode: z.string().max(40).optional(),
});

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
    private readonly onboarding: OnboardingService,
    private readonly events: EventsService,
    private readonly registrations: EventRegistrationsService,
    private readonly routines: RoutinesService,
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
   * Da de alta un gimnasio y devuelve la sesión de dueño.
   *
   * Es la única ruta pública que crea un tenant. Va aquí y no bajo `/staff`
   * porque quien la llama todavía no es staff de ningún sitio: es justo lo que
   * esta petición produce.
   *
   * Se declara antes que `:slug` para que ningún gimnasio con slug "signup"
   * pueda taparla.
   */
  @Public()
  @Post('signup')
  async signUp(@Body(parseWith(signUpSchema)) body: z.infer<typeof signUpSchema>) {
    const identity = await this.firebase.verify(body.idToken);
    return this.onboarding.signUpGym({
      firebaseUid: identity.uid,
      email: identity.email,
      displayName: identity.displayName,
      gymName: body.gymName,
      taxId: body.taxId,
      saasTier: body.saasTier,
      ownerName: body.ownerName,
      documentId: body.documentId,
      phone: body.phone,
      promoCode: body.promoCode,
    });
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

  /**
   * Horarios, precios, las clases que se pueden probar y lo que viene.
   *
   * Los eventos se componen aqui y no dentro de `trials.gym`: son de otro
   * modulo, y meterlos ahi dentro ataria el directorio a la clase gratis para
   * siempre. La ficha publica es un ensamblaje, y este es el sitio donde se ve.
   */
  @Public()
  @Get(':slug')
  async gym(@Param('slug') slug: string) {
    const detalle = await this.trials.gym(slug);
    const [events, biblioteca] = await Promise.all([
      this.events.publicUpcoming(detalle.id),
      // Con ojos de la calle: solo lo publicado y publico. `membersOnly` es el
      // numero que vende la mensualidad —"12 rutinas mas para alumnos"— sin
      // regalar los titulos de lo que hay detras.
      this.routines.library(detalle.id, 'visitor'),
    ]);
    return {
      ...detalle,
      events,
      routines: biblioteca.routines,
      membersOnlyRoutines: biblioteca.membersOnly,
    };
  }

  /**
   * Una rutina publica, abierta desde la calle.
   *
   * Es la unica ruta del producto que entrega contenido a quien no tiene cuenta
   * de nada, y a proposito: el video de un uchimata bien explicado es lo que
   * hace que alguien elija este dojo. Lo que NO entrega es lo de alumnos —el
   * servicio devuelve el anzuelo sin videos ni instrucciones— porque filtrarlo
   * en la pantalla seria decorativo: el JSON viaja igual.
   */
  @Public()
  @Get(':slug/routines/:routineId')
  async routine(
    @Param('slug') slug: string,
    @Param('routineId', ParseUUIDPipe) routineId: string,
  ) {
    /**
     * Se resuelve con `trials.gym` —que trae la ficha entera— y no con una
     * consulta suelta por el slug, a sabiendas de que cuesta un par de consultas
     * de mas.
     *
     * Ahi vive la regla de cuando un gimnasio esta disponible desde fuera:
     * activo Y dentro del directorio. Copiarla aqui seria tener dos sitios que
     * deciden lo mismo, y el dia que un local salga del directorio uno de los
     * dos se quedaria sirviendo su contenido.
     */
    const gym = await this.trials.gym(slug);
    return this.routines.view(gym.id, routineId, 'visitor');
  }

  /**
   * Coge plaza en un evento desde el directorio.
   *
   * Es lo que hace que un seminario con alguien conocido llene el local: lo
   * reserva gente que TODAVIA no entrena ahi. Se identifica ante Firebase
   * primero y se escribe despues, igual que la clase gratis.
   *
   * Un rechazo vuelve con 200 y `booked: false`. Que se agotaran las plazas no
   * es un error de la peticion, y quien lo lee necesita saber si esperar al
   * siguiente o si ya tenia la suya.
   */
  @Public()
  @Post(':slug/events/:eventId/book')
  async bookEvent(
    @Param('slug') slug: string,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body(parseWith(bookEventSchema)) body: z.infer<typeof bookEventSchema>,
  ) {
    const identity = await this.firebase.verify(body.idToken);

    return this.registrations.book({
      slug,
      eventId,
      account: {
        kind: 'firebase',
        uid: identity.uid,
        email: identity.email,
        displayName: identity.displayName,
      },
      fullName: body.fullName,
      phone: body.phone,
    });
  }

  /** Las plazas que ya tiene esta persona, para que no se le pierdan. */
  @Public()
  @Post('events/mine')
  async myEvents(@Body(parseWith(idTokenSchema)) body: z.infer<typeof idTokenSchema>) {
    const identity = await this.firebase.verify(body.idToken);
    return this.registrations.mine({
      kind: 'firebase',
      uid: identity.uid,
      email: identity.email,
      displayName: identity.displayName,
    });
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
