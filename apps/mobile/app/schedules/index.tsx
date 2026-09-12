/**
 * El horario del gimnasio: cuándo se entrena aquí.
 *
 * Faltaba entera, y su ausencia dejaba al gimnasio nuevo en un callejón sin
 * salida silencioso. Los bloques de horario solo los sabía escribir un script
 * nuestro, así que el local que se daba de alta desde la app nacía con sus
 * planes pero con CERO horarios, y sin horarios:
 *
 *  - su ficha pública no tiene ni una hora que reservar. La tarjeta del
 *    directorio ofrecía «1 clase gratis» y la pantalla de dentro contestaba
 *    «este gimnasio todavía no publicó sus horarios». La única vía de alta que
 *    empieza fuera del local —la que atiende a quien no entrena en ningún
 *    sitio— estaba muerta para todos los locales nuevos;
 *  - el directorio lo listaba con «0 clases por semana» y sin ninguna
 *    disciplina, que es exactamente como se ve un local cerrado.
 *
 * Se lee como un horario y no como una lista: agrupado por día, porque la
 * pregunta que trae aquí al dueño es «¿qué doy los martes?». Una lista plana de
 * catorce filas ordenadas por hora obliga a leerlas todas para responderla.
 *
 * Es solo del dueño: la api responde 403 a recepción, y una pantalla que se abre
 * para enseñar un error no debería poder abrirse.
 */
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import {
  allWeekdays,
  scheduleRange,
  weekdayName,
  type IsoWeekday,
} from '@sinchi/shared';
import { withAlpha } from '@sinchi/ui';
import { Button, Card, Eyebrow, Row, Stack, Text } from '../../src/design/primitives';
import { Screen } from '../../src/design/screen';
import { useTheme } from '../../src/design/theme';
import { useOwnerSchedules } from '../../src/data/hooks';
import { useRole } from '../../src/data/session-hooks';
import type { ScheduleWithUsage } from '../../src/data/api';

export default function SchedulesScreen() {
  const theme = useTheme();
  // De la sesión: el del store llega con el padrón, y estas pantallas se
  // abren solas desde un enlace.
  const isOwner = useRole() === 'owner';
  const { schedules, error, loading } = useOwnerSchedules();

  const activeBlocks = schedules?.filter((h) => h.active) ?? [];
  const archivados = schedules?.filter((h) => !h.active) ?? [];

  return (
    <Screen scroll>
      <Row style={{ paddingTop: 8 }}>
        <Text variant="titleSmall" weight="bold">
          Horarios
        </Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={16}>
          <Text variant="body" color={theme.colors.textSecondary}>
            Cerrar
          </Text>
        </Pressable>
      </Row>

      {!isOwner ? (
        <Card tone="sunken" style={{ marginTop: 20 }}>
          <Text variant="bodySmall" color={theme.colors.textSecondary}>
            El horario lo decide el dueño del local. Recepción lo ve en la puerta al marcar
            entrada, pero no lo cambia.
          </Text>
        </Card>
      ) : (
        <>
          <Text variant="captionSmall" color={theme.colors.textSecondary} style={{ marginTop: 6 }}>
            Las clases que das cada semana. Es lo que sale en tu ficha del directorio, lo que la
            gente elige para venir a probar y contra lo que la puerta valida el QR.
          </Text>

          {error !== null && (
            <Card tone="sunken" borderColor={theme.semaphore.bad} style={{ marginTop: 16 }}>
              <Text variant="bodySmall" color={theme.semaphore.bad}>
                {error}
              </Text>
            </Card>
          )}

          {loading ? (
            <Text variant="bodySmall" color={theme.colors.textSecondary} style={{ marginTop: 20 }}>
              Trayendo tus horarios…
            </Text>
          ) : activeBlocks.length === 0 ? (
            /**
             * El vacío dice lo que CUESTA, no solo que está vacío.
             *
             * Es la pantalla que ve todo dueño recién dado de alta, y es donde se
             * decide si su local aparece vivo o cerrado en el directorio. «No hay
             * horarios» a secas no le explica por qué no le llega nadie.
             */
            <Card tone="sunken" style={{ marginTop: 20 }}>
              <Stack gap={14}>
                <Text variant="bodySmall" color={theme.colors.textSecondary} align="center">
                  Todavía no publicaste ningún horario. Hasta que lo hagas, tu gimnasio sale en el
                  directorio como «0 clases por semana» y nadie puede reservar su primera clase
                  contigo.
                </Text>
                <Button
                  label="Publicar el primero"
                  onPress={() => router.push('/schedules/nuevo')}
                />
              </Stack>
            </Card>
          ) : (
            <>
              <Stack gap={18} style={{ marginTop: 22 }}>
                {allWeekdays().map((day) => (
                  <Weekday
                    key={day}
                    day={day}
                    rows={activeBlocks.filter((h) => h.schedule.weekday === day)}
                  />
                ))}
              </Stack>

              <Button
                label="+ Nueva clase"
                variant="secondary"
                style={{ marginTop: 18 }}
                onPress={() => router.push('/schedules/nuevo')}
              />
            </>
          )}

          {archivados.length > 0 && (
            <Stack gap={10} style={{ marginTop: 26 }}>
              <Eyebrow>Fuera del horario</Eyebrow>
              <Text variant="micro" color={theme.colors.textFaint}>
                No se ofrecen ni validan en la puerta. Es donde vive la clase de temporada: la
                vuelves a poner con un toque cuando toque.
              </Text>
              {archivados.map((row) => (
                <ScheduleRow key={row.schedule.id} row={row} withDay />
              ))}
            </Stack>
          )}

          <View style={{ height: 32 }} />
        </>
      )}
    </Screen>
  );
}

