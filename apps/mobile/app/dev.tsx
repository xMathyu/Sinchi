/**
 * Puerta de desarrollo.
 *
 * Existe porque probar la app en un teléfono real no debería depender de que la
 * autenticación con Google esté configurada en la consola de Firebase. Dos
 * caminos:
 *
 *  · **demostración** — sin api y sin sesión, contra los datos en memoria. Es lo
 *    que permite recorrer las once pantallas en dos minutos con Expo Go.
 *  · **dev-login** — sesión real contra una api, eligiendo a quién. Sirve para
 *    ver datos de verdad y ejercitar el cliente HTTP.
 *
 * Toda la pantalla va detrás de `__DEV__`. En un build de producción no se
 * compila el contenido y la ruta muestra un aviso: no hay forma de que un
 * atajo de desarrollo llegue a la tienda.
 */
import { useState } from 'react';
import { ActivityIndicator, Pressable, TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import { withAlpha } from '@sinchi/ui';
import { Screen } from '../src/design/screen';
import { Button, Card, Eyebrow, Row, Stack, Text } from '../src/design/primitives';
import { useTheme } from '../src/design/theme';
import { getApiBase, setApiBase } from '../src/data/api';
import { enterDemoMode, saveSession } from '../src/data/session';

/**
 * Atajos a las cuentas que siembra `npm run db:seed`.
 *
 * Son un atajo, no la lista: una base real no tiene por qué estar sembrada con
 * ellas —la de produccion no lo esta— y cuando no lo esta, estos botones fallan
 * con un 404 que parece un problema de la api. Por eso arriba hay un campo para
 * escribir cualquier telefono del padron.
 */
const CUENTAS = [
  { phone: '+51987654321', label: 'Mathyu Quispe', detail: 'alumno · 3 gimnasios' },
  { phone: '+51987000111', label: 'Ana Ríos', detail: 'recepción · Dojo Shotokan' },
  { phone: '+51987000222', label: 'Carlos Vega', detail: 'recepción · Nova BJJ' },
  { phone: '+51987000333', label: 'Sergio Paz', detail: 'dueño · Iron Muay Thai' },
] as const;

export default function DevScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [apiUrl, setApiUrl] = useState(getApiBase());
  const [working, setWorking] = useState<string | null>(null);
  const [telefono, setTelefono] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!__DEV__) {
    return (
      <Screen>
        <Stack gap={12} style={{ flex: 1, justifyContent: 'center' }}>
          <Text variant="title" align="center">
            No disponible
          </Text>
          <Text variant="body" color={theme.colors.textSecondary} align="center">
            Los atajos de desarrollo no existen en esta versión.
          </Text>
        </Stack>
      </Screen>
    );
  }

  const devLogin = async (phone: string): Promise<void> => {
    setError(null);
    setWorking(phone);
    setApiBase(apiUrl.trim());

    try {
      // Se llama directo y no por `api.ts`: `dev-login` es una puerta de
      // desarrollo y no merece un método en el cliente de producción.
      const response = await fetch(`${apiUrl.trim()}/auth/dev-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });

      const body = (await response.json()) as {
        accessToken?: string;
        expiresInSeconds?: number;
        role?: 'student' | 'front_desk' | 'owner';
        userId?: string;
        tenantId?: string | null;
        message?: string;
      };

      if (!response.ok || body.accessToken === undefined) {
        setError(body.message ?? `La api respondió ${response.status}.`);
        return;
      }

      await saveSession({
        accessToken: body.accessToken,
        expiresInSeconds: body.expiresInSeconds ?? 3600,
        role: body.role ?? 'student',
        userId: body.userId ?? '',
        tenantId: body.tenantId ?? null,
      });
      // El layout raíz enruta al ver la sesión.
    } catch {
      setError(
        `No se pudo llegar a ${apiUrl.trim()}. Si es una api local, el teléfono ` +
          'tiene que estar en la misma wifi y el firewall permitir el puerto.',
      );
    } finally {
      setWorking(null);
    }
  };

  return (
    <Screen scroll>
      <Stack gap={22} style={{ paddingVertical: 26 }}>
        <Stack gap={6}>
          <Eyebrow color={theme.semaphore.warn}>Solo desarrollo</Eyebrow>
          <Text variant="title">Probar la app</Text>
        </Stack>

        {error !== null && (
          <Card accent={theme.semaphore.bad} borderColor={withAlpha(theme.semaphore.bad, 0.28)}>
            <Text variant="bodySmall">{error}</Text>
          </Card>
        )}

        {/* ---------------------------------------------------------------- */}
        <Card tone="sunken">
          <Stack gap={10}>
            <Eyebrow>Sin api</Eyebrow>
            <Text variant="bodySmall" color={theme.colors.textSecondary}>
              Recorre las once pantallas con los datos de demostración. No hace
              falta servidor ni sesión, y el rol se cambia desde Ajustes.
            </Text>
            <Button
              label="Modo demostración"
              onPress={() => {
                enterDemoMode();
                router.replace('/');
              }}
            />
          </Stack>
        </Card>

        {/* ---------------------------------------------------------------- */}
        <Card tone="sunken">
          <Stack gap={12}>
            <Eyebrow>Contra una api</Eyebrow>
            <Text variant="bodySmall" color={theme.colors.textSecondary}>
              Sesión real con datos de verdad. Necesita que la api tenga
              `ALLOW_DEV_LOGIN=true` y que esté sembrada.
            </Text>

            <Stack gap={4}>
              <Text variant="captionSmall" color={theme.colors.textTertiary}>
                URL de la api
              </Text>
              <TextInput
                value={apiUrl}
                onChangeText={setApiUrl}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                placeholderTextColor={theme.colors.textPlaceholder}
                style={{
                  color: theme.colors.ink,
                  fontSize: 14,
                  paddingVertical: 8,
                  borderBottomWidth: 1,
                  borderBottomColor: theme.colors.hairline,
                }}
              />
            </Stack>

            <Stack gap={4}>
              <Text variant="captionSmall" color={theme.colors.textTertiary}>
                Teléfono de la persona
              </Text>
              <Row gap={10}>
                <TextInput
                  value={telefono}
                  onChangeText={setTelefono}
                  placeholder="+51..."
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="phone-pad"
                  placeholderTextColor={theme.colors.textPlaceholder}
                  style={{
                    flex: 1,
                    color: theme.colors.ink,
                    fontSize: 16,
                    paddingVertical: 8,
                    borderBottomWidth: 1,
                    borderBottomColor: theme.colors.hairline,
                  }}
                />
                <Pressable
                  accessibilityRole="button"
                  hitSlop={12}
                  disabled={telefono.trim().length < 6 || working !== null}
                  onPress={() => void devLogin(telefono.trim())}
                  style={{ opacity: telefono.trim().length < 6 || working !== null ? 0.4 : 1 }}
                >
                  <Text variant="bodySmall" weight="semibold" color={theme.semaphore.ok}>
                    Entrar
                  </Text>
                </Pressable>
              </Row>
            </Stack>

            <Text variant="micro" color={theme.colors.textFaint}>
              O usa una de las cuentas de la semilla, si la base las tiene:
            </Text>

            {CUENTAS.map((cuenta) => (
              <Pressable
                key={cuenta.phone}
                onPress={() => void devLogin(cuenta.phone)}
                disabled={working !== null}
              >
                <Card
                  borderColor={theme.colors.hairline}
                  style={{ opacity: working !== null && working !== cuenta.phone ? 0.4 : 1 }}
                >
                  <Row justify="space-between" align="center">
                    <Stack gap={2}>
                      <Text variant="heading">{cuenta.label}</Text>
                      <Text variant="captionSmall" color={theme.colors.textSecondary}>
                        {cuenta.detail}
                      </Text>
                    </Stack>
                    {working === cuenta.phone && <ActivityIndicator color={theme.colors.ink} />}
                  </Row>
                </Card>
              </Pressable>
            ))}
          </Stack>
        </Card>

        <Pressable onPress={() => router.back()} hitSlop={14}>
          <Text variant="caption" color={theme.colors.textSecondary} align="center">
            Volver al login
          </Text>
        </Pressable>
      </Stack>
    </Screen>
  );
}
