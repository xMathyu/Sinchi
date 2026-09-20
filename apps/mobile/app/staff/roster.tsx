/**
 * Padrón: quién está al día y quién debe.
 *
 * Faltaba, y su ausencia se notaba: el cobro solo se alcanzaba DESPUÉS de un
 * check-in, desde la pantalla de resultado. Para cobrarle a alguien que viene a
 * pagar sin entrenar —que en un gimnasio pasa todos los días— había que fingir
 * una asistencia primero.
 *
 * Se ordena por deuda descendente y no alfabéticamente: la pregunta que trae a
 * alguien a esta pantalla es "¿a quién tengo que cobrarle?", no "¿dónde está
 * Fulano?". Para eso está el buscador.
 *
 * Cada fila abre la ficha del alumno, no el cobro. Ir directo a cobrar obligaba
 * a abrir un cargo para responder "¿por qué no pasa?" y a cancelarlo después.
 */
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { screenPadding } from '@sinchi/ui';
import { formatPEN, type Cents } from '@sinchi/shared';
import { withAlpha } from '@sinchi/ui';
import { Screen } from '../../src/design/screen';
import { Button, Card, Chip, Dot, Eyebrow, Row, Stack, Text } from '../../src/design/primitives';
import { useTheme } from '../../src/design/theme';
import { AccountAvatar } from '../../src/design/account-avatar';
import {
  redeemCode,
} from '../../src/data/actions';
import { switchGym } from '../../src/data/auth';
import type { StaffPostDto } from '../../src/data/api';
import {
  useBajas,
  useMyGyms,
  useOwnerSummary,
  useRefresco,
  useRoster,
  useStore,
  useSinchiSubscription,
} from '../../src/data/hooks';
import type { RosterEntry } from '../../src/data/store';
import { describePromo, promoDenialMessage, type SaasNotice } from '@sinchi/shared';

