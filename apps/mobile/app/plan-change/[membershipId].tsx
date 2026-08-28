/**
 * Cambio de plan.
 *
 * La pantalla existe para hacer visible la regla antes de confirmar (MD 4.2):
 * subir se cobra hoy prorrateado, bajar se aplica en la proxima renovacion. Un
 * alumno que entiende por que le cobran S/ 14 no escribe al gimnasio.
 *
 * En la version 1 el diferencial del upgrade queda como cargo por cobrar en
 * mostrador, porque no hay tarjeta que debitar.
 */
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { decidePlanChange, formatPENShort, weekdayInitial, type Plan } from '@sinchi/shared';
import { withAlpha } from '@sinchi/ui';
import { Button, Card, Eyebrow, Row, Stack, Text } from '../../src/design/primitives';
import { Screen } from '../../src/design/screen';
import { useTheme } from '../../src/design/theme';
import { useMembership, usePlansFor, useToday } from '../../src/data/hooks';
import { cambiarPlan } from '../../src/data/actions';

export default function PlanChangeScreen() {
  const theme = useTheme();
  const today = useToday();
  const { membershipId } = useLocalSearchParams<{ membershipId: string }>();
  const entry = useMembership(membershipId);
  // Los planes se piden a la api. `state.plans` solo tiene el plan actual del
  // alumno, asi que filtrarlo dejaba la lista vacia y no habia a que cambiarse.
  const { plans, cargando, error: errorPlanes } = usePlansFor(membershipId);

  const options = plans.filter(
    (plan) => plan.tenantId === entry.tenant.id && plan.active && plan.id !== entry.plan.id,
  );
  const [targetId, setTargetId] = useState<string | null>(null);
  const target = options.find((plan) => plan.id === targetId) ?? null;

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decision =
    target === null
      ? null
      : decidePlanChange({
          subscription: entry.subscription,
          currentPlan: entry.plan,
          targetPlan: target,
          today,
        });

  return (
    <Screen scroll>
      <Row style={{ paddingTop: 10 }}>
        <Pressable accessibilityRole="button" onPress={() => router.back()}>
          <Text variant="body" color={theme.colors.textSecondary}>
            Cancelar
          </Text>
        </Pressable>
        <Text variant="heading" weight="semibold">
          Cambiar de plan
        </Text>
        <View style={{ width: 56 }} />
      </Row>

      <Stack gap={8} style={{ marginTop: 20 }}>
        <Eyebrow>Plan actual</Eyebrow>
        <Card radius={theme.radii.lg}>
          <Row>
            <Text variant="heading" weight="semibold">
              {entry.plan.name}
            </Text>
            <Text variant="heading" weight="semibold">
              {formatPENShort(entry.plan.priceCents)}
            </Text>
          </Row>
        </Card>
      </Stack>

      <Stack gap={10} style={{ marginTop: 20 }}>
        <Eyebrow>Cambiar a</Eyebrow>
        {cargando && options.length === 0 ? (
          <Text variant="bodySmall" color={theme.colors.textSecondary}>
            Cargando los planes del gimnasio…
          </Text>
        ) : options.length === 0 ? (
          <Card radius={theme.radii.lg}>
            <Text variant="bodySmall" color={theme.colors.textSecondary} align="center">
              {errorPlanes ?? 'Este gimnasio no tiene otros planes activos ahora mismo.'}
            </Text>
          </Card>
        ) : (
          options.map((plan) => (
            <PlanOption
              key={plan.id}
              plan={plan}
              selected={plan.id === targetId}
              currentPriceCents={entry.plan.priceCents}
              onPress={() => setTargetId(plan.id)}
            />
          ))
        )}
      </Stack>

      {decision === null ? null : (
        <View
          style={{
            marginTop: 20,
            borderRadius: theme.radii.lg,
            padding: 16,
            backgroundColor:
              decision.kind === 'upgrade'
                ? withAlpha(theme.semaphore.warn, 0.09)
                : withAlpha(theme.semaphore.ok, 0.07),
            borderWidth: 1,
            borderColor:
              decision.kind === 'upgrade'
                ? withAlpha(theme.semaphore.warn, 0.22)
                : withAlpha(theme.semaphore.ok, 0.2),
          }}
        >
          <Stack gap={8}>
            <Eyebrow color={decision.kind === 'upgrade' ? theme.semaphore.warn : theme.semaphore.ok}>
              {decision.kind === 'upgrade'
                ? 'Se cobra hoy'
                : decision.kind === 'downgrade'
                  ? 'Se aplica en tu renovación'
                  : 'Sin costo'}
            </Eyebrow>
            <Text variant="displaySmall" weight="extrabold">
              {decision.kind === 'downgrade'
                ? formatPENShort(decision.chargeTodayCents)
                : formatPENShort(decision.kind === 'no_change' ? entry.plan.priceCents : decision.chargeTodayCents)}
            </Text>
            <Text variant="captionSmall" color={theme.colors.textStrong}>
              {explain(decision, entry.subscription.nextBillingDate.day)}
            </Text>
          </Stack>
        </View>
      )}

      <View style={{ marginTop: 22, gap: 10 }}>
        <Button
          label={
            decision?.kind === 'upgrade'
              ? guardando
                ? 'Cambiando…'
                : `Subir de plan y pagar ${formatPENShort(decision.chargeTodayCents)} en mostrador`
              : decision?.kind === 'downgrade'
                ? 'Programar el cambio'
                : 'Confirmar cambio'
          }
          disabled={target === null || decision?.kind === 'no_change' || guardando}
          onPress={() => {
            if (target === null || guardando) return;
            setGuardando(true);
            setError(null);
            void cambiarPlan(entry.membership.id, target.id)
              .then(() => router.back())
              .catch((causa: unknown) => {
                setError(
                  causa instanceof Error ? causa.message : 'No se pudo cambiar el plan.',
                );
              })
              .finally(() => setGuardando(false));
          }}
        />
        {error === null ? null : (
          <Text variant="captionSmall" color={theme.semaphore.bad} align="center">
            {error}
          </Text>
        )}
      </View>
    </Screen>
  );
}

