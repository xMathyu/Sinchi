/**
 * S4 · Clases gratis.
 *
 * La lista de posibles alumnos: gente que encontró el gimnasio en la app, eligió
 * un horario y dijo que vendría. Es la contraparte del directorio — sin esta
 * pantalla, la reserva es una fila en una tabla que nadie mira y el interesado
 * aparece un martes sin que nadie lo espere.
 *
 * Se ordena por CUÁNDO VIENEN, no por cuándo reservaron: lo que el mostrador
 * pregunta al abrirla es "¿a quién espero hoy?".
 *
 * El celular va grande y visible a propósito. Es lo único que convierte la lista
 * en algo accionable: quien no aparece se merece una llamada, y quien vino,
 * también.
 */
import { useState } from 'react';
import { Alert, Pressable, Switch, View } from 'react-native';
import { router } from 'expo-router';
import {
  formatPENShort,
  isAfter,
  type TrialBooking,
  type TrialBookingStatus,
} from '@sinchi/shared';
import { withAlpha } from '@sinchi/ui';
import {
  Badge,
  Card,
  Chip,
  Eyebrow,
  Row,
  SegmentedControl,
  Stack,
  Text,
} from '../../src/design/primitives';
import { Screen } from '../../src/design/screen';
import { OfflineState, EmptyState } from '../../src/design/empty';
import { SectionLoader } from '../../src/design/loading';
import { useTheme } from '../../src/design/theme';
import {
  useGymTrialClasses,
  useTrialClassEnabled,
  useStore,
  useToday,
} from '../../src/data/hooks';
import { openTrialConversation, setTrialClassEnabled, setTrialStatus } from '../../src/data/api';
import { formatWeekdayAndDay } from '../../src/lib/format';

type Vista = 'proximas' | 'pasadas';

export default function TrialsScreen() {
  const theme = useTheme();
  const [vista, setVista] = useState<Vista>('proximas');
  const {
    details: bookings,
    loading,
    error,
    reload,
  } = useGymTrialClasses(vista === 'pasadas');

  const vigentes = bookings.filter((booking) => booking.status !== 'canceled');

  return (
    <Screen scroll>
      <Stack gap={3} style={{ paddingTop: 8 }}>
        <Text variant="titleSmall" weight="bold">
          Clases de prueba
        </Text>
        <Text variant="captionSmall" color={theme.colors.textSecondary}>
          Quién viene a probar. Todavía no son alumnos de nadie.
        </Text>
      </Stack>

      <Interruptor />

      <View style={{ marginTop: 18 }}>
        <SegmentedControl<Vista>
          options={[
            { value: 'proximas', label: 'Por venir' },
            { value: 'pasadas', label: 'Historial' },
          ]}
          value={vista}
          onChange={setVista}
        />
      </View>

      {loading && bookings.length === 0 ? (
        <View style={{ minHeight: 320 }}>
          <SectionLoader text="Trayendo la lista…" />
        </View>
      ) : error !== null && bookings.length === 0 ? (
        <View style={{ minHeight: 320 }}>
          <OfflineState error={error} onReintentar={reload} />
        </View>
      ) : vigentes.length === 0 ? (
        <View style={{ minHeight: 320 }}>
          <EmptyState
            title={vista === 'proximas' ? 'Nadie viene a probar todavía' : 'Sin historial'}
            body={
              vista === 'proximas'
                ? 'Cuando alguien reserve su clase de prueba desde la app, aparecerá aquí con el día, la hora y su celular. Puedes escribirle desde aquí mismo.'
                : 'Aquí quedan las clases de prueba que ya pasaron, con quién vino y quién no.'
            }
            pie="Tu gimnasio sale en la lista de la app mientras la clase gratis esté activa."
          />
        </View>
      ) : (
        <Stack gap={12} style={{ marginTop: 20 }}>
          <Eyebrow>
            {vigentes.length} {vigentes.length === 1 ? 'persona' : 'personas'}
          </Eyebrow>
          {vigentes.map((booking) => (
            <TrialCard key={booking.id} booking={booking} onChange={reload} />
          ))}
        </Stack>
      )}
    </Screen>
  );
}

/**
 * El interruptor de la clase gratis.
 *
 * No todos los gimnasios la dan, y esa es una decisión suya: hasta ahora la
 * columna existía en la base y no había forma de tocarla sin un UPDATE a mano,
 * que es lo mismo que no poder.
 *
 * Apagarlo NO cancela lo ya reservado —esa promesa ya se hizo, y borrarla deja a
 * alguien presentándose en un local que no lo espera—: corta lo de adelante, el
 * gimnasio deja de aparecer con horas para probar.
 */
