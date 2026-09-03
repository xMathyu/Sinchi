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
 *
 * La tarjeta de dueño, en cambio, NO es discreta. Esta pantalla es lo primero
 * que ve alguien que viene a evaluar Sinchi para su gimnasio, y hasta ahora solo
 * le hablaba al alumno («tus membresías en una sola app»): el alta de un
 * gimnasio vivía escondida al final del directorio, así que quien venía a
 * comprar no encontraba dónde. La oferta —gratis hasta diez alumnos— se dice
 * aquí, no dos pantallas más adentro.
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Google from 'expo-auth-session/providers/google';
import ChevronLeft from 'lucide-react-native/icons/chevron-left';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import { withAlpha } from '@sinchi/ui';
import { Screen } from '../src/design/screen';
import {
  Button,
  Card,
  Eyebrow,
  Field,
  Logo,
  Row,
  Stack,
  Text,
  Wordmark,
} from '../src/design/primitives';
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
  // "Entrar" o "crear cuenta": son dos vistas y no dos rutas. Los campos y los
  // handlers son los mismos, y separarlas en rutas obligaría a subir todo este
  // estado a un contexto para que sobreviviera al salto.
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

  const avisoDeError =
    error === null ? null : (
      <Card accent={theme.semaphore.bad} borderColor={withAlpha(theme.semaphore.bad, 0.28)}>
        <Text variant="bodySmall">{error}</Text>
      </Card>
    );

  const faltaFirebase = (
    <Card accent={theme.semaphore.bad} borderColor={withAlpha(theme.semaphore.bad, 0.28)}>
      <Eyebrow>Falta configurar</Eyebrow>
      <Text variant="bodySmall" style={{ marginTop: 6 }}>
        Este build no trae configuración de Firebase (ver `.env.example`).
      </Text>
    </Card>
  );

  const separador = (
    <Row align="center" gap={10}>
      <View style={{ flex: 1, height: 1, backgroundColor: theme.colors.hairline }} />
      <Text variant="captionSmall" color={theme.colors.textFaint}>
        o
      </Text>
      <View style={{ flex: 1, height: 1, backgroundColor: theme.colors.hairline }} />
    </Row>
  );

  const botonDeGoogle = (
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
  );

  if (creating) {
    return (
      <Screen scroll style={{ flexGrow: 1 }}>
        <Stack gap={0} style={{ flex: 1, paddingBottom: 8 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Volver a entrar"
            onPress={() => {
              setError(null);
              setCreating(false);
            }}
            disabled={working}
            style={{ height: 44, marginLeft: -8, paddingHorizontal: 8, justifyContent: 'center' }}
          >
            <Row gap={6} justify="flex-start">
              <ChevronLeft size={16} color={theme.colors.textSecondary} />
              <Text variant="bodySmall" color={theme.colors.textSecondary}>
                Entrar
              </Text>
            </Row>
          </Pressable>

          <Text variant="title" weight="bold" style={{ marginTop: 22 }}>
            Crea tu cuenta
          </Text>
          <Text variant="bodySmall" color={theme.colors.textSecondary} style={{ marginTop: 8 }}>
            Con la misma cuenta entras a cualquier gimnasio de la red y reservas tu
            primera clase gratis.
          </Text>

          {avisoDeError === null ? null : <View style={{ marginTop: 20 }}>{avisoDeError}</View>}

          {emailReady ? (
            <>
              <Stack gap={14} style={{ marginTop: 24 }}>
                <Field
                  label="Tu nombre"
                  value={nombre}
                  onChangeText={setNombre}
                  placeholder="Nombre y apellido"
                  autoCapitalize="words"
                  autoComplete="name"
                  editable={!working}
                />
                <Field
                  label="Correo"
                  value={email}
                  onChangeText={setEmail}
                  placeholder="tucorreo@ejemplo.com"
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  editable={!working}
                />
                <Field
                  label="Contraseña"
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Al menos 6 caracteres"
                  secureTextEntry
                  autoCapitalize="none"
                  autoComplete="new-password"
                  editable={!working}
                />
                <Field
                  label="Tu celular"
                  value={celular}
                  onChangeText={setCelular}
                  placeholder="+51987654321"
                  keyboardType="phone-pad"
                  autoComplete="tel"
                  editable={!working}
                  hint="Es con lo que el gimnasio te reconoce cuando llegas a probar."
                  returnKeyType="go"
                  onSubmitEditing={() => {
                    if (canSubmit) submitEmail();
                  }}
                />
              </Stack>

              <View style={{ marginTop: 20 }}>
                <Button
                  label={working ? 'Creando…' : 'Crear cuenta'}
                  disabled={!canSubmit}
                  onPress={submitEmail}
                />
              </View>
            </>
          ) : (
            <View style={{ marginTop: 24 }}>{faltaFirebase}</View>
          )}

          {googleReady && (
            <Stack gap={14} style={{ marginTop: 18 }}>
              {separador}
              {botonDeGoogle}
            </Stack>
          )}

          {working && <ActivityIndicator color={theme.colors.ink} style={{ marginTop: 16 }} />}

          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setError(null);
              setCreating(false);
            }}
            disabled={working}
            style={{ marginTop: 'auto', minHeight: 44, justifyContent: 'center' }}
          >
            <Text variant="caption" color={theme.colors.textSecondary} align="center">
              ¿Ya tienes cuenta? Entra
            </Text>
          </Pressable>
        </Stack>
      </Screen>
    );
  }

  return (
    <Screen scroll style={{ flexGrow: 1 }}>
      <Stack gap={0} style={{ flex: 1, paddingTop: 20, paddingBottom: 8 }}>
        <Row gap={10} justify="flex-start">
          <Logo size={34} />
          <Wordmark size={34} />
        </Row>

        <Text variant="body" color={theme.colors.textStrong} style={{ marginTop: 12 }}>
          Tu gimnasio y tus alumnos, en la misma app.
        </Text>

        <Row gap={8} justify="flex-start" style={{ marginTop: 14 }}>
          <Text variant="micro" color={theme.colors.textFaint}>
            Cobro automático
          </Text>
          <Punto />
          <Text variant="micro" color={theme.colors.textFaint}>
            Puerta con QR
          </Text>
          <Punto />
          <Text variant="micro" color={theme.colors.textFaint}>
            Padrón al día
          </Text>
        </Row>

        {avisoDeError === null ? null : <View style={{ marginTop: 20 }}>{avisoDeError}</View>}

        {emailReady ? (
          <>
            <Stack gap={14} style={{ marginTop: 26 }}>
              <Field
                label="Correo"
                value={email}
                onChangeText={setEmail}
                placeholder="tucorreo@ejemplo.com"
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                editable={!working}
              />
              <Field
                label="Contraseña"
                value={password}
                onChangeText={setPassword}
                placeholder="••••••••"
                secureTextEntry
                autoCapitalize="none"
                autoComplete="current-password"
                editable={!working}
                returnKeyType="go"
                onSubmitEditing={() => {
                  if (canSubmit) submitEmail();
                }}
              />
            </Stack>

            <View style={{ marginTop: 18 }}>
              <Button
                label={working ? 'Entrando…' : 'Entrar'}
                disabled={!canSubmit}
                onPress={submitEmail}
              />
            </View>

            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setError(null);
                setCreating(true);
              }}
              disabled={working}
              style={{ minHeight: 44, justifyContent: 'center' }}
            >
              <Text variant="caption" color={theme.colors.textSecondary} align="center">
                ¿Primera vez? Crea tu cuenta
              </Text>
            </Pressable>
          </>
        ) : (
          <View style={{ marginTop: 26 }}>{faltaFirebase}</View>
        )}

        {googleReady && (
          <Stack gap={14} style={{ marginTop: 6 }}>
            {separador}
            {botonDeGoogle}
          </Stack>
        )}

        {working && <ActivityIndicator color={theme.colors.ink} style={{ marginTop: 16 }} />}

        {/* La puerta del dueño. Va abajo pero sin bajar la pantalla, y con la
            oferta escrita: es lo que convierte esta pantalla en algo que le
            habla también a quien viene a comprar. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Registra tu gimnasio"
          onPress={() => router.push('/gym-signup')}
          style={{ marginTop: 'auto', paddingTop: 22 }}
        >
          <Card borderColor={withAlpha(theme.semaphore.ok, 0.28)} style={{ paddingVertical: 15 }}>
            <Row gap={14}>
              <Stack gap={5} style={{ flex: 1 }}>
                <Eyebrow color={theme.semaphore.ok}>Para dueños de gimnasio</Eyebrow>
                <Text variant="heading" weight="semibold">
                  Registra tu gimnasio
                </Text>
                <Text variant="caption" color={theme.colors.textSecondary}>
                  Gratis hasta 10 alumnos, y el primer mes de pago va por nuestra cuenta.
                </Text>
              </Stack>
              <ChevronRight size={18} color={theme.colors.textTertiary} />
            </Row>
          </Card>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/shift')}
          style={{ minHeight: 44, justifyContent: 'center', marginTop: 4 }}
        >
          <Text variant="caption" color={theme.colors.textSecondary} align="center">
            Soy staff — abrir turno
          </Text>
        </Pressable>

        {/* Solo en desarrollo. En un build de produccion `__DEV__` es false y
            este bloque no se renderiza. */}
        {__DEV__ && (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/dev')}
            style={{ minHeight: 44, justifyContent: 'center' }}
          >
            <Text variant="captionSmall" color={theme.semaphore.warn} align="center">
              Probar sin Google (desarrollo)
            </Text>
          </Pressable>
        )}
      </Stack>
    </Screen>
  );
}

/** Separador entre las tres promesas de la cabecera. */
function Punto() {
  const theme = useTheme();
  return (
    <View
      style={{
        width: 3,
        height: 3,
        borderRadius: 2,
        backgroundColor: theme.colors.textDisabled,
      }}
    />
  );
}
