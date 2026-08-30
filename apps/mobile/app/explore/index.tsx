/**
 * Explorar gimnasios.
 *
 * La primera pantalla de Sinchi que mira hacia AFUERA. Hasta aquí, para entrar a
 * un gimnasio había que estar ya dentro: el mostrador daba de alta la ficha o
 * mandaba una invitación, y quien instalaba la app por su cuenta se quedaba en
 * «muéstrale este código a recepción» sin recepción a la que mostrárselo.
 *
 * Funciona SIN sesión de Sinchi a propósito: quien busca dojo todavía no tiene
 * cuenta, y pedirle que se registre para mirar una lista es perderlo en la
 * primera pantalla. Lo único que exige cuenta es reservar, y para eso basta la
 * de Google.
 */
import { Alert, Pressable, View } from 'react-native';
import { router, useRouter } from 'expo-router';
import { cents, formatPENShort } from '@sinchi/shared';
import { withAlpha } from '@sinchi/ui';
import { Badge, Card, Eyebrow, Row, Stack, Text } from '../../src/design/primitives';
import { Screen } from '../../src/design/screen';
import { EstadoSinConexion, EstadoVacio } from '../../src/design/empty';
import { CargandoSeccion } from '../../src/design/loading';
import { useTheme } from '../../src/design/theme';
import { useGyms, useMisClasesGratis } from '../../src/data/hooks';
import { useSession } from '../../src/data/session-hooks';
import { signOut } from '../../src/data/auth';
import { cancelarClaseGratis } from '../../src/data/trials';
import type { GymCardDto } from '../../src/data/api';
import { formatWeekdayAndDay } from '../../src/lib/format';

export default function ExploreScreen() {
  const theme = useTheme();
  const { datos: gimnasios, cargando, error, recargar } = useGyms();
  const reservas = useMisClasesGratis();
  const proximas = reservas.datos.filter((reserva) => reserva.status === 'booked');
  // Con la cuenta recién creada y sin ficha, ESTA es la primera pantalla de la
  // app: hay que dejarle a mano las dos únicas cosas que puede necesitar y que
  // no están aquí — su código para el mostrador, y salir de la cuenta.
  const sesion = useSession();
  const sinFicha = sesion.status === 'unlinked';

  return (
    <Screen scroll>
      <Row style={{ paddingTop: 8 }}>
        <Text variant="titleSmall" weight="bold">
          Gimnasios
        </Text>
        {/* Esta pantalla es a veces un modal —se abre desde la billetera— y a
            veces la primera de la app, para quien acaba de crear su cuenta. Sin
            la segunda rama queda sin salida justo cuando recepción confirma el
            código: la sesión pasa a ser de alumno y el directorio se queda
            encima de nada. */}
        {router.canGoBack() ? (
          <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={16}>
            <Text variant="body" color={theme.colors.textSecondary}>
              Cerrar
            </Text>
          </Pressable>
        ) : sesion.status === 'signed_in' ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.replace('/student')}
            hitSlop={16}
          >
            <Text variant="body" color={theme.colors.textSecondary}>
              Mi billetera
            </Text>
          </Pressable>
        ) : null}
      </Row>

      <Text variant="bodySmall" color={theme.colors.textSecondary} style={{ marginTop: 8 }}>
        Escuelas y dojos de la red. Entra a cualquiera para ver sus horarios y sus
        precios, y reserva tu primera clase gratis.
      </Text>

      {proximas.length > 0 ? (
        <Stack gap={10} style={{ marginTop: 22 }}>
          <Eyebrow>Tu clase gratis</Eyebrow>
          {proximas.map((reserva) => (
            <Card
              key={reserva.id}
              accent={theme.semaphore.ok}
              borderColor={withAlpha(theme.semaphore.ok, 0.26)}
              radius={theme.radii.xl}
            >
              <Stack gap={7}>
                <Text variant="bodySmall" weight="semibold">
                  {reserva.gymName}
                </Text>
                <Text variant="caption" color={theme.colors.textSecondary}>
                  {reserva.className} · {formatWeekdayAndDay(reserva.date)} a las{' '}
                  {reserva.startTime}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  hitSlop={10}
                  onPress={() => {
                    // Confirmar antes de soltar el cupo: es una sola por
                    // gimnasio y deshacerlo exige volver a elegir hora.
                    Alert.alert(
                      'Cancelar tu clase gratis',
                      `${reserva.gymName} dejará de esperarte. Podrás reservar otro día.`,
                      [
                        { text: 'No', style: 'cancel' },
                        {
                          text: 'Cancelar la clase',
                          style: 'destructive',
                          onPress: () => {
                            void cancelarClaseGratis(reserva.id)
                              .then(() => reservas.recargar())
                              .catch((causa: unknown) => {
                                Alert.alert(
                                  'No se pudo cancelar',
                                  causa instanceof Error ? causa.message : 'Intenta de nuevo.',
                                );
                              });
                          },
                        },
                      ],
                    );
                  }}
                >
                  <Text variant="captionSmall" color={theme.colors.textTertiary}>
                    Cancelar
                  </Text>
                </Pressable>
              </Stack>
            </Card>
          ))}
        </Stack>
      ) : null}

      {sinFicha ? <PieDeCuentaNueva /> : null}

      {cargando && gimnasios.length === 0 ? (
        <View style={{ minHeight: 340 }}>
          <CargandoSeccion texto="Buscando gimnasios…" />
        </View>
      ) : error !== null && gimnasios.length === 0 ? (
        <View style={{ minHeight: 340 }}>
          <EstadoSinConexion
            titulo="No se pudo traer la lista"
            cuerpo="No llegamos al servidor. Los gimnasios siguen ahí; es la conexión la que falló."
            error={error}
            onReintentar={recargar}
          />
        </View>
      ) : gimnasios.length === 0 ? (
        <View style={{ minHeight: 340 }}>
          <EstadoVacio
            titulo="Todavía no hay gimnasios"
            cuerpo="Ninguna escuela de la red está aceptando alumnos ahora mismo."
            pie="Si tu gimnasio quiere aparecer aquí, escríbenos."
          />
        </View>
      ) : (
        <Stack gap={12} style={{ marginTop: 22 }}>
          <Eyebrow>{gimnasios.length} en la red</Eyebrow>
          {gimnasios.map((gimnasio) => (
            <GymCard key={gimnasio.id} gym={gimnasio} />
          ))}
        </Stack>
      )}
    </Screen>
  );
}