function Interruptor() {
  const theme = useTheme();
  const rol = useStore((state) => state.staff.role);
  const { details: remoto, error, reload } = useTrialClassEnabled();
  const [local, setLocal] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  // Lo que se pinta es lo último decidido aquí, si lo hay; si no, lo que dijo el
  // servidor. `null` = todavía no se sabe, y el interruptor no puede adivinar.
  const activa = local ?? remoto;
  const esDueño = rol === 'owner';

  const change = (value: boolean): void => {
    setLocal(value);
    setSaving(true);

    void setTrialClassEnabled(value)
      .then((outcome) => setLocal(outcome.trialClassEnabled))
      .catch((causa: unknown) => {
        // Se revierte: dejar el interruptor donde el dedo lo puso, cuando el
        // servidor no lo aceptó, es mentirle al dueño sobre su propio gimnasio.
        setLocal(null);
        reload();
        Alert.alert(
          'No se pudo cambiar',
          causa instanceof Error ? causa.message : 'Intenta de nuevo.',
        );
      })
      .finally(() => setSaving(false));
  };

  return (
    <Card radius={theme.radii.xl} style={{ marginTop: 18 }}>
      <Stack gap={10}>
        <Row align="flex-start" style={{ gap: 12 }}>
          <Stack gap={5} style={{ flex: 1 }}>
            <Text variant="bodySmall" weight="semibold">
              Aceptamos reservas de clase de prueba
            </Text>
            <Text variant="captionSmall" color={theme.colors.textSecondary}>
              {activa === false
                ? 'Tu gimnasio sale en la lista de la app con sus horarios y precios, pero sin clase de prueba.'
                : 'Quien te encuentre en la app puede reservar una clase para conocerte, el día y la hora que elija. Si tu prueba tiene precio, lo cobras al llegar.'}
            </Text>
          </Stack>
          <Switch
            value={activa === true}
            onValueChange={change}
            disabled={!esDueño || activa === null || saving}
            accessibilityLabel="Ofrecer la primera clase gratis"
            trackColor={{ true: theme.semaphore.ok, false: theme.colors.surfaceHigh }}
            thumbColor={theme.colors.ink}
          />
        </Row>

        {!esDueño ? (
          <Text variant="micro" color={theme.colors.textFaint}>
            Solo el dueño puede cambiarlo.
          </Text>
        ) : activa === false ? (
          <Text variant="micro" color={theme.colors.textFaint}>
            Las clases ya reservadas siguen en pie: abajo están.
          </Text>
        ) : null}

        {error !== null && activa === null ? (
          <Text variant="micro" color={theme.semaphore.alert}>
            {error}
          </Text>
        ) : null}
      </Stack>
    </Card>
  );
}

