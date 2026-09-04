/**
 * La página del gimnasio, y la reserva de la clase gratis.
 *
 * Responde las tres preguntas de quien todavía no entrena en ningún sitio —qué
 * se entrena, cuándo y cuánto cuesta— y le da la única acción que puede tomar
 * hoy: venir a probar un día concreto.
 *
 * La reserva se pide con **fecha y hora**, no "cuando pueda". Es lo que la
 * convierte en algo útil para el gimnasio: una lista de quién viene el martes a
 * las 19:00 se puede preparar; «alguien está interesado» no.
 *
 * El veredicto lo da el servidor con la misma función pura que decide qué se
 * ofrece aquí (`@sinchi/shared`), así que lo que la pantalla muestra es lo que
 * la api acepta.
 */
import { useMemo, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import {
  addDays,
  allWeekdays,
  cents,
  eventBookingDenialMessage,
  formatPEN,
  formatPENShort,
  formatPlainDate,
  isoWeekday,
  weekdayInitial,
  weekdayName,
  type ClassSchedule,
  type IsoWeekday,
  type PlainDate,
  type TrialSlot,
} from '@sinchi/shared';
import { withAlpha } from '@sinchi/ui';
import Lock from 'lucide-react-native/icons/lock';
import { Badge, Button, Card, Chip, Eyebrow, Row, Stack, Text } from '../../src/design/primitives';
import { MarcadorDeVideo, PortadaDeVideo } from '../../src/design/video';
import { Screen } from '../../src/design/screen';
import { EstadoSinConexion } from '../../src/design/empty';
import { CargandoSeccion } from '../../src/design/loading';
import { useTheme } from '../../src/design/theme';
import { useGym, useMisClasesGratis, useToday, useWallet } from '../../src/data/hooks';
import {
  cuentaParaReservar,
  necesitaDatos,
  reservarClaseGratis,
  reservarPlazaEnEvento,
} from '../../src/data/trials';
import type { BookEventDto, BookTrialDto, EventoConCupo, RutinaEnLista } from '../../src/data/api';
import {
  formatEventDate,
  formatLongDate,
  formatWeekdayAndDay,
  nivelCorto,
} from '../../src/lib/format';

export default function GymScreen() {
  const theme = useTheme();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { datos: gym, cargando, error, recargar } = useGym(slug ?? '');
  const reservas = useMisClasesGratis();
  const billetera = useWallet();
  const hoy = useToday();

  const [slot, setSlot] = useState<TrialSlot | null>(null);
  const [nombre, setNombre] = useState('');
  const [celular, setCelular] = useState('+51');
  const [reservando, setReservando] = useState(false);
  const [salida, setSalida] = useState<BookTrialDto | null>(null);

  const cuenta = cuentaParaReservar();
  // Solo si de verdad no sabemos quién es. Con identidad Sinchi los datos están
  // en el padrón; sin ficha, en lo que escribió al crear su cuenta. Preguntar
  // otra vez lo que la persona acaba de dar convierte la reserva en un trámite.
  const pideDatos = necesitaDatos();
  const yaReservada = reservas.datos.find(
    (reserva) => reserva.gymSlug === slug && reserva.status === 'booked',
  );

  if (cargando && gym === null) return <CargandoSeccion texto="Abriendo el gimnasio…" />;

  if (gym === null) {
    return (
      <Screen>
        <Row style={{ paddingTop: 8 }}>
          <Volver />
        </Row>
        <View style={{ flex: 1 }}>
          <EstadoSinConexion
            titulo="No se pudo abrir este gimnasio"
            cuerpo="No llegamos al servidor. Vuelve a intentarlo en un momento."
            error={error ?? 'Este gimnasio no está disponible.'}
            onReintentar={recargar}
          />
        </View>
      </Screen>
    );
  }

  const puedeReservar = gym.trialClassEnabled && gym.slots.length > 0;
  // `?? 0` porque la app se actualiza sola y la api no: contra un despliegue
  // viejo el campo no viene, y «PRUEBA undefined» es peor que asumir gratis.
  const precioCents = gym.trialClassPriceCents ?? 0;
  const gratis = precioCents === 0;
  const precio = formatPEN(cents(precioCents));
  /** Para la insignia y el botón, donde «S/ 40.00» se come media línea. */
  const precioCorto = formatPENShort(cents(precioCents));
  /**
   * Ya entrena aquí.
   *
   * La api lo rechaza igual —`already_member`, la clase gratis es para conocer
   * un local nuevo— pero enterarse DESPUÉS de elegir día y hora es que la
   * pantalla te haga trabajar para nada. La billetera ya sabe la respuesta.
   */
  const esAlumno = billetera.some(
    (entrada) =>
      entrada.tenant.id === gym.id && entrada.subscription.status !== 'canceled',
  );

  /**
   * Se ofrece reservar solo a quien de verdad puede.
   *
   * Quien ya entrena ahí, quien ya reservó o quien acaba de reservar sigue
   * viendo el horario entero —es información del gimnasio— pero sin filas que se
   * toquen: ofrecerle elegir una hora para después decirle que no es hacerle
   * trabajar para nada.
   */
  const puedeOfrecer =
    puedeReservar && !esAlumno && yaReservada === undefined && !(salida?.booked ?? false);

  const confirmar = (): void => {
    if (slot === null) return;
    setReservando(true);
    setSalida(null);

    // Solo se mandan si la pantalla los pidió. Mandar los campos vacíos —que es
    // lo que hay cuando no se enseñaron— tapaba lo que ya sabíamos de la persona
    // y la api rechazaba la reserva por «nombre demasiado corto».
    void reservarClaseGratis({
      slug: gym.slug,
      slot,
      ...(pideDatos ? { fullName: nombre, phone: celular } : {}),
    })
      .then((resultado) => {
        setSalida(resultado);
        if (resultado.booked) {
          setSlot(null);
          reservas.recargar();
        }
      })
      .catch((causa: unknown) => {
        // Un fallo de red no es un rechazo del gimnasio, pero se enseña en el
        // mismo sitio: quien reserva solo necesita saber que no quedó hecho.
        setSalida({
          booked: false,
          reason: { code: 'slot_not_available' },
          message: {
            title: 'No se pudo reservar',
            detail: causa instanceof Error ? causa.message : 'Intenta de nuevo.',
          },
        });
      })
      .finally(() => setReservando(false));
  };

  return (
    <Screen scroll>
      <Row style={{ paddingTop: 8 }}>
        <Volver />
        {gym.trialClassEnabled ? (
          <Badge
            label={gratis ? '1 CLASE GRATIS' : `PRUEBA ${precioCorto}`}
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

      {/* --- Reservar, si toca ---------------------------------------------- */}
      {esAlumno ? (
        <Card tone="sunken" radius={theme.radii.xl} style={{ marginTop: 22 }}>
          <Stack gap={6}>
            <Text variant="bodySmall" weight="semibold">
              Ya entrenas aquí
            </Text>
            <Text variant="caption" color={theme.colors.textSecondary}>
              Tu membresía está en la billetera. La clase de prueba es para conocer un
              gimnasio nuevo.
            </Text>
          </Stack>
        </Card>
      ) : yaReservada !== undefined ? (
        <Card
          accent={theme.semaphore.ok}
          borderColor={withAlpha(theme.semaphore.ok, 0.26)}
          radius={theme.radii.xl}
          style={{ marginTop: 22 }}
        >
          <Stack gap={6}>
            <Text variant="bodySmall" weight="semibold">
              Ya tienes tu clase reservada
            </Text>
            <Text variant="caption" color={theme.colors.textSecondary}>
              {yaReservada.className} · {formatWeekdayAndDay(yaReservada.date)} a las{' '}
              {yaReservada.startTime}. Te esperan.
              {(yaReservada.priceCents ?? 0) === 0
                ? ''
                : ` Se paga en el local: ${formatPEN(cents(yaReservada.priceCents))}.`}
            </Text>
          </Stack>
        </Card>
      ) : salida !== null && salida.booked ? (
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
              {salida.booking.className} · {formatWeekdayAndDay(salida.booking.date)} a las{' '}
              {salida.booking.startTime}. El gimnasio ya tiene tu nombre en su lista.
            </Text>
            <Text variant="captionSmall" color={theme.colors.textFaint}>
              {(salida.booking.priceCents ?? 0) === 0
                ? 'Llega unos minutos antes y di que vienes por tu clase de prueba.'
                : `Llega unos minutos antes. La clase se paga en el local: ${formatPEN(
                    cents(salida.booking.priceCents),
                  )}.`}
            </Text>
          </Stack>
        </Card>
      ) : null}

      {/* --- El horario, que es también el selector --------------------------
          Antes eran dos cosas: una tira de días para reservar y, más abajo, una
          lista plana con el horario del gimnasio. Dos formas de contar lo mismo
          en la misma pantalla, y la de abajo obligaba a leer catorce filas para
          responder «¿cuándo puedo ir?». Ahora es un solo horario, y sus filas se
          tocan cuando esa clase se puede reservar. */}
      <Stack gap={12} style={{ marginTop: 24 }}>
        <Eyebrow>
          {!gym.trialClassEnabled
            ? 'Horarios'
            : gratis
              ? 'Tu primera clase, gratis'
              : 'Reserva tu clase de prueba'}
        </Eyebrow>

        {!gym.trialClassEnabled ? (
          <Text variant="captionSmall" color={theme.colors.textSecondary}>
            Este gimnasio no toma reservas por la app. Puedes acercarte al local en
            cualquiera de estos horarios.
          </Text>
        ) : puedeOfrecer ? (
          <Text variant="captionSmall" color={theme.colors.textSecondary}>
            {gratis
              ? 'Elige el día y la hora a la que vendrás. El gimnasio recibe el aviso al instante.'
              : `Elige el día y la hora. Reservas tu sitio y pagas ${precio} al llegar; el gimnasio recibe el aviso al instante.`}
          </Text>
        ) : null}

        <Horario
          schedules={gym.schedules}
          slots={puedeOfrecer ? gym.slots : []}
          elegida={slot}
          onElegir={setSlot}
          hoy={hoy}
        />

        {puedeOfrecer && cuenta.kind === 'none' ? (
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

        {puedeOfrecer && cuenta.kind !== 'none' ? (
          <>
            {pideDatos ? (
              <Card radius={theme.radii.xl}>
                <Stack gap={14}>
                  <Campo
                    etiqueta="Tu nombre"
                    valor={nombre}
                    onChange={setNombre}
                    placeholder="Nombre y apellido"
                  />
                  <Campo
                    etiqueta="Tu celular"
                    valor={celular}
                    onChange={setCelular}
                    placeholder="+51987654321"
                    keyboardType="phone-pad"
                    pie="Es con lo que el gimnasio te reconoce al llegar."
                  />
                </Stack>
              </Card>
            ) : null}

            {salida !== null && !salida.booked ? (
              <Card
                accent={theme.semaphore.alert}
                borderColor={withAlpha(theme.semaphore.alert, 0.28)}
                radius={theme.radii.lg}
              >
                <Stack gap={4}>
                  <Text variant="bodySmall" weight="semibold">
                    {salida.message.title}
                  </Text>
                  <Text variant="captionSmall" color={theme.colors.textSecondary}>
                    {salida.message.detail}
                  </Text>
                </Stack>
              </Card>
            ) : null}

            <Button
              label={
                reservando
                  ? 'Reservando…'
                  : gratis
                    ? 'Reservar mi clase gratis'
                    : `Reservar mi clase · ${precioCorto}`
              }
              disabled={
                slot === null ||
                reservando ||
                (pideDatos && (nombre.trim().length < 2 || celular.trim().length < 7))
              }
              onPress={confirmar}
            />
          </>
        ) : null}

        {gym.trialClassEnabled && gym.slots.length === 0 && gym.schedules.length > 0 ? (
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
          {gym.events.map((fila) => (
            <TarjetaDeEvento
              key={fila.event.id}
              fila={fila}
              slug={gym.slug}
              esAlumno={esAlumno}
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

          {gym.routines.map((fila) => (
            <TarjetaDeRutina key={fila.routine.id} fila={fila} slug={gym.slug} />
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

/**
 * Una rutina pública en la ficha del gimnasio.
 *
 * Con miniatura y no como una fila de texto: es la única cosa de esta pantalla
 * que se puede mirar ahora mismo, y una lista de títulos no invita a tocar
 * nada. La miniatura no cuesta ninguna subida — sale del propio enlace.
 */
function TarjetaDeRutina({
  fila,
  slug,
}: {
  readonly fila: RutinaEnLista;
  readonly slug: string;
}) {
  const theme = useTheme();
  const { routine, itemCount, coverVideoUrl, hasVideo } = fila;
  const meta = [
    nivelCorto(routine.level),
    itemCount === 0 ? null : `${itemCount} ${itemCount === 1 ? 'paso' : 'pasos'}`,
  ]
    .filter((parte) => parte !== null)
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
            <PortadaDeVideo url={coverVideoUrl} alto={150} />
          ) : hasVideo ? (
            <MarcadorDeVideo alto={150} />
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
function TarjetaDeEvento({
  fila,
  slug,
  esAlumno,
}: {
  readonly fila: EventoConCupo;
  readonly slug: string;
  readonly esAlumno: boolean;
}) {
  const theme = useTheme();
  const [reservando, setReservando] = useState(false);
  const [resultado, setResultado] = useState<BookEventDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { event, seatsLeft } = fila;
  const precio = esAlumno ? event.memberPriceCents : event.guestPriceCents;
  const lleno = seatsLeft !== null && seatsLeft === 0;
  const yaTiene = resultado?.booked === true;

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
              {formatPEN(cents(precio), { withDecimals: false })}
            </Text>
            {esAlumno && event.guestPriceCents > event.memberPriceCents && (
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

        {yaTiene ? (
          <Text variant="captionSmall" color={theme.semaphore.ok}>
            Tienes tu plaza. Se paga en el local.
          </Text>
        ) : lleno ? (
          <Text variant="captionSmall" color={theme.colors.textTertiary}>
            Se agotaron las plazas.
          </Text>
        ) : (
          <Button
            label={reservando ? 'Reservando…' : `Reservar mi plaza · ${formatPENShort(cents(precio))}`}
            disabled={reservando}
            onPress={() => {
              setReservando(true);
              setError(null);
              void reservarPlazaEnEvento({ slug, eventId: event.id })
                .then((salida) => {
                  setResultado(salida);
                  if (!salida.booked) {
                    setError(eventBookingDenialMessage(salida.reason as never));
                  }
                })
                .catch((e: unknown) =>
                  setError(
                    e instanceof Error
                      ? e.message
                      : 'No se pudo reservar. Inténtalo otra vez.',
                  ),
                )
                .finally(() => setReservando(false));
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
function Horario({
  schedules,
  slots,
  elegida,
  onElegir,
  hoy,
}: {
  /** El horario semanal del gimnasio, completo. */
  readonly schedules: readonly ClassSchedule[];
  /** Las clases que además se pueden reservar, con fecha. Vacío = no se reserva. */
  readonly slots: readonly TrialSlot[];
  readonly elegida: TrialSlot | null;
  readonly onElegir: (slot: TrialSlot) => void;
  readonly hoy: PlainDate;
}) {
  const theme = useTheme();

  const disciplinas = useMemo(
    () => [...new Set(schedules.map((clase) => clase.name))].sort(),
    [schedules],
  );
  const [filtro, setFiltro] = useState<string | null>(null);

  const visibles = useMemo(
    () => (filtro === null ? schedules : schedules.filter((clase) => clase.name === filtro)),
    [schedules, filtro],
  );

  /** Las clases de cada día, ordenadas por hora. */
  const porDia = useMemo(() => {
    const mapa = new Map<IsoWeekday, readonly ClassSchedule[]>();
    for (const dia of allWeekdays()) {
      const delDia = visibles
        .filter((clase) => clase.weekday === dia)
        .slice()
        .sort((a, b) => a.startTime.localeCompare(b.startTime));
      if (delDia.length > 0) mapa.set(dia, delDia);
    }
    return mapa;
  }, [visibles]);

  const primerDia = allWeekdays().find((dia) => porDia.has(dia)) ?? null;
  const [tocado, setTocado] = useState<IsoWeekday | null>(null);
  const dia = tocado !== null && porDia.has(tocado) ? tocado : primerDia;
  const delDia = dia === null ? [] : (porDia.get(dia) ?? []);

  /**
   * La próxima vez que toca ese día.
   *
   * El horario del gimnasio dice «los martes»; reservar exige un martes
   * concreto, así que la cabecera lleva fecha. Si hoy es martes, es hoy.
   */
  const fecha = dia === null ? null : addDays(hoy, (dia - isoWeekday(hoy) + 7) % 7);

  /** La misma clase, en esa fecha, si además se puede reservar. */
  const reservable = (clase: ClassSchedule): TrialSlot | null => {
    if (fecha === null) return null;
    const iso = formatPlainDate(fecha);
    return (
      slots.find(
        (slot) => slot.scheduleId === clase.id && formatPlainDate(slot.date) === iso,
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
          {disciplinas.map((nombre) => (
            <Chip
              key={nombre}
              label={nombre}
              selected={filtro === nombre}
              onPress={() => {
                setFiltro(nombre);
                setTocado(null);
              }}
            />
          ))}
        </Row>
      ) : null}

      <Row gap={6} justify="flex-start">
        {allWeekdays().map((cada) => {
          const hay = porDia.has(cada);
          const activo = cada === dia;

          return (
            <Pressable
              key={cada}
              accessibilityRole="button"
              accessibilityState={{ selected: activo, disabled: !hay }}
              accessibilityLabel={`${weekdayName(cada)}${hay ? '' : ', sin clases'}`}
              onPress={hay ? () => setTocado(cada) : undefined}
              style={{
                flex: 1,
                aspectRatio: 1,
                borderRadius: theme.radii.sm,
                alignItems: 'center',
                justifyContent: 'center',
                gap: 3,
                backgroundColor: hay ? theme.colors.surfaceHigh : theme.colors.surfaceSunken,
                borderWidth: activo ? 1.5 : hay ? 0 : 1,
                borderStyle: activo || hay ? 'solid' : 'dashed',
                borderColor: activo ? theme.semaphore.ok : theme.colors.borderStrong,
              }}
            >
              <Text
                variant="caption"
                weight={hay ? 'bold' : 'semibold'}
                color={hay ? theme.colors.ink : theme.colors.textDisabled}
              >
                {weekdayInitial(cada)}
              </Text>
              {/* El punto dice que ese día hay clase: sin él, un día vacío y uno
                  lleno se ven igual hasta tocarlos. */}
              <View
                style={{
                  width: 4,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: hay ? theme.semaphore.ok : 'transparent',
                }}
              />
            </Pressable>
          );
        })}
      </Row>

      {delDia.length === 0 || fecha === null ? (
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
              {mayuscula(weekdayName(isoWeekday(fecha)))} {formatLongDate(fecha)}
            </Text>
            {formatPlainDate(fecha) === formatPlainDate(hoy) ? (
              <Text variant="micro" weight="bold" color={theme.semaphore.ok}>
                HOY
              </Text>
            ) : null}
          </Row>

          <Stack gap={9} style={{ paddingHorizontal: 12, paddingBottom: 12, paddingTop: 4 }}>
            {delDia.map((clase) => {
              const slot = reservable(clase);
              return (
                <ClaseRow
                  key={clase.id}
                  clase={clase}
                  slot={slot}
                  selected={slot !== null && esLaMisma(elegida, slot)}
                  onPress={slot === null ? undefined : () => onElegir(slot)}
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
const esLaMisma = (elegida: TrialSlot | null, opcion: TrialSlot): boolean =>
  elegida !== null &&
  elegida.scheduleId === opcion.scheduleId &&
  elegida.date.year === opcion.date.year &&
  elegida.date.month === opcion.date.month &&
  elegida.date.day === opcion.date.day;

function Volver() {
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
function ClaseRow({
  clase,
  slot,
  selected,
  onPress,
}: {
  readonly clase: ClassSchedule;
  readonly slot: TrialSlot | null;
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
          {clase.name}
        </Text>
        {clase.instructor === null ? null : (
          <Text variant="micro" color={theme.colors.textFaint}>
            {clase.instructor}
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
        {clase.startTime} – {clase.endTime}
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
      accessibilityLabel={`${clase.name}, de ${clase.startTime} a ${clase.endTime}`}
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

function Campo({
  etiqueta,
  valor,
  onChange,
  placeholder,
  keyboardType,
  pie,
}: {
  readonly etiqueta: string;
  readonly valor: string;
  readonly onChange: (texto: string) => void;
  readonly placeholder?: string;
  readonly keyboardType?: 'phone-pad';
  readonly pie?: string;
}) {
  const theme = useTheme();
  return (
    <Stack gap={4}>
      <Text variant="captionSmall" color={theme.colors.textTertiary}>
        {etiqueta}
      </Text>
      <TextInput
        value={valor}
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

const mayuscula = (texto: string): string => `${texto.charAt(0).toUpperCase()}${texto.slice(1)}`;
