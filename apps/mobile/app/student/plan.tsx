/**
 * A3 · Mi plan y cupo semanal.
 *
 * El cupo se muestra derivado, contando asistencias de la semana ISO: no hay
 * contador guardado que pueda desincronizarse (MD 4.3). Los dias permitidos se
 * pintan siempre, incluso en planes ilimitados, porque es la pregunta que el
 * alumno hace en la puerta.
 */
import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { allWeekdays, formatPENShort, weekdayInitial } from '@sinchi/shared';
import { semaphoreStyle, withAlpha } from '@sinchi/ui';
import { Button, Card, Divider, Eyebrow, Row, Stack, Text } from '../../src/design/primitives';
import { Screen } from '../../src/design/screen';
import { EstadoVacio } from '../../src/design/empty';
import { useTheme } from '../../src/design/theme';
import { useStore, useWallet } from '../../src/data/hooks';
import { railLabel, type MembershipView } from '../../src/data/store';
import { cancelarSuscripcion } from '../../src/data/actions';
import { formatShortDate } from '../../src/lib/format';

export default function PlanScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ membershipId?: string }>();
  const activeTenantId = useStore((state) => state.activeTenantId);
  const wallet = useWallet();

  const entry =
    wallet.find((item) => item.membership.id === params.membershipId) ??
    wallet.find((item) => item.tenant.id === activeTenantId) ??
    wallet[0];

  if (entry === undefined) {
    return (
      <Screen>
        <EstadoVacio
          titulo="Todavía no tienes un plan"
          cuerpo="Cuando te inscribas en un gimnasio verás aquí tu plan, tu cupo de la semana y cuándo te toca renovar."
          pie="Si cancelaste y quieres volver, pídelo en el mostrador: tu ficha y tu historial siguen ahí."
        />
      </Screen>
    );
  }

  const semaphore = semaphoreStyle(theme, entry.level);

  return (
    <Screen scroll>
      <Row justify="flex-start" gap={12} style={{ paddingTop: 10 }}>
        <Text variant="titleSmall" weight="bold">
          {entry.tenant.name}
        </Text>
      </Row>

      <Card radius={theme.radii.xxl} style={{ marginTop: 18 }}>
        <Stack gap={18}>
          <Row align="flex-start">
            <Stack gap={3}>
              <Eyebrow>Plan actual</Eyebrow>
              <Text variant="displaySmall" weight="extrabold">
                {entry.plan.name}
              </Text>
            </Stack>
            <Stack gap={0} style={{ alignItems: 'flex-end' }}>
              <Text variant="titleSmall" weight="bold">
                {formatPENShort(entry.plan.priceCents)}
              </Text>
              <Text variant="micro" color={theme.colors.textTertiary}>
                al mes
              </Text>
            </Stack>
          </Row>

          <Divider />
          <QuotaBlock entry={entry} />
        </Stack>
      </Card>

      <Stack gap={10} style={{ marginTop: 18 }}>
        <Eyebrow>Días permitidos</Eyebrow>
        <Row gap={6} justify="flex-start">
          {allWeekdays().map((day) => {
            const allowed = entry.plan.allowedDays === null || entry.plan.allowedDays.includes(day);
            return (
              <View
                key={day}
                accessibilityLabel={`${weekdayInitial(day)}${allowed ? ' permitido' : ' no permitido'}`}
                style={{
                  flex: 1,
                  aspectRatio: 1,
                  borderRadius: theme.radii.sm,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: allowed ? theme.colors.surfaceHigh : theme.colors.surfaceSunken,
                  borderWidth: allowed ? 0 : 1,
                  borderStyle: allowed ? 'solid' : 'dashed',
                  borderColor: theme.colors.borderStrong,
                }}
              >
                <Text
                  variant="caption"
                  weight={allowed ? 'bold' : 'semibold'}
                  color={allowed ? theme.colors.ink : theme.colors.textDisabled}
                >
                  {weekdayInitial(day)}
                </Text>
              </View>
            );
          })}
        </Row>
      </Stack>

      <Card radius={theme.radii.xl} style={{ marginTop: 18 }}>
        <Stack gap={12}>
          <Row>
            <Text variant="bodySmall" color={theme.colors.textSecondary}>
              {entry.receivable.due ? 'Debes' : 'Próximo cobro'}
            </Text>
            <Text variant="bodySmall" weight="semibold">
              {entry.receivable.due
                ? formatPENShort(entry.receivable.amountCents)
                : `${formatShortDate(entry.subscription.nextBillingDate)} · ${formatPENShort(entry.plan.priceCents)}`}
            </Text>
          </Row>
          <Row>
            <Text variant="bodySmall" color={theme.colors.textSecondary}>
              Cómo pagas
            </Text>
            <Text variant="bodySmall" weight="semibold">
              En mostrador
            </Text>
          </Row>
          {entry.charges[0] === undefined ? null : (
            <Row>
              <Text variant="bodySmall" color={theme.colors.textSecondary}>
                Último pago
              </Text>
              <Text variant="bodySmall" weight="semibold">
                {entry.charges[0].periodStart === null
                  ? railLabel(entry.charges[0].rail)
                  : `${formatShortDate(entry.charges[0].periodStart)} · ${railLabel(entry.charges[0].rail)}`}
              </Text>
            </Row>
          )}
        </Stack>
      </Card>

      {entry.pendingPlan === null ? null : (
        <View
          style={{
            marginTop: 14,
            backgroundColor: withAlpha(theme.semaphore.warn, 0.09),
            borderWidth: 1,
            borderColor: withAlpha(theme.semaphore.warn, 0.22),
            borderRadius: theme.radii.lg,
            padding: 14,
          }}
        >
          <Text variant="captionSmall" color="#D9CFA8">
            Cambio a {entry.pendingPlan.name} programado para el{' '}
            {formatShortDate(entry.subscription.nextBillingDate)}. Hasta entonces sigues con{' '}
            {entry.plan.name}.
          </Text>
        </View>
      )}

      <Stack gap={10} style={{ marginTop: 22 }}>
        <View
          style={{
            backgroundColor: withAlpha(theme.semaphore.warn, 0.09),
            borderWidth: 1,
            borderColor: withAlpha(theme.semaphore.warn, 0.22),
            borderRadius: theme.radii.lg,
            padding: 14,
          }}
        >
          <Text variant="captionSmall" color="#D9CFA8">
            Subir de plan se cobra hoy solo por los días que faltan del mes, prorrateado. Bajar de
            plan se aplica en tu próxima renovación, sin devoluciones.
          </Text>
        </View>

        <Button
          label="Cambiar de plan"
          onPress={() => router.push(`/plan-change/${entry.membership.id}`)}
        />

        {entry.receivable.due ? (
          <Button
            label={`Pagar ${formatPENShort(entry.receivable.amountCents)}`}
            variant="accent"
            accentColor={semaphore.color}
            accentInk={semaphore.ink}
            onPress={() => router.push(`/pay/${entry.membership.id}`)}
          />
        ) : null}

        <CancelButton membershipId={entry.membership.id} gimnasio={entry.tenant.name} />
        <Text variant="micro" color={theme.colors.textFaint} align="center">
          Cancelar no borra tu historial. Volver es un toque, cuando quieras.
        </Text>
      </Stack>
    </Screen>
  );
}

