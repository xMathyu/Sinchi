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
import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { Public } from '../auth/auth.guard';
import { parseWith } from '../common/zod.pipe';
import { phoneSchema } from '../common/phone';
import { FirebaseVerifier } from '../auth/firebase';
import { TrialsService, type TrialAccount } from './trials/trials.service';
import { OnboardingService } from './onboarding/onboarding.service';
import { EventsService } from './events/events.service';
import { EventRegistrationsService } from './events/registrations.service';
import { RoutinesService } from './routines/routines.service';
import { MessagingService } from './messaging/messaging.service';
import { GymLogoService } from './offering/logo.service';

/** El mismo ID token de Firebase que consume `/auth/google`. */
const idTokenSchema = z.object({ idToken: z.string().min(100) });

/** Nombre y celular solo hacen falta si la persona no tiene ficha en ningun padron. */
const bookEventSchema = idTokenSchema.extend({
  fullName: z.string().min(2).max(120).optional(),
  phone: phoneSchema.optional(),
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
  // OPCIONAL: no todo dojo tiene RUC, y el que arranca lo saca cuando empieza a
  // facturar. Sin minimo aqui a proposito — el campo vacio es una respuesta
  // valida y el servicio distingue "no lo dio" de "escribio algo que no sirve",
  // que responde con el mismo mensaje de siempre.
  taxId: z.string().max(20).optional(),
  saasTier: z.enum(['free', 'up_to_60', 'up_to_150', 'unlimited']),
  // Donde queda. El minimo real lo pone el servicio, con su mensaje.
  address: z.string().min(1).max(240),
  // El pin del mapa del alta, si lo marco. El rango se acota aqui, en el
  // servicio y en la base (`tenants_coords_range`): teclear «-77.0» sin el punto
  // da 770, y un pin en un sitio que no existe manda a alguien a la calle.
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  ownerName: z.string().min(2).max(120).optional(),
  documentId: z.string().min(6).max(20),
  phone: phoneSchema.optional(),
  promoCode: z.string().max(40).optional(),
});

/**
 * Mensaje de quien todavia no tiene sesion de Sinchi.
 *
 * Nombre y celular, como en la reserva, solo hacen falta para ABRIR el hilo y
 * solo si no tiene ficha: son lo que el gimnasio necesita para saber con quien
 * habla. El tope del texto lo pone `checkMessageDraft`, con su frase.
 */
const guestMessageSchema = idTokenSchema.extend({
  body: z.string().max(4000),
  topic: z.enum(['general', 'trial', 'drop_in', 'membership', 'event']).optional(),
  fullName: z.string().min(2).max(120).optional(),
  phone: phoneSchema.optional(),
});

/** La hora nueva. El gimnasio no se repite: sale de la reserva que se mueve. */
const guestRescheduleSchema = idTokenSchema.extend({
  classScheduleId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha va en formato YYYY-MM-DD.'),
});