export default function RosterScreen() {
  const theme = useTheme();
  const router = useRouter();
  const roster = useRoster();
  const loading = useStore((s) => s.hydrating);
  const isOwner = useStore((s) => s.staff.role) === 'owner';
  const summary = useOwnerSummary();
  const { subscription, reload: reloadSubscription } = useSinchiSubscription();
  /**
   * `null` cuando quien mira es recepción: la suscripción es del dueño. Ahí no
   * se apaga nada — el alta le devuelve el motivo de la api en pantalla, que es
   * el mismo texto y llega en el momento de actuar.
   */
  const canEnroll = subscription === null || subscription.state.canWrite;
  const { refrescando, refrescar } = useRefresco();

  /**
   * En que local esta parada esta pantalla.
   *
   * Con un solo local no se ensena: «PADRON» ya lo dice todo y el nombre del
   * gimnasio en cada pantalla es ruido. Con dos empieza a importar mas que
   * ninguna otra cosa de la cabecera — las cifras de «Este mes» del local
   * equivocado se leen igual de bien que las del bueno, y no hay forma de
   * notarlo.
   */
  const gyms = useMyGyms();
  const tenantId = useStore((s) => s.staff.tenantId);
  const localActual =
    gyms.length > 1 ? (gyms.find((l) => l.tenantId === tenantId) ?? null) : null;
  const [query, setQuery] = useState('');
  // Las bajas no entran en el padron normal —el mostrador mira «quien entrena
  // aqui» todo el dia— pero tienen que ser alcanzables: son las unicas fichas
  // que se pueden reinscribir, y cancelar las hacia desaparecer de todas partes.
  const [viendoBajas, setViendoBajas] = useState(false);
  const { bajas, loading: loadingDeletions } = useBajas(viendoBajas);

  const listado = useMemo(() => {
    const fuente = viendoBajas ? bajas : roster;
    const text = query.trim().toLowerCase();
    const filtrado =
      text.length === 0
        ? [...fuente]
        : fuente.filter(
            (e) =>
              e.user.name.toLowerCase().includes(text) || e.user.documentId.includes(text),
          );

    return filtrado.sort((a, b) => {
      const debtA = a.view.receivable.amountCents;
      const debtB = b.view.receivable.amountCents;
      if (debtA !== debtB) return debtB - debtA;
      return a.user.name.localeCompare(b.user.name, 'es');
    });
  }, [roster, bajas, viendoBajas, query]);

  const totalDebt = roster.reduce((sum, e) => sum + e.view.receivable.amountCents, 0);
  const inDebt = roster.filter((e) => e.view.receivable.amountCents > 0).length;

  // Va a la ficha, no al cobro: la pregunta del mostrador no siempre es cobrar,
  // y para llegar a mirar a alguien no debería haber que abrir un cargo a medias.
  const open = useCallback(
    (entry: RosterEntry) =>
      router.push({
        pathname: '/member/[membershipId]',
        params: { membershipId: entry.view.membership.id },
      }),
    [router],
  );

  const cabecera = (
    <Stack gap={18} style={{ paddingTop: 20, paddingBottom: 18 }}>
      {/* Los chips van en la línea del rótulo, no en la del título.
          Entre los dos ocupan el 63% del ancho, así que compartir fila con
          «5 alumnos» no cabe de ninguna manera: primero se partía en dos líneas
          y la deuda en tres, y forzando una sola línea quedaba «5 alumn…».
          Arriba sobra sitio —«PADRÓN» usa el 14% de una línea entera— y así el
          título y la deuda recuperan el ancho completo. */}
      <Stack gap={4}>
        <Row gap={10}>
          <Eyebrow>Padrón</Eyebrow>
          <Row gap={8} justify="flex-end" style={{ flexShrink: 0 }}>
            {/* Inscribir sí es permanente: es la acción que sostiene todo lo
                demás —sin padrón no hay a quién vincular, ni a quién escanear,
                ni a quién cobrar— y hasta ahora no existía en ninguna pantalla.

                Se apaga con la cuenta en solo lectura, y no desaparece: un botón
                que se esfuma deja al dueño preguntándose qué pasó, mientras que
                uno gris justo encima de «Cuenta en solo lectura» se lee como
                causa y efecto. Verde e invitando llevaría a un alta que la api
                va a rechazar, que es la peor de las tres. */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Inscribir un alumno"
              accessibilityState={{ disabled: !canEnroll }}
              disabled={!canEnroll}
              hitSlop={12}
              onPress={() => router.push('/enroll')}
            >
              <Card
                radius={theme.radii.pill}
                borderColor={withAlpha(
                  canEnroll ? theme.semaphore.ok : theme.colors.textSecondary,
                  0.4,
                )}
                style={{ paddingVertical: 7, paddingHorizontal: 12 }}
              >
                <Text
                  variant="captionSmall"
                  weight="semibold"
                  color={canEnroll ? theme.semaphore.ok : theme.colors.textSecondary}
                >
                  + Alumno
                </Text>
              </Card>
            </Pressable>
            <AccountAvatar size={34} />
          </Row>
        </Row>

        <Text variant="title" numberOfLines={1}>
          {roster.length} {roster.length === 1 ? 'alumno' : 'alumnos'}
        </Text>

        {localActual !== null && (
          <SelectorDeLocal gyms={gyms} actual={localActual} />
        )}

        {/* A lo ancho, y solo para recepción: al dueño se lo dicen con más
            detalle las cifras de «Este mes», que van veinte píxeles más abajo.
            Decir el mismo número dos veces en la misma pantalla no informa, y
            era lo que obligaba a apretar esta línea contra los chips.

            Se decide por el ROL y no por `resumen === null`: ese llega tarde, y
            con él la línea aparecía y se esfumaba sola al cargar el resumen. */}
        {totalDebt > 0 && !isOwner && (
          <Text variant="captionSmall" color={theme.semaphore.warn} numberOfLines={1}>
            {inDebt} con deuda · {formatPEN(totalDebt as Cents, { withDecimals: false })} por
            cobrar
          </Text>
        )}
      </Stack>

      {/* La cuenta atrás del mes gratis del gimnasio.
          Va arriba del todo y desde el primer día: un mes gratis del que el
          dueño se entera el día que se corta es un cliente que se va enojado, no
          uno que paga. Solo aparece mientras dice algo —el mes gratis corriendo,
          el vencimiento encima, el corte, o el plan gratis, que es lo que
          explica por qué no le están cobrando— y desaparece cuando la cuenta
          está al día pagando, que no necesita decir nada. */}
      {subscription !== null &&
      (subscription.state.status === 'trialing' ||
        subscription.state.status === 'free' ||
        subscription.notice.tone !== 'info') ? (
        <SubscriptionNotice notice={subscription.notice} onCanjeado={reloadSubscription} />
      ) : null}

      {/* Solo lo ve el dueño. Va en el padrón y no en una pestaña propia porque
          es la misma pregunta mirada de lejos: cuánto entró, cuánto falta y
          quién no está pagando. */}
      {summary === null ? null : (
        <Stack gap={10}>
          <Eyebrow>Este mes</Eyebrow>
          <Row gap={10} align="stretch">
            <Metrica
              value={formatPEN(summary.collectedThisMonthCents as Cents, { withDecimals: false })}
              label="cobrado"
              color={theme.semaphore.ok}
            />
            <Metrica
              value={formatPEN(summary.outstandingCents as Cents, { withDecimals: false })}
              label="por cobrar"
              color={summary.outstandingCents > 0 ? theme.semaphore.warn : theme.colors.ink}
            />
          </Row>
          <Row gap={10} align="stretch">
            <Metrica
              value={String(summary.checkInsToday)}
              label="marcados hoy"
              color={theme.colors.ink}
            />
            <Metrica
              value={String(summary.delinquentMembers)}
              label={summary.delinquentMembers === 1 ? 'moroso' : 'morosos'}
              color={summary.delinquentMembers > 0 ? theme.semaphore.bad : theme.colors.ink}
            />
          </Row>
        </Stack>
      )}

      {/* La entrada a la oferta del local. Va aquí y no en Ajustes porque es
          plata, no configuración: el dueño llega al padrón preguntándose cuánto
          entró, y "cuánto cobro" es la misma pregunta un paso antes.

          Por ROL y no por `resumen === null`: ese llega tarde y la fila
          aparecía y se esfumaba sola al cargar el resumen. */}
      {/* El primero de los cuatro, y no por orden alfabético: un local recién
          dado de alta nace con su mensualidad —la escribe el dueño en el alta— y
          con el horario EN BLANCO, y el horario vacío es lo que lo deja
          anunciado como «0 clases por semana» y sin una sola hora que alguien
          pueda reservar. Debajo de eventos y rutinas quedaba fuera de pantalla,
          que para lo único que le falta al dueño nuevo es como no estar. */}
      {isOwner && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Horarios"
          onPress={() => router.push('/schedules')}
        >
          <Card radius={theme.radii.lg} tone="sunken">
            <Row>
              <Stack gap={2} style={{ flex: 1, paddingRight: 12 }}>
                <Text variant="bodySmall" weight="semibold">
                  Horarios
                </Text>
                <Text variant="captionSmall" color={theme.colors.textSecondary}>
                  Las clases de cada semana. Es lo que ve quien te busca y lo que valida la
                  puerta.
                </Text>
              </Stack>
              <Text variant="body" color={theme.colors.textTertiary}>
                ›
              </Text>
            </Row>
          </Card>
        </Pressable>
      )}

      {/* Va pegada a Horarios y por la misma razón: son las dos cosas que un
          local recién dado de alta necesita para que su ficha sirva de algo. Sin
          horario no hay ni una hora que reservar; sin dirección, quien lo
          encuentra en el directorio no sabe si le queda a diez cuadras o a una
          hora, que es la pregunta que decide si va. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dónde queda"
        onPress={() => router.push('/location')}
      >
        <Card radius={theme.radii.lg} tone="sunken">
          <Row>
            <Stack gap={2} style={{ flex: 1, paddingRight: 12 }}>
              <Text variant="bodySmall" weight="semibold">
                Dónde queda
              </Text>
              <Text variant="captionSmall" color={theme.colors.textSecondary}>
                Tu dirección y tu punto en el mapa. Es lo que abre el navegador de quien
                va a probar.
              </Text>
            </Stack>
            <Text variant="body" color={theme.colors.textTertiary}>
              ›
            </Text>
          </Row>
        </Card>
      </Pressable>

      {/* Los eventos los ve TODO el staff, no solo el dueño: la lista del día
          del seminario la opera quien recibe a la gente en la puerta. Escribir
          el evento sí es del dueño, y eso se apaga dentro. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Eventos"
        onPress={() => router.push('/events')}
      >
        <Card radius={theme.radii.lg} tone="sunken">
          <Row>
            <Stack gap={2} style={{ flex: 1, paddingRight: 12 }}>
              <Text variant="bodySmall" weight="semibold">
                Eventos
              </Text>
              <Text variant="captionSmall" color={theme.colors.textSecondary}>
                Seminarios y talleres: quién viene y quién ya pagó.
              </Text>
            </Stack>
            <Text variant="body" color={theme.colors.textTertiary}>
              ›
            </Text>
          </Row>
        </Card>
      </Pressable>

      {/* La biblioteca la ve TODO el staff: a recepción le preguntan por el
          video de la clase del sábado tanto como por el precio. Escribirla sí es
          del dueño, y eso se apaga dentro. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Rutinas"
        onPress={() => router.push('/routines')}
      >
        <Card radius={theme.radii.lg} tone="sunken">
          <Row>
            <Stack gap={2} style={{ flex: 1, paddingRight: 12 }}>
              <Text variant="bodySmall" weight="semibold">
                Rutinas
              </Text>
              <Text variant="captionSmall" color={theme.colors.textSecondary}>
                Tus videos y técnicas. Unos para atraer, otros solo para tus alumnos.
              </Text>
            </Stack>
            <Text variant="body" color={theme.colors.textTertiary}>
              ›
            </Text>
          </Row>
        </Card>
      </Pressable>

      {isOwner && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Planes y precios"
          onPress={() => router.push('/plans')}
        >
          <Card radius={theme.radii.lg} tone="sunken">
            <Row>
              <Stack gap={2} style={{ flex: 1, paddingRight: 12 }}>
                <Text variant="bodySmall" weight="semibold">
                  Planes y precios
                </Text>
                <Text variant="captionSmall" color={theme.colors.textSecondary}>
                  Lo que cobras por entrenar aquí.
                </Text>
              </Stack>
              <Text variant="body" color={theme.colors.textTertiary}>
                ›
              </Text>
            </Row>
          </Card>
        </Pressable>
      )}

      <Row gap={8} justify="flex-start">
        <Chip label="Activos" selected={!viendoBajas} onPress={() => setViendoBajas(false)} />
        <Chip label="Bajas" selected={viendoBajas} onPress={() => setViendoBajas(true)} />
      </Row>

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Buscar por nombre o documento"
        placeholderTextColor={theme.colors.textPlaceholder}
        keyboardAppearance={theme.scheme}
        autoCapitalize="none"
        autoCorrect={false}
        style={{
          color: theme.colors.ink,
          fontSize: 15,
          paddingVertical: 12,
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.hairline,
        }}
      />
    </Stack>
  );

  const blank =
    (viendoBajas ? loadingDeletions : loading) && listado.length === 0 ? (
      <Text variant="bodySmall" color={theme.colors.textSecondary} align="center">
        {viendoBajas ? 'Buscando las bajas…' : 'Cargando el padrón…'}
      </Text>
    ) : (
      <Card tone="sunken">
        <Stack gap={14}>
          <Text variant="bodySmall" color={theme.colors.textSecondary} align="center">
            {query.trim().length > 0
              ? 'Nadie coincide con esa búsqueda.'
              : viendoBajas
                ? 'Nadie ha cancelado. Aquí aparecen las fichas dadas de baja, que se reinscriben sin registrar otra vez a la persona.'
                : 'Todavía no hay alumnos inscritos. Inscribe al primero con su nombre, su documento y su celular.'}
          </Text>
          {/* Un vacío que dice qué falta y no ofrece hacerlo deja a quien lo lee
              buscando el botón por la app. */}
          {query.trim().length === 0 && !viendoBajas && (
            <Button label="Inscribir alumno" onPress={() => router.push('/enroll')} />
          )}
        </Stack>
      </Card>
    );

  // FlatList y no un `map` dentro del ScrollView: el padrón es el gimnasio
  // entero, y montar sesenta tarjetas de golpe se siente en el equipo del
  // mostrador, que no es un teléfono nuevo.
  return (
    <Screen padded={false}>
      <FlatList
        data={listado}
        keyExtractor={(entry) => entry.view.membership.id}
        renderItem={({ item }) => <MemberRow entry={item} onPress={() => open(item)} />}
        ListHeaderComponent={cabecera}
        ListEmptyComponent={blank}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        contentContainerStyle={{ paddingHorizontal: screenPadding, paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refrescando}
            onRefresh={refrescar}
            tintColor={theme.colors.textTertiary}
          />
        }
      />
    </Screen>
  );
}