/**
 * Un día con sus clases.
 *
 * Los días SIN clase también salen, apagados. Esconderlos dejaría un horario que
 * parece completo cuando le falta el sábado, y el hueco es justo lo que el dueño
 * viene a ver.
 */
function Weekday({
  day,
  rows,
}: {
  readonly day: IsoWeekday;
  readonly rows: readonly ScheduleWithUsage[];
}) {
  const theme = useTheme();

  return (
    <Stack gap={9}>
      <Row>
        <Eyebrow>{weekdayName(day)}</Eyebrow>
        <Text variant="micro" color={theme.colors.textFaint}>
          {rows.length === 0
            ? 'sin clases'
            : `${rows.length} ${rows.length === 1 ? 'clase' : 'clases'}`}
        </Text>
      </Row>

      {rows.length === 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Añadir una clase el ${weekdayName(day)}`}
          onPress={() => router.push(`/schedules/nuevo?weekday=${day}`)}
        >
          <Card radius={theme.radii.lg} borderColor={theme.colors.borderDashed}>
            <Text variant="captionSmall" color={theme.colors.textFaint}>
              + Añadir una clase
            </Text>
          </Card>
        </Pressable>
      ) : (
        rows.map((row) => <ScheduleRow key={row.schedule.id} row={row} />)
      )}
    </Stack>
  );
}

function ScheduleRow({
  row,
  withDay = false,
}: {
  readonly row: ScheduleWithUsage;
  readonly withDay?: boolean;
}) {
  const theme = useTheme();
  const { schedule, active, upcomingTrials, overlaps } = row;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Editar ${schedule.name}, ${weekdayName(schedule.weekday)} ${scheduleRange(schedule)}`}
      onPress={() => router.push(`/schedules/${schedule.id}`)}
    >
      <Card
        radius={theme.radii.lg}
        // Lo archivado se lee apagado, no escondido: sin verlo, nadie entiende
        // por qué la clase de las 7am no sale en su ficha.
        style={{ opacity: active ? 1 : 0.55 }}
        borderColor={active ? theme.colors.hairline : theme.colors.borderDashed}
      >
        <Row align="flex-start">
          <Stack gap={3} style={{ flex: 1, paddingRight: 12 }}>
            <Text variant="heading" weight="semibold" numberOfLines={1}>
              {schedule.name}
            </Text>
            <Text variant="captionSmall" color={theme.colors.textSecondary} numberOfLines={1}>
              {withDay ? `${weekdayName(schedule.weekday)} · ` : ''}
              {scheduleRange(schedule)}
              {schedule.instructor === null ? '' : ` · ${schedule.instructor}`}
            </Text>
            {/* Las dos cosas que hay que saber antes de tocarlo. El aviso de
                solape no impide nada —dos tatamis dan dos clases a la vez— pero
                enterarse al ver el horario publicado es tarde. */}
            {upcomingTrials > 0 && (
              <Text variant="micro" color={theme.semaphore.ok}>
                {upcomingTrials} {upcomingTrials === 1 ? 'viene' : 'vienen'} a probar
              </Text>
            )}
            {overlaps && (
              <Text variant="micro" color={theme.semaphore.warn}>
                Se cruza con otra clase de este día
              </Text>
            )}
          </Stack>

          <Stack gap={1} style={{ alignItems: 'flex-end' }}>
            <Text variant="bodySmall" weight="semibold">
              {schedule.startTime}
            </Text>
            <Text variant="micro" color={theme.colors.textFaint}>
              {schedule.capacity === null ? 'sin aforo' : `${schedule.capacity} cupos`}
            </Text>
            {!active && (
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
                  fuera
                </Text>
              </View>
            )}
          </Stack>
        </Row>
      </Card>
    </Pressable>
  );
}
