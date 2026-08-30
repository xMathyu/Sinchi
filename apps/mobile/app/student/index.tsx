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
  Avatar,
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
import { EstadoSinConexion, EstadoVacio } from '../../src/design/empty';
import { useTheme } from '../../src/design/theme';
import {
  useErrorDeCarga,
  useMisClasesGratis,
  useRefresco,
  useStore,
  useWallet,
} from '../../src/data/hooks';
import { setActiveTenant } from '../../src/data/store';
import type { MembershipView } from '../../src/data/store';
import { formatShortDate, formatWeekdayAndDay, initials, splitGymName } from '../../src/lib/format';

export default function WalletScreen() {
  const theme = useTheme();
  const user = useStore((state) => state.user);
  const wallet = useWallet();
  useRefresco();
  const { error: errorDeCarga, reintentar } = useErrorDeCarga();
  const active = wallet.filter((entry) => entry.subscription.status !== 'canceled').length;
  // Las clases gratis reservadas viven aqui y no en el directorio: es un
  // compromiso con una fecha, y esta es la pantalla que el alumno abre.
  const clasesGratis = useMisClasesGratis().datos.filter((clase) => clase.status === 'booked');

  return (
    <Screen scroll>
      <Row style={{ paddingTop: 8 }}>
        <Row gap={10}>
          <Logo size={28} />
          <Wordmark size={30} />
        </Row>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Ajustes de la cuenta"
          onPress={() => router.push('/settings')}
        >
          <Avatar initials={initials(user.name)} size={38} radius={19} />
        </Pressable>
      </Row>

      <Stack gap={2} style={{ marginTop: 18 }}>
        <Text variant="title" weight="bold">
          {user.name}
        </Text>
        <Text variant="caption" color={theme.colors.textSecondary}>
          DNI {user.documentId} · {active}{' '}
          {active === 1 ? 'membresía activa' : 'membresías activas'}
        </Text>
      </Stack>

      {wallet.length === 0 && errorDeCarga !== null ? (
        <View style={{ flex: 1, minHeight: 380 }}>
          <EstadoSinConexion error={errorDeCarga} onReintentar={reintentar} />
        </View>
      ) : wallet.length === 0 ? (
        <View style={{ flex: 1, minHeight: 380 }}>
          <EstadoVacio
            titulo="Tu billetera está vacía"
            cuerpo="Aquí van tus membresías: una por cada gimnasio al que asistas, todas bajo la misma identidad Sinchi."
            pie="¿Todavía no entrenas en ninguno? Mira los de la red y prueba uno gratis."
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

      {clasesGratis.length > 0 ? (
        <Stack gap={10} style={{ marginTop: 22 }}>
          <Eyebrow>Vas a probar</Eyebrow>
          {clasesGratis.map((clase) => (
            <Pressable
              key={clase.id}
              accessibilityRole="button"
              accessibilityLabel={`Clase gratis en ${clase.gymName}`}
              onPress={() =>
                router.push({ pathname: '/explore/[slug]', params: { slug: clase.gymSlug } })
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
                      {clase.gymName}
                    </Text>
                    <Badge
                      label="CLASE GRATIS"
                      color={theme.semaphoreInk.ok}
                      background={theme.semaphore.ok}
                    />
                  </Row>
                  <Text variant="captionSmall" color={theme.colors.textSecondary}>
                    {clase.className} · {formatWeekdayAndDay(clase.date)} a las {clase.startTime}
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
          directorio de la red, con la primera clase gratis. El camino del
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
                  Mira los horarios y los precios de las escuelas de la red, y prueba una
                  clase gratis en la que te interese.
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
        accessibilityLabel={`${entry.tenant.name}, ${insigniaParaTi(entry.badge)}`}
      >
        <Card
          accent={semaphore.color}
          radius={theme.radii.xl}
          borderColor={entry.level === 'blocked' ? semaphore.border : theme.colors.hairline}
        >
          <Stack gap={10}>
            <Row align="flex-start" style={{ gap: 10 }}>
              <Text variant="heading" weight="semibold" style={{ flex: 1 }}>
                {brand}
                {area === '' ? '' : `\n${area}`}
              </Text>
              <Badge label={insigniaParaTi(entry.badge)} color={semaphore.color} />
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
const insigniaParaTi = (badge: string): string =>
  badge.startsWith('DEBE ') ? `DEBES ${badge.slice('DEBE '.length)}` : badge;
