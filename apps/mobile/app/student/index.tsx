/**
 * A1 · Billetera.
 *
 * La pantalla que sostiene la idea del producto: una sola identidad Sinchi con
 * todas las membresias del alumno, de todos los gimnasios a los que asiste
 * (MD 5). Por eso el nombre y el documento van arriba, sobre la lista, y no
 * dentro de cada tarjeta.
 */
import { Pressable, View } from 'react-native';
import { Link, router } from 'expo-router';
import { formatPENShort, type AccessLevel } from '@sinchi/shared';
import { semaphoreStyle, withAlpha } from '@sinchi/ui';
import {
  Badge,
  Button,
  Card,
  Eyebrow,
  Logo,
  Row,
  Stack,
  Text,
  Wordmark,
} from '../../src/design/primitives';
import { Screen } from '../../src/design/screen';
import { OfflineState, EmptyState } from '../../src/design/empty';
import { useTheme } from '../../src/design/theme';
import { AccountAvatar } from '../../src/design/account-avatar';
import { GymLogo } from '../../src/design/gym-logo';
import {
  useErrorDeCarga,
  useLinkRequests,
  useMyBookings,
  useRefresco,
  useStore,
  useWallet,
} from '../../src/data/hooks';
import { setActiveTenant } from '../../src/data/store';
import { useSession } from '../../src/data/session-hooks';
import { acceptLinkRequest, rejectLinkRequest } from '../../src/data/link-requests';
import { LinkRequestList } from '../../src/design/link-requests';
import type { MembershipView } from '../../src/data/store';
import type { ClassBookingDto } from '../../src/data/api';
import { formatShortDate, formatWeekdayAndDay, splitGymName } from '../../src/lib/format';

/**
 * La etiqueta de una reserva, en lo que se lee de un vistazo: si se paga y a qué
 * viene. Con `??` porque contra una api anterior a la 0022 todo era una prueba.
 */
const bookingBadge = (booking: ClassBookingDto): string =>
  (booking.kind ?? 'trial') === 'enrollment'
    ? 'INSCRIPCIÓN'
    : booking.kind === 'drop_in'
      ? 'CLASE SUELTA'
      : (booking.priceCents ?? 0) === 0
        ? 'CLASE GRATIS'
        : 'CLASE DE PRUEBA';

