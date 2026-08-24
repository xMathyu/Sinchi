/**
 * Entrar.
 *
 * Una sola pantalla para los tres roles, con dos caminos: el alumno entra con
 * Google; el staff abre turno en el equipo del mostrador. La app no pregunta
 * "¿eres alumno o staff?" — el rol lo decide la api al mirar si esa persona tiene
 * fila en `staff`, no una elección del usuario.
 *
 * El acceso del staff va abajo y discreto a propósito: en un dojo de 60 alumnos
 * hay 60 personas que entran con Google y una que abre turno.
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Google from 'expo-auth-session/providers/google';
import { withAlpha } from '@sinchi/ui';
import { Screen } from '../src/design/screen';
import { Button, Card, Eyebrow, Logo, Stack, Text } from '../src/design/primitives';
import { useTheme } from '../src/design/theme';
import { completeGoogleSignIn } from '../src/data/auth';
import { googleAuthReady, googleClientIds } from '../src/data/firebase';

export default function LoginScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // `useIdTokenAuthRequest` en vez del flujo de código: devuelve directamente el
  // ID token de Google, que es lo único que necesita el intercambio con Firebase.
  // El flujo de código exigiría un secreto de cliente, y un secreto dentro de una
  // app móvil no es un secreto — se extrae del binario.
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    clientId: googleClientIds.web ?? '',
    iosClientId: googleClientIds.ios,
    androidClientId: googleClientIds.android,
  });

  useEffect(() => {
    if (response === null) return;

    if (response.type === 'dismiss' || response.type === 'cancel') {
      // Cancelar no es un error y no merece un mensaje en rojo.
      setWorking(false);
      return;
    }
    if (response.type !== 'success') {
      setWorking(false);
      setError('No se pudo completar el acceso con Google.');
      return;
    }

    const idToken = response.params.id_token;
    if (typeof idToken !== 'string') {
      setWorking(false);
      setError('Google no devolvió un token válido.');
      return;
    }

    let cancelled = false;
    void completeGoogleSignIn(idToken).then((outcome) => {
      if (cancelled) return;
      setWorking(false);

      if (outcome.kind === 'error') {
        setError(outcome.message);
        return;
      }
      // Cuando queda vinculado, el layout raíz enruta solo al ver la sesión.
      // Aquí solo hace falta mandar a la pantalla del código.
      if (outcome.kind === 'needs_link') router.replace('/link');
    });

    return () => {
      cancelled = true;
    };
  }, [response, router]);

  const configured = googleAuthReady();

  return (
    <Screen scroll>
      <Stack gap={26} style={{ flex: 1, justifyContent: 'center', paddingVertical: 40 }}>
        <Stack gap={14} style={{ alignItems: 'center' }}>
          <Logo size={56} />
          <Text variant="hero" align="center">
            SINCHI
          </Text>
          <Text variant="body" color={theme.colors.textSecondary} align="center">
            Tus membresías de todos tus gimnasios, en una sola app.
          </Text>
        </Stack>

        {error !== null && (
          <Card accent={theme.semaphore.bad} borderColor={withAlpha(theme.semaphore.bad, 0.28)}>
            <Text variant="bodySmall">{error}</Text>
          </Card>
        )}

        {configured ? (
          <Button
            label={working ? 'Entrando…' : 'Entrar con Google'}
            disabled={request === null || working}
            onPress={() => {
              setError(null);
              setWorking(true);
              void promptAsync();
            }}
          />
        ) : (
          // Mejor decirlo que mostrar un botón que abre el navegador y falla con
          // un error de Google que nadie va a entender.
          <Card accent={theme.semaphore.warn} borderColor={withAlpha(theme.semaphore.warn, 0.28)}>
            <Eyebrow>Falta configurar</Eyebrow>
            <Text variant="bodySmall" style={{ marginTop: 6 }}>
              El acceso con Google no está habilitado en este build: falta activar
              el proveedor en la consola de Firebase y publicar los ids de cliente
              OAuth.
            </Text>
          </Card>
        )}

        {working && <ActivityIndicator color={theme.colors.ink} />}

        <Stack gap={12} style={{ alignItems: 'center', marginTop: 6 }}>
          <Text variant="captionSmall" color={theme.colors.textFaint} align="center">
            Si es tu primera vez, al entrar te daremos un código de 6 dígitos para
            que recepción lo confirme.
          </Text>

          <View style={{ height: 1, alignSelf: 'stretch', backgroundColor: theme.colors.hairline }} />

          <Pressable onPress={() => router.push('/staff/shift')} hitSlop={14}>
            <Text variant="caption" color={theme.colors.textSecondary}>
              Soy staff — abrir turno
            </Text>
          </Pressable>

          {/* Solo en desarrollo. En un build de produccion `__DEV__` es false y
              este bloque no se renderiza. */}
          {__DEV__ && (
            <Pressable onPress={() => router.push('/dev')} hitSlop={14}>
              <Text variant="captionSmall" color={theme.semaphore.warn}>
                Probar sin Google (desarrollo)
              </Text>
            </Pressable>
          )}
        </Stack>
      </Stack>
    </Screen>
  );
}
