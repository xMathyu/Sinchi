/**
 * Planes y precios: lo que el gimnasio vende. Es la primera pestaña de «Clases
 * y precios» (`app/offering.tsx`).
 *
 * Faltaba entera, y su ausencia dejaba un agujero raro en el producto: un local
 * podía darse de alta desde la app en dos minutos y después no tenía forma de
 * escribir su propia tarifa. Los planes solo nacían de un script nuestro, así
 * que el dueño que se registraba un martes dependía de que alguien de aquí le
 * sembrara los precios a mano para poder inscribir a su primer alumno.
 *
 * Dos decisiones que se ven en la pantalla:
 *
 *  - **cada plan dice cuánta gente lo tiene.** Es el dato que convierte
 *    "archivar" en una decisión y no en una apuesta: subir un precio es archivar
 *    el viejo y escribir el nuevo, y el dueño necesita saber a cuántos les está
 *    tocando la cuota antes de hacerlo;
 *
 *  - **los archivados se ven, apagados y abajo.** Esconderlos hacía imposible
 *    entender por qué "Ilimitado" no salía en el alta de un alumno.
 *
 * Es solo del dueño: la api responde 403 a recepción, y una pantalla que se abre
 * para enseñar un error no debería poder abrirse.
 *
 * Los datos los trae la pantalla y no el panel: la guía del alta necesita saber
 * cuántos planes hay para dejar pasar al paso de los horarios, y pedirlos dos
 * veces es dos listas que pueden no coincidir.
 */
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { formatPEN, planPriceUnit, planShape, weekdayInitial, type Cents } from '@sinchi/shared';
import { withAlpha } from '@sinchi/ui';
import { Button, Card, Eyebrow, Row, Stack, Text } from './primitives';
import { useTheme } from './theme';
import type { PlanWithUsage } from '../data/api';

export function PlansPanel({
  isOwner,
  plans,
  error,
  loading,
}: {
  readonly isOwner: boolean;
  readonly plans: readonly PlanWithUsage[] | null;
  readonly error: string | null;
  readonly loading: boolean;
}) {
  const theme = useTheme();

  const active = plans?.filter((p) => p.plan.active) ?? [];
  const archivados = plans?.filter((p) => !p.plan.active) ?? [];

  return (
    <View>
      {!isOwner ? (
        <Card tone="sunken" style={{ marginTop: 20 }}>
          <Text variant="bodySmall" color={theme.colors.textSecondary}>
            Los precios los decide el dueño del local. Recepción puede verlos al inscribir a
            alguien, pero no cambiarlos.
          </Text>
        </Card>
      ) : (
        <>
          <Text variant="captionSmall" color={theme.colors.textSecondary} style={{ marginTop: 6 }}>
            Lo que cobras por entrenar aquí. Cambiar un precio afecta a los cobros de adelante,
            nunca a los que ya hiciste.
          </Text>

          {error !== null && (
            <Card tone="sunken" borderColor={theme.semaphore.bad} style={{ marginTop: 16 }}>
              <Text variant="bodySmall" color={theme.semaphore.bad}>
                {error}
              </Text>
            </Card>
          )}

          <Stack gap={10} style={{ marginTop: 20 }}>
            <Row>
              <Eyebrow>Se ofrecen</Eyebrow>
              <Text variant="micro" color={theme.colors.textFaint}>
                {active.length} {active.length === 1 ? 'plan' : 'planes'}
              </Text>
            </Row>

            {loading ? (
              <Text variant="bodySmall" color={theme.colors.textSecondary}>
                Trayendo tus planes…
              </Text>
            ) : active.length === 0 ? (
              <Card tone="sunken">
                <Stack gap={14}>
                  <Text variant="bodySmall" color={theme.colors.textSecondary} align="center">
                    No tienes ningún plan activo. Sin planes no puedes inscribir a nadie: el alta de
                    un alumno pide en cuál lo pones.
                  </Text>
                  <Button label="Escribir el primero" onPress={() => router.push('/plans/nuevo')} />
                </Stack>
              </Card>
            ) : (
              active.map((row) => <PlanRow key={row.plan.id} row={row} />)
            )}
          </Stack>

          {active.length > 0 && (
            <Button
              label="+ Nuevo plan"
              variant="secondary"
              style={{ marginTop: 14 }}
              onPress={() => router.push('/plans/nuevo')}
            />
          )}

          {archivados.length > 0 && (
            <Stack gap={10} style={{ marginTop: 26 }}>
              <Eyebrow>Archivados</Eyebrow>
              <Text variant="micro" color={theme.colors.textFaint}>
                Ya no se ofrecen, pero quien los tiene los conserva. Es como se sube un precio sin
                tocarle la cuota a los alumnos de antes.
              </Text>
              {archivados.map((row) => (
                <PlanRow key={row.plan.id} row={row} />
              ))}
            </Stack>
          )}

          <View style={{ height: 24 }} />
        </>
      )}
    </View>
  );
}

function PlanRow({ row }: { readonly row: PlanWithUsage }) {
  const theme = useTheme();
  const { plan, activeMembers } = row;

  const days =
    plan.allowedDays === null ? null : plan.allowedDays.map(weekdayInitial).join(' · ');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Editar ${plan.name}`}
      onPress={() => router.push(`/plans/${plan.id}`)}
    >
      <Card
        radius={theme.radii.lg}
        // Lo archivado se lee apagado, no escondido: sin verlo, nadie entiende
        // por qué "Ilimitado" no sale en el alta de un alumno.
        style={{ opacity: plan.active ? 1 : 0.55 }}
        borderColor={plan.active ? theme.colors.hairline : theme.colors.borderDashed}
      >
        <Row align="flex-start">
          <Stack gap={3} style={{ flex: 1, paddingRight: 12 }}>
            <Text variant="heading" weight="semibold" numberOfLines={1}>
              {plan.name}
            </Text>
            <Text variant="captionSmall" color={theme.colors.textSecondary} numberOfLines={1}>
              {planShape(plan)}
              {days === null ? '' : ` · ${days}`}
            </Text>
            {activeMembers > 0 ? (
              <Text variant="micro" color={theme.colors.textFaint}>
                {activeMembers} {activeMembers === 1 ? 'alumno' : 'alumnos'}
              </Text>
            ) : (
              <Text variant="micro" color={theme.colors.textFaint}>
                Todavía no lo tiene nadie
              </Text>
            )}
          </Stack>

          <Stack gap={1} style={{ alignItems: 'flex-end' }}>
            <Text variant="heading" weight="bold">
              {formatPEN(plan.priceCents as Cents, { withDecimals: false })}
            </Text>
            <Text variant="micro" color={theme.colors.textFaint}>
              {planPriceUnit(plan.type)}
            </Text>
            {!plan.active && (
              <View
                style={{
                  marginTop: 4,
                  paddingHorizontal: 7,
                  paddingVertical: 2,
                  borderRadius: theme.radii.pill,
                  backgroundColor: withAlpha(theme.colors.textFaint, 0.16),
                }}
              >
                <Text variant="micro" color={theme.colors.textSecondary}>
                  archivado
                </Text>
              </View>
            )}
          </Stack>
        </Row>
      </Card>
    </Pressable>
  );
}