/**
 * Lo que necesita quien acaba de crear su cuenta y no es de ningún gimnasio.
 *
 * El código de seis dígitos ya no es la pantalla de entrada —era una pared para
 * quien todavía no entrena en ningún sitio— pero no desaparece: al alumno al que
 * su gimnasio dio de alta por DNI, sin invitación, es lo único que le conecta la
 * ficha con la app. Así que vive aquí, a un toque, en vez de recibirle.
 */
function PieDeCuentaNueva() {
  const theme = useTheme();
  const router = useRouter();

  return (
    <Stack gap={10} style={{ marginTop: 22 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Ver mi código para recepción"
        onPress={() => router.push('/link')}
      >
        <Card radius={theme.radii.lg} tone="sunken">
          <Row style={{ gap: 12 }}>
            <Stack gap={5} style={{ flex: 1 }}>
              <Text variant="bodySmall" weight="semibold">
                ¿Tu gimnasio ya te registró?
              </Text>
              <Text variant="captionSmall" color={theme.colors.textSecondary}>
                Muéstrale tu código a recepción y tu membresía aparece aquí, con tu plan
                y tu QR.
              </Text>
            </Stack>
            <Text variant="title" color={theme.colors.textFaint}>
              ›
            </Text>
          </Row>
        </Card>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        hitSlop={12}
        style={{ alignSelf: 'center' }}
        onPress={() => {
          void signOut({ forgetTotpSecret: true }).then(() => router.replace('/login'));
        }}
      >
        <Text variant="caption" color={theme.colors.textSecondary}>
          Entrar con otra cuenta
        </Text>
      </Pressable>
    </Stack>
  );
}

/**
 * Tarjeta del directorio.
 *
 * Dice precio, ritmo y disciplina antes de que haya que abrir nada: una lista de
 * nombres a secas obliga a entrar en los cinco para descartar cuatro.
 */
function GymCard({ gym }: { readonly gym: GymCardDto }) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${gym.name}${gym.trialClassEnabled ? ', ofrece una clase gratis' : ''}`}
      onPress={() => router.push({ pathname: '/explore/[slug]', params: { slug: gym.slug } })}
    >
      <Card radius={theme.radii.xl}>
        <Stack gap={11}>
          {/* El nombre ENTERO, en dos líneas si hace falta.
              La billetera lo parte en marca y distrito («Nova BJJ» + «Surco»)
              porque son gimnasios que el alumno ya conoce. Aquí no conoce
              ninguno, y esa heurística le hacía perder justo la palabra que
              importa: «Asociación Deportiva Club Kaizen» salía como
              «Asociación Deportiva C…» con «Kaizen» de subtítulo. */}
          <Row align="flex-start" style={{ gap: 10 }}>
            <Stack gap={2} style={{ flex: 1 }}>
              <Text variant="heading" weight="bold" numberOfLines={2}>
                {gym.name}
              </Text>
            </Stack>
            {gym.trialClassEnabled ? (
              <Badge
                label="1 CLASE GRATIS"
                color={theme.semaphoreInk.ok}
                background={theme.semaphore.ok}
              />
            ) : null}
          </Row>

          <Text variant="caption" color={theme.colors.textSecondary}>
            {gym.fromPriceCents === null
              ? 'Precios en el local'
              : `Desde ${formatPENShort(cents(gym.fromPriceCents))} al mes`}
            {gym.weeklyClasses > 0
              ? ` · ${gym.weeklyClasses} ${gym.weeklyClasses === 1 ? 'clase' : 'clases'} por semana`
              : ''}
          </Text>

          {gym.disciplines.length > 0 ? (
            <Text variant="captionSmall" color={theme.colors.textTertiary} numberOfLines={1}>
              {gym.disciplines.slice(0, 3).join(' · ')}
            </Text>
          ) : null}
        </Stack>
      </Card>
    </Pressable>
  );
}
