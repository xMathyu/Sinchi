/**
 * S4 · Marcado manual.
 *
 * Para el alumno sin celular o con la batería muerta. Queda registrado con
 * `method = manual` y con quién lo registró, porque es el hueco por donde se
 * cuelan favores (MD 4.6): el aviso en pantalla no es un trámite legal, es lo
 * que hace que el recepcionista sepa que se está firmando.
 */
import { useMemo, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { formatPENShort } from '@sinchi/shared';
import { semaphoreStyle, withAlpha } from '@sinchi/ui';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Eyebrow,
  Row,
  Stack,
  Text,
} from '../../src/design/primitives';
import { Screen } from '../../src/design/screen';
import { useTheme } from '../../src/design/theme';
import { useRoster, useStore, useToday } from '../../src/data/hooks';
import type { RosterEntry } from '../../src/data/store';
import { marcarAsistencia } from '../../src/data/actions';
import { formatDocument, initials } from '../../src/lib/format';

export default function ManualCheckInScreen() {
  const theme = useTheme();
  const today = useToday();
  const staff = useStore((state) => state.staff);
  const roster = useRoster();

  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [marcando, setMarcando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return roster;
    return roster.filter(
      (entry) =>
        entry.user.name.toLowerCase().includes(needle) ||
        entry.user.documentId.includes(needle.replace(/\s/g, '')),
    );
  }, [roster, query]);

  const selected = matches.find((entry) => entry.view.membership.id === selectedId) ?? null;

  return (
    <Screen scroll>
      <Row style={{ paddingTop: 8 }}>
        <Text variant="titleSmall" weight="bold">
          Marcar manual
        </Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()}>
          <Text variant="body" color={theme.colors.textSecondary}>
            Cerrar
          </Text>
        </Pressable>
      </Row>

      <View
        style={{
          marginTop: 16,
          backgroundColor: theme.colors.surfaceMuted,
          borderRadius: 13,
          paddingHorizontal: 15,
          paddingVertical: 4,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <View
          style={{
            width: 15,
            height: 15,
            borderRadius: 8,
            borderWidth: 2,
            borderColor: theme.colors.textTertiary,
          }}
        />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Nombre o documento"
          placeholderTextColor={theme.colors.textTertiary}
          autoCorrect={false}
          autoCapitalize="words"
          accessibilityLabel="Buscar alumno por nombre o documento"
          style={{
            flex: 1,
            color: theme.colors.ink,
            fontSize: 16,
            paddingVertical: 12,
          }}
        />
      </View>

      <Eyebrow style={{ marginTop: 16 }}>
        {matches.length} {matches.length === 1 ? 'coincidencia' : 'coincidencias'}
      </Eyebrow>

      <Stack gap={9} style={{ marginTop: 10 }}>
        {matches.map((entry) => (
          <MemberRow
            key={entry.view.membership.id}
            entry={entry}
            selected={entry.view.membership.id === selectedId}
            onPress={() => setSelectedId(entry.view.membership.id)}
          />
        ))}
        {matches.length === 0 ? (
          <Card radius={theme.radii.lg}>
            <Text variant="bodySmall" color={theme.colors.textSecondary} align="center">
              Nadie en el padrón coincide con «{query}».
            </Text>
          </Card>
        ) : null}
      </Stack>

      <View
        style={{
          marginTop: 16,
          backgroundColor: withAlpha(theme.semaphore.alert, 0.08),
          borderWidth: 1,
          borderColor: withAlpha(theme.semaphore.alert, 0.22),
          borderRadius: theme.radii.lg,
          padding: 14,
          flexDirection: 'row',
          gap: 11,
          alignItems: 'flex-start',
        }}
      >
        <View
          style={{
            width: 17,
            height: 17,
            borderRadius: 9,
            backgroundColor: theme.semaphore.alert,
            alignItems: 'center',
            justifyContent: 'center',
            marginTop: 1,
          }}
        >
          <Text variant="eyebrow" weight="black" color="#2B1305" style={{ letterSpacing: 0 }}>
            !
          </Text>
        </View>
        <Text variant="captionSmall" color="#D3B394" style={{ flex: 1 }}>
          El marcado manual queda auditado con tu nombre y la hora. Úsalo solo cuando el alumno no
          tenga su celular.
        </Text>
      </View>

      <Stack gap={10} style={{ marginTop: 20 }}>
        <Row>
          <Text variant="caption" color={theme.colors.textSecondary}>
            Registrado por
          </Text>
          <Text variant="caption" weight="semibold">
            {staff.displayName} · {staff.role === 'owner' ? 'dueño' : 'recepción'}
          </Text>
        </Row>
        <Button
          label={
            selected === null
              ? 'Elige un alumno'
              : `Marcar asistencia de ${firstName(selected.user.name)}`
          }
          disabled={selected === null}
          onPress={() => {
            if (selected === null) return;
            const allowed = selected.view.delinquency.canTrain && !selected.view.quota.exhausted;
            setMarcando(true);
            setError(null);

            void marcarAsistencia({
              membershipId: selected.view.membership.id,
              method: 'manual',
              overrideDenial: !allowed,
            })
              .then(() => {
                setSelectedId(null);
                setQuery('');
                router.back();
              })
              .catch((causa: unknown) => {
                setError(
                  causa instanceof Error ? causa.message : 'No se pudo marcar la asistencia.',
                );
              })
              .finally(() => setMarcando(false));
          }}
        />
        {error !== null ? (
          <Text variant="micro" color={theme.semaphore.bad} align="center">
            {error}
          </Text>
        ) : null}
        {selected !== null && !selected.view.delinquency.canTrain ? (
          <Text variant="micro" color={theme.semaphore.bad} align="center">
            {firstName(selected.user.name)} está suspendido. Marcarlo queda registrado como
            excepción a tu nombre.
          </Text>
        ) : null}
      </Stack>
    </Screen>
  );
}

const firstName = (name: string): string => name.trim().split(/\s+/)[0] ?? name;

function MemberRow({
  entry,
  selected,
  onPress,
}: {
  readonly entry: RosterEntry;
  readonly selected: boolean;
  readonly onPress: () => void;
}) {
  const theme = useTheme();
  const semaphore = semaphoreStyle(theme, entry.view.level);

  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ selected }} onPress={onPress}>
      <Card
        radius={theme.radii.lg}
        borderColor={selected ? withAlpha(semaphore.color, 0.5) : theme.colors.hairline}
      >
        <Row gap={12} justify="flex-start">
          <Avatar initials={initials(entry.user.name)} size={44} />
          <Stack gap={1} style={{ flex: 1 }}>
            <Text variant="heading" weight="semibold">
              {entry.user.name}
            </Text>
            <Text variant="captionSmall" color={theme.colors.textSecondary}>
              DNI {formatDocument(entry.user.documentId)} · {entry.view.plan.name}
            </Text>
          </Stack>
          <Badge label={shortBadge(entry)} color={semaphore.color} />
        </Row>
      </Card>
    </Pressable>
  );
}

/** En el padrón el chip tiene que caber al lado del nombre. */
function shortBadge(entry: RosterEntry): string {
  const { view } = entry;
  if (view.delinquency.status === 'suspended') return 'MORA';
  if (view.receivable.due) return `DEBE ${formatPENShort(view.receivable.amountCents)}`;
  if (view.quota.exhausted && view.quota.limit !== null) {
    return `${view.quota.used} / ${view.quota.limit}`;
  }
  return 'AL DÍA';
}
