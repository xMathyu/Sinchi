/**
 * La biblioteca: rutinas y técnicas con sus videos.
 *
 * Es lo primero que el gimnasio ofrece sin que la persona cruce la puerta. El
 * «día de pecho» con sus seis ejercicios y el uchimata explicado paso a paso son
 * la misma cosa aquí, y por eso hay una sola lista.
 *
 * Cada fila lleva delante quién la ve, y no es una etiqueta de estado más: es
 * LA decisión del producto. Una rutina pública es un anuncio —la abre cualquiera
 * desde el directorio, sin cuenta— y una de alumnos es media razón para seguir
 * pagando la mensualidad. El mismo local necesita las dos, así que se cambia de
 * una a otra con un toque en la propia lista, sin abrir el editor.
 *
 * La misma pantalla sirve al alumno: con `membershipId` enseña la biblioteca del
 * gimnasio donde entrena. Es la misma lista mirada por otros ojos, y quien
 * decide qué sale de ella es la api.
 */
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import Globe from 'lucide-react-native/icons/globe';
import Lock from 'lucide-react-native/icons/lock';
import { withAlpha } from '@sinchi/ui';
import { Badge, Button, Card, Row, Stack, Text } from '../../src/design/primitives';
import { Screen } from '../../src/design/screen';
import { MarcadorDeVideo, PortadaDeVideo } from '../../src/design/video';
import { useTheme } from '../../src/design/theme';
import { useBiblioteca } from '../../src/data/hooks';
import { useRole } from '../../src/data/session-hooks';
import { setRoutineAudience } from '../../src/data/actions';
import { shortLevel } from '../../src/lib/format';
import type { RoutineListItem } from '../../src/data/api';

export default function BibliotecaScreen() {
  const theme = useTheme();
  const { membershipId } = useLocalSearchParams<{ membershipId?: string }>();
  const belongsToStudent = membershipId !== undefined;

  /**
   * El rol sale de la SESIÓN y no del store, por lo mismo que en eventos: el
   * store llega con el padrón, y al abrir esta pantalla desde un enlace el dueño
   * se encontraba el vacío pidiéndole crear una rutina y sin el botón para
   * hacerlo.
   */
  const isOwner = useRole() === 'owner' && !belongsToStudent;
  const { biblioteca, error, loading, reload } = useBiblioteca(membershipId);

  const routines = biblioteca?.routines ?? [];

  return (
    <Screen scroll>
      <Row style={{ paddingTop: 8 }}>
        <Text variant="titleSmall" weight="bold">
          Rutinas
        </Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={16}>
          <Text variant="body" color={theme.colors.textSecondary}>
            Cerrar
          </Text>
        </Pressable>
      </Row>

      <Text variant="captionSmall" color={theme.colors.textSecondary} style={{ marginTop: 6 }}>
        {belongsToStudent
          ? 'Lo que tu gimnasio enseña en video: rutinas del día y técnicas paso a paso.'
          : 'Rutinas y técnicas en video. Tú decides cuáles ve cualquiera desde el directorio y cuáles son solo para tus alumnos.'}
      </Text>

      {error !== null && (
        <Card tone="sunken" borderColor={theme.semaphore.bad} style={{ marginTop: 16 }}>
          <Text variant="bodySmall" color={theme.semaphore.bad}>
            {error}
          </Text>
        </Card>
      )}

      <Stack gap={12} style={{ marginTop: 18 }}>
        {loading && (
          <Text variant="bodySmall" color={theme.colors.textSecondary}>
            Trayendo las rutinas…
          </Text>
        )}

        {/* El vacío se calla cuando algo falló: decir «tu gimnasio no publicó
            ninguna» debajo de un error es afirmar un hecho que no sabemos, y el
            alumno se va creyendo que su local no tiene nada. */}
        {!loading && error === null && routines.length === 0 && (
          <Card tone="sunken">
            <Stack gap={14}>
              <Text variant="bodySmall" color={theme.colors.textSecondary} align="center">
                {belongsToStudent
                  ? 'Tu gimnasio todavía no publicó ninguna rutina.'
                  : 'Todavía no tienes ninguna. Un video bien explicado —el uchimata, el día de pecho— es lo que hace que alguien te elija a ti y no al de al lado.'}
              </Text>
              {isOwner && (
                <Button label="Crear la primera" onPress={() => router.push('/routines/edit/nueva')} />
              )}
            </Stack>
          </Card>
        )}

        {routines.map((row) => (
          <RoutineRow
            key={row.routine.id}
            row={row}
            isOwner={isOwner}
            membershipId={membershipId}
            onChange={reload}
          />
        ))}
      </Stack>

      {isOwner && routines.length > 0 && (
        <Button
          label="+ Nueva rutina"
          variant="secondary"
          style={{ marginTop: 14 }}
          onPress={() => router.push('/routines/edit/nueva')}
        />
      )}

      <View style={{ height: 28 }} />
    </Screen>
  );
}