function explain(
  decision: ReturnType<typeof decidePlanChange>,
  billingDay: number,
): string {
  switch (decision.kind) {
    case 'upgrade':
      return `Solo la diferencia por los ${decision.proration.daysRemaining} días que faltan del mes, de ${decision.proration.daysInPeriod} en total. Tu fecha de cobro sigue siendo el ${billingDay} de cada mes.`;
    case 'downgrade':
      return `No se cobra nada hoy y no hay devoluciones. Desde tu próxima renovación pagas ${formatPENShort(decision.monthlySavingsCents)} menos al mes.`;
    case 'lateral':
      return 'Mismo precio, así que el cambio entra de inmediato sin ningún cargo.';
    case 'no_change':
      return 'Es el plan que ya tienes.';
  }
}

function PlanOption({
  plan,
  selected,
  currentPriceCents,
  onPress,
}: {
  readonly plan: Plan;
  readonly selected: boolean;
  readonly currentPriceCents: number;
  readonly onPress: () => void;
}) {
  const theme = useTheme();
  const isUpgrade = plan.priceCents > currentPriceCents;

  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ selected }} onPress={onPress}>
      <Card
        radius={theme.radii.lg}
        borderColor={selected ? withAlpha(theme.semaphore.ok, 0.4) : theme.colors.hairline}
      >
        <Row align="flex-start">
          <Stack gap={4} style={{ flex: 1 }}>
            <Text variant="heading" weight="semibold">
              {plan.name}
            </Text>
            <Text variant="captionSmall" color={theme.colors.textSecondary}>
              {describePlan(plan)}
            </Text>
          </Stack>
          <Stack gap={2} style={{ alignItems: 'flex-end' }}>
            <Text variant="heading" weight="semibold">
              {formatPENShort(plan.priceCents)}
            </Text>
            <Text
              variant="micro"
              color={isUpgrade ? theme.semaphore.warn : theme.semaphore.ok}
            >
              {isUpgrade ? 'sube' : plan.priceCents === currentPriceCents ? 'igual' : 'baja'}
            </Text>
          </Stack>
        </Row>
      </Card>
    </Pressable>
  );
}

function describePlan(plan: Plan): string {
  const days =
    plan.allowedDays === null
      ? 'cualquier día'
      : plan.allowedDays.map(weekdayInitial).join(' · ');

  switch (plan.type) {
    case 'unlimited':
      return `Sin límite de sesiones · ${days}`;
    case 'sessions_per_week':
      return `${plan.sessionsPerWeek} sesiones por semana · ${days}`;
    case 'fixed_days':
      return `Días fijos · ${days}`;
  }
}
