/**
 * Clases y precios: todo lo que el gimnasio ofrece, detrás de una sola puerta.
 *
 * Eran tres pantallas con dos entradas separadas en el padrón —«Horarios» arriba
 * y «Planes y precios» abajo, con cuatro filas en medio— y el precio de la
 * matrícula escondido dentro de la segunda. Responden a la misma pregunta del
 * dueño, «¿qué ofrezco?», y por separado se notaba en el peor momento: recién
 * dado de alta, la app lo llevaba a Planes y nada lo llevaba después a Horarios.
 * Sin horario su gimnasio sale en el directorio como «0 clases por semana» y
 * nadie puede reservar.
 *
 * PESTAÑAS Y NO UNA PANTALLA LARGA. Se leen distinto —los planes por precio, el
 * horario por día («¿qué doy los martes?»)— y en una sola lista cada una le
 * estorbaría a la otra. Las tres quedan MONTADAS aunque no se vean: cambiar de
 * pestaña no puede borrarle al dueño la matrícula que estaba escribiendo.
 *
 * Con `?setup=1` es la guía del alta: primero los planes, después el horario.
 * Los planes antes porque sin uno no se puede inscribir a nadie; el horario
 * después porque es lo que lo pone en el directorio.
 */
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { withAlpha } from '@sinchi/ui';
import { Button, Card, Eyebrow, Row, SegmentedControl, Stack, Text } from '../src/design/primitives';
import { Screen } from '../src/design/screen';
import { useTheme } from '../src/design/theme';
import { PlansPanel } from '../src/design/plans-panel';
import { SchedulesPanel } from '../src/design/schedules-panel';
import { PricingPanel } from '../src/design/pricing-panel';
import { useOwnerPlans, useOwnerSchedules } from '../src/data/hooks';
import { useRole } from '../src/data/session-hooks';

type Tab = 'plans' | 'schedules' | 'pricing';

const TABS: readonly { readonly value: Tab; readonly label: string }[] = [
  { value: 'plans', label: 'Planes' },
  { value: 'schedules', label: 'Horarios' },
  { value: 'pricing', label: 'Otros cobros' },
];

const isTab = (value: string | undefined): value is Tab =>
  TABS.some((tab) => tab.value === value);

export default function OfferingScreen() {
  const theme = useTheme();
  // De la sesión: el del store llega con el padrón, y esta pantalla se abre
  // sola desde un enlace.
  const isOwner = useRole() === 'owner';
  const params = useLocalSearchParams<{ tab?: string; setup?: string }>();
  const setup = params.setup === '1';
  const [tab, setTab] = useState<Tab>(isTab(params.tab) ? params.tab : 'plans');

  // Los traen aquí y no cada panel: la guía necesita saber cuántos hay para
  // dejar pasar al paso siguiente, y dos peticiones son dos listas que pueden no
  // coincidir.
  const { plans, error: plansError, loading: plansLoading } = useOwnerPlans();
  const { schedules, error: schedulesError, loading: schedulesLoading } = useOwnerSchedules();
  const activePlans = plans?.filter((row) => row.plan.active).length ?? 0;
  const activeSchedules = schedules?.filter((row) => row.active).length ?? 0;

  return (
    <Screen scroll>
      <Row style={{ paddingTop: 8 }}>
        <Text variant="titleSmall" weight="bold">
          Clases y precios
        </Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={16}>
          <Text variant="body" color={theme.colors.textSecondary}>
            Cerrar
          </Text>
        </Pressable>
      </Row>

      {setup && tab !== 'pricing' ? (
        <Eyebrow color={theme.semaphore.ok} style={{ marginTop: 10 }}>
          {tab === 'plans' ? 'Paso 1 de 2 · Tus planes' : 'Paso 2 de 2 · Tu horario'}
        </Eyebrow>
      ) : null}

      <View style={{ marginTop: 14, marginBottom: 8 }}>
        <SegmentedControl options={TABS} value={tab} onChange={setTab} />
      </View>

      <View style={{ display: tab === 'plans' ? 'flex' : 'none' }}>
        <PlansPanel isOwner={isOwner} plans={plans} error={plansError} loading={plansLoading} />
      </View>
      <View style={{ display: tab === 'schedules' ? 'flex' : 'none' }}>
        <SchedulesPanel
          isOwner={isOwner}
          schedules={schedules}
          error={schedulesError}
          loading={schedulesLoading}
        />
      </View>
      <View style={{ display: tab === 'pricing' ? 'flex' : 'none' }}>
        <PricingPanel isOwner={isOwner} />
      </View>

      {setup && isOwner && tab === 'plans' ? (
        <SetupStep
          body="Sin un plan no puedes inscribir a nadie: el alta de un alumno pide en cuál entra."
          label="Siguiente: tu horario"
          ready={activePlans > 0}
          blockedHint="Escribe tu primer plan antes de seguir."
          onNext={() => setTab('schedules')}
        />
      ) : null}
      {setup && isOwner && tab === 'schedules' ? (
        <SetupStep
          body={
            activeSchedules > 0
              ? 'Tu horario ya sale en el directorio. Lo cambias cuando quieras desde el padrón, en «Clases y precios».'
              : 'Hasta que publiques tu horario, tu gimnasio sale como «0 clases por semana» y nadie puede reservar.'
          }
          // Se puede dejar para después, y se dice: no tener horario hoy no
          // impide inscribir a nadie, y retener al dueño aquí es peor que dejarlo
          // salir sabiendo lo que le falta.
          label={activeSchedules > 0 ? 'Listo' : 'Lo hago después'}
          ready
          onNext={() => router.back()}
        />
      ) : null}
    </Screen>
  );
}

/** El pie de cada paso de la guía: qué falta y el botón para seguir. */
function SetupStep({
  body,
  label,
  ready,
  blockedHint,
  onNext,
}: {
  readonly body: string;
  readonly label: string;
  readonly ready: boolean;
  readonly blockedHint?: string;
  readonly onNext: () => void;
}) {
  const theme = useTheme();
  const [attempted, setAttempted] = useState(false);

  return (
    <Card borderColor={withAlpha(theme.semaphore.ok, 0.3)} style={{ marginBottom: 32 }}>
      <Stack gap={12}>
        <Text variant="captionSmall" color={theme.colors.textSecondary}>
          {body}
        </Text>
        <Button
          label={label}
          disabled={!ready}
          onPress={onNext}
          onBlockedPress={() => setAttempted(true)}
        />
        {attempted && !ready && blockedHint !== undefined ? (
          <Text variant="caption" color={theme.semaphore.bad} align="center">
            {blockedHint}
          </Text>
        ) : null}
      </Stack>
    </Card>
  );
}
