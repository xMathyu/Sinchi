/**
 * S4 · Reservas.
 *
 * La lista de quién viene desde la app: gente que encontró el gimnasio en el
 * directorio, eligió un horario y dijo que vendría — a probar, a una clase
 * suelta o a inscribirse. Es la contraparte del directorio: sin esta pantalla, la
 * reserva es una fila en una tabla que nadie mira y el interesado aparece un
 * martes sin que nadie lo espere.
 *
 * Se ordena por CUÁNDO VIENEN, no por cuándo reservaron: lo que el mostrador
 * pregunta al abrirla es "¿a quién espero hoy?".
 *
 * Cada tarjeta dice lo que hay que COBRAR, y la acción para hacerlo está en la
 * misma tarjeta. Con la persona delante, el mostrador no puede ponerse a buscar
 * en qué pantalla se cobra una clase suelta, ni cómo se hace la ficha de quien
 * reservó su inscripción desde el sofá.
 *
 * El celular va grande y visible a propósito. Es lo único que convierte la lista
 * en algo accionable: quien no aparece se merece una llamada, y quien vino,
 * también.
 */
import { useState } from 'react';
import { Alert, Pressable, Switch, View } from 'react-native';
import { router } from 'expo-router';
import {
  cents,
  formatPEN,
  formatPENShort,
  isAfter,
  type BookingKind,
  type ClassBooking,
  type ClassBookingStatus,
} from '@sinchi/shared';
import { withAlpha } from '@sinchi/ui';
import {
  Badge,
  Button,
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
  useGymBookings,
  useTrialClassEnabled,
  useStore,
  useToday,
} from '../../src/data/hooks';
import { openTrialConversation, setTrialClassEnabled, setTrialStatus } from '../../src/data/api';
import { chargeBooking } from '../../src/data/actions';
import { railLabel } from '../../src/data/store';
import { formatWeekdayAndDay } from '../../src/lib/format';

type Vista = 'proximas' | 'pasadas';

