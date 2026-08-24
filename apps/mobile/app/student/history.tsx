/**
 * A6 · Historial.
 *
 * La asistencia se agrupa por semana ISO porque es la unidad del cupo: agrupar
 * por mes esconderia justo el dato que importa (MD 4.3). El marcado manual se
 * distingue del QR a proposito: es el hueco por donde se cuelan favores, y el
 * alumno tiene derecho a ver cuando alguien lo marco por el.
 */
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import {
  formatPENShort,
  plainDateInZone,
  TZ_LIMA,
  type Attendance,
  type Charge,
} from '@sinchi/shared';
import { withAlpha } from '@sinchi/ui';
import {
  Button,
  Card,
  Eyebrow,
  Row,
  SegmentedControl,
  Stack,
  Text,
} from '../../src/design/primitives';
import { Screen } from '../../src/design/screen';
import { useTheme } from '../../src/design/theme';
import { useStore, useWallet } from '../../src/data/hooks';
import { railLabel } from '../../src/data/store';
import { formatCheckInMoment, formatShortDate } from '../../src/lib/format';

type Tab = 'attendance' | 'payments';

export default function HistoryScreen() {
  const [tab, setTab] = useState<Tab>('attendance');
  const wallet = useWallet();
  const tenants = useStore((state) => state.tenants);
  const schedules = useStore((state) => state.schedules);

  const gymName = useMemo(
    () => new Map(tenants.map((tenant) => [tenant.id, tenant.name])),
    [tenants],
  );

  const attendances = useMemo(
    () =>
      wallet
        .flatMap((entry) => entry.attendances)
        .slice()
        .sort((a, b) => b.checkedInAt.getTime() - a.checkedInAt.getTime()),
    [wallet],
  );

  const charges = useMemo(
    () =>
      wallet
        .flatMap((entry) => entry.charges)
        .slice()
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    [wallet],
  );

  const weeks = useMemo(() => groupByIsoWeek(attendances), [attendances]);

  return (
    <Screen scroll>
      <Text variant="title" weight="bold" style={{ paddingTop: 10 }}>
        Historial
      </Text>

      <View style={{ marginTop: 16 }}>
        <SegmentedControl<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'attendance', label: 'Asistencia' },
            { value: 'payments', label: 'Pagos' },
          ]}
        />
      </View>

      {tab === 'attendance' ? (
        <Stack gap={16} style={{ marginTop: 16 }}>
          {weeks.length === 0 ? (
            <EmptyState text="Todavía no tienes asistencias registradas." />
          ) : (
            weeks.map((week) => (
              <Stack key={week.key} gap={8}>
                <Eyebrow>
                  Semana {week.number} · {week.items.length}{' '}
                  {week.items.length === 1 ? 'sesión' : 'sesiones'}
                </Eyebrow>
                <Card padded={false} radius={16}>
                  {week.items.map((attendance, index) => (
                    <AttendanceRow
                      key={attendance.id}
                      attendance={attendance}
                      gym={gymName.get(attendance.tenantId) ?? ''}
                      className={
                        schedules.find((s) => s.id === attendance.classScheduleId)?.name ?? null
                      }
                      last={index === week.items.length - 1}
                    />
                  ))}
                </Card>
              </Stack>
            ))
          )}
        </Stack>
      ) : (
        <Stack gap={8} style={{ marginTop: 16 }}>
          {charges.length === 0 ? (
            <EmptyState text="Todavía no hay pagos registrados." />
          ) : (
            <Card padded={false} radius={16}>
              {charges.map((charge, index) => (
                <ChargeRow
                  key={charge.id}
                  charge={charge}
                  gym={gymName.get(charge.tenantId) ?? ''}
                  last={index === charges.length - 1}
                />
              ))}
            </Card>
          )}
        </Stack>
      )}

      <View style={{ marginTop: 22 }}>
        <Button label="Descargar estado de cuenta" variant="secondary" />
      </View>
    </Screen>
  );
}

interface WeekGroup {
  readonly key: string;
  readonly number: number;
  readonly items: readonly Attendance[];
}

function groupByIsoWeek(attendances: readonly Attendance[]): readonly WeekGroup[] {
  const buckets = new Map<string, Attendance[]>();
  for (const attendance of attendances) {
    const list = buckets.get(attendance.isoWeek);
    if (list === undefined) buckets.set(attendance.isoWeek, [attendance]);
    else list.push(attendance);
  }
  return [...buckets.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, items]) => ({
      key,
      number: Number(key.split('-W')[1] ?? '0'),
      items,
    }));
}

function AttendanceRow({
  attendance,
  gym,
  className,
  last,
}: {
  readonly attendance: Attendance;
  readonly gym: string;
  readonly className: string | null;
  readonly last: boolean;
}) {
  const theme = useTheme();
  const manual = attendance.method === 'manual';
  const color = manual ? theme.colors.textSecondary : theme.semaphore.ok;

  return (
    <Row
      gap={13}
      style={{
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: theme.colors.divider,
      }}
      justify="flex-start"
    >
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: 11,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: manual ? 'rgba(255,255,255,0.07)' : withAlpha(theme.semaphore.ok, 0.14),
        }}
      >
        <Text variant="eyebrow" weight="extrabold" color={color} style={{ letterSpacing: 0.4 }}>
          {manual ? 'MAN' : 'QR'}
        </Text>
      </View>
      <Stack gap={1} style={{ flex: 1 }}>
        <Text variant="bodySmall" weight="semibold">
          {formatCheckInMoment(attendance.checkedInAt)}
        </Text>
        <Text variant="captionSmall" color={theme.colors.textSecondary}>
          {manual ? `Manual · registrado por recepción` : `${gym}${className === null ? '' : ` · ${className}`}`}
        </Text>
      </Stack>
    </Row>
  );
}

function ChargeRow({
  charge,
  gym,
  last,
}: {
  readonly charge: Charge;
  readonly gym: string;
  readonly last: boolean;
}) {
  const theme = useTheme();
  const pending = charge.status === 'pending';
  const date = plainDateInZone(charge.createdAt, TZ_LIMA);

  return (
    <Row
      style={{
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: theme.colors.divider,
      }}
    >
      <Stack gap={1} style={{ flex: 1 }}>
        <Text variant="bodySmall" weight="semibold">
          {formatPENShort(charge.amountCents)} · {chargeTypeLabel(charge)}
        </Text>
        <Text variant="captionSmall" color={theme.colors.textSecondary}>
          {gym} · {pending ? 'por cobrar en mostrador' : railLabel(charge.rail)}
          {charge.periodStart === null ? '' : ` · desde ${formatShortDate(charge.periodStart)}`}
        </Text>
      </Stack>
      <Text
        variant="captionSmall"
        color={pending ? theme.semaphore.warn : theme.colors.textTertiary}
      >
        {pending ? 'pendiente' : formatShortDate(date)}
      </Text>
    </Row>
  );
}

function chargeTypeLabel(charge: Charge): string {
  switch (charge.type) {
    case 'renewal':
      return 'mensualidad';
    case 'proration':
      return 'diferencia de plan';
    case 'enrollment':
      return 'matrícula';
    case 'drop_in':
      return 'clase suelta';
    case 'saas':
      return 'suscripción Sinchi';
  }
}

function EmptyState({ text }: { readonly text: string }) {
  const theme = useTheme();
  return (
    <Card radius={16}>
      <Text variant="bodySmall" color={theme.colors.textSecondary} align="center">
        {text}
      </Text>
    </Card>
  );
}
