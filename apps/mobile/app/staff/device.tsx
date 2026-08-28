/**
 * S6 · Estado del dispositivo.
 *
 * El wifi de los gimnasios es malo, así que la puerta no puede depender de él
 * (MD 4.6). Esta pantalla existe para que el recepcionista confíe en eso: ve
 * qué tiene en caché, qué quedó en cola y que el servidor reconcilia después.
 *
 * Un dispositivo que valida offline sin decirlo se siente roto; uno que lo dice
 * se siente sólido. Es la misma máquina.
 */
import { useMemo } from 'react';
import { View } from 'react-native';
import { isoWeekday, type Attendance } from '@sinchi/shared';
import { withAlpha } from '@sinchi/ui';
import { Button, Card, Dot, Eyebrow, Row, Stack, Text } from '../../src/design/primitives';
import { Screen } from '../../src/design/screen';
import { useTheme } from '../../src/design/theme';
import { useRoster, useStore, useToday } from '../../src/data/hooks';
import { setOnline, syncQueue } from '../../src/data/store';
import { formatClock } from '../../src/lib/format';

export default function DeviceScreen() {
  const theme = useTheme();
  const today = useToday();
  const online = useStore((state) => state.online);
  const queue = useStore((state) => state.queue);
  const lastSyncAt = useStore((state) => state.lastSyncAt);
  const staff = useStore((state) => state.staff);
  const schedules = useStore((state) => state.schedules);
  const attendances = useStore((state) => state.attendances);
  const roster = useRoster();

  const unsynced = useMemo(
    () => attendances.filter((item: Attendance) => item.syncedAt === null),
    [attendances],
  );
  const pendingPayments = queue.filter((item) => item.kind === 'payment');
  const currentSubscriptions = roster.filter((entry) => entry.view.delinquency.canTrain).length;
  const todaysClasses = schedules.filter(
    (schedule) => schedule.tenantId === staff.tenantId && schedule.weekday === isoWeekday(today),
  ).length;

  const offlineMinutes = useMemo(() => {
    if (online || lastSyncAt === null) return 0;
    return Math.max(1, Math.round((Date.now() - lastSyncAt.getTime()) / 60_000));
  }, [online, lastSyncAt]);

  return (
    <Screen scroll>
      <Text variant="titleSmall" weight="bold" style={{ paddingTop: 8 }}>
        Estado del dispositivo
      </Text>

      <View
        style={{
          marginTop: 16,
          borderRadius: theme.radii.xxl,
          padding: 20,
          gap: 12,
          backgroundColor: withAlpha(online ? theme.semaphore.ok : theme.semaphore.alert, 0.13),
          borderWidth: 1,
          borderColor: withAlpha(online ? theme.semaphore.ok : theme.semaphore.alert, 0.3),
        }}
      >
        <Row gap={10} justify="flex-start">
          <Dot color={online ? theme.semaphore.ok : theme.semaphore.alert} size={11} />
          <Text
            variant="eyebrow"
            weight="extrabold"
            color={online ? theme.semaphore.ok : theme.semaphore.alert}
            style={{ letterSpacing: 1.6 }}
          >
            {online ? 'Conectado' : `Sin conexión — ${offlineMinutes} min`}
          </Text>
        </Row>
        <Text variant="display" weight="extrabold">
          {online ? 'Todo sincronizado' : 'La puerta sigue\nfuncionando'}
        </Text>
        <Text variant="caption" color={online ? '#A9C9B4' : '#C9A98C'}>
          {online
            ? 'Cada marcado se sube al momento. El padrón en caché se refresca en segundo plano.'
            : 'Validando contra el padrón en caché. Los marcados se suben solos cuando vuelva el wifi.'}
        </Text>
      </View>

      <Row gap={10} style={{ marginTop: 16 }} align="stretch">
        <StatCard value={unsynced.length} label="marcados en cola" />
        <StatCard value={pendingPayments.length} label="cobros por subir" />
      </Row>

      <Stack gap={9} style={{ marginTop: 18 }}>
        <Row align="baseline">
          <Eyebrow>Caché local</Eyebrow>
          <Text variant="captionSmall" color={theme.colors.textTertiary}>
            {lastSyncAt === null ? 'sin sincronizar' : `actualizado ${formatClock(lastSyncAt)}`}
          </Text>
        </Row>
        <Card padded={false} radius={16}>
          <CacheRow label="Padrón de alumnos" value={roster.length} />
          <CacheRow label="Suscripciones vigentes" value={currentSubscriptions} />
          <CacheRow
            label="Horarios de hoy"
            value={todaysClasses === 0 ? 'horario libre' : `${todaysClasses} clases`}
            last
          />
        </Card>
      </Stack>

      {queue.length > 0 ? (
        <Stack gap={9} style={{ marginTop: 18 }}>
          <Eyebrow>En cola</Eyebrow>
          <Card padded={false} radius={16}>
            {queue.map((item, index) => (
              <Row
                key={item.id}
                gap={11}
                justify="flex-start"
                style={{
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                  borderBottomWidth: index === queue.length - 1 ? 0 : 1,
                  borderBottomColor: theme.colors.divider,
                }}
              >
                <Dot color={theme.semaphore.alert} size={7} />
                <Text variant="bodySmall" weight="semibold" style={{ flex: 1 }}>
                  {item.label}
                </Text>
                <Text variant="captionSmall" color={theme.colors.textTertiary}>
                  {formatClock(item.at)}
                </Text>
              </Row>
            ))}
          </Card>
        </Stack>
      ) : null}

      <Stack gap={9} style={{ marginTop: 22 }}>
        <Text variant="micro" color={theme.colors.textFaint} align="center">
          El servidor reconcilia al sincronizar y tiene la última palabra.
        </Text>
        {/* Cortar el wifi a mano es una herramienta de desarrollo. En un local
            de verdad, un boton que deja la puerta offline a proposito solo
            puede hacer dano. */}
        {online ? (
          __DEV__ ? (
            <Button label="Simular corte de wifi" variant="ghost" onPress={() => setOnline(false)} />
          ) : null
        ) : (
          <Button label="Reintentar sincronización" variant="secondary" onPress={() => syncQueue()} />
        )}
      </Stack>
    </Screen>
  );
}

function StatCard({ value, label }: { readonly value: number; readonly label: string }) {
  const theme = useTheme();
  return (
    <Card radius={theme.radii.xl} style={{ flex: 1 }}>
      <Stack gap={2}>
        <Text variant="hero" weight="black" style={{ fontSize: 34, lineHeight: 36 }}>
          {value}
        </Text>
        <Text variant="captionSmall" color={theme.colors.textSecondary}>
          {label}
        </Text>
      </Stack>
    </Card>
  );
}

function CacheRow({
  label,
  value,
  last = false,
}: {
  readonly label: string;
  readonly value: number | string;
  readonly last?: boolean;
}) {
  const theme = useTheme();
  return (
    <Row
      style={{
        paddingHorizontal: 16,
        paddingVertical: 13,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: theme.colors.divider,
      }}
    >
      <Text variant="bodySmall" color={theme.colors.textSecondary}>
        {label}
      </Text>
      <Text variant="bodySmall" weight="semibold">
        {value}
      </Text>
    </Row>
  );
}