function MemberRow({
  entry,
  onPress,
}: {
  readonly entry: RosterEntry;
  readonly onPress: () => void;
}) {
  const theme = useTheme();
  const { view, user } = entry;
  const debt = view.receivable.amountCents;

  // El semáforo lo decide el dominio, no esta pantalla: aquí solo se traduce a
  // color. Si esta lista tuviera su propio criterio, un alumno podría verse
  // verde en el padrón y rojo en la puerta.
  const color =
    view.level === 'ok'
      ? theme.semaphore.ok
      : view.level === 'warn'
        ? theme.semaphore.warn
        : theme.semaphore.bad;

  return (
    <Pressable accessibilityRole="button" onPress={onPress}>
      <Card
        borderColor={debt > 0 ? withAlpha(color, 0.35) : theme.colors.hairline}
        radius={theme.radii.lg}
      >
        <Row justify="space-between" align="center" gap={12}>
          <Row align="center" gap={10} style={{ flex: 1 }}>
            <Dot color={color} size={9} />
            <Stack gap={2} style={{ flex: 1 }}>
              <Text variant="heading">{user.name}</Text>
              <Text variant="captionSmall" color={theme.colors.textTertiary}>
                {view.plan.name} · {view.badge}
              </Text>
            </Stack>
          </Row>

          <Stack gap={2} style={{ alignItems: 'flex-end' }}>
            {debt > 0 ? (
              <>
                <Text variant="heading" color={color}>
                  {formatPEN(debt as Cents, { withDecimals: false })}
                </Text>
                <Text variant="micro" color={theme.colors.textFaint}>
                  cobrar
                </Text>
              </>
            ) : (
              <Text variant="captionSmall" color={theme.colors.textFaint}>
                al día
              </Text>
            )}
          </Stack>
          <View />
        </Row>
      </Card>
    </Pressable>
  );
}

