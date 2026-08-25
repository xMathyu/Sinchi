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
 */
import { useMemo, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { formatPEN, type Cents } from '@sinchi/shared';
import { withAlpha } from '@sinchi/ui';
import { Screen } from '../../src/design/screen';
import { Card, Dot, Eyebrow, Row, Stack, Text } from '../../src/design/primitives';
import { useTheme } from '../../src/design/theme';
import { useRoster, useStore } from '../../src/data/hooks';
import type { RosterEntry } from '../../src/data/store';

export default function PadronScreen() {
  const theme = useTheme();
  const router = useRouter();
  const roster = useRoster();
  const cargando = useStore((s) => s.hidratando);
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

  return (
    <Screen scroll>
      <Stack gap={18} style={{ paddingVertical: 20 }}>
        <Stack gap={4}>
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

        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Buscar por nombre o documento"
          placeholderTextColor={theme.colors.textDisabled}
          autoCapitalize="none"
          autoCorrect={false}
          style={{
            color: theme.colors.ink,
            fontSize: 15,
            paddingVertical: 10,
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.hairline,
          }}
        />

        {cargando && roster.length === 0 ? (
          <Text variant="bodySmall" color={theme.colors.textSecondary} align="center">
            Cargando el padrón…
          </Text>
        ) : listado.length === 0 ? (
          <Card tone="sunken">
            <Text variant="bodySmall" color={theme.colors.textSecondary} align="center">
              {roster.length === 0
                ? 'Todavía no hay alumnos inscritos en este gimnasio.'
                : 'Nadie coincide con esa búsqueda.'}
            </Text>
          </Card>
        ) : (
          <Stack gap={10}>
            {listado.map((entrada) => (
              <Fila
                key={entrada.view.membership.id}
                entrada={entrada}
                onPress={() => router.push(`/charge/${entrada.view.membership.id}`)}
              />
            ))}
          </Stack>
        )}
      </Stack>
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
