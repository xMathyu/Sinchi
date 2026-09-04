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
import { CargandoSeccion } from '../../src/design/loading';
import { EstadoSinConexion } from '../../src/design/empty';
import { VideoDeRutina } from '../../src/design/video';
import { useTheme } from '../../src/design/theme';
import { useRutina } from '../../src/data/hooks';
import { useRole } from '../../src/data/session-hooks';
import { formatIsoDay, nivelCorto } from '../../src/lib/format';
import type { PasoDto } from '../../src/data/api';

export default function RutinaScreen() {
  const theme = useTheme();
  const { routineId, membershipId, slug } = useLocalSearchParams<{
    routineId: string;
    membershipId?: string;
    slug?: string;
  }>();

  const { rutina, error, cargando, recargar } = useRutina(routineId, {
    ...(membershipId === undefined ? {} : { membershipId }),
    ...(slug === undefined ? {} : { slug }),
  });

  // Solo el dueño de ESTE local la edita: quien la mira desde el directorio o
  // desde su membresía no es staff de aquí aunque lo sea de otro sitio.
  const puedeEditar =
    useRole() === 'owner' && membershipId === undefined && slug === undefined;

  if (cargando) return <CargandoSeccion texto="Abriendo la rutina…" />;

  if (rutina === null) {
    return (
      <Screen>
        <Row style={{ paddingTop: 8 }}>
          <Volver />
        </Row>
        <View style={{ flex: 1 }}>
          <EstadoSinConexion
            titulo="No se pudo abrir la rutina"
            cuerpo="No llegamos al servidor. Vuelve a intentarlo en un momento."
            error={error ?? 'Esta rutina no está disponible.'}
            onReintentar={recargar}
          />
        </View>
      </Screen>
    );
  }

  if (!rutina.unlocked) {
    const mensaje = routineAccessMessage(rutina.reason);
    return (
      <Screen scroll>
        <Row style={{ paddingTop: 8 }}>
          <Volver />
        </Row>

        <Stack gap={6} style={{ marginTop: 20 }}>
          <Text variant="title" weight="bold">
            {rutina.teaser.title}
          </Text>
          {rutina.teaser.summary === null ? null : (
            <Text variant="bodySmall" color={theme.colors.textSecondary}>
              {rutina.teaser.summary}
            </Text>
          )}
          <Text variant="micro" color={theme.colors.textFaint}>
            {[
              nivelCorto(rutina.teaser.level),
              rutina.teaser.itemCount === 0
                ? null
                : `${rutina.teaser.itemCount} ${rutina.teaser.itemCount === 1 ? 'paso' : 'pasos'}`,
            ]
              .filter((parte) => parte !== null)
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
                {mensaje.title}
              </Text>
            </Row>
            <Text variant="captionSmall" color={theme.colors.textSecondary}>
              {mensaje.detail}
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

  const { routine, itemCount } = rutina.card;
  const publica = routine.visibility === 'public';

  return (
    <Screen scroll>
      <Row style={{ paddingTop: 8 }}>
        <Volver />
        {puedeEditar ? (
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
          {puedeEditar ? (
            <Badge
              label={publica ? 'PÚBLICA' : 'ALUMNOS'}
              color={publica ? theme.semaphore.ok : theme.colors.textSecondary}
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
            nivelCorto(routine.level),
            itemCount === 0 ? null : `${itemCount} ${itemCount === 1 ? 'paso' : 'pasos'}`,
            routine.status === 'draft' ? 'Sin publicar' : null,
            `Actualizada el ${formatIsoDay(routine.updatedAt)}`,
          ]
            .filter((parte) => parte !== null)
            .join(' · ')}
        </Text>
      </Stack>

      {routine.videoUrl === null ? null : (
        <View style={{ marginTop: 18 }}>
          <VideoDeRutina url={routine.videoUrl} etiqueta={routine.title} alto={190} />
        </View>
      )}

      {rutina.items.length === 0 ? null : (
        <Stack gap={12} style={{ marginTop: 26 }}>
          <Eyebrow>Paso a paso</Eyebrow>
          {rutina.items.map((paso, indice) => (
            <Paso key={paso.id} paso={paso} numero={indice + 1} />
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
function Paso({ paso, numero }: { readonly paso: PasoDto; readonly numero: number }) {
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
              {numero}
            </Text>
          </View>
          <Stack gap={2} style={{ flex: 1 }}>
            <Text variant="bodySmall" weight="semibold">
              {paso.title}
            </Text>
            {paso.prescription === null ? null : (
              <Text variant="micro" color={theme.semaphore.ok}>
                {paso.prescription}
              </Text>
            )}
          </Stack>
        </Row>

        {paso.instructions === null ? null : (
          <Text variant="captionSmall" color={theme.colors.textSecondary}>
            {paso.instructions}
          </Text>
        )}

        {paso.videoUrl === null ? null : (
          <VideoDeRutina url={paso.videoUrl} etiqueta={paso.title} alto={148} />
        )}
      </Stack>
    </Card>
  );
}

function Volver() {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={16}>
      <Text variant="body" color={theme.colors.textSecondary}>
        ‹ Volver
      </Text>
    </Pressable>
  );
}
