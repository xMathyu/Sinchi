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
import MapPin from 'lucide-react-native/icons/map-pin';
import { router, useRouter } from 'expo-router';
import { cents, conversationTopicLabel, formatPENShort, type BookingKind } from '@sinchi/shared';
import { withAlpha } from '@sinchi/ui';
import { Badge, Card, Divider, Eyebrow, Row, Stack, Text } from '../../src/design/primitives';
import { ConversationRow } from '../../src/design/chat';
import { Screen } from '../../src/design/screen';
import { OfflineState, EmptyState } from '../../src/design/empty';
import { SectionLoader } from '../../src/design/loading';
import { useTheme } from '../../src/design/theme';
import { useGyms, useMyConversations, useMyBookings } from '../../src/data/hooks';
import { useSession } from '../../src/data/session-hooks';
import { signOut } from '../../src/data/auth';
import { cancelBooking } from '../../src/data/trials';
import type { ClassBookingDto, GymCardDto } from '../../src/data/api';
import { formatWeekdayAndDay } from '../../src/lib/format';

/** Qué reservó, en dos palabras: la tarjeta la lee fuera de la ficha del gimnasio. */
const KIND_LABEL: Readonly<Record<BookingKind, string>> = {
  trial: 'Clase de prueba',
  drop_in: 'Clase suelta',
  enrollment: 'Inscripción',
};

export default function ExploreScreen() {
  const theme = useTheme();
  const { details: gyms, loading, error, reload } = useGyms();
  const bookings = useMyBookings();
  const upcoming = bookings.details.filter((booking) => booking.status === 'booked');
  const conversations = useMyConversations();
  // Con la cuenta recién creada y sin ficha, ESTA es la primera pantalla de la
  // app: hay que dejarle a mano las dos únicas cosas que puede necesitar y que
  // no están aquí — su código para el mostrador, y salir de la cuenta.
  const session = useSession();
  const unlinked = session.status === 'unlinked';

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
        ) : session.status === 'signed_in' ? (
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
        precios, y reserva una clase o inscríbete.
      </Text>

      {upcoming.length > 0 ? (
        <Stack gap={10} style={{ marginTop: 22 }}>
          <Eyebrow>Tus reservas</Eyebrow>
          {upcoming.map((booking) => (
            <UpcomingCard key={booking.id} booking={booking} onCanceled={bookings.reload} />
          ))}
        </Stack>
      ) : null}

      {/* Sus conversaciones, para quien todavía no tiene ficha. Con sesión de
          alumno viven en su pestaña de Mensajes; la cuenta sin ficha no tiene
          pestañas, y sin esto la respuesta del gimnasio llegaba a un hilo que no
          sabía cómo volver a abrir. */}
      {unlinked && conversations.details.length > 0 ? (
        <Stack gap={10} style={{ marginTop: 22 }}>
          <Eyebrow>Tus mensajes</Eyebrow>
          <Card radius={theme.radii.xl} style={{ paddingVertical: 2 }}>
            {conversations.details.map((conversation, index) => (
              <View key={conversation.id}>
                {index > 0 ? <Divider /> : null}
                <ConversationRow
                  title={conversation.gymName}
                  detail={conversationTopicLabel(conversation.topic)}
                  lastMessage={conversation.lastMessage}
                  me="person"
                  unread={conversation.unread}
                  onPress={() =>
                    router.push({
                      pathname: '/chat/[slug]',
                      params: { slug: conversation.gymSlug },
                    })
                  }
                />
              </View>
            ))}
          </Card>
        </Stack>
      ) : null}

      {unlinked ? <NewAccountFooter /> : null}

      {loading && gyms.length === 0 ? (
        <View style={{ minHeight: 340 }}>
          <SectionLoader text="Buscando gimnasios…" />
        </View>
      ) : error !== null && gyms.length === 0 ? (
        <View style={{ minHeight: 340 }}>
          <OfflineState
            title="No se pudo traer la lista"
            body="No llegamos al servidor. Los gimnasios siguen ahí; es la conexión la que falló."
            error={error}
            onReintentar={reload}
          />
        </View>
      ) : gyms.length === 0 ? (
        <View style={{ minHeight: 340 }}>
          <EmptyState
            title="Todavía no hay gimnasios"
            body="Ninguna escuela de la red está aceptando alumnos ahora mismo."
            pie="Si tu gimnasio quiere aparecer aquí, escríbenos."
          />
        </View>
      ) : (
        <Stack gap={12} style={{ marginTop: 22 }}>
          <Eyebrow>{gyms.length} en la red</Eyebrow>
          {gyms.map((gymCard) => (
            <GymCard key={gymCard.id} gym={gymCard} />
          ))}
        </Stack>
      )}

      <OwnerInvitation />
    </Screen>
  );
}

/**
 * Una reserva en pie, fuera de la ficha de su gimnasio.
 *
 * Dice qué reservó —prueba, suelta o inscripción— porque aquí se leen juntas las
 * de varios locales, y «Fundamentos, martes 19:00» no dice si se paga, cuánto ni
 * si es para quedarse.
 */