/** Una cifra del resumen del dueño. */
function Metrica({
  value,
  label,
  color,
}: {
  readonly value: string;
  readonly label: string;
  readonly color: string;
}) {
  const theme = useTheme();
  return (
    <Card radius={theme.radii.xl} style={{ flex: 1 }}>
      <Stack gap={2}>
        <Text variant="displaySmall" weight="extrabold" color={color}>
          {value}
        </Text>
        <Text variant="captionSmall" color={theme.colors.textSecondary}>
          {label}
        </Text>
      </Stack>
    </Card>
  );
}

/**
 * El aviso de la suscripción del gimnasio a Sinchi.
 *
 * El texto sale de `shared` y no de aquí: la app, el panel web y el motivo con
 * el que la api rechaza un alta tienen que decir lo mismo del mismo hecho. Si la
 * pantalla escribiera el suyo, el dueño leería una cosa en el padrón y otra
 * distinta al chocar contra el corte.
 */
function SubscriptionNotice({
  notice,
  onCanjeado,
}: {
  readonly notice: SaasNotice;
  readonly onCanjeado: () => void;
}) {
  const theme = useTheme();
  const [opened, setOpened] = useState(false);
  const [code, setCode] = useState('');
  const [canjeando, setCanjeando] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);

  const color =
    notice.tone === 'blocked'
      ? theme.semaphore.bad
      : notice.tone === 'warn'
        ? theme.semaphore.warn
        : theme.colors.ink;

  const redeem = async (): Promise<void> => {
    setCanjeando(true);
    setOutcome(null);
    try {
      const redemption = await redeemCode(code);
      if (redemption.redeemed) {
        setOutcome(describePromo({ freeMonths: redemption.freeMonths, freeUntil: redemption.freeUntil }));
        setCode('');
        onCanjeado();
      } else {
        // El motivo sale de `shared`: la app, el panel y la api dicen lo mismo
        // del mismo hecho, y la persona necesita saber si insistir sirve.
        setOutcome(promoDenialMessage(redemption.reason));
      }
    } catch (causa: unknown) {
      setOutcome(causa instanceof Error ? causa.message : 'No se pudo canjear.');
    } finally {
      setCanjeando(false);
    }
  };

  return (
    <Card borderColor={withAlpha(color, 0.35)} style={{ paddingVertical: 12 }}>
      <Stack gap={3}>
        <Text variant="bodySmall" weight="semibold" color={color}>
          {notice.title}
        </Text>
        <Text variant="captionSmall" color={theme.colors.textSecondary}>
          {notice.detail}
        </Text>

        {/* El canje vive AQUI, pegado a la cuenta atrás, y no en ajustes: es el
            único momento en que el dueño piensa en cuánto le queda. */}
        {opened ? (
          <Row gap={8} style={{ marginTop: 8 }}>
            <TextInput
              value={code}
              onChangeText={setCode}
              placeholder="Tu código"
              placeholderTextColor={theme.colors.textPlaceholder}
              keyboardAppearance={theme.scheme}
              autoCapitalize="characters"
              autoCorrect={false}
              accessibilityLabel="Código de promoción"
              style={{
                flex: 1,
                color: theme.colors.ink,
                fontSize: 15,
                paddingVertical: 6,
                borderBottomWidth: 1,
                borderBottomColor: theme.colors.hairline,
              }}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Canjear código"
              disabled={canjeando || code.trim().length === 0}
              hitSlop={10}
              onPress={() => void redeem()}
            >
              <Text
                variant="captionSmall"
                weight="semibold"
                color={code.trim().length === 0 ? theme.colors.textFaint : theme.semaphore.ok}
              >
                {canjeando ? 'Canjeando…' : 'Canjear'}
              </Text>
            </Pressable>
          </Row>
        ) : (
          <Pressable
            accessibilityRole="button"
            hitSlop={10}
            onPress={() => setOpened(true)}
            style={{ marginTop: 6 }}
          >
            <Text variant="captionSmall" weight="semibold" color={theme.colors.textSecondary}>
              Tengo un código
            </Text>
          </Pressable>
        )}

        {outcome === null ? null : (
          <Text variant="micro" color={theme.colors.textSecondary} style={{ marginTop: 4 }}>
            {outcome}
          </Text>
        )}
      </Stack>
    </Card>
  );
}

