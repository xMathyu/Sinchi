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
import { Card, Dot, Eyebrow, Row, Stack, Text } from '../../src/design/primitives';
import { useTheme } from '../../src/design/theme';
import { useClaims, useOwnerSummary, useRefresco, useRoster, useStore } from '../../src/data/hooks';
import type { RosterEntry } from '../../src/data/store';

export default function PadronScreen() {
  const theme = useTheme();
  const router = useRouter();
  const roster = useRoster();
  const cargando = useStore((s) => s.hidratando);
  const { claims } = useClaims();
  const resumen = useOwnerSummary();
  const { refrescando, refrescar } = useRefresco();
  const [query, setQuery] = useState('');

  const listado = useMemo(() => {
    const texto = query.trim().toLowerCase();
    const filtrado =
      texto.length === 0
        ? [...roster]
        : roster.filter(
            (e) =>
              e.user.name.toLowerCase().includes(texto) || e.user.documentId.includes(texto),
          );

    return filtrado.sort((a, b) => {
      const deudaA = a.view.receivable.amountCents;
      const deudaB = b.view.receivable.amountCents;
      if (deudaA !== deudaB) return deudaB - deudaA;
      return a.user.name.localeCompare(b.user.name, 'es');
    });
  }, [roster, query]);

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
      <Row align="flex-start">
        <Stack gap={4} style={{ flex: 1 }}>
          <Eyebrow>Padrón</Eyebrow>
          <Text variant="title">
            {roster.length} {roster.length === 1 ? 'alumno' : 'alumnos'}
          </Text>
          {deudaTotal > 0 && (
            <Text variant="bodySmall" color={theme.semaphore.warn}>
              {conDeuda} con deuda · {formatPEN(deudaTotal as Cents, { withDecimals: false })} por
              cobrar
            </Text>
          )}
        </Stack>
        {/* Solo aparece cuando hay alguien esperando. Un botón permanente para
            algo que ocurre tres veces por semana es ruido en la pantalla que
            recepción mira todo el día. */}
        {claims.length > 0 && (
          <Pressable
            accessibilityRole="button"
            hitSlop={12}
            onPress={() => router.push('/staff/claims')}
          >
            <Card
              radius={theme.radii.pill}
              borderColor={withAlpha(theme.semaphore.warn, 0.35)}
              style={{ paddingVertical: 7, paddingHorizontal: 13 }}
            >
              <Text variant="captionSmall" weight="semibold" color={theme.semaphore.warn}>
                {claims.length} por vincular
              </Text>
            </Card>
          </Pressable>
        )}
      </Row>

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
    cargando && roster.length === 0 ? (
      <Text variant="bodySmall" color={theme.colors.textSecondary} align="center">
        Cargando el padrón…
      </Text>
    ) : (
      <Card tone="sunken">
        <Text variant="bodySmall" color={theme.colors.textSecondary} align="center">
          {roster.length === 0
            ? 'Todavía no hay alumnos inscritos en este gimnasio.'
            : 'Nadie coincide con esa búsqueda.'}
        </Text>
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