function RoutineRow({
  row,
  isOwner,
  membershipId,
  onChange,
}: {
  readonly row: RoutineListItem;
  readonly isOwner: boolean;
  readonly membershipId: string | undefined;
  readonly onChange: () => void;
}) {
  const theme = useTheme();
  const [switching, setSwitching] = useState(false);
  const { routine, itemCount, coverVideoUrl, hasVideo } = row;

  const draft = routine.status === 'draft';
  const isPublic = routine.visibility === 'public';

  const meta = [
    shortLevel(routine.level),
    itemCount === 0 ? null : `${itemCount} ${itemCount === 1 ? 'paso' : 'pasos'}`,
    draft ? 'Sin publicar' : null,
  ]
    .filter((part) => part !== null)
    .join(' · ');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Abrir ${routine.title}`}
      onPress={() =>
        router.push({
          pathname: '/routines/[routineId]',
          params: {
            routineId: routine.id,
            ...(membershipId === undefined ? {} : { membershipId }),
          },
        })
      }
    >
      <Card radius={theme.radii.lg} style={{ opacity: draft ? 0.6 : 1 }}>
        <Stack gap={12}>
          {/* Un video SUBIDO no trae portada —no hay miniatura sin decodificar
              el primer fotograma, y eso ya es transcodificar— y la api tampoco
              firma su URL para una lista. Se pinta el marcador igual: sin él, la
              tarjeta parece no tener video. */}
          {coverVideoUrl !== null ? (
            <PortadaDeVideo url={coverVideoUrl} height={150} />
          ) : hasVideo ? (
            <MarcadorDeVideo height={150} />
          ) : null}

          <Row align="flex-start">
            <Stack gap={3} style={{ flex: 1, paddingRight: 12 }}>
              <Text variant="heading" weight="semibold" numberOfLines={2}>
                {routine.title}
              </Text>
              {routine.summary === null ? null : (
                <Text variant="captionSmall" color={theme.colors.textSecondary} numberOfLines={2}>
                  {routine.summary}
                </Text>
              )}
              {meta === '' ? null : (
                <Text variant="micro" color={theme.colors.textFaint}>
                  {meta}
                </Text>
              )}
            </Stack>

            <Badge
              label={isPublic ? 'PÚBLICA' : 'ALUMNOS'}
              color={isPublic ? theme.semaphore.ok : theme.colors.textSecondary}
            />
          </Row>

          {/* El interruptor que importa, en la propia lista.
              El dueño publica el uchimata para atraer, ve que funciona y quiere
              guardarse la serie entera para alumnos: hacerle abrir el editor
              para eso convierte un toque en un formulario. */}
          {isOwner && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                isPublic ? 'Dejarla solo para alumnos' : 'Publicarla para cualquiera'
              }
              disabled={switching}
              onPress={() => {
                setSwitching(true);
                void setRoutineAudience(routine.id, isPublic ? 'members' : 'public')
                  .then(onChange)
                  .finally(() => setSwitching(false));
              }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                alignSelf: 'flex-start',
                paddingHorizontal: 11,
                paddingVertical: 7,
                borderRadius: theme.radii.pill,
                backgroundColor: withAlpha(
                  isPublic ? theme.semaphore.ok : theme.colors.textSecondary,
                  0.13,
                ),
              }}
            >
              {isPublic ? (
                <Globe size={13} color={theme.semaphore.ok} />
              ) : (
                <Lock size={13} color={theme.colors.textSecondary} />
              )}
              <Text
                variant="micro"
                weight="semibold"
                color={isPublic ? theme.semaphore.ok : theme.colors.textSecondary}
              >
                {isPublic ? 'La ve cualquiera' : 'Solo tus alumnos'}
              </Text>
            </Pressable>
          )}
        </Stack>
      </Card>
    </Pressable>
  );
}
