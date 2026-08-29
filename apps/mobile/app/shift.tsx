/**
 * Abrir turno en el equipo del mostrador.
 *
 * Dos pasos porque son dos cosas distintas: el equipo se registra UNA vez (con el
 * token que da el dueño) y a partir de ahí cada persona abre su turno con su PIN.
 *
 * La razón de que exista el PIN y no simplemente una sesión de Google por
 * recepcionista: la tablet es compartida y los turnos rotan. Cerrar y abrir sesión
 * de Google en cada cambio termina en "dejemos la de Ana abierta", y entonces
 * `recorded_by` deja de decir la verdad sobre quién marcó y quién cobró — que es
 * justo lo que la auditoría existe para saber.
 */
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { withAlpha } from '@sinchi/ui';
import { Screen } from '../src/design/screen';
import { Button, Card, Eyebrow, Row, Stack, Text } from '../src/design/primitives';
import { useTheme } from '../src/design/theme';
import { registerThisDevice, shiftCandidates, startShift } from '../src/data/auth';
import { getDeviceToken } from '../src/data/session';
import type { ShiftCandidate } from '../src/data/api';

export default function ShiftScreen() {
  const theme = useTheme();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [candidates, setCandidates] = useState<readonly ShiftCandidate[] | null>(null);
  const [deviceTokenInput, setDeviceTokenInput] = useState('');
  const [selected, setSelected] = useState<ShiftCandidate | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const token = await getDeviceToken();
    if (token === null) {
      setCandidates(null);
      setLoading(false);
      return;
    }
    setCandidates(await shiftCandidates());
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <Screen>
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <ActivityIndicator color={theme.colors.ink} />
        </View>
      </Screen>
    );
  }

  // ---------------------------------------------------------------------------
  // Paso 1: registrar el equipo
  // ---------------------------------------------------------------------------
  if (candidates === null) {
    return (
      <Screen scroll>
        <Stack gap={22} style={{ paddingVertical: 30 }}>
          <Stack gap={8}>
            <Text variant="title">Registrar este equipo</Text>
            <Text variant="body" color={theme.colors.textSecondary}>
              Pega el token que te dio el dueño del gimnasio. Se hace una sola vez:
              después sobrevive a todos los cambios de turno.
            </Text>
          </Stack>

          {error !== null && (
            <Card accent={theme.semaphore.bad} borderColor={withAlpha(theme.semaphore.bad, 0.28)}>
              <Text variant="bodySmall">{error}</Text>
            </Card>
          )}

          <Card tone="sunken">
            <Stack gap={8}>
              <Eyebrow>Token del equipo</Eyebrow>
              <TextInput
                value={deviceTokenInput}
                onChangeText={setDeviceTokenInput}
                placeholder="Pégalo aquí"
                placeholderTextColor={theme.colors.textPlaceholder}
                autoCapitalize="none"
                autoCorrect={false}
                multiline
                style={{
                  color: theme.colors.ink,
                  fontSize: 15,
                  minHeight: 64,
                  fontFamily: 'monospace',
                }}
              />
            </Stack>
          </Card>

          <Button
            label={working ? 'Comprobando…' : 'Registrar equipo'}
            disabled={deviceTokenInput.trim().length < 20 || working}
            onPress={() => {
              setError(null);
              setWorking(true);
              void registerThisDevice(deviceTokenInput).then(async (outcome) => {
                setWorking(false);
                if (outcome.kind === 'error') {
                  setError(outcome.message);
                  return;
                }
                setDeviceTokenInput('');
                await load();
              });
            }}
          />

          <Pressable onPress={() => router.replace('/login')} hitSlop={14}>
            <Text variant="caption" color={theme.colors.textSecondary} align="center">
              Volver
            </Text>
          </Pressable>
        </Stack>
      </Screen>
    );
  }

  // ---------------------------------------------------------------------------
  // Paso 2: elegir persona y poner PIN
  // ---------------------------------------------------------------------------
  return (
    <Screen scroll>
      <Stack gap={22} style={{ paddingVertical: 30 }}>
        <Stack gap={8}>
          <Text variant="title">Abrir turno</Text>
          <Text variant="body" color={theme.colors.textSecondary}>
            Lo que marques y cobres queda a tu nombre.
          </Text>
        </Stack>

        {error !== null && (
          <Card accent={theme.semaphore.bad} borderColor={withAlpha(theme.semaphore.bad, 0.28)}>
            <Text variant="bodySmall">{error}</Text>
          </Card>
        )}

        <Stack gap={10}>
          <Eyebrow>Quién entra</Eyebrow>
          {candidates.map((candidate) => {
            const active = selected?.id === candidate.id;
            return (
              <Pressable
                key={candidate.id}
                onPress={() => {
                  setSelected(candidate);
                  setPin('');
                  setError(null);
                }}
              >
                <Card
                  tone={active ? 'raised' : 'default'}
                  borderColor={active ? theme.semaphore.ok : theme.colors.hairline}
                >
                  <Row justify="space-between" align="center">
                    <Text variant="heading">{candidate.displayName}</Text>
                    {!candidate.hasPin && (
                      <Text variant="captionSmall" color={theme.semaphore.alert}>
                        sin PIN
                      </Text>
                    )}
                  </Row>
                </Card>
              </Pressable>
            );
          })}
        </Stack>

        {selected !== null && selected.hasPin && (
          <Card tone="sunken">
            <Stack gap={10}>
              <Eyebrow>Tu PIN</Eyebrow>
              <TextInput
                value={pin}
                onChangeText={(value) => setPin(value.replace(/\D/g, '').slice(0, 6))}
                placeholder="••••"
                placeholderTextColor={theme.colors.textPlaceholder}
                keyboardType="number-pad"
                secureTextEntry
                style={{ color: theme.colors.ink, fontSize: 28, letterSpacing: 8, paddingVertical: 4 }}
              />
              <Text variant="captionSmall" color={theme.colors.textSecondary}>
                Tras 5 intentos fallidos se bloquea 15 minutos.
              </Text>
            </Stack>
          </Card>
        )}

        {selected !== null && !selected.hasPin && (
          <Card accent={theme.semaphore.alert} borderColor={withAlpha(theme.semaphore.alert, 0.26)}>
            <Text variant="bodySmall">
              {selected.displayName} todavía no tiene PIN. El dueño puede asignarle
              uno desde su cuenta.
            </Text>
          </Card>
        )}

        <Button
          label={working ? 'Entrando…' : 'Abrir turno'}
          disabled={selected === null || !selected.hasPin || pin.length < 4 || working}
          onPress={() => {
            if (selected === null) return;
            setError(null);
            setWorking(true);
            void startShift(selected.id, pin).then((outcome) => {
              setWorking(false);
              setPin('');
              if (outcome.kind === 'error') setError(outcome.message);
              // Si salió bien, el layout raíz enruta al ver la sesión de staff.
            });
          }}
        />

        <Pressable onPress={() => router.replace('/login')} hitSlop={14}>
          <Text variant="caption" color={theme.colors.textSecondary} align="center">
            Volver
          </Text>
        </Pressable>
      </Stack>
    </Screen>
  );
}
