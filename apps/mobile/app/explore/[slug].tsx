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
  allWeekdays,
  cents,
  formatPEN,
  formatPENShort,
  formatPlainDate,
  isoWeekday,
  weekdayInitial,
  weekdayName,
  type IsoWeekday,
  type PlainDate,
  type TrialSlot,
} from '@sinchi/shared';
import { withAlpha } from '@sinchi/ui';
import { Badge, Button, Card, Chip, Eyebrow, Row, Stack, Text } from '../../src/design/primitives';
import { Screen } from '../../src/design/screen';
import { EstadoSinConexion } from '../../src/design/empty';
import { CargandoSeccion } from '../../src/design/loading';
import { useTheme } from '../../src/design/theme';
import { useGym, useMisClasesGratis, useWallet } from '../../src/data/hooks';
import { cuentaParaReservar, necesitaDatos, reservarClaseGratis } from '../../src/data/trials';
import type { BookTrialDto } from '../../src/data/api';
import { formatLongDate, formatWeekdayAndDay } from '../../src/lib/format';

export default function GymScreen() {
  const theme = useTheme();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { datos: gym, cargando, error, recargar } = useGym(slug ?? '');
  const reservas = useMisClasesGratis();
  const billetera = useWallet();

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
            label="1 CLASE GRATIS"
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

      {/* --- La clase gratis ------------------------------------------------ */}
      {esAlumno ? (
        <Card tone="sunken" radius={theme.radii.xl} style={{ marginTop: 22 }}>
          <Stack gap={6}>
            <Text variant="bodySmall" weight="semibold">
              Ya entrenas aquí
            </Text>
            <Text variant="caption" color={theme.colors.textSecondary}>
              Tu membresía está en la billetera. La clase gratis es para conocer un
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
              Llega unos minutos antes y di que vienes por tu clase gratis.
            </Text>
          </Stack>
        </Card>
      ) : (
        <Stack gap={12} style={{ marginTop: 24 }}>
          {/* El titulillo cambia con el interruptor del gimnasio: «Tu primera
              clase, gratis» encima de «este gimnasio no la ofrece» se
              contradice a sí mismo. */}
          <Eyebrow>{gym.trialClassEnabled ? 'Tu primera clase, gratis' : 'Clase de prueba'}</Eyebrow>

          {!gym.trialClassEnabled ? (
            <Card tone="sunken" radius={theme.radii.lg}>
              <Text variant="captionSmall" color={theme.colors.textSecondary}>
                Este gimnasio no ofrece clase de prueba por la app. Puedes acercarte al
                local en cualquiera de sus horarios.
              </Text>
            </Card>
          ) : gym.slots.length === 0 ? (
            <Card tone="sunken" radius={theme.radii.lg}>
              <Text variant="captionSmall" color={theme.colors.textSecondary}>
                Todavía no hay clases publicadas para las próximas dos semanas.
              </Text>
            </Card>
          ) : cuenta.kind === 'none' ? (
            <Stack gap={10}>
              <Card tone="sunken" radius={theme.radii.lg}>
                <Text variant="captionSmall" color={theme.colors.textSecondary}>
                  Entra con tu correo o con Google para reservar. Hace falta solo para que
                  el gimnasio sepa a quién esperar.
                </Text>
              </Card>
              <Button label="Entrar y reservar" onPress={() => router.push('/login')} />
            </Stack>
          ) : (
            <Stack gap={12}>
              <Text variant="captionSmall" color={theme.colors.textSecondary}>
                Elige el día y la hora a la que vendrás. El gimnasio recibe el aviso al
                instante.
              </Text>

              <Horario slots={gym.slots} elegida={slot} onElegir={setSlot} />

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
                label={reservando ? 'Reservando…' : 'Reservar mi clase gratis'}
                disabled={
                  !puedeReservar ||
                  slot === null ||
                  reservando ||
                  (pideDatos && (nombre.trim().length < 2 || celular.trim().length < 7))
                }
                onPress={confirmar}
              />
            </Stack>
          )}
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

      {/* --- Horarios ------------------------------------------------------- */}
      <Stack gap={10} style={{ marginTop: 26, marginBottom: 8 }}>
        <Eyebrow>Horarios</Eyebrow>
        {gym.schedules.length === 0 ? (
          <Text variant="captionSmall" color={theme.colors.textTertiary}>
            Este gimnasio opera con horario libre.
          </Text>
        ) : (
          <Card radius={theme.radii.xl}>
            <Stack gap={12}>
              {gym.schedules.map((clase) => (
                <Row key={clase.id} align="flex-start" style={{ gap: 12 }}>
                  <Stack gap={2} style={{ flex: 1 }}>
                    <Text variant="bodySmall">{clase.name}</Text>
                    <Text variant="captionSmall" color={theme.colors.textTertiary}>
                      {mayuscula(weekdayName(clase.weekday))}
                      {clase.instructor === null ? '' : ` · ${clase.instructor}`}
                    </Text>
                  </Stack>
                  <Text variant="captionSmall" color={theme.colors.textSecondary}>
                    {clase.startTime}–{clase.endTime}
                  </Text>
                </Row>
              ))}
            </Stack>
          </Card>
        )}
      </Stack>
    </Screen>
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
  slots,
  elegida,
  onElegir,
}: {
  readonly slots: readonly TrialSlot[];
  readonly elegida: TrialSlot | null;
  readonly onElegir: (slot: TrialSlot) => void;
}) {
  const theme = useTheme();

  /** Las disciplinas que de verdad tienen hueco, no todas las del gimnasio. */
  const disciplinas = useMemo(
    () => [...new Set(slots.map((slot) => slot.name))].sort(),
    [slots],
  );
  const [filtro, setFiltro] = useState<string | null>(null);

  const visibles = useMemo(
    () => (filtro === null ? slots : slots.filter((slot) => slot.name === filtro)),
    [slots, filtro],
  );

  /**
   * Por día de la semana, su PRÓXIMA fecha con clases.
   *
   * No es siempre «dentro de menos de siete días»: si las clases de hoy ya
   * empezaron, el próximo lunes es el de la semana que viene, y la cabecera lo
   * dice con su fecha en vez de dejar el día vacío.
   */
  const proximas = useMemo(() => {
    const mapa = new Map<IsoWeekday, readonly TrialSlot[]>();
    for (const dia of allWeekdays()) {
      const delDia = visibles.filter((slot) => isoWeekday(slot.date) === dia);
      if (delDia.length === 0) continue;

      const primera = delDia.reduce((a, b) => (formatPlainDate(a.date) <= formatPlainDate(b.date) ? a : b));
      const fecha = formatPlainDate(primera.date);
      mapa.set(
        dia,
        delDia
          .filter((slot) => formatPlainDate(slot.date) === fecha)
          .sort((a, b) => a.startTime.localeCompare(b.startTime)),
      );
    }
    return mapa;
  }, [visibles]);

  // El primer día con clases, para no abrir en uno vacío.
  const primerDia = allWeekdays().find((dia) => proximas.has(dia)) ?? null;
  const [tocado, setTocado] = useState<IsoWeekday | null>(null);
  const dia = tocado !== null && proximas.has(tocado) ? tocado : primerDia;
  const delDia = dia === null ? [] : (proximas.get(dia) ?? []);
  const fecha: PlainDate | null = delDia[0]?.date ?? null;

  return (
    <Stack gap={10}>
      {/* El filtro solo aparece cuando hay algo que filtrar. En un dojo con una
          sola disciplina son cuatro chips que no deciden nada. */}
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
          const hay = proximas.has(cada);
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
              {/* El punto dice que ese día hay clase a la que apuntarse: sin él,
                  un día vacío y uno lleno se ven igual hasta tocarlos. */}
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
              ? 'No hay clases para reservar en las próximas dos semanas.'
              : `No hay ${filtro} en las próximas dos semanas.`}
          </Text>
        </Card>
      ) : (
        <Card padded={false} radius={theme.radii.xl}>
          <Row
            style={{ paddingHorizontal: 16, paddingTop: 13, paddingBottom: 4 }}
            gap={8}
            justify="flex-start"
          >
            {/* Con mes: la reserva puede caer en la semana que cruza de agosto a
                setiembre, y «Martes 1» a secas no dice cuál. */}
            <Text variant="captionSmall" weight="bold" color={theme.colors.textSecondary}>
              {mayuscula(weekdayName(isoWeekday(fecha)))} {formatLongDate(fecha)}
            </Text>
          </Row>

          <Stack gap={9} style={{ paddingHorizontal: 12, paddingBottom: 12, paddingTop: 4 }}>
            {delDia.map((opcion) => (
              <SlotRow
                key={`${opcion.scheduleId}-${opcion.startTime}`}
                slot={opcion}
                selected={esLaMisma(elegida, opcion)}
                onPress={() => onElegir(opcion)}
              />
            ))}
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
 * Una clase del día elegido.
 *
 * Misma fila que el horario del alumno inscrito —nombre a la izquierda, hora a
 * la derecha— pero aquí se toca: es lo que se reserva. La fecha no se repite en
 * cada fila porque ya está en la cabecera del día.
 */
function SlotRow({
  slot,
  selected,
  onPress,
}: {
  readonly slot: TrialSlot;
  readonly selected: boolean;
  readonly onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${slot.name}, ${formatWeekdayAndDay(slot.date)} de ${slot.startTime} a ${slot.endTime}`}
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
      <Row gap={12}>
        <Stack gap={2} style={{ flex: 1 }}>
          <Text variant="bodySmall" weight={selected ? 'semibold' : 'regular'}>
            {slot.name}
          </Text>
          {slot.instructor === null ? null : (
            <Text variant="micro" color={theme.colors.textFaint}>
              {slot.instructor}
            </Text>
          )}
        </Stack>
        {selected ? (
          <Text variant="captionSmall" weight="bold" color={theme.semaphore.ok}>
            ELEGIDA
          </Text>
        ) : null}
        <Text variant="bodySmall" weight="semibold" color={theme.colors.textStrong}>
          {slot.startTime} – {slot.endTime}
        </Text>
      </Row>
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