/** Cupo de la semana: numero, barra de sesiones y la regla que lo explica. */
function QuotaBlock({ entry }: { readonly entry: MembershipView }) {
  const theme = useTheme();
  const { quota } = entry;

  if (quota.limit === null) {
    return (
      <Stack gap={11}>
        <Row align="baseline">
          <Text variant="caption" color={theme.colors.textSecondary}>
            Sesiones de esta semana
          </Text>
          <Text variant="caption" weight="bold">
            Sin límite
          </Text>
        </Row>
        <Text variant="micro" color={theme.colors.textTertiary}>
          Pagas el mes y entras cuando quieras.
        </Text>
      </Stack>
    );
  }

  const usedColor = quota.exhausted
    ? theme.semaphore.alert
    : quota.isLastSession
      ? theme.semaphore.warn
      : theme.semaphore.ok;

  return (
    <Stack gap={11}>
      <Row align="baseline">
        <Text variant="caption" color={theme.colors.textSecondary}>
          Sesiones de esta semana
        </Text>
        <Text variant="caption" weight="bold">
          <Text variant="caption" weight="bold" color={usedColor}>
            {quota.used}
          </Text>{' '}
          de {quota.limit}
        </Text>
      </Row>
      <Row gap={7} justify="flex-start">
        {Array.from({ length: quota.limit }, (_, index) => (
          <View
            key={index}
            style={{
              flex: 1,
              height: 8,
              borderRadius: theme.radii.pill,
              backgroundColor: index < quota.used ? usedColor : 'rgba(255,255,255,0.11)',
            }}
          />
        ))}
      </Row>
      <Text variant="micro" color={theme.colors.textTertiary}>
        El cupo se reinicia el lunes. Las sesiones no usadas no se acumulan.
      </Text>
    </Stack>
  );
}

/**
 * Cancelar la suscripción.
 *
 * Dos cambios sobre lo que había. Iba por `cancelSubscription` de `store.ts`, que
 * escribe en memoria: con sesión real la pantalla se pintaba cancelada y la
 * siguiente carga desde la api lo revertía sin decir nada.
 *
 * Y no preguntaba. Un toque en un texto gris, sin confirmación ni deshacer,
 * terminaba la suscripción del alumno — justo al lado del botón de pagar. Es la
 * acción más destructiva de la app y era la más fácil de disparar sin querer.
 */
function CancelButton({
  membershipId,
  gimnasio,
}: {
  readonly membershipId: string;
  readonly gimnasio: string;
}) {
  const theme = useTheme();
  const [cancelando, setCancelando] = useState(false);

  const confirmar = () => {
    Alert.alert(
      `¿Cancelar tu plan en ${gimnasio}?`,
      'Dejarás de renovar y el escáner dejará de validar tu QR al terminar el periodo que ya pagaste. Tu historial se conserva.',
      [
        { text: 'Seguir suscrito', style: 'cancel' },
        {
          text: 'Cancelar el plan',
          style: 'destructive',
          onPress: () => {
            setCancelando(true);
            void cancelarSuscripcion(membershipId)
              .catch((causa: unknown) => {
                Alert.alert(
                  'No se pudo cancelar',
                  causa instanceof Error ? causa.message : 'Intenta de nuevo.',
                );
              })
              .finally(() => setCancelando(false));
          },
        },
      ],
    );
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: cancelando }}
      onPress={cancelando ? undefined : confirmar}
      hitSlop={8}
      style={{ paddingVertical: 10 }}
    >
      <Text variant="caption" color={theme.colors.textTertiary} align="center">
        {cancelando ? 'Cancelando…' : 'Cancelar suscripción'}
      </Text>
    </Pressable>
  );
}
