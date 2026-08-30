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
import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { cents, formatPEN, formatPENShort, weekdayName, type TrialSlot } from '@sinchi/shared';
import { withAlpha } from '@sinchi/ui';
import { Badge, Button, Card, Chip, Eyebrow, Row, Stack, Text } from '../../src/design/primitives';
import { Screen } from '../../src/design/screen';
import { EstadoSinConexion } from '../../src/design/empty';
import { CargandoSeccion } from '../../src/design/loading';
import { useTheme } from '../../src/design/theme';
import { useGym, useMisClasesGratis } from '../../src/data/hooks';
import { cuentaParaReservar, reservarClaseGratis } from '../../src/data/trials';
import type { BookTrialDto } from '../../src/data/api';
import { formatWeekdayAndDay, splitGymName } from '../../src/lib/format';

export default function GymScreen() {
  const theme = useTheme();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { datos: gym, cargando, error, recargar } = useGym(slug ?? '');
  const reservas = useMisClasesGratis();

  const [slot, setSlot] = useState<TrialSlot | null>(null);
  const [nombre, setNombre] = useState('');
  const [celular, setCelular] = useState('+51');
  const [reservando, setReservando] = useState(false);
  const [salida, setSalida] = useState<BookTrialDto | null>(null);

  const cuenta = cuentaParaReservar();
  // Con identidad Sinchi el nombre y el celular ya se saben: volver a pedirlos
  // dejaría dos versiones de la misma persona en la lista del gimnasio.
  const pideDatos = cuenta.kind === 'guest';
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
            error={error ?? 'Este gimnasio no está disponible.'}
            onReintentar={recargar}
          />
        </View>
      </Screen>
    );
  }

  const { brand, area } = splitGymName(gym.name);
  const puedeReservar = gym.trialClassEnabled && gym.slots.length > 0;

  const confirmar = (): void => {
    if (slot === null) return;
    setReservando(true);
    setSalida(null);

    void reservarClaseGratis({ slug: gym.slug, slot, fullName: nombre, phone: celular })
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

      <Stack gap={3} style={{ marginTop: 18 }}>
        <Text variant="title" weight="bold">
          {brand}
        </Text>
        <Text variant="caption" color={theme.colors.textSecondary}>
          {area.length > 0 ? `${area} · ` : ''}
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
      {yaReservada !== undefined ? (
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
          <Eyebrow>Tu primera clase, gratis</Eyebrow>

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

              <Stack gap={8}>
                {gym.slots.slice(0, 12).map((opcion) => (
                  <SlotRow
                    key={`${opcion.scheduleId}-${opcion.date.month}-${opcion.date.day}-${opcion.startTime}`}
                    slot={opcion}
                    selected={esLaMisma(slot, opcion)}
                    onPress={() => setSlot(opcion)}
                  />
                ))}
              </Stack>

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

/** Una clase concreta: día, hora y nombre. Es lo que se reserva. */
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
      accessibilityLabel={`${slot.name}, ${formatWeekdayAndDay(slot.date)} a las ${slot.startTime}`}
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: selected
          ? withAlpha(theme.semaphore.ok, 0.14)
          : theme.colors.surfaceRaised,
        borderWidth: 1,
        borderColor: selected ? withAlpha(theme.semaphore.ok, 0.5) : theme.colors.hairline,
        borderRadius: theme.radii.lg,
        paddingHorizontal: 14,
        paddingVertical: 12,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Row>
        <Stack gap={2} style={{ flex: 1 }}>
          <Text variant="bodySmall" weight={selected ? 'semibold' : 'regular'}>
            {formatWeekdayAndDay(slot.date)} · {slot.startTime}
          </Text>
          <Text variant="captionSmall" color={theme.colors.textTertiary} numberOfLines={1}>
            {slot.name}
          </Text>
        </Stack>
        {selected ? (
          <Text variant="captionSmall" weight="bold" color={theme.semaphore.ok}>
            ELEGIDA
          </Text>
        ) : null}
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