/**
 * En qué local estoy, y el salto al otro.
 *
 * Vive en el padrón y no solo en Ajustes porque el problema que resuelve es de
 * ESTA pantalla: el dueño con dos locales llega aquí a preguntar «cuánto entró y
 * quién debe», y las cifras del local equivocado responden esa pregunta igual de
 * bien. El nombre delante es la mitad que importa; el cambio es la comodidad.
 *
 * Solo se monta con más de un local (`localActual` es `null` con uno), así que
 * quien tiene un dojo y nada más no ve una línea de más.
 *
 * Desplegable y no una lista siempre abierta: son dos o tres nombres, pero
 * ocupan el sitio donde el mostrador mira la deuda todo el día.
 */
function SelectorDeLocal({
  gyms,
  actual,
}: {
  readonly gyms: readonly StaffPostDto[];
  readonly actual: StaffPostDto;
}) {
  const theme = useTheme();
  const [opened, setOpened] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const others = gyms.filter((local) => local.tenantId !== actual.tenantId);

  return (
    <Stack gap={8}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: opened }}
        accessibilityLabel={`${actual.tenantName ?? 'Este local'}. Cambiar de local`}
        hitSlop={8}
        onPress={() => setOpened((v) => !v)}
      >
        <Row gap={8} justify="flex-start">
          <Text
            variant="captionSmall"
            weight="semibold"
            numberOfLines={1}
            style={{ flexShrink: 1 }}
          >
            {actual.tenantName ?? 'Este local'}
          </Text>
          <Text variant="captionSmall" color={theme.colors.textSecondary}>
            {opened ? 'cerrar' : 'cambiar'}
          </Text>
        </Row>
      </Pressable>

      {opened &&
        others.map((local) => (
          <Pressable
            key={local.tenantId}
            accessibilityRole="button"
            accessibilityLabel={`Cambiar a ${local.tenantName ?? 'el otro local'}`}
            disabled={switching !== null}
            onPress={() => {
              setSwitching(local.tenantId);
              setError(null);
              /**
               * No hay `then` de éxito, y es a propósito: `switchGym`
               * vacía el store y guarda la sesión nueva, y esta pantalla se
               * vuelve a montar con el padrón del otro local. Apagar el
               * indicador después sería tocar el estado de un componente que
               * ya no existe.
               */
              void switchGym(local.tenantId).catch((causa: unknown) => {
                setSwitching(null);
                setError(
                  causa instanceof Error ? causa.message : 'No se pudo cambiar de local.',
                );
              });
            }}
          >
            <Card radius={theme.radii.lg} tone="sunken">
              <Row gap={10}>
                <Stack gap={1} style={{ flex: 1 }}>
                  <Text variant="captionSmall" weight="semibold" numberOfLines={1}>
                    {local.tenantName ?? 'Otro local'}
                  </Text>
                  <Text variant="micro" color={theme.colors.textSecondary}>
                    {local.role === 'owner' ? 'Dueño' : 'Recepción'}
                  </Text>
                </Stack>
                {switching === local.tenantId ? (
                  <ActivityIndicator color={theme.colors.textSecondary} />
                ) : (
                  <Text variant="captionSmall" color={theme.colors.textSecondary}>
                    ›
                  </Text>
                )}
              </Row>
            </Card>
          </Pressable>
        ))}

      {error !== null && (
        <Text variant="micro" color={theme.semaphore.bad}>
          {error}
        </Text>
      )}
    </Stack>
  );
}
