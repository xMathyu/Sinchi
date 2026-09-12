/**
 * Una rutina abierta: sus videos y sus instrucciones.
 *
 * La misma pantalla la abren tres personas distintas —el dueño desde su
 * biblioteca, el alumno desde su gimnasio y alguien que no entrena en ningún
 * sitio desde el directorio— y por eso el origen viaja en los parámetros:
 * `slug` = desde la calle, `membershipId` = como alumno de ese local, ninguno de
 * los dos = como staff del suyo.
 *
 * Quien decide qué se enseña NO es esta pantalla: es la api. Cuando la rutina es
 * de alumnos y quien mira no lo es, el cuerpo llega sin videos y sin
 * instrucciones, y aquí solo queda pintar el candado. Filtrar aquí habría sido
 * decorativo —el JSON viaja igual— y esa diferencia es justo lo que separa
 * «contenido exclusivo» de «contenido con una etiqueta que dice exclusivo».
 *
 * El candado no es un error: es la única pantalla del producto donde alguien de
 * fuera está mirando algo que quiere. Por eso lleva el botón de probar una clase
 * y no un «no tienes acceso» a secas.
 */
import { Pressable, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import Lock from 'lucide-react-native/icons/lock';
import { routineAccessMessage } from '@sinchi/shared';
import { withAlpha } from '@sinchi/ui';
import { Badge, Button, Card, Eyebrow, Row, Stack, Text } from '../../src/design/primitives';
import { Screen } from '../../src/design/screen';
import { SectionLoader } from '../../src/design/loading';
import { OfflineState } from '../../src/design/empty';
import { RoutineVideo } from '../../src/design/video';
import { useTheme } from '../../src/design/theme';
import { useRoutine } from '../../src/data/hooks';
import { useRole } from '../../src/data/session-hooks';
import { formatIsoDay, shortLevel } from '../../src/lib/format';
import type { StepDto } from '../../src/data/api';

export default function RoutineScreen() {
  const theme = useTheme();
  const { routineId, membershipId, slug } = useLocalSearchParams<{
    routineId: string;
    membershipId?: string;
    slug?: string;
  }>();

  const { routine: detail, error, loading, reload } = useRoutine(routineId, {
    ...(membershipId === undefined ? {} : { membershipId }),
    ...(slug === undefined ? {} : { slug }),
  });

  // Solo el dueño de ESTE local la edita: quien la mira desde el directorio o
  // desde su membresía no es staff de aquí aunque lo sea de otro sitio.
  const canEdit =
    useRole() === 'owner' && membershipId === undefined && slug === undefined;

  if (loading) return <SectionLoader text="Abriendo la rutina…" />;

  if (detail === null) {
    return (
      <Screen>
        <Row style={{ paddingTop: 8 }}>
          <BackRow />
        </Row>
        <View style={{ flex: 1 }}>
          <OfflineState
            title="No se pudo abrir la rutina"
            body="No llegamos al servidor. Vuelve a intentarlo en un momento."
            error={error ?? 'Esta rutina no está disponible.'}
            onReintentar={reload}
          />
        </View>
      </Screen>
    );
  }

  if (!detail.unlocked) {
    const message = routineAccessMessage(detail.reason);
    return (
      <Screen scroll>
        <Row style={{ paddingTop: 8 }}>
          <BackRow />
        </Row>

        <Stack gap={6} style={{ marginTop: 20 }}>
          <Text variant="title" weight="bold">
            {detail.teaser.title}
          </Text>
          {detail.teaser.summary === null ? null : (
            <Text variant="bodySmall" color={theme.colors.textSecondary}>
              {detail.teaser.summary}
            </Text>
          )}
          <Text variant="micro" color={theme.colors.textFaint}>
            {[
              shortLevel(detail.teaser.level),
              detail.teaser.itemCount === 0
                ? null
                : `${detail.teaser.itemCount} ${detail.teaser.itemCount === 1 ? 'paso' : 'pasos'}`,
            ]
              .filter((part) => part !== null)
              .join(' · ')}
          </Text>
        </Stack>

        {/* El candado, y con él la salida. «No tienes acceso» deja a alguien que
            quiere ver un uchimata mirando una pared. */}
        <Card
          accent={theme.semaphore.alert}
          borderColor={withAlpha(theme.semaphore.alert, 0.28)}
          radius={theme.radii.xl}
          style={{ marginTop: 22 }}
        >
          <Stack gap={12}>
            <Row gap={10} justify="flex-start">
              <Lock size={17} color={theme.semaphore.alert} />
              <Text variant="bodySmall" weight="semibold">
                {message.title}
              </Text>
            </Row>
            <Text variant="captionSmall" color={theme.colors.textSecondary}>
              {message.detail}
            </Text>
            {slug === undefined ? null : (
              <Button
                label="Ver el gimnasio"
                onPress={() => router.replace({ pathname: '/explore/[slug]', params: { slug } })}
              />
            )}
          </Stack>
        </Card>

        <View style={{ height: 28 }} />
      </Screen>
    );
  }

  const { routine, itemCount } = detail.card;
  const isPublic = routine.visibility === 'public';

  return (
    <Screen scroll>
      <Row style={{ paddingTop: 8 }}>
        <BackRow />
        {canEdit ? (
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              router.push({
                pathname: '/routines/edit/[routineId]',
                params: { routineId: routine.id },
              })
            }
            hitSlop={16}
          >
            <Text variant="body" color={theme.colors.textSecondary}>
              Editar
            </Text>
          </Pressable>
        ) : null}
      </Row>

      <Stack gap={8} style={{ marginTop: 18 }}>
        <Row align="flex-start" gap={10}>
          <Text variant="title" weight="bold" style={{ flex: 1 }}>
            {routine.title}
          </Text>
          {canEdit ? (
            <Badge
              label={isPublic ? 'PÚBLICA' : 'ALUMNOS'}
              color={isPublic ? theme.semaphore.ok : theme.colors.textSecondary}
            />
          ) : null}
        </Row>

        {routine.summary === null ? null : (
          <Text variant="bodySmall" color={theme.colors.textSecondary}>
            {routine.summary}
          </Text>
        )}

        <Text variant="micro" color={theme.colors.textFaint}>
          {[
            shortLevel(routine.level),
            itemCount === 0 ? null : `${itemCount} ${itemCount === 1 ? 'paso' : 'pasos'}`,
            routine.status === 'draft' ? 'Sin publicar' : null,
            `Actualizada el ${formatIsoDay(routine.updatedAt)}`,
          ]
            .filter((part) => part !== null)
            .join(' · ')}
        </Text>
      </Stack>

      {routine.videoUrl === null ? null : (
        <View style={{ marginTop: 18 }}>
          <RoutineVideo url={routine.videoUrl} label={routine.title} height={190} />
        </View>
      )}

      {detail.items.length === 0 ? null : (
        <Stack gap={12} style={{ marginTop: 26 }}>
          <Eyebrow>Paso a paso</Eyebrow>
          {detail.items.map((step, index) => (
            <Step key={step.id} step={step} number={index + 1} />
          ))}
        </Stack>
      )}

      <View style={{ height: 32 }} />
    </Screen>
  );
}