export default function BookingsScreen() {
  const theme = useTheme();
  const [vista, setVista] = useState<Vista>('proximas');
  const {
    details: bookings,
    loading,
    error,
    reload,
  } = useGymBookings(vista === 'pasadas');

  const vigentes = bookings.filter((booking) => booking.status !== 'canceled');

  return (
    <Screen scroll>
      <Stack gap={3} style={{ paddingTop: 8 }}>
        <Text variant="titleSmall" weight="bold">
          Reservas
        </Text>
        <Text variant="captionSmall" color={theme.colors.textSecondary}>
          Quién viene desde la app: a probar, a una clase suelta o a inscribirse.
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
            title={vista === 'proximas' ? 'Nadie tiene reserva todavía' : 'Sin historial'}
            body={
              vista === 'proximas'
                ? 'Cuando alguien reserve desde la app —una clase de prueba, una clase suelta o su inscripción— aparece aquí con el día, la hora, su celular y lo que hay que cobrarle.'
                : 'Aquí quedan las reservas que ya pasaron, con quién vino y quién no.'
            }
            pie="Tu gimnasio sale en la lista de la app con sus horarios y sus precios: desde ahí se reserva."
          />
        </View>
      ) : (
        <Stack gap={12} style={{ marginTop: 20 }}>
          <Eyebrow>
            {vigentes.length} {vigentes.length === 1 ? 'persona' : 'personas'}
          </Eyebrow>
          {vigentes.map((booking) => (
            <BookingCard key={booking.id} booking={booking} onChange={reload} />
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
 * gimnasio deja de ofrecer la prueba. La clase suelta y la inscripción no
 * cuelgan de aquí: salen de sus precios.
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
                ? 'Tu gimnasio sale en la lista de la app sin clase de prueba. Siguen pudiendo reservar una clase suelta o inscribirse, si tienes esos precios.'
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

const KIND_LABEL: Readonly<Record<BookingKind, string>> = {
  trial: 'PRUEBA',
  drop_in: 'CLASE SUELTA',
  enrollment: 'INSCRIPCIÓN',
};

type Rail = 'cash' | 'yape' | 'bank_transfer';
const RAILS: readonly Rail[] = ['cash', 'yape', 'bank_transfer'];

function BookingCard({
  booking,
  onChange,
}: {
  readonly booking: ClassBooking;
  readonly onChange: () => void;
}) {
  const theme = useTheme();
  const hoy = useToday();
  const [saving, setSaving] = useState(false);
  const [rail, setRail] = useState<Rail>('cash');

  // `??` porque la app se actualiza sola y la api no: contra una anterior a la
  // 0022 estos campos no vienen, y entonces todo era una prueba sin cobrar.
  const kind: BookingKind = booking.kind ?? 'trial';
  const price = cents(booking.priceCents);
  const fee = cents(booking.enrollmentFeeCents ?? 0);
  const paid = (booking.chargeId ?? null) !== null;
  const enrolled = (booking.membershipId ?? null) !== null;

  /** Se cobra aquí mismo: la clase suelta y la prueba que tiene precio. */
  const chargeable = kind !== 'enrollment' && price > 0;
  /** Todavía hay que cobrarle algo, sea aquí o al inscribirla. */
  const owes = (chargeable && !paid) || (kind === 'enrollment' && !enrolled);

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
   *
   * Cobrar e inscribir NO esperan al día: quien reservó el jueves y aparece el
   * martes paga el martes, y su mensualidad empieza el martes.
   */
  const dueNow = !isAfter(booking.date, hoy) || booking.status !== 'booked';
  /** Reservó para un día que ya pasó y nadie la atendió: sigue siendo trabajo. */
  const overdue = booking.status === 'booked' && isAfter(hoy, booking.date);

  const mark = (status: ClassBookingStatus): void => {
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

  const charge = (): void => {
    if (saving) return;
    setSaving(true);
    void chargeBooking(booking.id, rail)
      .then(() => onChange())
      .catch((causa: unknown) => {
        Alert.alert(
          'No se pudo cobrar',
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
        : owes
          ? theme.semaphore.warn
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
          <Stack gap={5} style={{ alignItems: 'flex-end' }}>
            <Badge
              label={KIND_LABEL[kind]}
              color={theme.colors.textSecondary}
              background={theme.colors.surfaceHigh}
            />
            {booking.status === 'booked' ? null : (
              <Badge
                label={booking.status === 'attended' ? 'VINO' : 'NO VINO'}
                color={color}
                background={withAlpha(color, 0.14)}
              />
            )}
          </Stack>
        </Row>

        <Text variant="bodySmall">
          {formatWeekdayAndDay(booking.date)} · {booking.startTime}–{booking.endTime}
        </Text>
        <Text variant="captionSmall" color={theme.colors.textTertiary}>
          {booking.className}
          {kind === 'enrollment' && booking.planName !== null ? ` · plan ${booking.planName}` : ''}
        </Text>

        {overdue ? (
          <Text variant="micro" color={theme.semaphore.warn}>
            Era para ese día y todavía no vino. Si llega hoy, se le atiende igual.
          </Text>
        ) : null}

        {/* Lo que hay que cobrar, antes que nada: es la pregunta que hace el
            mostrador cuando la persona está delante. */}
        {owes ? (
          <Card tone="sunken" radius={theme.radii.lg}>
            <Stack gap={3}>
              <Text variant="captionSmall" weight="semibold" color={theme.semaphore.warn}>
                Tiene que pagar
              </Text>
              <Text variant="bodySmall" weight="semibold">
                {kind === 'enrollment'
                  ? `${formatPEN(price)} del primer mes${fee > 0 ? ` + ${formatPEN(fee)} de matrícula` : ''}`
                  : formatPEN(price)}
              </Text>
              {kind === 'enrollment' ? (
                <Text variant="micro" color={theme.colors.textFaint}>
                  Su mensualidad empieza el día que la inscribas, no el que reservó.
                </Text>
              ) : null}
            </Stack>
          </Card>
        ) : paid ? (
          <Text variant="captionSmall" weight="semibold" color={theme.semaphore.ok}>
            Pagó {formatPENShort(price)}
          </Text>
        ) : enrolled ? (
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            style={{ alignSelf: 'flex-start' }}
            onPress={() =>
              router.push({
                pathname: '/member/[membershipId]',
                params: { membershipId: booking.membershipId! },
              })
            }
          >
            {/* Sin género: la lista no sabe el de quien reservó, y «inscrita» o
                «inscrito» acierta la mitad de las veces. */}
            <Text variant="captionSmall" weight="semibold" color={theme.semaphore.ok}>
              Ya tiene su ficha · abrirla
            </Text>
          </Pressable>
        ) : null}

        {/* Cobrar la clase: el medio y el botón, sin salir de la tarjeta. Cobrar
            marca «vino» —nadie paga una clase a la que no entra—, así que aquí
            no hay chip de «vino» aparte que invite a marcarlo sin cobrar. */}
        {owes && chargeable ? (
          <Stack gap={8}>
            <Row justify="flex-start" style={{ gap: 8, flexWrap: 'wrap' }}>
              {RAILS.map((option) => (
                <Chip
                  key={option}
                  label={railLabel(option)}
                  selected={rail === option}
                  onPress={() => setRail(option)}
                />
              ))}
            </Row>
            <Button
              label={saving ? 'Cobrando…' : `Cobrar ${formatPENShort(price)}`}
              disabled={saving}
              onPress={charge}
            />
          </Stack>
        ) : null}

        {/* La inscripción no se cobra como una clase: se hace la ficha —con su
            documento, que es lo que falta— y se cobra en ella, donde viven la
            mensualidad y la matrícula. La reserva llega con todo lo demás. */}
        {owes && kind === 'enrollment' ? (
          <Button
            label="Inscribir y cobrar"
            onPress={() =>
              router.push({
                pathname: '/enroll',
                params: {
                  bookingId: booking.id,
                  name: booking.fullName,
                  phone: booking.phone,
                  ...(booking.email === null ? {} : { email: booking.email }),
                  ...(booking.planId === null ? {} : { planId: booking.planId }),
                },
              })
            }
          />
        ) : null}

        {/* Escribirle, dentro de Sinchi. Aquí el celular abría WhatsApp, y con eso
            el mostrador coordinaba FUERA de la app justo con quien llegó por la
            app (decisiones §12). El celular sigue a la vista: es un dato de la
            persona, no la forma de hablarle. */}
        <WriteButton bookingId={booking.id} name={booking.fullName} />

        {/* Marcar quién vino es lo que convierte la lista en un dato: sin esto,
            el gimnasio no sabe si lo que reservan desde la app le trae alumnos o
            curiosos. Chips con su color del semáforo, y los dos tocables: el
            mostrador se equivoca y tiene que poder corregir. */}
        {dueNow && !paid && !enrolled ? (
          <Row justify="flex-start" style={{ gap: 8, marginTop: 2 }}>
            {owes ? null : (
              <Chip
                label="Vino"
                selected={booking.status === 'attended'}
                selectedColor={theme.semaphore.ok}
                onPress={() => mark('attended')}
              />
            )}
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