function TrialCard({
  booking,
  onChange,
}: {
  readonly booking: TrialBooking;
  readonly onChange: () => void;
}) {
  const theme = useTheme();
  const hoy = useToday();
  const [saving, setSaving] = useState(false);

  /**
   * Marcar quien vino solo tiene sentido desde el DIA de la clase.
   *
   * Antes salia siempre, asi que la tarjeta ofrecia marcar «vino» en una clase
   * que todavia no habia ocurrido —y al marcarla no se movia a ningun sitio,
   * porque sigue siendo futura—. Se tocaba algo que no deberia estar ahi y el
   * resultado era invisible.
   *
   * El corte es por DIA y no por hora de inicio, igual que el de las pestanas:
   * quien llega diez minutos antes se marca al recibirlo, no cuando el reloj
   * cruza el horario.
   *
   * Si una reserva futura ya viniera marcada, los chips se quedan: es la unica
   * forma de deshacer un marcado hecho por error.
   */
  const dueNow = !isAfter(booking.date, hoy) || booking.status !== 'booked';

  const mark = (status: TrialBookingStatus): void => {
    // Ya está en ese estado, o hay una petición en vuelo: no se manda otra.
    if (saving || booking.status === status) return;
    setSaving(true);
    void setTrialStatus(booking.id, status)
      .then(() => onChange())
      .catch((causa: unknown) => {
        Alert.alert(
          'No se pudo guardar',
          causa instanceof Error ? causa.message : 'Intenta de nuevo.',
        );
      })
      .finally(() => setSaving(false));
  };

  const color =
    booking.status === 'attended'
      ? theme.semaphore.ok
      : booking.status === 'no_show'
        ? theme.semaphore.alert
        : theme.colors.textTertiary;

  return (
    <Card accent={color} radius={theme.radii.xl}>
      <Stack gap={10}>
        <Row align="flex-start" style={{ gap: 10 }}>
          <Stack gap={2} style={{ flex: 1 }}>
            <Text variant="heading" weight="bold" numberOfLines={1}>
              {booking.fullName}
            </Text>
            <Text variant="captionSmall" color={theme.colors.textSecondary}>
              {booking.phone}
            </Text>
          </Stack>
          {booking.status === 'booked' ? null : (
            <Badge
              label={booking.status === 'attended' ? 'VINO' : 'NO VINO'}
              color={color}
              background={withAlpha(color, 0.14)}
            />
          )}
        </Row>

        <Text variant="bodySmall">
          {formatWeekdayAndDay(booking.date)} · {booking.startTime}–{booking.endTime}
        </Text>
        <Row justify="flex-start" gap={8}>
          <Text variant="captionSmall" color={theme.colors.textTertiary}>
            {booking.className}
          </Text>
          {booking.priceCents > 0 ? (
            <Text variant="captionSmall" color={theme.colors.textSecondary}>
              · cobrar {formatPENShort(booking.priceCents)}
            </Text>
          ) : null}
        </Row>

        {/* Escribirle, dentro de Sinchi. Aquí el celular abría WhatsApp, y con eso
            el mostrador coordinaba FUERA de la app justo con quien llegó por la
            app (decisiones §12). El celular sigue a la vista: es un dato de la
            persona, no la forma de hablarle. */}
        <WriteButton bookingId={booking.id} name={booking.fullName} />

        {/* Marcar quién vino es lo que convierte la lista en un dato: sin esto,
            el gimnasio no sabe si la clase gratis le trae alumnos o curiosos. */}
        {dueNow ? (
          <Row justify="flex-start" style={{ gap: 8, marginTop: 2 }}>
            {/* Chips, y no dos textos con uno «apagado».
              
              El apagado era invisible: distinguía `textSecondary` (#9C9CA6) de
              `textFaint` (#8C8C95), y esos dos dejaron de ser dos colores cuando
              la rampa de grises se aplanó al suelo que pasa AA — `textFaint` y
              `textTertiary` son hoy el MISMO hex. Asi que tocar «Vino» en una
              reserva que ya estaba en «vino» no hacia nada y nada en la pantalla
              explicaba por que: se leia como un boton roto.
              
              El chip elegido se pinta con su color del semaforo, que es el mismo
              lenguaje que la insignia de arriba y el que ya usa el padron para
              «Activos / Bajas». Las dos siguen tocables porque el mostrador se
              equivoca y tiene que poder corregir. */}
            <Chip
              label="Vino"
              selected={booking.status === 'attended'}
              selectedColor={theme.semaphore.ok}
              onPress={() => mark('attended')}
            />
            <Chip
              label="No vino"
              selected={booking.status === 'no_show'}
              selectedColor={theme.semaphore.alert}
              onPress={() => mark('no_show')}
            />
          </Row>
        ) : null}
      </Stack>
    </Card>
  );
}

/**
 * Abre —o encuentra— el hilo con quien reservó y lo lleva ahí.
 *
 * La conversación no existe hasta que alguien escribe, así que tocar y volver
 * sin mandar nada no deja un hilo vacío en ninguna bandeja.
 */
function WriteButton({ bookingId, name }: { readonly bookingId: string; readonly name: string }) {
  const theme = useTheme();
  const [opening, setOpening] = useState(false);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Escribirle a ${name}`}
      hitSlop={8}
      disabled={opening}
      style={{ alignSelf: 'flex-start' }}
      onPress={() => {
        setOpening(true);
        void openTrialConversation(bookingId)
          .then(({ conversationId }) =>
            router.push({ pathname: '/inbox/[conversationId]', params: { conversationId } }),
          )
          .catch((causa: unknown) => {
            Alert.alert(
              'No se pudo abrir la conversación',
              causa instanceof Error ? causa.message : 'Intenta de nuevo.',
            );
          })
          .finally(() => setOpening(false));
      }}
    >
      <Text variant="captionSmall" weight="semibold" color={theme.semaphore.ok}>
        {opening ? 'Abriendo…' : 'Escribirle'}
      </Text>
    </Pressable>
  );
}
