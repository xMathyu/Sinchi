/**
 * Entrar.
 *
 * Una sola pantalla para los tres roles, y con UNA sola forma de entrar: correo
 * o Google. La app no pregunta "¿eres alumno o staff?" — el rol lo decide la api
 * al mirar si esa persona tiene fila en `staff`, no una elección del usuario.
 *
 * Hubo un acceso aparte para el mostrador, «Soy staff — abrir turno», que pedía
 * el token de una tablet compartida más un PIN. Se retiró con el turno: en los
 * gimnasios de esta red el profesor ES la recepción y entra con su propia
 * cuenta, así que la puerta extra solo añadía una pregunta que nadie necesitaba
 * responder.
 *
 * Los dos caminos del alumno terminan en el mismo sitio: un ID token de Firebase
 * que la api cambia por una sesión de Sinchi. El correo va primero porque es el
 * que siempre funciona — Google depende de un cliente OAuth que solo se crea
 * desde la consola de Firebase.
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
import { checkPhoneNumber, phoneDenialMessage } from '@sinchi/shared';
import { withAlpha } from '@sinchi/ui';
import { Screen } from '../src/design/screen';
import { PhoneField } from '../src/design/phone-field';
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
import { GoogleMark } from '../src/design/google-mark';
import { useTheme } from '../src/design/theme';
import { completeEmailSignIn, completeGoogleSignIn } from '../src/data/auth';
import { firebaseConfigured, googleAuthReady, googleClientIds } from '../src/data/firebase';

/** Los campos del formulario de correo, para marcarlos de uno en uno. */
type LoginField = 'name' | 'email' | 'password' | 'phone';

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
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
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
    void completeGoogleSignIn(idToken, { phone }).then((outcome) => {
      if (cancelled) return;
      setWorking(false);

      if (outcome.kind === 'error') {
        setError(outcome.message);
        return;
      }
      // Cuando queda vinculado, el layout raíz enruta solo al ver la sesión.
      // Sin ficha en ningún padrón, a su billetera: vacía todavía, y con su QR
      // para que la inscriban.
      if (outcome.kind === 'needs_link') router.replace('/student');
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
      creating ? { fullName: name.trim(), phone } : {},
    ).then((outcome) => {
      setWorking(false);
      if (outcome.kind === 'error') {
        setError(outcome.message);
        return;
      }
      if (outcome.kind === 'needs_link') router.replace('/student');
      // Si quedo dentro, el layout raiz enruta solo al ver la sesion.
    });
  };

  const googleReady = googleAuthReady();
  const emailReady = firebaseConfigured();
  // Seis es el minimo que exige Firebase; comprobarlo aqui evita un viaje de red
  // para que el servidor conteste lo mismo.
  const phoneDenial = checkPhoneNumber(phone);
  const completeDetails = name.trim().length >= 2 && phoneDenial === null;
  const canSubmit =
    email.trim().length > 3 && password.length >= 6 && (!creating || completeDetails) && !working;

  /**
   * Que le falta a cada campo, por su nombre.
   *
   * Sin esto el boton se apagaba y no decia nada: quien escribe una contrasena
   * de cinco caracteres ve el mismo boton gris que quien no escribio nada, y la
   * unica salida es ir tocando campos a ver cual lo despierta.
   */
  const problems: Readonly<Partial<Record<LoginField, string>>> = {
    ...(creating && name.trim().length < 2 ? { name: 'Escribe tu nombre.' } : {}),
    ...(email.trim().length === 0
      ? { email: 'Falta tu correo.' }
      : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
        ? { email: 'Ese correo no tiene forma de correo. Revisa la arroba y el punto.' }
        : {}),
    ...(password.length === 0
      ? { password: 'Falta la contraseña.' }
      : password.length < 6
        ? { password: 'La contraseña va de 6 caracteres para arriba.' }
        : {}),
    ...(creating && phoneDenial !== null
      ? { phone: phoneDenial === 'missing' ? 'Falta tu celular.' : phoneDenialMessage(phoneDenial) }
      : {}),
  };

  // Los rojos NO salen mientras escribe: marcar un campo vacio que todavia no ha
  // tocado es reganarle por ir en orden. Salen al tocar el boton apagado, que es
  // justo cuando necesita saber por que no pasa nada.
  const [attempted, setAttempted] = useState(false);
  const denial = (field: LoginField): string | undefined =>
    attempted ? problems[field] : undefined;

  const errorNotice =
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

  const googleButton = (
    <Button
      label="Entrar con Google"
      icon={<GoogleMark />}
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

          {errorNotice === null ? null : <View style={{ marginTop: 20 }}>{errorNotice}</View>}

          {emailReady ? (
            <>
              <Stack gap={14} style={{ marginTop: 24 }}>
                <Field
                  label="Tu nombre"
                  value={name}
                  onChangeText={setName}
                  placeholder="Nombre y apellido"
                  autoCapitalize="words"
                  autoComplete="name"
                  editable={!working}
                  error={denial('name')}
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
                  error={denial('email')}
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
                  error={denial('password')}
                />
                <PhoneField
                  label="Tu celular"
                  value={phone}
                  onChange={setPhone}
                  editable={!working}
                  hint="Es con lo que el gimnasio te reconoce cuando llegas a probar."
                  error={denial('phone')}
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
                  onBlockedPress={working ? undefined : () => setAttempted(true)}
                />
              </View>
            </>
          ) : (
            <View style={{ marginTop: 24 }}>{faltaFirebase}</View>
          )}

          {googleReady && (
            <Stack gap={14} style={{ marginTop: 18 }}>
              {separador}
              {googleButton}
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
          <MapPoint />
          <Text variant="micro" color={theme.colors.textFaint}>
            Puerta con QR
          </Text>
          <MapPoint />
          <Text variant="micro" color={theme.colors.textFaint}>
            Padrón al día
          </Text>
        </Row>

        {errorNotice === null ? null : <View style={{ marginTop: 20 }}>{errorNotice}</View>}

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
            {googleButton}
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
function MapPoint() {
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