const bookSchema = idTokenSchema.extend({
  /**
   * Nombre y celular solo se le piden a quien no tiene ficha: con identidad
   * Sinchi ya se saben, y volver a preguntarlos deja dos versiones de la misma
   * persona en la lista del gimnasio.
   */
  fullName: z.string().min(2).max(120).optional(),
  phone: phoneSchema.optional(),
  classScheduleId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha va en formato YYYY-MM-DD.'),
  /**
   * Que se reserva. Por defecto la prueba, porque las apps anteriores a la 0022
   * no lo mandan: para ellas esta ruta era la de la clase gratis, y lo sigue
   * siendo.
   */
  kind: z.enum(['trial', 'drop_in', 'enrollment']).default('trial'),
  /** Con que plan entra. Solo lo lee una inscripcion. */
  planId: z.string().uuid().optional(),
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
    private readonly messaging: MessagingService,
    private readonly logos: GymLogoService,
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
   * La imagen del logo de un gimnasio. La dirección la arma `gymLogoPath`.
   *
   * Pública por lo mismo que el directorio: el logo sale en la tarjeta a quien
   * todavía no tiene cuenta.
   *
   * Un año en caché y `immutable`: el id cambia con cada imagen nueva, así que
   * esta dirección no va a devolver nunca otra cosa. Sin eso, cada vez que
   * alguien abre la billetera o el directorio se volvería a pedir cada logo.
   *
   * `nosniff` para que ningún navegador adivine otro tipo que el declarado. Los
   * bytes ya se comprobaron al subirlos, pero esta ruta sirve contenido que puso
   * un tercero, y esa cabecera es gratis.
   */
  @Public()
  @Get('logos/:logoId')
  async logo(@Param('logoId', ParseUUIDPipe) logoId: string, @Res() res: Response) {
    const logo = await this.logos.serve(logoId);
    if (logo === null) throw new NotFoundException('Ese logo ya no existe.');
    res.setHeader('Content-Type', logo.contentType);
    res.setHeader('Content-Length', String(logo.bytes.length));
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(logo.bytes);
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
      address: body.address,
      latitude: body.latitude,
      longitude: body.longitude,
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

  /**
   * Sus conversaciones, para quien todavia no tiene ficha.
   *
   * POST por lo mismo que `trials/mine`: el token va en el cuerpo. Se declara
   * antes que `:slug` para que ningun gimnasio con slug "conversations" la tape.
   */
  @Public()
  @Post('conversations/mine')
  async myConversations(@Body(parseWith(idTokenSchema)) body: z.infer<typeof idTokenSchema>) {
    const identity = await this.firebase.verify(body.idToken);
    return this.messaging.mine({
      kind: 'firebase',
      uid: identity.uid,
      email: identity.email,
      displayName: identity.displayName,
    });
  }

  /**
   * Mueve la reserva a otra hora, sin ficha en ningún padrón.
   *
   * El par de `/me/trials/:id/reschedule`, para quien reservó solo con su cuenta
   * de Google. Se declara antes que `:slug` por lo mismo que las de arriba.
   */
  @Public()
  @Post('trials/:bookingId/reschedule')
  async reschedule(
    @Param('bookingId') bookingId: string,
    @Body(parseWith(guestRescheduleSchema)) body: z.infer<typeof guestRescheduleSchema>,
  ) {
    const identity = await this.firebase.verify(body.idToken);
    return this.trials.rescheduleOwn(
      { kind: 'firebase', uid: identity.uid, email: identity.email, displayName: identity.displayName },
      bookingId,
      { classScheduleId: body.classScheduleId, date: body.date },
    );
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
    const detail = await this.trials.gym(slug);
    const [events, biblioteca] = await Promise.all([
      this.events.publicUpcoming(detail.id),
      // Con ojos de la calle: solo lo publicado y publico. `membersOnly` es el
      // numero que vende la mensualidad —"12 rutinas mas para alumnos"— sin
      // regalar los titulos de lo que hay detras.
      this.routines.library(detail.id, 'visitor'),
    ]);
    return {
      ...detail,
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
   * Reserva una clase: la de prueba, una suelta o la primera de una inscripcion.
   *
   * La ruta se llama `trial` porque nacio para la primera, y la llaman apps ya
   * instaladas; sin `kind` sigue siendo la prueba.
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
      kind: body.kind,
      planId: body.planId,
      fullName: body.fullName,
      phone: body.phone,
      classScheduleId: body.classScheduleId,
      date: body.date,
    });
  }

  /**
   * El hilo con este gimnasio, para quien solo tiene su cuenta de Google.
   *
   * Es la pregunta del curioso del directorio, y es la razon de que el chat
   * exista: quien todavia no reservo nada no tenia ninguna forma de preguntar si
   * hay clases de noche. Abrirlo lo marca leido.
   */
  @Public()
  @Post(':slug/conversation')
  async guestConversation(
    @Param('slug') slug: string,
    @Body(parseWith(idTokenSchema)) body: z.infer<typeof idTokenSchema>,
  ) {
    const identity = await this.firebase.verify(body.idToken);
    return this.messaging.personThread(
      { kind: 'firebase', uid: identity.uid, email: identity.email, displayName: identity.displayName },
      slug,
    );
  }

  /**
   * Le escribe al gimnasio sin haberse inscrito ni reservado nada.
   *
   * Se verifica ante Firebase antes de escribir, igual que la reserva: sin una
   * cuenta detras, la bandeja del mostrador se llena de mensajes de nadie.
   */
  @Public()
  @Post(':slug/messages')
  async guestMessage(
    @Param('slug') slug: string,
    @Body(parseWith(guestMessageSchema)) body: z.infer<typeof guestMessageSchema>,
  ) {
    const identity = await this.firebase.verify(body.idToken);
    return this.messaging.personSend(
      { kind: 'firebase', uid: identity.uid, email: identity.email, displayName: identity.displayName },
      slug,
      { body: body.body, topic: body.topic, fullName: body.fullName, phone: body.phone },
    );
  }
}
