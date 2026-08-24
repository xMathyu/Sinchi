/**
 * Aceptar una invitacion.
 *
 * Se llega aqui desde `sinchi://invite/<token>` — un enlace que el gimnasio
 * manda por WhatsApp. Es el atajo al codigo de 6 digitos: en vez de que la
 * persona lo dicte en el mostrador, el staff ya eligio ficha y plan al invitar.
 *
 * El orden de la pantalla no es casual: **primero se enseña a que le estan
 * invitando y cuanto cuesta, y solo despues se pide crear la cuenta.** Al reves
 * seria pedirle los datos a alguien que todavia no sabe si le interesa.
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { formatPENShort, type Cents } from '@sinchi/shared';
import { withAlpha } from '@sinchi/ui';
import { Screen } from '../../src/design/screen';
import { Button, Card, Eyebrow, Logo, Row, Stack, Text } from '../../src/design/primitives';
import { useTheme } from '../../src/design/theme';
import { fetchInvite, type InvitePreviewDto } from '../../src/data/api';
import { acceptInvite } from '../../src/data/auth';
import { firebaseConfigured, signInWithEmail } from '../../src/data/firebase';

type Phase = 'loading' | 'ready' | 'gone';

export default function InviteScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { token } = useLocalSearchParams<{ token: string }>();

  const [phase, setPhase] = useState<Phase>('loading');
  const [invite, setInvite] = useState<InvitePreviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (typeof token !== 'string' || token.length === 0) {
      setPhase('gone');
      return;
    }

    let cancelled = false;
    void fetchInvite(token)
      .then((preview) => {
        if (cancelled) return;
        setInvite(preview);
        setPhase('ready');
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        // Caducada, consumida, revocada o inventada: la api no las distingue a
        // proposito, y la app tampoco tiene por que.
        setError(cause instanceof Error ? cause.message : 'No se pudo leer la invitación.');
        setPhase('gone');
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  const accept = (): void => {
    if (typeof token !== 'string') return;
    setError(null);
    setWorking(true);

    void (async () => {
      try {
        // Se intenta crear la cuenta y, si el correo ya tiene una, se entra con
        // ella. Preguntarle a alguien "¿es tu primera vez?" cuando el servidor
        // puede averiguarlo solo es una decision que no le corresponde tomar.
        let firebaseToken: string;
        try {
          firebaseToken = await signInWithEmail(email, password, 'signUp');
        } catch (cause) {
          const code = (cause as { code?: string } | null)?.code ?? '';
          if (!code.startsWith('EMAIL_EXISTS')) throw cause;
          firebaseToken = await signInWithEmail(email, password, 'signIn');
        }

        const outcome = await acceptInvite(token, firebaseToken);
        if (outcome.kind === 'error') {
          setError(outcome.message);
          return;
        }
        // El layout raiz enruta solo al ver la sesion.
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'No se pudo aceptar la invitación.');
      } finally {
        setWorking(false);
      }
    })();
  };

  if (phase === 'loading') {
    return (
      <Screen>
        <Stack gap={16} style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator color={theme.colors.ink} />
          <Text variant="bodySmall" color={theme.colors.textSecondary}>
            Abriendo tu invitación…
          </Text>
        </Stack>
      </Screen>
    );
  }

  if (phase === 'gone' || invite === null) {
    return (
      <Screen>
        <Stack gap={18} style={{ flex: 1, justifyContent: 'center' }}>
          <Card accent={theme.semaphore.bad} borderColor={withAlpha(theme.semaphore.bad, 0.28)}>
            <Eyebrow>Invitación no válida</Eyebrow>
            <Text variant="bodySmall" style={{ marginTop: 6 }}>
              {error ?? 'Esta invitación ya no es válida.'}
            </Text>
          </Card>
          <Button label="Ir al inicio" variant="secondary" onPress={() => router.replace('/login')} />
        </Stack>
      </Screen>
    );
  }

  const canSubmit = email.trim().length > 3 && password.length >= 6 && !working;
  const total = invite.priceCents + invite.enrollmentFeeCents;

  return (
    <Screen scroll>
      <Stack gap={24} style={{ paddingVertical: 32 }}>
        <Stack gap={12} style={{ alignItems: 'center' }}>
          <Logo size={48} />
          <Text variant="captionSmall" color={theme.colors.textFaint}>
            TE INVITARON A
          </Text>
          <Text variant="title" align="center">
            {invite.gymName}
          </Text>
        </Stack>

        <Card tone="sunken">
          <Stack gap={12}>
            <Row justify="space-between" align="center">
              <Text variant="bodySmall" color={theme.colors.textSecondary}>
                A nombre de
              </Text>
              <Text variant="heading">{invite.fullName}</Text>
            </Row>
            <View style={{ height: 1, backgroundColor: theme.colors.hairline }} />
            <Row justify="space-between" align="center">
              <Text variant="bodySmall" color={theme.colors.textSecondary}>
                Plan
              </Text>
              <Text variant="heading">{invite.planName}</Text>
            </Row>
            <Row justify="space-between" align="center">
              <Text variant="bodySmall" color={theme.colors.textSecondary}>
                Mensualidad
              </Text>
              <Text variant="heading">{formatPENShort(invite.priceCents as Cents)}</Text>
            </Row>
            {invite.enrollmentFeeCents > 0 && (
              <Row justify="space-between" align="center">
                <Text variant="bodySmall" color={theme.colors.textSecondary}>
                  Matrícula (una vez)
                </Text>
                <Text variant="heading">{formatPENShort(invite.enrollmentFeeCents as Cents)}</Text>
              </Row>
            )}
            <View style={{ height: 1, backgroundColor: theme.colors.hairline }} />
            <Row justify="space-between" align="center">
              <Text variant="body">Primer pago</Text>
              <Text variant="title">{formatPENShort(total as Cents)}</Text>
            </Row>
          </Stack>
        </Card>

        {/* Que quede claro que aceptar no cobra: en la v1 cobra el mostrador. */}
        <Text variant="captionSmall" color={theme.colors.textFaint} align="center">
          Aceptar no cobra nada. El pago lo registra el gimnasio cuando pagues en
          recepción.
        </Text>

        {error !== null && (
          <Card accent={theme.semaphore.bad} borderColor={withAlpha(theme.semaphore.bad, 0.28)}>
            <Text variant="bodySmall">{error}</Text>
          </Card>
        )}

        {firebaseConfigured() ? (
          <Stack gap={14}>
            <Text variant="bodySmall" color={theme.colors.textSecondary}>
              Crea tu cuenta para aceptar:
            </Text>

            <Stack gap={4}>
              <Text variant="captionSmall" color={theme.colors.textTertiary}>
                Correo
              </Text>
              <TextInput
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                keyboardType="email-address"
                editable={!working}
                placeholder="tucorreo@ejemplo.com"
                placeholderTextColor={theme.colors.textDisabled}
                style={{
                  color: theme.colors.ink,
                  fontSize: 16,
                  paddingVertical: 10,
                  borderBottomWidth: 1,
                  borderBottomColor: theme.colors.hairline,
                }}
              />
            </Stack>

            <Stack gap={4}>
              <Text variant="captionSmall" color={theme.colors.textTertiary}>
                Contraseña
              </Text>
              <TextInput
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="new-password"
                editable={!working}
                placeholder="Al menos 6 caracteres"
                placeholderTextColor={theme.colors.textDisabled}
                onSubmitEditing={() => {
                  if (canSubmit) accept();
                }}
                returnKeyType="go"
                style={{
                  color: theme.colors.ink,
                  fontSize: 16,
                  paddingVertical: 10,
                  borderBottomWidth: 1,
                  borderBottomColor: theme.colors.hairline,
                }}
              />
            </Stack>

            <Button
              label={working ? 'Aceptando…' : 'Aceptar e inscribirme'}
              disabled={!canSubmit}
              onPress={accept}
            />
          </Stack>
        ) : (
          <Card accent={theme.semaphore.bad} borderColor={withAlpha(theme.semaphore.bad, 0.28)}>
            <Text variant="bodySmall">
              Este build no trae configuración de Firebase.
            </Text>
          </Card>
        )}

        <Pressable onPress={() => router.replace('/login')} hitSlop={14} disabled={working}>
          <Text variant="caption" color={theme.colors.textSecondary} align="center">
            Ya tengo cuenta en Sinchi
          </Text>
        </Pressable>
      </Stack>
    </Screen>
  );
}
