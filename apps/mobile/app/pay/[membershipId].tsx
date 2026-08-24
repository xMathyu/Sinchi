/**
 * A4 · Estado de pago.
 *
 * Adaptada al alcance de la version 1: no hay cobro con tarjeta, asi que no hay
 * intentos de cobro que listar ni boton de pago en la app. Lo que el alumno
 * necesita saber es cuanto debe, hasta cuando puede entrenar y como se paga
 * (mostrador). El cronograma que el diseno usa para los reintentos se reutiliza
 * para el calendario que si existe hoy: cobro, gracia y suspension.
 *
 * Cuando entre Culqi, este cronograma pasa a mostrar los reintentos de tarjeta
 * y se suma un boton de pago. La informacion de arriba no cambia.
 */
import { Pressable, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { formatPEN, formatPENShort } from '@sinchi/shared';
import { semaphoreStyle, withAlpha } from '@sinchi/ui';
import { Button, Card, Divider, Dot, Eyebrow, Row, Stack, Text } from '../../src/design/primitives';
import { Screen } from '../../src/design/screen';
import { useTheme } from '../../src/design/theme';
import { useMembership } from '../../src/data/hooks';
import { formatLongDate, formatShortDate } from '../../src/lib/format';

export default function PaymentStatusScreen() {
  const theme = useTheme();
  const { membershipId } = useLocalSearchParams<{ membershipId: string }>();
  const entry = useMembership(membershipId);
  const semaphore = semaphoreStyle(theme, entry.level);
  const { delinquency, receivable } = entry;

  const suspended = delinquency.status === 'suspended';

  return (
    <Screen scroll>
      <Row justify="space-between" style={{ paddingTop: 10 }}>
        <Text variant="titleSmall" weight="bold">
          {entry.tenant.name}
        </Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()}>
          <Text variant="body" color={theme.colors.textSecondary}>
            Cerrar
          </Text>
        </Pressable>
      </Row>

      {receivable.due ? (
        <View
          style={{
            marginTop: 16,
            borderRadius: theme.radii.xxl,
            padding: 20,
            gap: 12,
            backgroundColor: withAlpha(semaphore.color, 0.14),
            borderWidth: 1,
            borderColor: semaphore.border,
          }}
        >
          <Row gap={10} justify="flex-start">
            <Dot color={semaphore.color} size={11} />
            <Text
              variant="eyebrow"
              weight="extrabold"
              color={semaphore.color}
              style={{ letterSpacing: 1.5 }}
            >
              {suspended ? 'Acceso suspendido' : 'Periodo de gracia'}
            </Text>
          </Row>
          <Text variant="display" weight="extrabold">
            {suspended
              ? `Mora de ${delinquency.daysPastDue} días`
              : delinquency.graceDaysLeft === 0
                ? 'Hoy es tu último día'
                : `Te quedan ${delinquency.graceDaysLeft} ${delinquency.graceDaysLeft === 1 ? 'día' : 'días'}\npara entrenar`}
          </Text>
          <Text variant="caption" color={suspended ? '#E8B9B9' : '#C4BB98'}>
            {suspended
              ? `Venció el periodo de gracia el ${formatLongDate(delinquency.suspensionDate)}. El escáner de la puerta ya no valida tu QR.`
              : `El ${formatLongDate(delinquency.suspensionDate)} tu acceso se suspende y el escáner de la puerta dejará de validar tu QR.`}
          </Text>
        </View>
      ) : (
        <View
          style={{
            marginTop: 16,
            borderRadius: theme.radii.xxl,
            padding: 20,
            gap: 10,
            backgroundColor: withAlpha(theme.semaphore.ok, 0.1),
            borderWidth: 1,
            borderColor: withAlpha(theme.semaphore.ok, 0.24),
          }}
        >
          <Row gap={10} justify="flex-start">
            <Dot color={theme.semaphore.ok} size={11} />
            <Text
              variant="eyebrow"
              weight="extrabold"
              color={theme.semaphore.ok}
              style={{ letterSpacing: 1.5 }}
            >
              Al día
            </Text>
          </Row>
          <Text variant="display" weight="extrabold">
            No debes nada
          </Text>
          <Text variant="caption" color="#A9C9B4">
            Tu próximo pago es el {formatLongDate(entry.subscription.nextBillingDate)} por{' '}
            {formatPENShort(entry.plan.priceCents)}.
          </Text>
        </View>
      )}

      {receivable.due ? (
        <Card radius={theme.radii.xxl} style={{ marginTop: 16 }}>
          <Stack gap={14}>
            <Row align="baseline">
              <Text variant="caption" color={theme.colors.textSecondary}>
                Deuda pendiente
              </Text>
              <Text variant="display" weight="extrabold">
                {formatPEN(receivable.amountCents)}
              </Text>
            </Row>
            <Divider />
            <Row>
              <Text variant="captionSmall" color={theme.colors.textSecondary}>
                Cubre
              </Text>
              <Text variant="captionSmall" weight="semibold">
                {formatShortDate(receivable.fromDate)} — {formatShortDate(receivable.throughDate)}
              </Text>
            </Row>
            <Row>
              <Text variant="captionSmall" color={theme.colors.textSecondary}>
                {receivable.periodsOwed === 1 ? 'Mensualidad' : 'Mensualidades'}
              </Text>
              <Text variant="captionSmall" weight="semibold">
                {receivable.periodsOwed} × {formatPENShort(receivable.perPeriodCents)}
              </Text>
            </Row>
            {receivable.capped ? (
              <Text variant="micro" color={theme.colors.textTertiary}>
                Hay más meses vencidos. Recepción confirma el total exacto al momento de cobrar.
              </Text>
            ) : null}
          </Stack>
        </Card>
      ) : null}

      <Stack gap={12} style={{ marginTop: 16 }}>
        <Eyebrow>Cómo funciona el corte</Eyebrow>
        <Card radius={theme.radii.xl}>
          <Stack gap={14}>
            <TimelineStep
              date={formatShortDate(entry.subscription.nextBillingDate)}
              title="Fecha de cobro"
              detail={`Se paga por adelantado el mes que empieza: ${formatPENShort(entry.plan.priceCents)}.`}
              state={receivable.due ? 'done' : 'future'}
            />
            <TimelineStep
              date={`${entry.tenant.graceDays} días`}
              title="Periodo de gracia"
              detail="Sigues entrenando mientras pagas."
              state={
                receivable.due && !suspended ? 'current' : receivable.due ? 'done' : 'future'
              }
            />
            <TimelineStep
              date={formatShortDate(delinquency.suspensionDate)}
              title="Suspensión"
              detail="El QR deja de validar en la puerta hasta que se registre el pago."
              state={suspended ? 'current' : 'future'}
            />
          </Stack>
        </Card>
      </Stack>

      <Stack gap={10} style={{ marginTop: 22 }}>
        <View
          style={{
            backgroundColor: withAlpha(theme.semaphore.ok, 0.07),
            borderWidth: 1,
            borderColor: withAlpha(theme.semaphore.ok, 0.2),
            borderRadius: theme.radii.md,
            padding: 14,
          }}
        >
          <Text variant="captionSmall" color="#A9C9B4">
            Los pagos se registran en mostrador: efectivo, Yape o transferencia. Recepción escanea
            tu QR, cobra y tu acceso se libera al instante.
          </Text>
        </View>
        <Button label="Mostrar mi QR en mostrador" onPress={() => router.replace('/student/qr')} />
      </Stack>
    </Screen>
  );
}

type StepState = 'done' | 'current' | 'future';

function TimelineStep({
  date,
  title,
  detail,
  state,
}: {
  readonly date: string;
  readonly title: string;
  readonly detail: string;
  readonly state: StepState;
}) {
  const theme = useTheme();
  const color =
    state === 'current'
      ? theme.semaphore.warn
      : state === 'done'
        ? theme.colors.textSecondary
        : theme.colors.textDisabled;

  return (
    <Row gap={12} align="flex-start" justify="flex-start">
      <View style={{ paddingTop: 6 }}>
        {state === 'future' ? (
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              borderWidth: 2,
              borderColor: theme.colors.textDisabled,
            }}
          />
        ) : (
          <Dot color={color} size={8} />
        )}
      </View>
      <Stack gap={1} style={{ flex: 1 }}>
        <Text
          variant="bodySmall"
          weight="semibold"
          color={state === 'future' ? theme.colors.textSecondary : theme.colors.ink}
        >
          {date} · {title}
        </Text>
        <Text variant="captionSmall" color={theme.colors.textSecondary}>
          {detail}
        </Text>
      </Stack>
    </Row>
  );
}
