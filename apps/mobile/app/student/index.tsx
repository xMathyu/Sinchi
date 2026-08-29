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
  Card,
  Eyebrow,
  Logo,
  Row,
  Stack,
  Text,
  Wordmark,
} from '../../src/design/primitives';
import { Screen } from '../../src/design/screen';
import { useTheme } from '../../src/design/theme';
import { useRefresco, useStore, useWallet } from '../../src/data/hooks';
import { setActiveTenant } from '../../src/data/store';
import type { MembershipView } from '../../src/data/store';
import { formatDocument, formatShortDate, initials, splitGymName } from '../../src/lib/format';

export default function WalletScreen() {
  const theme = useTheme();
  const user = useStore((state) => state.user);
  const wallet = useWallet();
  useRefresco();
  const active = wallet.filter((entry) => entry.subscription.status !== 'canceled').length;

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
          DNI {formatDocument(user.documentId)} · {active}{' '}
          {active === 1 ? 'membresía activa' : 'membresías activas'}
        </Text>
      </Stack>

      <Stack gap={12} style={{ marginTop: 18 }}>
        <Eyebrow>Tus gimnasios</Eyebrow>
        {wallet.map((entry) => (
          <GymCard key={entry.membership.id} entry={entry} />
        ))}
      </Stack>

      <Stack gap={10} style={{ marginTop: 22 }}>
        <View
          style={{
            borderWidth: 1,
            borderStyle: 'dashed',
            borderColor: theme.colors.borderDashed,
            borderRadius: theme.radii.lg,
            padding: 14,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <View
            style={{
              width: 30,
              height: 30,
              borderRadius: theme.radii.xs,
              backgroundColor: theme.colors.surfaceHigher,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text variant="titleSmall" color={theme.colors.textSecondary}>
              +
            </Text>
          </View>
          <Text variant="bodySmall" color={theme.colors.textSecondary}>
            Unirme a otro gimnasio
          </Text>
        </View>
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
      <Pressable accessibilityRole="button" accessibilityLabel={`${entry.tenant.name}, ${entry.badge}`}>
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
              <Badge label={entry.badge} color={semaphore.color} />
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