/**
 * Un ejercicio o una técnica.
 *
 * El número va delante porque el orden es un dato: un calentamiento después del
 * trabajo fuerte es otra rutina. Las series van en texto libre —«4 series de
 * 12», «5 minutos de uchikomi»— porque en judo las repeticiones no significan
 * nada, y modelar solo el gimnasio de pesas dejaría al dojo rellenando casillas
 * vacías.
 */
function Step({ step, number }: { readonly step: StepDto; readonly number: number }) {
  const theme = useTheme();

  return (
    <Card radius={theme.radii.lg}>
      <Stack gap={10}>
        <Row align="flex-start" gap={10}>
          <View
            style={{
              width: 24,
              height: 24,
              borderRadius: 12,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.colors.surfaceHigh,
            }}
          >
            <Text variant="micro" weight="bold" color={theme.colors.textSecondary}>
              {number}
            </Text>
          </View>
          <Stack gap={2} style={{ flex: 1 }}>
            <Text variant="bodySmall" weight="semibold">
              {step.title}
            </Text>
            {step.prescription === null ? null : (
              <Text variant="micro" color={theme.semaphore.ok}>
                {step.prescription}
              </Text>
            )}
          </Stack>
        </Row>

        {step.instructions === null ? null : (
          <Text variant="captionSmall" color={theme.colors.textSecondary}>
            {step.instructions}
          </Text>
        )}

        {step.videoUrl === null ? null : (
          <RoutineVideo url={step.videoUrl} label={step.title} height={148} />
        )}
      </Stack>
    </Card>
  );
}

function BackRow() {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={16}>
      <Text variant="body" color={theme.colors.textSecondary}>
        ‹ Volver
      </Text>
    </Pressable>
  );
}
