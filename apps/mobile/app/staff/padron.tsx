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
import { FlatList, Pressable, RefreshControl, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { screenPadding } from '@sinchi/ui';
import { formatPEN, type Cents } from '@sinchi/shared';
import { withAlpha } from '@sinchi/ui';
import { Screen } from '../../src/design/screen';
import { Button, Card, Chip, Dot, Eyebrow, Row, Stack, Text } from '../../src/design/primitives';
import { useTheme } from '../../src/design/theme';
import {
  canjearCodigo,
} from '../../src/data/actions';
import {
  useBajas,
  useClaims,
  useOwnerSummary,
  useRefresco,
  useRoster,
  useStore,
  useSuscripcionSinchi,
} from '../../src/data/hooks';
import type { RosterEntry } from '../../src/data/store';
import { describePromo, promoDenialMessage, type SaasNotice } from '@sinchi/shared';

export default function PadronScreen() {
  const theme = useTheme();
  const router = useRouter();
  const roster = useRoster();
  const cargando = useStore((s) => s.hidratando);
  const esDueno = useStore((s) => s.staff.role) === 'owner';
  const { claims } = useClaims();
  const resumen = useOwnerSummary();
  const { suscripcion, recargar: recargarSuscripcion } = useSuscripcionSinchi();
  /**
   * `null` cuando quien mira es recepción: la suscripción es del dueño. Ahí no
   * se apaga nada — el alta le devuelve el motivo de la api en pantalla, que es
   * el mismo texto y llega en el momento de actuar.
   */
  const puedeInscribir = suscripcion === null || suscripcion.state.canWrite;
  const { refrescando, refrescar } = useRefresco();
  const [query, setQuery] = useState('');
  // Las bajas no entran en el padron normal —el mostrador mira «quien entrena
  // aqui» todo el dia— pero tienen que ser alcanzables: son las unicas fichas
  // que se pueden reinscribir, y cancelar las hacia desaparecer de todas partes.
  const [viendoBajas, setViendoBajas] = useState(false);
  const { bajas, cargando: cargandoBajas } = useBajas(viendoBajas);

  const listado = useMemo(() => {
    const fuente = viendoBajas ? bajas : roster;
    const texto = query.trim().toLowerCase();
    const filtrado =
      texto.length === 0
        ? [...fuente]
        : fuente.filter(
            (e) =>
              e.user.name.toLowerCase().includes(texto) || e.user.documentId.includes(texto),
          );

    return filtrado.sort((a, b) => {
      const deudaA = a.view.receivable.amountCents;
      const deudaB = b.view.receivable.amountCents;
      if (deudaA !== deudaB) return deudaB - deudaA;
      return a.user.name.localeCompare(b.user.name, 'es');
    });
  }, [roster, bajas, viendoBajas, query]);

  const deudaTotal = roster.reduce((suma, e) => suma + e.view.receivable.amountCents, 0);
  const conDeuda = roster.filter((e) => e.view.receivable.amountCents > 0).length;

  // Va a la ficha, no al cobro: la pregunta del mostrador no siempre es cobrar,
  // y para llegar a mirar a alguien no debería haber que abrir un cargo a medias.
  const abrir = useCallback(
    (entrada: RosterEntry) =>
      router.push({
        pathname: '/member/[membershipId]',
        params: { membershipId: entrada.view.membership.id },
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
            {/* Solo aparece cuando hay alguien esperando. Un chip permanente
                para algo que ocurre tres veces por semana es ruido en la
                pantalla que recepción mira todo el día. */}
            {claims.length > 0 && (
              <Pressable
                accessibilityRole="button"
                hitSlop={12}
                onPress={() => router.push('/claims')}
              >
                <Card
                  radius={theme.radii.pill}
                  borderColor={withAlpha(theme.semaphore.warn, 0.35)}
                  style={{ paddingVertical: 7, paddingHorizontal: 12 }}
                >
                  <Text variant="captionSmall" weight="semibold" color={theme.semaphore.warn}>
                    {claims.length} por vincular
                  </Text>
                </Card>
              </Pressable>
            )}
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
              accessibilityState={{ disabled: !puedeInscribir }}
              disabled={!puedeInscribir}
              hitSlop={12}
              onPress={() => router.push('/enroll')}
            >
              <Card
                radius={theme.radii.pill}
                borderColor={withAlpha(
                  puedeInscribir ? theme.semaphore.ok : theme.colors.textSecondary,
                  0.4,
                )}
                style={{ paddingVertical: 7, paddingHorizontal: 12 }}
              >
                <Text
                  variant="captionSmall"
                  weight="semibold"
                  color={puedeInscribir ? theme.semaphore.ok : theme.colors.textSecondary}
                >
                  + Alumno
                </Text>
              </Card>
            </Pressable>
          </Row>
        </Row>

        <Text variant="title" numberOfLines={1}>
          {roster.length} {roster.length === 1 ? 'alumno' : 'alumnos'}
        </Text>

        {/* A lo ancho, y solo para recepción: al dueño se lo dicen con más
            detalle las cifras de «Este mes», que van veinte píxeles más abajo.
            Decir el mismo número dos veces en la misma pantalla no informa, y
            era lo que obligaba a apretar esta línea contra los chips.

            Se decide por el ROL y no por `resumen === null`: ese llega tarde, y
            con él la línea aparecía y se esfumaba sola al cargar el resumen. */}
        {deudaTotal > 0 && !esDueno && (
          <Text variant="captionSmall" color={theme.semaphore.warn} numberOfLines={1}>
            {conDeuda} con deuda · {formatPEN(deudaTotal as Cents, { withDecimals: false })} por
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
      {suscripcion !== null &&
      (suscripcion.state.status === 'trialing' ||
        suscripcion.state.status === 'free' ||
        suscripcion.notice.tone !== 'info') ? (
        <AvisoSuscripcion notice={suscripcion.notice} onCanjeado={recargarSuscripcion} />
      ) : null}

      {/* Solo lo ve el dueño. Va en el padrón y no en una pestaña propia porque
          es la misma pregunta mirada de lejos: cuánto entró, cuánto falta y
          quién no está pagando. */}
      {resumen === null ? null : (
        <Stack gap={10}>
          <Eyebrow>Este mes</Eyebrow>
          <Row gap={10} align="stretch">
            <Metrica
              valor={formatPEN(resumen.collectedThisMonthCents as Cents, { withDecimals: false })}
              etiqueta="cobrado"
              color={theme.semaphore.ok}
            />
            <Metrica
              valor={formatPEN(resumen.outstandingCents as Cents, { withDecimals: false })}
              etiqueta="por cobrar"
              color={resumen.outstandingCents > 0 ? theme.semaphore.warn : theme.colors.ink}
            />
          </Row>
          <Row gap={10} align="stretch">
            <Metrica
              valor={String(resumen.checkInsToday)}
              etiqueta="marcados hoy"
              color={theme.colors.ink}
            />
            <Metrica
              valor={String(resumen.delinquentMembers)}
              etiqueta={resumen.delinquentMembers === 1 ? 'moroso' : 'morosos'}
              color={resumen.delinquentMembers > 0 ? theme.semaphore.bad : theme.colors.ink}
            />
          </Row>
        </Stack>
      )}

      {/* La entrada a la oferta del local. Va aquí y no en Ajustes porque es
          plata, no configuración: el dueño llega al padrón preguntándose cuánto
          entró, y "cuánto cobro" es la misma pregunta un paso antes.

          Por ROL y no por `resumen === null`: ese llega tarde y la fila
          aparecía y se esfumaba sola al cargar el resumen. */}
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

      {esDueno && (
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

  const vacio =
    (viendoBajas ? cargandoBajas : cargando) && listado.length === 0 ? (
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
        keyExtractor={(entrada) => entrada.view.membership.id}
        renderItem={({ item }) => <Fila entrada={item} onPress={() => abrir(item)} />}
        ListHeaderComponent={cabecera}
        ListEmptyComponent={vacio}
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

function Fila({
  entrada,
  onPress,
}: {
  readonly entrada: RosterEntry;
  readonly onPress: () => void;
}) {
  const theme = useTheme();
  const { view, user } = entrada;
  const deuda = view.receivable.amountCents;

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
        borderColor={deuda > 0 ? withAlpha(color, 0.35) : theme.colors.hairline}
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
            {deuda > 0 ? (
              <>
                <Text variant="heading" color={color}>
                  {formatPEN(deuda as Cents, { withDecimals: false })}
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
  valor,
  etiqueta,
  color,
}: {
  readonly valor: string;
  readonly etiqueta: string;
  readonly color: string;
}) {
  const theme = useTheme();
  return (
    <Card radius={theme.radii.xl} style={{ flex: 1 }}>
      <Stack gap={2}>
        <Text variant="displaySmall" weight="extrabold" color={color}>
          {valor}
        </Text>
        <Text variant="captionSmall" color={theme.colors.textSecondary}>
          {etiqueta}
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
function AvisoSuscripcion({
  notice,
  onCanjeado,
}: {
  readonly notice: SaasNotice;
  readonly onCanjeado: () => void;
}) {
  const theme = useTheme();
  const [abierto, setAbierto] = useState(false);
  const [codigo, setCodigo] = useState('');
  const [canjeando, setCanjeando] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);

  const color =
    notice.tone === 'blocked'
      ? theme.semaphore.bad
      : notice.tone === 'warn'
        ? theme.semaphore.warn
        : theme.colors.ink;

  const canjear = async (): Promise<void> => {
    setCanjeando(true);
    setResultado(null);
    try {
      const canje = await canjearCodigo(codigo);
      if (canje.redeemed) {
        setResultado(describePromo({ freeMonths: canje.freeMonths, freeUntil: canje.freeUntil }));
        setCodigo('');
        onCanjeado();
      } else {
        // El motivo sale de `shared`: la app, el panel y la api dicen lo mismo
        // del mismo hecho, y la persona necesita saber si insistir sirve.
        setResultado(promoDenialMessage(canje.reason));
      }
    } catch (causa: unknown) {
      setResultado(causa instanceof Error ? causa.message : 'No se pudo canjear.');
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
        {abierto ? (
          <Row gap={8} style={{ marginTop: 8 }}>
            <TextInput
              value={codigo}
              onChangeText={setCodigo}
              placeholder="Tu código"
              placeholderTextColor={theme.colors.textPlaceholder}
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
              disabled={canjeando || codigo.trim().length === 0}
              hitSlop={10}
              onPress={() => void canjear()}
            >
              <Text
                variant="captionSmall"
                weight="semibold"
                color={codigo.trim().length === 0 ? theme.colors.textFaint : theme.semaphore.ok}
              >
                {canjeando ? 'Canjeando…' : 'Canjear'}
              </Text>
            </Pressable>
          </Row>
        ) : (
          <Pressable
            accessibilityRole="button"
            hitSlop={10}
            onPress={() => setAbierto(true)}
            style={{ marginTop: 6 }}
          >
            <Text variant="captionSmall" weight="semibold" color={theme.colors.textSecondary}>
              Tengo un código
            </Text>
          </Pressable>
        )}

        {resultado === null ? null : (
          <Text variant="micro" color={theme.colors.textSecondary} style={{ marginTop: 4 }}>
            {resultado}
          </Text>
        )}
      </Stack>
    </Card>
  );
}