function UpcomingCard({
  booking,
  onCanceled,
}: {
  readonly booking: ClassBookingDto;
  readonly onCanceled: () => void;
}) {
  const theme = useTheme();
  // `??` porque la app se actualiza sola y la api no: antes de la 0022 todo era
  // una prueba.
  const kind: BookingKind = booking.kind ?? 'trial';

  return (
    <Card
      accent={theme.semaphore.ok}
      borderColor={withAlpha(theme.semaphore.ok, 0.26)}
      radius={theme.radii.xl}
    >
      <Stack gap={7}>
        <Row>
          <Text variant="bodySmall" weight="semibold" style={{ flex: 1 }} numberOfLines={1}>
            {booking.gymName}
          </Text>
          <Text variant="micro" weight="bold" color={theme.semaphore.ok}>
            {KIND_LABEL[kind].toUpperCase()}
          </Text>
        </Row>
        <Text variant="caption" color={theme.colors.textSecondary}>
          {booking.className} · {formatWeekdayAndDay(booking.date)} a las {booking.startTime}
          {kind === 'enrollment' && booking.planName !== null ? ` · ${booking.planName}` : ''}
        </Text>
        {/* Primero mover y después cancelar, y no al revés: quien no puede
            el martes casi siempre puede el jueves, y lo único que había
            aquí —cancelar— le hacía soltar el cupo para volver a pedirlo.
            Cancelar se queda, en gris, como lo que es: la salida de quien
            de verdad no va a ir. */}
        <Row gap={16} justify="flex-start">
          <Pressable
            accessibilityRole="button"
            hitSlop={10}
            onPress={() =>
              router.push({
                pathname: '/explore/[slug]',
                params: { slug: booking.gymSlug },
              })
            }
          >
            <Text variant="captionSmall" weight="semibold" color={theme.semaphore.ok}>
              Cambiar la hora
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            hitSlop={10}
            onPress={() => {
              // Confirmar antes de soltarla: deshacerlo exige volver a elegir
              // hora, y en la prueba es una por gimnasio.
              Alert.alert(
                kind === 'trial'
                  ? 'Cancelar tu clase de prueba'
                  : kind === 'drop_in'
                    ? 'Cancelar tu clase suelta'
                    : 'Cancelar tu inscripción',
                `${booking.gymName} dejará de esperarte. Podrás reservar otro día.`,
                [
                  { text: 'No', style: 'cancel' },
                  {
                    text: 'Cancelar la reserva',
                    style: 'destructive',
                    onPress: () => {
                      void cancelBooking(booking.id)
                        .then(onCanceled)
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
        </Row>
      </Stack>
    </Card>
  );
}

/**
 * La otra mitad del directorio: quien lo mira no siempre busca dónde entrenar.
 *
 * Es la única puerta de entrada al alta de un gimnasio, y va al final del
 * directorio a propósito. Arriba competiría con la lista —que es lo que casi
 * todo el mundo viene a ver— y en Ajustes no la encontraría nadie: quien está
 * evaluando Sinchi para su dojo llega mirando qué otros gimnasios ya lo usan,
 * y termina justo aquí.
 */
function OwnerInvitation() {
  const theme = useTheme();
  const router = useRouter();

  return (
    <Card
      borderColor={withAlpha(theme.semaphore.ok, 0.3)}
      style={{ marginTop: 26, marginBottom: 8, paddingVertical: 16 }}
    >
      <Stack gap={10}>
        <Stack gap={3}>
          <Text variant="bodySmall" weight="semibold">
            ¿Tienes un gimnasio?
          </Text>
          <Text variant="captionSmall" color={theme.colors.textSecondary}>
            Regístralo en Sinchi: el primer mes es gratis, y hasta 10 alumnos no
            pagas nunca.
          </Text>
        </Stack>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Registrar mi gimnasio"
          hitSlop={10}
          onPress={() => router.push('/gym-signup')}
        >
          <Text variant="captionSmall" weight="semibold" color={theme.semaphore.ok}>
            Registrar mi gimnasio
          </Text>
        </Pressable>
      </Stack>
    </Card>
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
function NewAccountFooter() {
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
      accessibilityLabel={`${gym.name}${gym.trialClassEnabled ? ', acepta reservas de clase de prueba' : ''}`}
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
            {/* Con precio cuando lo tiene: «1 CLASE GRATIS» en un local que
                cobra S/40 por probar promete algo que la reserva desmiente.

                Y solo si el local tiene horario publicado: sin bloques no hay ni
                una hora reservable, asi que la insignia manda a una pantalla que
                contesta «este gimnasio todavia no publico sus horarios». Le
                pasaba a TODO gimnasio recien dado de alta, que nace con la clase
                gratis encendida y sin horarios. */}
            {gym.trialClassEnabled && gym.weeklyClasses > 0 ? (
              <Badge
                label={
                  (gym.trialClassPriceCents ?? 0) === 0
                    ? '1 CLASE GRATIS'
                    : `PRUEBA ${formatPENShort(cents(gym.trialClassPriceCents))}`
                }
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

          {/* DÓNDE queda, en la tarjeta y no solo dentro.
              Es la primera pregunta de quien busca dónde entrenar —nadie cruza
              Lima para una clase de prueba— y tenerla que responder abriendo los
              cinco gimnasios de la lista para descartar cuatro es justo lo que
              una lista debería evitar. En una línea: aquí se descarta, no se
              decide. */}
          {(gym.address ?? '').trim().length > 0 ? (
            <Row gap={6} justify="flex-start" align="center">
              <MapPin size={12} color={theme.colors.textFaint} />
              <Text
                variant="captionSmall"
                color={theme.colors.textTertiary}
                numberOfLines={1}
                style={{ flex: 1 }}
              >
                {gym.address}
              </Text>
            </Row>
          ) : null}
        </Stack>
      </Card>
    </Pressable>
  );
}