export default function WalletScreen() {
  const theme = useTheme();
  const user = useStore((state) => state.user);
  // La cuenta sin ficha tiene esta misma billetera, pero no identidad en el
  // padrón: su nombre es el que dio al registrarse, y documento no tiene.
  const session = useSession();
  const unlinked = session.status === 'unlinked';
  const displayName = session.status === 'unlinked' ? (session.fullName ?? '') : user.name;
  const wallet = useWallet();
  useRefresco();
  const { error: errorDeCarga, reintentar } = useErrorDeCarga();
  const active = wallet.filter((entry) => entry.subscription.status !== 'canceled').length;
  // Las clases reservadas viven aqui y no solo en el directorio: son un
  // compromiso con una fecha, y esta es la pantalla que el alumno abre.
  const trialClasses = useMyBookings().details.filter((klass) => klass.status === 'booked');

  return (
    <Screen scroll>
      <Row style={{ paddingTop: 8 }}>
        <Row gap={10}>
          <Logo size={28} />
          <Wordmark size={30} />
        </Row>
        <AccountAvatar />
      </Row>

      <Stack gap={2} style={{ marginTop: 18 }}>
        <Text variant="title" weight="bold">
          {displayName}
        </Text>
        <Text variant="caption" color={theme.colors.textSecondary}>
          {unlinked
            ? 'Todavía no estás en ningún gimnasio'
            : `DNI ${user.documentId} · ${active} ${active === 1 ? 'membresía activa' : 'membresías activas'}`}
        </Text>
      </Stack>

      <PendingLinkRequests />

      {wallet.length === 0 && errorDeCarga !== null ? (
        <View style={{ flex: 1, minHeight: 380 }}>
          <OfflineState error={errorDeCarga} onReintentar={reintentar} />
        </View>
      ) : wallet.length === 0 ? (
        <View style={{ flex: 1, minHeight: 380 }}>
          <EmptyState
            title="Tu billetera está vacía"
            body="Aquí van tus membresías: una por cada gimnasio al que asistas, todas bajo la misma identidad Sinchi."
            pie="¿Ya elegiste gimnasio? Muestra tu QR en recepción para que te inscriban. Si no, mira los de la red: prueba uno, ven a una clase o inscríbete."
            accion={
              <Button label="Explorar gimnasios" onPress={() => router.push('/explore')} />
            }
          />
        </View>
      ) : (
        <Stack gap={12} style={{ marginTop: 18 }}>
          <Eyebrow>Tus gimnasios</Eyebrow>
          {wallet.map((entry) => (
            <GymCard key={entry.membership.id} entry={entry} />
          ))}
        </Stack>
      )}

      {trialClasses.length > 0 ? (
        <Stack gap={10} style={{ marginTop: 22 }}>
          <Eyebrow>Tus reservas</Eyebrow>
          {trialClasses.map((klass) => (
            <Pressable
              key={klass.id}
              accessibilityRole="button"
              accessibilityLabel={`${bookingBadge(klass).toLowerCase()} en ${klass.gymName}`}
              onPress={() =>
                router.push({ pathname: '/explore/[slug]', params: { slug: klass.gymSlug } })
              }
            >
              <Card
                accent={theme.semaphore.ok}
                borderColor={withAlpha(theme.semaphore.ok, 0.26)}
                radius={theme.radii.xl}
              >
                <Stack gap={5}>
                  <Row>
                    <Text variant="bodySmall" weight="semibold" numberOfLines={1}>
                      {klass.gymName}
                    </Text>
                    <Badge
                      label={(klass.priceCents ?? 0) === 0 ? 'CLASE GRATIS' : 'CLASE DE PRUEBA'}
                      color={theme.semaphoreInk.ok}
                      background={theme.semaphore.ok}
                    />
                  </Row>
                  <Text variant="captionSmall" color={theme.colors.textSecondary}>
                    {klass.className} · {formatWeekdayAndDay(klass.date)} a las {klass.startTime}
                  </Text>
                </Stack>
              </Card>
            </Pressable>
          ))}
        </Stack>
      ) : null}

      {/* Antes esto era un recuadro punteado con un «+» que decía «Unirme a otro
          gimnasio» y NO era pulsable: un `View` suelto, sin `onPress`. Prometía
          una acción que el producto no tenía. Ahora sí la tiene, y es esta: el
          directorio de la red, con la primera clase de prueba. El camino del
          mostrador sigue existiendo y se dice debajo, porque sigue siendo el
          normal para quien ya eligió gimnasio. */}
      <Stack gap={8} style={{ marginTop: 22 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Explorar los gimnasios de la red"
          onPress={() => router.push('/explore')}
        >
          <Card radius={theme.radii.lg}>
            <Row style={{ gap: 12 }}>
              <Stack gap={5} style={{ flex: 1 }}>
                <Text variant="bodySmall" weight="semibold">
                  ¿Entrenas en otro gimnasio?
                </Text>
                <Text variant="captionSmall" color={theme.colors.textSecondary}>
                  Mira los horarios y los precios de las escuelas de la red: reserva una
                  clase, suelta o de prueba, o inscríbete desde aquí.
                </Text>
              </Stack>
              <Text variant="title" color={theme.colors.textFaint}>
                ›
              </Text>
            </Row>
          </Card>
        </Pressable>
        <Text variant="micro" color={theme.colors.textFaint} align="center">
          Una sola identidad Sinchi. Tu DNI y tu QR funcionan en cualquier local de la red.
        </Text>
      </Stack>
    </Screen>
  );
}

/**
 * Tarjeta de membresia.
 *
 * La barra de color de la izquierda es el semaforo: es lo unico que el alumno
 * necesita leer de reojo. El texto de abajo dice el hecho concreto (cuando
 * cobra, cuantas sesiones le quedan, cuanto debe), no el estado abstracto.
 */
function GymCard({ entry }: { readonly entry: MembershipView }) {
  const theme = useTheme();
  const semaphore = semaphoreStyle(theme, entry.level);
  const { brand, area } = splitGymName(entry.tenant.name);

  return (
    <Link
      href={{ pathname: '/student/plan', params: { membershipId: entry.membership.id } }}
      asChild
      onPress={() => setActiveTenant(entry.tenant.id)}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${entry.tenant.name}, ${badgeForYou(entry.badge)}`}
      >
        <Card
          accent={semaphore.color}
          radius={theme.radii.xl}
          borderColor={entry.level === 'blocked' ? semaphore.border : theme.colors.hairline}
        >
          <Stack gap={10}>
            <Row align="flex-start" style={{ gap: 10 }}>
              <GymLogo name={entry.tenant.name} logoId={entry.tenant.logoId} size={44} />
              <Text variant="heading" weight="semibold" style={{ flex: 1 }}>
                {brand}
                {area === '' ? '' : `\n${area}`}
              </Text>
              <Badge label={badgeForYou(entry.badge)} color={semaphore.color} />
            </Row>
            <Row>
              <Text variant="caption" color={theme.colors.textSecondary}>
                {entry.plan.name} · {formatPENShort(entry.plan.priceCents)}
              </Text>
              <SecondaryLine entry={entry} level={entry.level} />
            </Row>
          </Stack>
        </Card>
      </Pressable>
    </Link>
  );
}

function SecondaryLine({
  entry,
  level,
}: {
  readonly entry: MembershipView;
  readonly level: AccessLevel;
}) {
  const theme = useTheme();
  const semaphore = semaphoreStyle(theme, level);

  if (entry.receivable.due) {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push(`/pay/${entry.membership.id}`)}
        style={{
          backgroundColor: withAlpha(semaphore.color, 0.14),
          paddingHorizontal: 10,
          paddingVertical: 3,
          borderRadius: theme.radii.pill,
        }}
      >
        <Text variant="caption" weight="semibold" color={semaphore.color}>
          Pagar
        </Text>
      </Pressable>
    );
  }

  if (entry.quota.limit !== null) {
    return (
      <Text variant="caption" color={theme.colors.textSecondary}>
        {entry.quota.used} de {entry.quota.limit} usadas
      </Text>
    );
  }

  return (
    <Text variant="caption" color={theme.colors.textSecondary}>
      Cobra el {formatShortDate(entry.subscription.nextBillingDate)}
    </Text>
  );
}

/**
 * La insignia, dicha al alumno.
 *
 * El dominio habla en tercera persona —"DEBE S/ 150"— porque describe a alguien;
 * es lo mismo que hace `accessMessage` con "Puede pasar". Aqui es su propia
 * billetera, asi que se le habla de tu. La traduccion va en esta direccion y no
 * al reves por una razon concreta: al reves, el padron y la ficha del mostrador
 * le decian "DEBES S/ 150" al recepcionista que estaba mirando la deuda de otro.
 */
const badgeForYou = (badge: string): string =>
  badge.startsWith('DEBE ') ? `DEBES ${badge.slice('DEBE '.length)}` : badge;

/**
 * Los gimnasios que la inscribieron y esperan que acepte.
 *
 * Arriba de la billetera y no dentro: lo que está aquí todavía NO es una
 * membresía suya, y mezclarlo con las tarjetas del semáforo lo haría pasar por
 * una. Es el caso que la regla vino a cubrir —el segundo gimnasio que inscribe a
 * alguien por su DNI— y por eso tiene que verse sin buscarlo.
 */
function PendingLinkRequests() {
  const requests = useLinkRequests();
  if (requests.details.length === 0) return null;

  return (
    <Stack gap={10} style={{ marginTop: 18 }}>
      <Eyebrow>Te agregaron</Eyebrow>
      <LinkRequestList
        requests={requests.details}
        onAccept={acceptLinkRequest}
        onReject={rejectLinkRequest}
        onAnswered={requests.reload}
      />
    </Stack>
  );
}
