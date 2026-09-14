/**
 * La página del gimnasio, y lo que se puede reservar desde ella.
 *
 * Responde las tres preguntas de quien todavía no entrena en ningún sitio —qué
 * se entrena, cuándo y cuánto cuesta— y le da lo que puede hacer hoy: venir a
 * probar, venir a una clase pagándola, o inscribirse. Las tres se piden igual,
 * eligiendo un día concreto.
 *
 * Antes solo existía la primera, y un gimnasio sin clase de prueba no dejaba
 * hacer NADA desde su ficha: quien ya había decidido entrenar ahí solo podía
 * presentarse sin avisar.
 *
 * La reserva se pide con **fecha y hora**, no "cuando pueda". Es lo que la
 * convierte en algo útil para el gimnasio: una lista de quién viene el martes a
 * las 19:00 se puede preparar; «alguien está interesado» no.
 *
 * Qué se ofrece lo calcula `bookingOffer` y el veredicto lo da el servidor con la
 * misma función pura (`@sinchi/shared`), así que lo que la pantalla muestra es lo
 * que la api acepta.
 */
import { useMemo, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import {
  addDays,
  allWeekdays,
  bookingOffer,
  cents,
  eventBookingDenialMessage,
  formatPEN,
  formatPENShort,
  formatPlainDate,
  isDropInPlan,
  isoWeekday,
  weekdayInitial,
  weekdayName,
  type BookingKind,
  type Cents,
  type ClassSchedule,
  type ClassSlot,
  type ConversationTopic,
  type IsoWeekday,
  type Plan,
  type PlainDate,
} from '@sinchi/shared';
import { withAlpha } from '@sinchi/ui';
import Lock from 'lucide-react-native/icons/lock';
import MessageCircle from 'lucide-react-native/icons/message-circle';
import { Badge, Button, Card, Chip, Eyebrow, Row, Stack, Text } from '../../src/design/primitives';
import { MarcadorDeVideo, PortadaDeVideo } from '../../src/design/video';
import { Screen } from '../../src/design/screen';
import { OfflineState } from '../../src/design/empty';
import { SectionLoader } from '../../src/design/loading';
import { GymLocationBlock } from '../../src/design/gym-location';
import { useTheme } from '../../src/design/theme';
import { useGym, useMyBookings, useToday, useWallet } from '../../src/data/hooks';
import {
  rescheduleBooking,
  bookingCredential,
  askForDetails,
  bookClass,
  bookEventSeat,
} from '../../src/data/trials';
import type {
  BookClassDto,
  BookEventDto,
  ClassBookingDto,
  EventWithSeats,
  RoutineListItem,
} from '../../src/data/api';
import {
  formatEventDate,
  formatLongDate,
  formatWeekdayAndDay,
  shortLevel,
} from '../../src/lib/format';

/**
 * Por qué viene quien reservó.
 *
 * Con `??` porque la app se actualiza sola y la api no: contra un despliegue
 * anterior a la 0022 el campo no viene, y entonces todo lo reservado era una
 * clase de prueba.
 */
const kindOf = (booking: { readonly kind?: BookingKind }): BookingKind => booking.kind ?? 'trial';

/** Una forma de venir, con su precio y, si no se puede elegir, por qué. */
interface KindOption {
  readonly kind: BookingKind;
  readonly title: string;
  readonly price: string;
  readonly detail: string;
  /** Por qué no se puede pedir ahora. `null` = se puede. */
  readonly blocked: string | null;
}

export default function GymScreen() {
  const theme = useTheme();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { details: gym, loading, error, reload } = useGym(slug ?? '');
  const bookings = useMyBookings();
  const wallet = useWallet();
  const hoy = useToday();

  /**
   * Cómo quiere venir: a probar, a una clase suelta o a inscribirse.
   *
   * `null` mientras no lo dice. Con una sola forma posible no se le pregunta —es
   * el gimnasio de siempre, el que solo da prueba— y la pantalla se comporta
   * como antes: el horario ya se toca.
   */
  const [chosen, setChosen] = useState<BookingKind | null>(null);
  const [planId, setPlanId] = useState<string | null>(null);
  const [slot, setSlot] = useState<ClassSlot | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('+51');
  const [submitting, setBooking] = useState(false);
  const [outcome, setOutcome] = useState<BookClassDto | null>(null);
  /** Tocó el botón apagado: se dice qué falta en vez de ignorar el toque. */
  const [attempted, setAttempted] = useState(false);
  /**
   * La reserva a la que le está cambiando la hora.
   *
   * Es un modo de esta misma pantalla y no otra: el horario ya está aquí, las
   * filas ya se tocan, y lo único que cambia es a qué llama el botón. Mandarle a
   * una pantalla aparte a elegir entre las mismas catorce filas sería contar lo
   * mismo dos veces.
   */
  const [switchingId, setSwitchingId] = useState<string | null>(null);

  const account = bookingCredential();
  // Solo si de verdad no sabemos quién es. Con identidad Sinchi los datos están
  // en el padrón; sin ficha, en lo que escribió al crear su cuenta. Preguntar
  // otra vez lo que la persona acaba de dar convierte la reserva en un trámite.
  const needsDetails = askForDetails();

  if (loading && gym === null) return <SectionLoader text="Abriendo el gimnasio…" />;

  if (gym === null) {
    return (
      <Screen>
        <Row style={{ paddingTop: 8 }}>
          <BackRow />
        </Row>
        <View style={{ flex: 1 }}>
          <OfflineState
            title="No se pudo abrir este gimnasio"
            body="No llegamos al servidor. Vuelve a intentarlo en un momento."
            error={error ?? 'Este gimnasio no está disponible.'}
            onReintentar={reload}
          />
        </View>
      </Screen>
    );
  }

  const offer = bookingOffer({
    trialClassEnabled: gym.trialClassEnabled,
    // `?? 0` porque la app se actualiza sola y la api no: contra un despliegue
    // viejo el campo no viene, y «PRUEBA undefined» es peor que asumir gratis.
    trialClassPriceCents: gym.trialClassPriceCents ?? 0,
    dropInPriceCents: gym.dropInPriceCents,
    enrollmentFeeCents: gym.enrollmentFeeCents,
    plans: gym.plans,
  });
  const hasSlots = gym.slots.length > 0;
  const trialPrice = offer.trial?.priceCents ?? cents(0);
  const dropInPrice = offer.dropIn?.priceCents ?? cents(0);
  const free = trialPrice === 0;
  /** Para la insignia y el botón, donde «S/ 40.00» se come media línea. */
  const shortPrice = formatPENShort(trialPrice);

  /**
   * Ya entrena aquí.
   *
   * La api lo rechaza igual —`already_member`— pero enterarse DESPUÉS de elegir
   * día y hora es que la pantalla te haga trabajar para nada. La billetera ya
   * sabe la respuesta.
   */
  const membershipHere = wallet.find(
    (entry) => entry.tenant.id === gym.id && entry.subscription.status !== 'canceled',
  );
  const isStudent = membershipHere !== undefined;

  /** La que acaba de hacer: se cuenta con su propia tarjeta, no en la lista. */
  const justBooked = outcome !== null && outcome.booked ? outcome.booking : null;
  const mine = bookings.details.filter((booking) => booking.gymSlug === gym.slug);
  const live = mine.filter(
    (booking) => booking.status === 'booked' && booking.id !== justBooked?.id,
  );

  /** La prueba es UNA por gimnasio: la que ya usó cuenta aunque haya venido. */
  const trialUsed =
    (justBooked !== null && kindOf(justBooked) === 'trial') ||
    mine.some((booking) => kindOf(booking) === 'trial' && booking.status !== 'canceled');
  const enrollmentPending =
    (justBooked !== null && kindOf(justBooked) === 'enrollment') ||
    live.some((booking) => kindOf(booking) === 'enrollment');

  const cheapestMonthly =
    offer.enrollment?.plans.reduce<Cents | null>(
      (min, plan) => (min === null || plan.priceCents < min ? plan.priceCents : min),
      null,
    ) ?? null;

  const options: readonly KindOption[] = [
    ...(offer.trial === null
      ? []
      : [
          {
            kind: 'trial' as const,
            title: 'Clase de prueba',
            price: free ? 'Gratis' : shortPrice,
            detail: 'Para conocer el gimnasio. Una por persona.',
            blocked: trialUsed ? 'Ya reservaste tu clase de prueba aquí.' : null,
          },
        ]),
    ...(offer.dropIn === null
      ? []
      : [
          {
            kind: 'drop_in' as const,
            title: 'Clase suelta',
            price: formatPENShort(dropInPrice),
            detail: 'Vienes a una clase y la pagas en recepción al llegar.',
            blocked: null,
          },
        ]),
    ...(offer.enrollment === null
      ? []
      : [
          {
            kind: 'enrollment' as const,
            title: 'Inscribirme',
            price: cheapestMonthly === null ? '' : `desde ${formatPENShort(cheapestMonthly)}/mes`,
            detail: 'Eliges tu plan y tu primera clase. Pagas en recepción el día que vengas.',
            blocked: enrollmentPending
              ? 'Ya reservaste tu inscripción: arriba está tu primera clase.'
              : null,
          },
        ]),
  ];

  const available = options.filter((option) => option.blocked === null);
  const kind: BookingKind | null =
    chosen !== null && available.some((option) => option.kind === chosen)
      ? chosen
      : available.length === 1
        ? available[0]!.kind
        : null;

  const plan: Plan | null =
    kind === 'enrollment'
      ? (offer.enrollment?.plans.find((candidate) => candidate.id === planId) ?? null)
      : null;

  const switching = live.find((booking) => booking.id === switchingId) ?? null;

  /**
   * Se ofrece reservar solo a quien de verdad puede, y cuando ya dijo qué.
   *
   * Quien ya entrena ahí o acaba de reservar sigue viendo el horario entero —es
   * información del gimnasio— pero sin filas que se toquen: ofrecerle elegir una
   * hora para después decirle que no es hacerle trabajar para nada.
   */
  const puedeOfrecer =
    hasSlots && !isStudent && kind !== null && switching === null && justBooked === null;

  /**
   * Y se ofrece MOVER a quien ya tiene una y lo pidió.
   *
   * Las filas se vuelven a tocar, pero por otra razón y con otro botón. Hasta
   * que existió, la única salida era cancelar y reservar otra vez: dos
   * pantallas, un aviso que amenaza con que el gimnasio «dejará de esperarte», y
   * el cupo en el aire entre una cosa y la otra.
   */
  const canReschedule = switching !== null && hasSlots && !isStudent;
  /** Quien puede tocar las filas del horario, por cualquiera de los dos motivos. */
  const eligiendo = puedeOfrecer || canReschedule;
  /** Hay entre qué elegir, y no está en medio de otra cosa. */
  const showOptions =
    hasSlots && !isStudent && options.length > 1 && switching === null && justBooked === null;

  /**
   * De qué va a preguntar, deducido de quién es aquí: el alumno de casa pregunta
   * por su mensualidad —o por su clase suelta, si paga por clase—, quien reservó
   * pregunta por lo que reservó y el resto es una consulta. Solo cuenta si abre el
   * hilo, y es lo que le dice al mostrador con quién habla antes de leer.
   */
  const chatTopic: ConversationTopic =
    membershipHere !== undefined
      ? isDropInPlan(membershipHere.plan)
        ? 'drop_in'
        : 'membership'
      : live.some((booking) => kindOf(booking) === 'enrollment')
        ? 'membership'
        : live.some((booking) => kindOf(booking) === 'trial')
          ? 'trial'
          : live.some((booking) => kindOf(booking) === 'drop_in')
            ? 'drop_in'
            : 'general';

  /** Qué le falta al botón, dicho en vez de apagarlo en silencio. */
  const missing =
    kind === 'enrollment' && plan === null
      ? 'Elige tu plan.'
      : slot === null
        ? 'Elige el día y la hora en el horario.'
        : needsDetails && (name.trim().length < 2 || phone.trim().length < 7)
          ? 'Faltan tu nombre y tu celular.'
          : null;

  /**
   * Mueve la que ya tiene.
   *
   * Al salir bien no deja tarjeta de «listo»: la reserva ya sale arriba con su
   * hora nueva, y contarlo dos veces haría creer que ahora tiene dos.
   */
  const confirmReschedule = (): void => {
    if (slot === null || switching === null) return;
    setBooking(true);
    setOutcome(null);

    void rescheduleBooking({ bookingId: switching.id, slot })
      .then((result) => {
        if (!result.booked) {
          setOutcome(result);
          return;
        }
        setSlot(null);
        setSwitchingId(null);
        bookings.reload();
      })
      .catch((causa: unknown) => {
        setOutcome({
          booked: false,
          reason: { code: 'slot_not_available' },
          message: {
            title: 'No se pudo cambiar la hora',
            detail: causa instanceof Error ? causa.message : 'Intenta de nuevo.',
          },
        });
      })
      .finally(() => setBooking(false));
  };

  const confirmar = (): void => {
    if (kind === null || missing !== null || slot === null) return;
    setBooking(true);
    setOutcome(null);

    // Solo se mandan si la pantalla los pidió. Mandar los campos vacíos —que es
    // lo que hay cuando no se enseñaron— tapaba lo que ya sabíamos de la persona
    // y la api rechazaba la reserva por «nombre demasiado corto».
    void bookClass({
      slug: gym.slug,
      slot,
      kind,
      ...(plan === null ? {} : { planId: plan.id }),
      ...(needsDetails ? { fullName: name, phone: phone } : {}),
    })
      .then((result) => {
        setOutcome(result);
        if (result.booked) {
          setSlot(null);
          setAttempted(false);
          bookings.reload();
        }
      })
      .catch((causa: unknown) => {
        // Un fallo de red no es un rechazo del gimnasio, pero se enseña en el
        // mismo sitio: quien reserva solo necesita saber que no quedó hecho.
        setOutcome({
          booked: false,
          reason: { code: 'slot_not_available' },
          message: {
            title: 'No se pudo reservar',
            detail: causa instanceof Error ? causa.message : 'Intenta de nuevo.',
          },
        });
      })
      .finally(() => setBooking(false));
  };

  const eyebrow = canReschedule
    ? 'Elige tu hora nueva'
    : !puedeOfrecer
      ? 'Horarios'
      : kind === 'enrollment'
        ? 'Tu primera clase'
        : kind === 'drop_in'
          ? 'Elige tu clase'
          : free
            ? 'Tu primera clase, gratis'
            : 'Reserva tu clase de prueba';

  const hint = canReschedule
    ? 'Tu sitio no se pierde: se mueve. El gimnasio recibe el aviso con la hora nueva.'
    : options.length === 0
      ? 'Este gimnasio no toma reservas por la app. Puedes acercarte al local en cualquiera de estos horarios.'
      : showOptions && kind === null
        ? 'Elige arriba cómo quieres venir, y después tu clase.'
        : !puedeOfrecer
          ? null
          : kind === 'enrollment'
            ? // La mitad que importa: quien no puede el día que eligió no pierde
              // nada. La mensualidad la empieza recepción el día que llega.
              'Elige el día de tu primera clase. Si al final vienes otro día no pasa nada: tu mensualidad empieza el día que llegues y pagues en recepción.'
            : kind === 'drop_in'
              ? `Elige el día y la hora. Pagas ${formatPEN(dropInPrice)} en recepción al llegar; el gimnasio recibe el aviso al instante.`
              : free
                ? 'Elige el día y la hora a la que vendrás. El gimnasio recibe el aviso al instante.'
                : `Elige el día y la hora. Reservas tu sitio y pagas ${formatPEN(trialPrice)} al llegar; el gimnasio recibe el aviso al instante.`;

  const bookLabel = submitting
    ? 'Reservando…'
    : kind === 'enrollment'
      ? plan === null
        ? 'Inscribirme'
        : `Inscribirme · ${plan.name}`
      : kind === 'drop_in'
        ? `Reservar mi clase · ${formatPENShort(dropInPrice)}`
        : free
          ? 'Reservar mi clase gratis'
          : `Reservar mi clase · ${shortPrice}`;

  return (
    <Screen scroll>
      <Row style={{ paddingTop: 8 }}>
        <BackRow />
        {/* Sin horario publicado la insignia promete una reserva que esta misma
            pantalla no puede ofrecer: debajo solo hay siete días vacíos y un
            «este gimnasio todavía no publicó sus horarios». Es el estado de todo
            local recién dado de alta, que nace con la clase gratis encendida y
            sin bloques. */}
        {gym.trialClassEnabled && gym.schedules.length > 0 ? (
          <Badge
            label={free ? '1 CLASE GRATIS' : `PRUEBA ${shortPrice}`}
            color={theme.semaphoreInk.ok}
            background={theme.semaphore.ok}
          />
        ) : null}
      </Row>

      {/* El nombre entero, sin partirlo en marca y distrito: quien abre esta
          pantalla todavía no conoce el gimnasio y el nombre es lo único que
          tiene para reconocerlo. */}
      <Stack gap={3} style={{ marginTop: 18 }}>
        <Text variant="title" weight="bold">
          {gym.name}
        </Text>
        <Text variant="caption" color={theme.colors.textSecondary}>
          {gym.weeklyClasses} {gym.weeklyClasses === 1 ? 'clase' : 'clases'} por semana
        </Text>
      </Stack>

      {gym.disciplines.length > 0 ? (
        <Row justify="flex-start" style={{ marginTop: 14, flexWrap: 'wrap', gap: 8 }}>
          {gym.disciplines.map((disciplina) => (
            <Chip key={disciplina} label={disciplina} />
          ))}
        </Row>
      ) : null}

      {/* --- Preguntar -------------------------------------------------------
          Antes de reservar y no al final: la pregunta —«¿hay clase para
          principiantes?», «¿puedo pagar solo por clase?»— es muchas veces lo que
          decide si se reserva. Y va por el chat de Sinchi, no por WhatsApp: lo
          que se habla aquí se queda en la app (decisiones §12). */}
      <AskTheGym slug={gym.slug} gymName={gym.name} topic={chatTopic} />

      {/* --- Lo que ya tiene aquí --------------------------------------------- */}
      {isStudent ? (
        <Card tone="sunken" radius={theme.radii.xl} style={{ marginTop: 22 }}>
          <Stack gap={6}>
            <Text variant="bodySmall" weight="semibold">
              Ya entrenas aquí
            </Text>
            <Text variant="caption" color={theme.colors.textSecondary}>
              Tu membresía está en la billetera, y tus clases se marcan en la puerta.
            </Text>
          </Stack>
        </Card>
      ) : null}

      {!isStudent && justBooked !== null ? (
        <BookedCard
          booking={justBooked}
          onAnother={() => {
            setOutcome(null);
            setChosen(null);
            setPlanId(null);
          }}
        />
      ) : null}

      {!isStudent && live.length > 0 ? (
        <Stack gap={10} style={{ marginTop: 22 }}>
          {live.map((booking) => (
            <LiveBookingCard
              key={booking.id}
              booking={booking}
              switching={switchingId === booking.id}
              canSwitch={hasSlots}
              onToggleSwitch={() => {
                setSwitchingId((current) => (current === booking.id ? null : booking.id));
                setSlot(null);
                setOutcome(null);
              }}
            />
          ))}
        </Stack>
      ) : null}

      {/* --- Dónde queda ----------------------------------------------------
          Va DESPUÉS de la reserva y antes del horario. Quien abre esta ficha
          pregunta tres cosas en orden: cuánto cuesta, dónde queda y cuándo hay
          clase. La tercera es la más larga de leer, y ponerla en medio deja la
          segunda al final de un scroll. */}
      <GymLocationBlock
        place={{
          name: gym.name,
          address: gym.address ?? null,
          latitude: gym.latitude ?? null,
          longitude: gym.longitude ?? null,
        }}
      />

      {/* --- Cómo quiere venir ---------------------------------------------
          Solo si hay entre qué elegir. La tarjeta dice el precio que le toca,
          porque es lo que decide entre una y otra: «clase suelta S/ 25» contra
          «desde S/ 90 al mes» se compara de un vistazo. */}
      {showOptions ? (
        <Stack gap={10} style={{ marginTop: 24 }}>
          <Eyebrow>Cómo quieres venir</Eyebrow>
          {options.map((option) => (
            <KindCard
              key={option.kind}
              option={option}
              selected={option.kind === kind}
              onPress={() => {
                setChosen(option.kind);
                setSlot(null);
                setOutcome(null);
                setAttempted(false);
              }}
            />
          ))}
        </Stack>
      ) : null}

      {puedeOfrecer && kind === 'enrollment' && offer.enrollment !== null ? (
        <PlanPicker
          plans={offer.enrollment.plans}
          feeCents={offer.enrollment.enrollmentFeeCents}
          picked={planId}
          onPick={(id) => {
            setPlanId(id);
            setAttempted(false);
          }}
        />
      ) : null}

      {/* --- El horario, que es también el selector --------------------------
          Antes eran dos cosas: una tira de días para reservar y, más abajo, una
          lista plana con el horario del gimnasio. Dos formas de contar lo mismo
          en la misma pantalla, y la de abajo obligaba a leer catorce filas para
          responder «¿cuándo puedo ir?». Ahora es un solo horario, y sus filas se
          tocan cuando esa clase se puede reservar. */}
      <Stack gap={12} style={{ marginTop: 24 }}>
        <Eyebrow>{eyebrow}</Eyebrow>

        {hint === null ? null : (
          <Text variant="captionSmall" color={theme.colors.textSecondary}>
            {hint}
          </Text>
        )}

        <Timetable
          schedules={gym.schedules}
          slots={eligiendo ? gym.slots : []}
          picked={slot}
          onPick={(picked) => {
            setSlot(picked);
            setAttempted(false);
          }}
          hoy={hoy}
        />

        {puedeOfrecer && account.kind === 'none' ? (
          <Stack gap={10}>
            <Card tone="sunken" radius={theme.radii.lg}>
              <Text variant="captionSmall" color={theme.colors.textSecondary}>
                Entra con tu correo o con Google para reservar. Hace falta solo para que
                el gimnasio sepa a quién esperar.
              </Text>
            </Card>
            <Button label="Entrar y reservar" onPress={() => router.push('/login')} />
          </Stack>
        ) : null}

        {/* Cambiar la hora no pide nada más: el nombre y el celular ya están en
            la reserva que se mueve, y la cuenta es la misma que la hizo. */}
        {canReschedule ? (
          <>
            {outcome !== null && !outcome.booked ? <Rejection outcome={outcome} /> : null}

            <Button
              label={submitting ? 'Cambiando…' : 'Cambiar mi hora'}
              disabled={slot === null || submitting}
              onPress={confirmReschedule}
            />
          </>
        ) : null}

        {puedeOfrecer && account.kind !== 'none' ? (
          <>
            {needsDetails ? (
              <Card radius={theme.radii.xl}>
                <Stack gap={14}>
                  <LabeledInput
                    label="Tu nombre"
                    value={name}
                    onChange={setName}
                    placeholder="Nombre y apellido"
                  />
                  <LabeledInput
                    label="Tu celular"
                    value={phone}
                    onChange={setPhone}
                    placeholder="+51987654321"
                    keyboardType="phone-pad"
                    pie="Es con lo que el gimnasio te reconoce al llegar."
                  />
                </Stack>
              </Card>
            ) : null}

            {outcome !== null && !outcome.booked ? <Rejection outcome={outcome} /> : null}

            {attempted && missing !== null ? (
              <Text variant="caption" color={theme.semaphore.bad} align="center">
                {missing}
              </Text>
            ) : null}

            <Button
              label={bookLabel}
              disabled={missing !== null || submitting}
              onBlockedPress={submitting ? undefined : () => setAttempted(true)}
              onPress={confirmar}
            />
          </>
        ) : null}

        {options.length > 0 && !hasSlots && gym.schedules.length > 0 ? (
          <Text variant="micro" color={theme.colors.textFaint}>
            No hay clases reservables en las próximas dos semanas.
          </Text>
        ) : null}
      </Stack>

      {/* --- Lo que viene --------------------------------------------------- */}
      {gym.events.length > 0 && (
        <Stack gap={10} style={{ marginTop: 28 }}>
          <Eyebrow>Lo que viene</Eyebrow>
          <Text variant="micro" color={theme.colors.textFaint}>
            Seminarios y talleres. No hace falta ser alumno del local para venir.
          </Text>
          {gym.events.map((row) => (
            <EventCard
              key={row.event.id}
              row={row}
              slug={gym.slug}
              isStudent={isStudent}
            />
          ))}
        </Stack>
      )}

      {/* --- Lo que enseñan -------------------------------------------------
          Va antes que los precios y después de lo que viene: es lo único de
          esta pantalla que se puede consumir HOY, sin decidir nada ni pagar
          nada. Un uchimata bien explicado convence más que una lista de
          tarifas. */}
      {(gym.routines.length > 0 || gym.membersOnlyRoutines > 0) && (
        <Stack gap={10} style={{ marginTop: 28 }}>
          <Eyebrow>Lo que enseñan</Eyebrow>
          <Text variant="micro" color={theme.colors.textFaint}>
            Rutinas y técnicas en video, abiertas para cualquiera.
          </Text>

          {gym.routines.map((row) => (
            <RoutineCard key={row.routine.id} row={row} slug={gym.slug} />
          ))}

          {/* El número, sin los títulos. Enseñar qué hay detrás regalaría la
              mitad del valor; decir cuánto hay es lo que vende la mensualidad. */}
          {gym.membersOnlyRoutines > 0 ? (
            <Card tone="sunken" radius={theme.radii.lg}>
              <Row gap={10} justify="flex-start">
                <Lock size={15} color={theme.colors.textSecondary} />
                <Text variant="captionSmall" color={theme.colors.textSecondary} style={{ flex: 1 }}>
                  {gym.membersOnlyRoutines === 1
                    ? 'Hay 1 rutina más solo para sus alumnos.'
                    : `Hay ${gym.membersOnlyRoutines} rutinas más solo para sus alumnos.`}
                </Text>
              </Row>
            </Card>
          ) : null}
        </Stack>
      )}

      {/* --- Precios -------------------------------------------------------- */}
      <Stack gap={10} style={{ marginTop: 28 }}>
        <Eyebrow>Precios</Eyebrow>
        {gym.plans.length === 0 ? (
          <Text variant="captionSmall" color={theme.colors.textTertiary}>
            Este gimnasio todavía no publicó sus planes.
          </Text>
        ) : (
          <Card radius={theme.radii.xl}>
            <Stack gap={12}>
              {gym.plans.map((plan) => (
                <Row key={plan.id}>
                  <Text variant="bodySmall">{plan.name}</Text>
                  <Text variant="bodySmall" weight="semibold">
                    {formatPEN(plan.priceCents)}
                  </Text>
                </Row>
              ))}
              {/* La clase suelta no es un plan —no crea suscripción ni fecha de
                  cobro— pero es media lista de precios en un gimnasio que vende
                  por sesión, y sin esto no salía por ningún lado. */}
              {gym.dropInPriceCents !== null && gym.dropInPriceCents > 0 ? (
                <Row>
                  <Text variant="bodySmall">Clase suelta</Text>
                  <Text variant="bodySmall" weight="semibold">
                    {formatPEN(cents(gym.dropInPriceCents))}
                  </Text>
                </Row>
              ) : null}
              {gym.enrollmentFeeCents > 0 ? (
                <Row>
                  <Text variant="captionSmall" color={theme.colors.textSecondary}>
                    Matrícula, una sola vez
                  </Text>
                  <Text variant="captionSmall" color={theme.colors.textSecondary}>
                    {formatPENShort(cents(gym.enrollmentFeeCents))}
                  </Text>
                </Row>
              ) : null}
            </Stack>
          </Card>
        )}
      </Stack>

      <View style={{ height: 16 }} />
    </Screen>
  );
}

const LIVE_TITLE: Readonly<Record<BookingKind, string>> = {
  trial: 'Ya tienes tu clase de prueba reservada',
  drop_in: 'Tienes una clase suelta reservada',
  enrollment: 'Tu inscripción está reservada',
};

/**
 * Qué se paga y dónde, dicho para quien reservó.
 *
 * En la inscripción, además, que la mensualidad cuenta desde el día que llegue:
 * quien reservó el martes y solo puede el jueves no tiene que mover nada para no
 * perder dos días de mes.
 */
function paymentNote(booking: ClassBookingDto): string {
  const price = cents(booking.priceCents ?? 0);
  switch (kindOf(booking)) {
    case 'enrollment': {
      const fee = cents(booking.enrollmentFeeCents ?? 0);
      return ` En recepción terminas tu inscripción: ${booking.planName ?? 'tu plan'}, ${formatPEN(price)} al mes${
        fee > 0 ? ` y ${formatPEN(fee)} de matrícula` : ''
      }. Si llegas otro día, tu mensualidad empieza ese día.`;
    }
    case 'drop_in':
      return ` Pagas ${formatPEN(price)} en recepción al llegar.`;
    case 'trial':
      return price === 0 ? ' Te esperan.' : ` Te esperan. Se paga en el local: ${formatPEN(price)}.`;
  }
}

/** Una reserva que tiene en pie en este gimnasio. */
function LiveBookingCard({
  booking,
  switching,
  canSwitch,
  onToggleSwitch,
}: {
  readonly booking: ClassBookingDto;
  readonly switching: boolean;
  readonly canSwitch: boolean;
  readonly onToggleSwitch: () => void;
}) {
  const theme = useTheme();

  return (
    <Card
      accent={theme.semaphore.ok}
      borderColor={withAlpha(theme.semaphore.ok, 0.26)}
      radius={theme.radii.xl}
    >
      <Stack gap={6}>
        <Text variant="bodySmall" weight="semibold">
          {LIVE_TITLE[kindOf(booking)]}
        </Text>
        <Text variant="caption" color={theme.colors.textSecondary}>
          {booking.className} · {formatWeekdayAndDay(booking.date)} a las {booking.startTime}.
          {paymentNote(booking)}
        </Text>
        {/* La salida que faltaba. Antes, desde aquí, lo único que se podía
            hacer con una reserva hecha era cancelarla — y quien solo quería
            otra hora acababa soltando el cupo para volver a pedirlo. */}
        {canSwitch ? (
          <Pressable
            accessibilityRole="button"
            hitSlop={10}
            style={{ alignSelf: 'flex-start', paddingTop: 4 }}
            onPress={onToggleSwitch}
          >
            <Text variant="captionSmall" weight="semibold" color={theme.semaphore.ok}>
              {switching ? 'Dejarlo como está' : 'Cambiar la hora'}
            </Text>
          </Pressable>
        ) : null}
      </Stack>
    </Card>
  );
}

/** La reserva que acaba de hacer: lo que tiene que saber para llegar. */
function BookedCard({
  booking,
  onAnother,
}: {
  readonly booking: ClassBookingDto;
  readonly onAnother: () => void;
}) {
  const theme = useTheme();
  const price = cents(booking.priceCents ?? 0);
  const kind = kindOf(booking);

  const foot =
    kind === 'enrollment'
      ? 'En recepción terminas tu inscripción y pagas tu primer mes. Tu mensualidad empieza el día que llegues, aunque no sea este.'
      : kind === 'drop_in'
        ? `Llega unos minutos antes y paga ${formatPEN(price)} en recepción.`
        : price === 0
          ? 'Llega unos minutos antes y di que vienes por tu clase de prueba.'
          : `Llega unos minutos antes. La clase se paga en el local: ${formatPEN(price)}.`;

  return (
    <Card
      accent={theme.semaphore.ok}
      borderColor={withAlpha(theme.semaphore.ok, 0.26)}
      radius={theme.radii.xl}
      style={{ marginTop: 22 }}
    >
      <Stack gap={6}>
        <Text variant="heading" weight="bold">
          Listo, te esperan
        </Text>
        <Text variant="caption" color={theme.colors.textSecondary}>
          {booking.className} · {formatWeekdayAndDay(booking.date)} a las {booking.startTime}. El
          gimnasio ya tiene tu nombre en su lista.
        </Text>
        <Text variant="captionSmall" color={theme.colors.textFaint}>
          {foot}
        </Text>
        <Pressable
          accessibilityRole="button"
          hitSlop={10}
          style={{ alignSelf: 'flex-start', paddingTop: 4 }}
          onPress={onAnother}
        >
          <Text variant="captionSmall" weight="semibold" color={theme.semaphore.ok}>
            Reservar otra clase
          </Text>
        </Pressable>
      </Stack>
    </Card>
  );
}

/** El motivo por el que no quedó hecho, en el sitio donde se tocó el botón. */
function Rejection({ outcome }: { readonly outcome: BookClassDto & { readonly booked: false } }) {
  const theme = useTheme();
  return (
    <Card
      accent={theme.semaphore.alert}
      borderColor={withAlpha(theme.semaphore.alert, 0.28)}
      radius={theme.radii.lg}
    >
      <Stack gap={4}>
        <Text variant="bodySmall" weight="semibold">
          {outcome.message.title}
        </Text>
        <Text variant="captionSmall" color={theme.colors.textSecondary}>
          {outcome.message.detail}
        </Text>
      </Stack>
    </Card>
  );
}

/** Una forma de venir. Se toca entera, como un radio. */
function KindCard({
  option,
  selected,
  onPress,
}: {
  readonly option: KindOption;
  readonly selected: boolean;
  readonly onPress: () => void;
}) {
  const theme = useTheme();
  const blocked = option.blocked !== null;

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled: blocked }}
      accessibilityLabel={`${option.title}, ${option.price}`}
      disabled={blocked}
      onPress={onPress}
    >
      <Card
        radius={theme.radii.lg}
        borderColor={selected ? theme.semaphore.ok : theme.colors.hairline}
        style={{ opacity: blocked ? 0.55 : 1 }}
      >
        <Row align="flex-start" gap={12}>
          <Stack gap={3} style={{ flex: 1 }}>
            <Text variant="bodySmall" weight="semibold">
              {option.title}
            </Text>
            <Text variant="captionSmall" color={theme.colors.textSecondary}>
              {option.blocked ?? option.detail}
            </Text>
          </Stack>
          <Text
            variant="bodySmall"
            weight="semibold"
            color={selected ? theme.semaphore.ok : theme.colors.ink}
          >
            {option.price}
          </Text>
        </Row>
      </Card>
    </Pressable>
  );
}

