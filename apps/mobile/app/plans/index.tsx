/**
 * Planes y precios: lo que el gimnasio vende.
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
 */
import { Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { formatPEN, planPriceUnit, planShape, weekdayInitial, type Cents } from '@sinchi/shared';
import { withAlpha } from '@sinchi/ui';
import { Button, Card, Eyebrow, Row, Stack, Text } from '../../src/design/primitives';
import { Screen } from '../../src/design/screen';
import { useTheme } from '../../src/design/theme';
import { usePlanesDelDueno, useStore } from '../../src/data/hooks';
import type { PlanConUso } from '../../src/data/api';

export default function PlanesScreen() {
  const theme = useTheme();
  const esDueno = useStore((s) => s.staff.role) === 'owner';
  const { planes, error, cargando } = usePlanesDelDueno();

  const activos = planes?.filter((p) => p.plan.active) ?? [];
  const archivados = planes?.filter((p) => !p.plan.active) ?? [];

  return (
    <Screen scroll>
      <Row style={{ paddingTop: 8 }}>
        <Text variant="titleSmall" weight="bold">
          Planes y precios
        </Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={16}>
          <Text variant="body" color={theme.colors.textSecondary}>
            Cerrar
          </Text>
        </Pressable>
      </Row>

      {!esDueno ? (
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
                {activos.length} {activos.length === 1 ? 'plan' : 'planes'}
              </Text>
            </Row>

            {cargando ? (
              <Text variant="bodySmall" color={theme.colors.textSecondary}>
                Trayendo tus planes…
              </Text>
            ) : activos.length === 0 ? (
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
              activos.map((fila) => <FilaDePlan key={fila.plan.id} fila={fila} />)
            )}
          </Stack>

          {activos.length > 0 && (
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
              {archivados.map((fila) => (
                <FilaDePlan key={fila.plan.id} fila={fila} />
              ))}
            </Stack>
          )}

          <Stack gap={10} style={{ marginTop: 26 }}>
            <Eyebrow>Aparte de los planes</Eyebrow>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/pricing')}
            >
              <Card radius={theme.radii.lg}>
                <Row>
                  <Stack gap={2} style={{ flex: 1, paddingRight: 12 }}>
                    <Text variant="bodySmall" weight="semibold">
                      Matrícula, clase suelta y clase de prueba
                    </Text>
                    <Text variant="captionSmall" color={theme.colors.textSecondary}>
                      Lo que se cobra al inscribirse, al pasarse del cupo y al venir a conocer.
                    </Text>
                  </Stack>
                  <Text variant="body" color={theme.colors.textTertiary}>
                    ›
                  </Text>
                </Row>
              </Card>
            </Pressable>
          </Stack>

          <View style={{ height: 24 }} />
        </>
      )}
    </Screen>
  );
}

function FilaDePlan({ fila }: { readonly fila: PlanConUso }) {
  const theme = useTheme();
  const { plan, activeMembers } = fila;

  const dias =
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
              {dias === null ? '' : ` · ${dias}`}
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
