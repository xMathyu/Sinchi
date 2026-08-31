/**
 * Entrar.
 *
 * Una sola pantalla para los tres roles. El alumno entra con correo o con Google;
 * el staff abre turno en el equipo del mostrador. La app no pregunta "¿eres
 * alumno o staff?" — el rol lo decide la api al mirar si esa persona tiene fila
 * en `staff`, no una elección del usuario.
 *
 * Los dos caminos del alumno terminan en el mismo sitio: un ID token de Firebase
 * que la api cambia por una sesión de Sinchi. El correo va primero porque es el
 * que siempre funciona — Google depende de un cliente OAuth que solo se crea
 * desde la consola de Firebase.
 *
 * El acceso del staff va abajo y discreto a propósito: en un dojo de 60 alumnos
 * hay 60 personas que entran con Google y una que abre turno.
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Google from 'expo-auth-session/providers/google';
import { withAlpha } from '@sinchi/ui';
import { Screen } from '../src/design/screen';
import { Button, Card, Eyebrow, Logo, Row, Stack, Text } from '../src/design/primitives';
import { useTheme } from '../src/design/theme';
import { completeEmailSignIn, completeGoogleSignIn } from '../src/data/auth';
import { firebaseConfigured, googleAuthReady, googleClientIds } from '../src/data/firebase';

export default function LoginScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Solo al crear la cuenta. Es la ÚNICA vez que se piden: de aquí salen el
  // nombre y el celular con los que se reserva una clase gratis, y por eso esa
  // pantalla ya no vuelve a preguntarlos.
  const [nombre, setNombre] = useState('');
  const [celular, setCelular] = useState('+51');
  // "Entrar" o "crear cuenta": el mismo formulario, porque los campos son los
  // mismos y separarlos en dos pantallas solo añade un paso.
  const [creating, setCreating] = useState(false);

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
    void completeGoogleSignIn(idToken, { phone: celular.trim() }).then((outcome) => {
      if (cancelled) return;
      setWorking(false);

      if (outcome.kind === 'error') {
        setError(outcome.message);
        return;
      }
      // Cuando queda vinculado, el layout raíz enruta solo al ver la sesión.
      // Sin ficha en ningún padrón, al directorio: es lo único que esa persona
      // puede hacer hoy, y su código sigue a un toque desde ahí.
      if (outcome.kind === 'needs_link') router.replace('/explore');
    });

    return () => {
      cancelled = true;
    };
  }, [response, router]);

  const submitEmail = (): void => {
    setError(null);
    setWorking(true);
    void completeEmailSignIn(
      email,
      password,
      creating ? 'signUp' : 'signIn',
      creating ? { fullName: nombre.trim(), phone: celular.trim() } : {},
    ).then((outcome) => {
      setWorking(false);
      if (outcome.kind === 'error') {
        setError(outcome.message);
        return;
      }
      if (outcome.kind === 'needs_link') router.replace('/explore');
      // Si quedo dentro, el layout raiz enruta solo al ver la sesion.
    });
  };

  const googleReady = googleAuthReady();
  const emailReady = firebaseConfigured();
  // Seis es el minimo que exige Firebase; comprobarlo aqui evita un viaje de red
  // para que el servidor conteste lo mismo.
  const datosCompletos = nombre.trim().length >= 2 && celular.trim().length >= 8;
  const canSubmit =
    email.trim().length > 3 && password.length >= 6 && (!creating || datosCompletos) && !working;

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

        {emailReady ? (
          <Stack gap={14}>
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
                placeholderTextColor={theme.colors.textPlaceholder}
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
                autoComplete={creating ? 'new-password' : 'current-password'}
                editable={!working}
                placeholder={creating ? 'Al menos 6 caracteres' : '••••••••'}
                placeholderTextColor={theme.colors.textPlaceholder}
                onSubmitEditing={() => {
                  if (canSubmit) submitEmail();
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

            {/* Al crear la cuenta, y solo entonces. Preguntarlos aquí es lo que
                permite que reservar una clase gratis no vuelva a pedirlos: la
                queja legítima era «si ya me registré, ¿por qué me lo preguntas
                otra vez?». */}
            {creating ? (
              <>
                <Stack gap={4}>
                  <Text variant="captionSmall" color={theme.colors.textTertiary}>
                    Tu nombre
                  </Text>
                  <TextInput
                    value={nombre}
                    onChangeText={setNombre}
                    autoCapitalize="words"
                    autoComplete="name"
                    editable={!working}
                    placeholder="Nombre y apellido"
                    placeholderTextColor={theme.colors.textPlaceholder}
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
                    Tu celular
                  </Text>
                  <TextInput
                    value={celular}
                    onChangeText={setCelular}
                    keyboardType="phone-pad"
                    autoComplete="tel"
                    editable={!working}
                    placeholder="+51987654321"
                    placeholderTextColor={theme.colors.textPlaceholder}
                    style={{
                      color: theme.colors.ink,
                      fontSize: 16,
                      paddingVertical: 10,
                      borderBottomWidth: 1,
                      borderBottomColor: theme.colors.hairline,
                    }}
                  />
                  <Text variant="micro" color={theme.colors.textFaint}>
                    Es con lo que el gimnasio te reconoce cuando llegas a probar.
                  </Text>
                </Stack>
              </>
            ) : null}

            <Button
              label={
                working ? (creating ? 'Creando…' : 'Entrando…') : creating ? 'Crear cuenta' : 'Entrar'
              }
              disabled={!canSubmit}
              onPress={submitEmail}
            />

            <Pressable
              onPress={() => {
                setError(null);
                setCreating((previous) => !previous);
              }}
              hitSlop={12}
              disabled={working}
            >
              <Text variant="caption" color={theme.colors.textSecondary} align="center">
                {creating ? '¿Ya tienes cuenta? Entra' : '¿Primera vez? Crea tu cuenta'}
              </Text>
            </Pressable>
          </Stack>
        ) : (
          <Card accent={theme.semaphore.bad} borderColor={withAlpha(theme.semaphore.bad, 0.28)}>
            <Eyebrow>Falta configurar</Eyebrow>
            <Text variant="bodySmall" style={{ marginTop: 6 }}>
              Este build no trae configuración de Firebase (ver `.env.example`).
            </Text>
          </Card>
        )}

        {googleReady && (
          <Stack gap={12}>
            <Row align="center" gap={10}>
              <View style={{ flex: 1, height: 1, backgroundColor: theme.colors.hairline }} />
              <Text variant="captionSmall" color={theme.colors.textFaint}>
                o
              </Text>
              <View style={{ flex: 1, height: 1, backgroundColor: theme.colors.hairline }} />
            </Row>
            <Button
              label="Entrar con Google"
              variant="secondary"
              disabled={request === null || working}
              onPress={() => {
                setError(null);
                setWorking(true);
                void promptAsync();
              }}
            />
          </Stack>
        )}

        {working && <ActivityIndicator color={theme.colors.ink} />}

        <Stack gap={12} style={{ alignItems: 'center', marginTop: 6 }}>
          {/* Antes esto prometía el código de 6 dígitos, que era lo primero que
              veía quien entraba. Ya no: quien no entrena en ningún sitio aterriza
              en el directorio, y el código está a un toque para cuando el
              mostrador lo pida. */}
          <Text variant="captionSmall" color={theme.colors.textFaint} align="center">
            ¿Primera vez? Al entrar verás los gimnasios de la red y podrás reservar
            tu primera clase.
          </Text>

          <View style={{ height: 1, alignSelf: 'stretch', backgroundColor: theme.colors.hairline }} />

          <Pressable onPress={() => router.push('/shift')} hitSlop={14}>
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