/**
 * El plan con el que dice que entra.
 *
 * Con el precio al mes a la vista y la matrícula debajo: es lo que va a pagar en
 * recepción, y enterarse allí de la matrícula es la discusión que esta lista
 * evita.
 */
function PlanPicker({
  plans,
  feeCents,
  picked,
  onPick,
}: {
  readonly plans: readonly Plan[];
  readonly feeCents: Cents;
  readonly picked: string | null;
  readonly onPick: (planId: string) => void;
}) {
  const theme = useTheme();

  return (
    <Stack gap={10} style={{ marginTop: 24 }}>
      <Eyebrow>Tu plan</Eyebrow>
      {plans.map((option) => {
        const active = option.id === picked;
        return (
          <Pressable
            key={option.id}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${option.name}, ${formatPEN(option.priceCents)} al mes`}
            onPress={() => onPick(option.id)}
          >
            <Card
              radius={theme.radii.lg}
              borderColor={active ? theme.semaphore.ok : theme.colors.hairline}
            >
              <Row>
                <Text variant="bodySmall" weight="semibold" style={{ flex: 1 }}>
                  {option.name}
                </Text>
                <Text
                  variant="bodySmall"
                  weight="semibold"
                  color={active ? theme.semaphore.ok : theme.colors.ink}
                >
                  {formatPEN(option.priceCents)} al mes
                </Text>
              </Row>
            </Card>
          </Pressable>
        );
      })}
      {feeCents > 0 ? (
        <Text variant="micro" color={theme.colors.textFaint}>
          Más {formatPEN(feeCents)} de matrícula, una sola vez. Todo se paga en recepción.
        </Text>
      ) : (
        <Text variant="micro" color={theme.colors.textFaint}>
          Sin matrícula. El primer mes se paga en recepción.
        </Text>
      )}
    </Stack>
  );
}

/**
 * Una rutina pública en la ficha del gimnasio.
 *
 * Con miniatura y no como una fila de texto: es la única cosa de esta pantalla
 * que se puede mirar ahora mismo, y una lista de títulos no invita a tocar
 * nada. La miniatura no cuesta ninguna subida — sale del propio enlace.
 */
function RoutineCard({
  row,
  slug,
}: {
  readonly row: RoutineListItem;
  readonly slug: string;
}) {
  const theme = useTheme();
  const { routine, itemCount, coverVideoUrl, hasVideo } = row;
  const meta = [
    shortLevel(routine.level),
    itemCount === 0 ? null : `${itemCount} ${itemCount === 1 ? 'paso' : 'pasos'}`,
  ]
    .filter((part) => part !== null)
    .join(' · ');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Abrir ${routine.title}`}
      onPress={() =>
        router.push({
          pathname: '/routines/[routineId]',
          params: { routineId: routine.id, slug },
        })
      }
    >
      <Card radius={theme.radii.xl}>
        <Stack gap={12}>
          {coverVideoUrl !== null ? (
            <PortadaDeVideo url={coverVideoUrl} height={150} />
          ) : hasVideo ? (
            <MarcadorDeVideo height={150} />
          ) : null}
          <Stack gap={3}>
            <Text variant="heading" weight="semibold" numberOfLines={2}>
              {routine.title}
            </Text>
            {routine.summary === null ? null : (
              <Text variant="captionSmall" color={theme.colors.textSecondary} numberOfLines={2}>
                {routine.summary}
              </Text>
            )}
            {/* Sin nivel y sin pasos no se dice nada: la miniatura ya cuenta que
                es un video, y una línea de relleno debajo del título hace que la
                tarjeta parezca tener menos, no más. */}
            {meta === '' ? null : (
              <Text variant="micro" color={theme.colors.textFaint}>
                {meta}
              </Text>
            )}
          </Stack>
        </Stack>
      </Card>
    </Pressable>
  );
}

/**
 * Un evento en la ficha del gimnasio.
 *
 * El precio que se enseña es EL QUE LE TOCA a quien mira: el de alumno si
 * entrena aquí, el de fuera si no. Enseñar los dos convierte una decisión de
 * cinco segundos en una tabla que hay que interpretar, y enseñar solo el de
 * alumno sería un precio que no va a pagar.
 */
function EventCard({
  row,
  slug,
  isStudent,
}: {
  readonly row: EventWithSeats;
  readonly slug: string;
  readonly isStudent: boolean;
}) {
  const theme = useTheme();
  const [submitting, setBooking] = useState(false);
  const [outcome, setOutcome] = useState<BookEventDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { event, seatsLeft } = row;
  const price = isStudent ? event.memberPriceCents : event.guestPriceCents;
  const full = seatsLeft !== null && seatsLeft === 0;
  const alreadyHas = outcome?.booked === true;

  return (
    <Card radius={theme.radii.xl}>
      <Stack gap={12}>
        <Row align="flex-start">
          <Stack gap={3} style={{ flex: 1, paddingRight: 12 }}>
            <Text variant="heading" weight="semibold">
              {event.name}
            </Text>
            <Text variant="captionSmall" color={theme.colors.textSecondary}>
              {formatEventDate(event.date)} · {event.startTime}–{event.endTime}
              {event.instructor === null ? '' : ` · con ${event.instructor}`}
            </Text>
            {event.description !== null && (
              <Text variant="captionSmall" color={theme.colors.textTertiary}>
                {event.description}
              </Text>
            )}
          </Stack>
          <Stack gap={1} style={{ alignItems: 'flex-end' }}>
            <Text variant="heading" weight="bold">
              {formatPEN(cents(price), { withDecimals: false })}
            </Text>
            {isStudent && event.guestPriceCents > event.memberPriceCents && (
              <Text variant="micro" color={theme.semaphore.ok}>
                precio de alumno
              </Text>
            )}
          </Stack>
        </Row>

        {/* Las plazas que quedan solo se dicen cuando aprietan: «quedan 28 de
            30» no mueve a nadie, «quedan 3» sí. */}
        {seatsLeft !== null && seatsLeft > 0 && seatsLeft <= 5 && (
          <Text variant="micro" color={theme.semaphore.warn}>
            Quedan {seatsLeft} {seatsLeft === 1 ? 'plaza' : 'plazas'}
          </Text>
        )}

        {alreadyHas ? (
          <Text variant="captionSmall" color={theme.semaphore.ok}>
            Tienes tu plaza. Se paga en el local.
          </Text>
        ) : full ? (
          <Text variant="captionSmall" color={theme.colors.textTertiary}>
            Se agotaron las plazas.
          </Text>
        ) : (
          <Button
            label={submitting ? 'Reservando…' : `Reservar mi plaza · ${formatPENShort(cents(price))}`}
            disabled={submitting}
            onPress={() => {
              setBooking(true);
              setError(null);
              void bookEventSeat({ slug, eventId: event.id })
                .then((outcome) => {
                  setOutcome(outcome);
                  if (!outcome.booked) {
                    setError(eventBookingDenialMessage(outcome.reason as never));
                  }
                })
                .catch((e: unknown) =>
                  setError(
                    e instanceof Error
                      ? e.message
                      : 'No se pudo reservar. Inténtalo otra vez.',
                  ),
                )
                .finally(() => setBooking(false));
            }}
          />
        )}

        {error !== null && (
          <Text variant="captionSmall" color={theme.semaphore.warn}>
            {error}
          </Text>
        )}
      </Stack>
    </Card>
  );
}

/**
 * El horario, con la misma forma que ve el alumno ya inscrito.
 *
 * Antes era una lista plana de doce filas «Jueves 20 · 19:00 · Fundamentos», y
 * leerla entera para responder «¿cuándo puedo ir?» es justo el trabajo que la
 * pantalla del alumno resolvió: una tira de días arriba, y debajo las clases del
 * día que tocas. Copiarla no es coherencia decorativa — el que reserva su clase
 * gratis hoy es el mismo que mañana mira su horario, y no debería aprender dos
 * lenguajes para la misma pregunta.
 *
 * Lo que cambia respecto de aquella: aquí cada día lleva FECHA. Reservar es un
 * compromiso con un martes concreto, no con «los martes», y de cada día de la
 * semana se ofrece su próxima fecha con clases — que puede ser hoy mismo, o el
 * martes que viene si el de hoy ya empezó.
 */
function Timetable({
  schedules,
  slots,
  picked,
  onPick,
  hoy,
}: {
  /** El horario semanal del gimnasio, completo. */
  readonly schedules: readonly ClassSchedule[];
  /** Las clases que además se pueden reservar, con fecha. Vacío = no se reserva. */
  readonly slots: readonly ClassSlot[];
  readonly picked: ClassSlot | null;
  readonly onPick: (slot: ClassSlot) => void;
  readonly hoy: PlainDate;
}) {
  const theme = useTheme();

  const disciplinas = useMemo(
    () => [...new Set(schedules.map((klass) => klass.name))].sort(),
    [schedules],
  );
  const [filtro, setFiltro] = useState<string | null>(null);

  const visibles = useMemo(
    () => (filtro === null ? schedules : schedules.filter((klass) => klass.name === filtro)),
    [schedules, filtro],
  );

  /** Las clases de cada día, ordenadas por hora. */
  const byDay = useMemo(() => {
    const maps = new Map<IsoWeekday, readonly ClassSchedule[]>();
    for (const day of allWeekdays()) {
      const ofTheDay = visibles
        .filter((klass) => klass.weekday === day)
        .slice()
        .sort((a, b) => a.startTime.localeCompare(b.startTime));
      if (ofTheDay.length > 0) maps.set(day, ofTheDay);
    }
    return maps;
  }, [visibles]);

  const firstDay = allWeekdays().find((day) => byDay.has(day)) ?? null;
  const [touched, setTouched] = useState<IsoWeekday | null>(null);
  const day = touched !== null && byDay.has(touched) ? touched : firstDay;
  const ofTheDay = day === null ? [] : (byDay.get(day) ?? []);

  /**
   * La próxima vez que toca ese día.
   *
   * El horario del gimnasio dice «los martes»; reservar exige un martes
   * concreto, así que la cabecera lleva fecha. Si hoy es martes, es hoy.
   */
  const date = day === null ? null : addDays(hoy, (day - isoWeekday(hoy) + 7) % 7);

  /** La misma clase, en esa fecha, si además se puede reservar. */
  const reservable = (klass: ClassSchedule): ClassSlot | null => {
    if (date === null) return null;
    const iso = formatPlainDate(date);
    return (
      slots.find(
        (slot) => slot.scheduleId === klass.id && formatPlainDate(slot.date) === iso,
      ) ?? null
    );
  };

  return (
    <Stack gap={10}>
      {/* El filtro solo aparece cuando hay algo que filtrar. En un dojo con una
          sola disciplina son chips que no deciden nada. */}
      {disciplinas.length > 1 ? (
        <Row justify="flex-start" style={{ flexWrap: 'wrap', gap: 8 }}>
          <Chip label="Todas" selected={filtro === null} onPress={() => setFiltro(null)} />
          {disciplinas.map((name) => (
            <Chip
              key={name}
              label={name}
              selected={filtro === name}
              onPress={() => {
                setFiltro(name);
                setTouched(null);
              }}
            />
          ))}
        </Row>
      ) : null}

      <Row gap={6} justify="flex-start">
        {allWeekdays().map((each) => {
          const exists = byDay.has(each);
          const active = each === day;

          return (
            <Pressable
              key={each}
              accessibilityRole="button"
              accessibilityState={{ selected: active, disabled: !exists }}
              accessibilityLabel={`${weekdayName(each)}${exists ? '' : ', sin clases'}`}
              onPress={exists ? () => setTouched(each) : undefined}
              style={{
                flex: 1,
                aspectRatio: 1,
                borderRadius: theme.radii.sm,
                alignItems: 'center',
                justifyContent: 'center',
                gap: 3,
                backgroundColor: exists ? theme.colors.surfaceHigh : theme.colors.surfaceSunken,
                borderWidth: active ? 1.5 : exists ? 0 : 1,
                borderStyle: active || exists ? 'solid' : 'dashed',
                borderColor: active ? theme.semaphore.ok : theme.colors.borderStrong,
              }}
            >
              <Text
                variant="caption"
                weight={exists ? 'bold' : 'semibold'}
                color={exists ? theme.colors.ink : theme.colors.textDisabled}
              >
                {weekdayInitial(each)}
              </Text>
              {/* El punto dice que ese día hay clase: sin él, un día vacío y uno
                  lleno se ven igual hasta tocarlos. */}
              <View
                style={{
                  width: 4,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: exists ? theme.semaphore.ok : 'transparent',
                }}
              />
            </Pressable>
          );
        })}
      </Row>

      {ofTheDay.length === 0 || date === null ? (
        <Card tone="sunken" radius={theme.radii.lg}>
          <Text variant="captionSmall" color={theme.colors.textSecondary}>
            {filtro === null
              ? 'Este gimnasio todavía no publicó sus horarios.'
              : `No hay ${filtro} en el horario.`}
          </Text>
        </Card>
      ) : (
        <Card padded={false} radius={theme.radii.xl}>
          <Row
            style={{ paddingHorizontal: 16, paddingTop: 13, paddingBottom: 4 }}
            gap={8}
            justify="flex-start"
          >
            <Text variant="captionSmall" weight="bold" color={theme.colors.textSecondary}>
              {mayuscula(weekdayName(isoWeekday(date)))} {formatLongDate(date)}
            </Text>
            {formatPlainDate(date) === formatPlainDate(hoy) ? (
              <Text variant="micro" weight="bold" color={theme.semaphore.ok}>
                HOY
              </Text>
            ) : null}
          </Row>

          <Stack gap={9} style={{ paddingHorizontal: 12, paddingBottom: 12, paddingTop: 4 }}>
            {ofTheDay.map((klass) => {
              const slot = reservable(klass);
              return (
                <ClassRow
                  key={klass.id}
                  klass={klass}
                  slot={slot}
                  selected={slot !== null && isTheSame(picked, slot)}
                  onPress={slot === null ? undefined : () => onPick(slot)}
                />
              );
            })}
          </Stack>
        </Card>
      )}
    </Stack>
  );
}

/**
 * Dos opciones son la misma clase si coinciden horario Y fecha.
 *
 * El `scheduleId` solo no basta —un horario se repite cada semana— y la fecha
 * sola tampoco: un día puede tener varias clases.
 */
const isTheSame = (picked: ClassSlot | null, option: ClassSlot): boolean =>
  picked !== null &&
  picked.scheduleId === option.scheduleId &&
  picked.date.year === option.date.year &&
  picked.date.month === option.date.month &&
  picked.date.day === option.date.day;

function AskTheGym({
  slug,
  gymName,
  topic,
}: {
  readonly slug: string;
  readonly gymName: string;
  readonly topic: ConversationTopic;
}) {
  const theme = useTheme();
  const blurb =
    topic === 'membership' || topic === 'drop_in'
      ? 'Tu plan, tus clases o tus pagos: pregúntaselo directo al gimnasio.'
      : topic === 'trial'
        ? 'Sobre tu clase de prueba: qué traer, cómo llegar, si puedes ir con alguien.'
        : 'Horarios, precios, si hay clase para principiantes o si se puede pagar por clase. Sin inscribirte a nada.';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Escribirle a ${gymName}`}
      onPress={() => router.push({ pathname: '/chat/[slug]', params: { slug, topic } })}
      style={{ marginTop: 18 }}
    >
      <Card radius={theme.radii.xl}>
        <Row style={{ gap: 12 }}>
          <MessageCircle size={22} color={theme.semaphore.ok} strokeWidth={2} />
          <Stack gap={3} style={{ flex: 1 }}>
            <Text variant="bodySmall" weight="semibold">
              Escríbeles
            </Text>
            <Text variant="captionSmall" color={theme.colors.textSecondary}>
              {blurb}
            </Text>
          </Stack>
          <Text variant="body" color={theme.colors.textTertiary}>
            ›
          </Text>
        </Row>
      </Card>
    </Pressable>
  );
}

function BackRow() {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Volver a la lista de gimnasios"
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/explore'))}
      hitSlop={16}
    >
      <Text variant="body" color={theme.colors.textSecondary}>
        ‹ Gimnasios
      </Text>
    </Pressable>
  );
}

/**
 * Una clase del día.
 *
 * Misma fila que el horario del alumno inscrito —nombre a la izquierda, hora a
 * la derecha—, y aquí además se toca cuando esa clase se puede reservar. Cuando
 * no —el gimnasio no acepta reservas, o esa de hoy ya empezó— se sigue viendo:
 * es su horario, y esconderlo sería mentir sobre cuándo abre.
 */
function ClassRow({
  klass,
  slot,
  selected,
  onPress,
}: {
  readonly klass: ClassSchedule;
  readonly slot: ClassSlot | null;
  readonly selected: boolean;
  readonly onPress?: (() => void) | undefined;
}) {
  const theme = useTheme();
  const reservable = slot !== null && onPress !== undefined;

  const contenido = (
    <Row gap={12}>
      <Stack gap={2} style={{ flex: 1 }}>
        <Text
          variant="bodySmall"
          weight={selected ? 'semibold' : 'regular'}
          color={reservable ? theme.colors.ink : theme.colors.textSecondary}
        >
          {klass.name}
        </Text>
        {klass.instructor === null ? null : (
          <Text variant="micro" color={theme.colors.textFaint}>
            {klass.instructor}
          </Text>
        )}
      </Stack>
      {selected ? (
        <Text variant="captionSmall" weight="bold" color={theme.semaphore.ok}>
          ELEGIDA
        </Text>
      ) : null}
      <Text
        variant="bodySmall"
        weight="semibold"
        color={reservable ? theme.colors.textStrong : theme.colors.textTertiary}
      >
        {klass.startTime} – {klass.endTime}
      </Text>
    </Row>
  );

  if (!reservable) {
    return <View style={{ paddingHorizontal: 8, paddingVertical: 10 }}>{contenido}</View>;
  }

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${klass.name}, de ${klass.startTime} a ${klass.endTime}`}
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: selected ? withAlpha(theme.semaphore.ok, 0.14) : 'transparent',
        borderWidth: 1,
        borderColor: selected ? withAlpha(theme.semaphore.ok, 0.5) : 'transparent',
        borderRadius: theme.radii.lg,
        paddingHorizontal: 8,
        paddingVertical: 10,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      {contenido}
    </Pressable>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
  keyboardType,
  pie,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (text: string) => void;
  readonly placeholder?: string;
  readonly keyboardType?: 'phone-pad';
  readonly pie?: string;
}) {
  const theme = useTheme();
  return (
    <Stack gap={4}>
      <Text variant="captionSmall" color={theme.colors.textTertiary}>
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.textPlaceholder}
        keyboardType={keyboardType}
        autoCapitalize={keyboardType === 'phone-pad' ? 'none' : 'words'}
        style={{
          color: theme.colors.ink,
          fontSize: 16,
          paddingVertical: 9,
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.hairline,
        }}
      />
      {pie === undefined ? null : (
        <Text variant="micro" color={theme.colors.textFaint}>
          {pie}
        </Text>
      )}
    </Stack>
  );
}

const mayuscula = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
