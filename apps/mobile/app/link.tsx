/**
 * Vincular la cuenta con la ficha del padrón.
 *
 * La pantalla que resuelve el problema que Firebase no resuelve: el gimnasio creó
 * la ficha del alumno antes de que instalara la app, y Google no devuelve nada que
 * permita emparejarlas. Así que lo confirma quien tiene al alumno enfrente.
 *
 * Todo el diseño de esta pantalla es para que se pueda leer **de lejos y al
 * revés**: la recepcionista mira el teléfono del alumno desde el otro lado del
 * mostrador. De ahí los seis dígitos enormes y separados en dos grupos de tres.
 */
import { useEffect, useState } from 'react';
import { Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { withAlpha } from '@sinchi/ui';
import { Screen } from '../src/design/screen';
import { Button, Card, Eyebrow, Logo, Row, Stack, Text } from '../src/design/primitives';
import { useTheme } from '../src/design/theme';
import { useSession } from '../src/data/session-hooks';
import { signOut } from '../src/data/auth';

export default function LinkScreen() {
  const theme = useTheme();
  const router = useRouter();
  const state = useSession();
  const [secondsLeft, setSecondsLeft] = useState(0);

  const expiresAt = state.status === 'unlinked' ? state.expiresAt : 0;

  useEffect(() => {
    if (expiresAt === 0) return;
    const tick = () => setSecondsLeft(Math.max(0, Math.round((expiresAt - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  // Si la recepcionista ya confirmó, el estado pasa a `signed_in` y el layout
  // raíz enruta. Esta pantalla no tiene que hacer nada.
  if (state.status !== 'unlinked') return null;

  const grupos = [state.code.slice(0, 3), state.code.slice(3)];
  const vencido = secondsLeft <= 0;

  return (
    <Screen scroll>
      <Stack gap={26} style={{ flex: 1, justifyContent: 'center', paddingVertical: 40 }}>
        <Stack gap={12} style={{ alignItems: 'center' }}>
          <Logo size={44} />
          <Text variant="title" align="center">
            Un paso más
          </Text>
          <Text variant="body" color={theme.colors.textSecondary} align="center">
            Si tu gimnasio ya tiene tu ficha, muéstrale este código a recepción y tu
            membresía aparece en la app.
          </Text>
        </Stack>

        <Card
          accent={vencido ? theme.semaphore.alert : theme.semaphore.ok}
          borderColor={withAlpha(vencido ? theme.semaphore.alert : theme.semaphore.ok, 0.26)}
        >
          <Stack gap={16} style={{ alignItems: 'center', paddingVertical: 10 }}>
            <Eyebrow>Tu código</Eyebrow>

            <Row gap={18}>
              {grupos.map((grupo, i) => (
                // `variant="hero"` y con espacio entre grupos: se lee desde el
                // otro lado del mostrador, que es donde está quien lo escribe.
                <Text key={i} variant="hero" style={{ letterSpacing: 4 }}>
                  {grupo}
                </Text>
              ))}
            </Row>

            {vencido ? (
              <Text variant="bodySmall" color={theme.semaphore.alert} align="center">
                Este código ya venció. Vuelve a entrar para conseguir uno nuevo.
              </Text>
            ) : (
              <Text variant="caption" color={theme.colors.textSecondary}>
                Vence en {formatCountdown(secondsLeft)}
              </Text>
            )}
          </Stack>
        </Card>

        <Card tone="sunken">
          <Stack gap={8}>
            <Eyebrow>Por qué hace falta</Eyebrow>
            <Text variant="captionSmall" color={theme.colors.textSecondary}>
              Tu gimnasio ya tiene tu ficha con tu plan, tus pagos y tus sesiones.
              Que sea una persona la que confirme —y no un dato que cualquiera
              podría escribir— es lo que impide que alguien más reclame tu
              membresía.
            </Text>
          </Stack>
        </Card>

        {/* Ya no hace falta ofrecer el directorio desde aquí: esta pantalla dejó
            de ser la puerta de entrada. Quien acaba de crear su cuenta aterriza
            en los gimnasios, y llega a este código solo si lo busca — que es lo
            que pasa cuando recepción se lo pide. */}
        <Button
          label="Volver a los gimnasios"
          variant="secondary"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/explore'))}
        />

        <Pressable
          onPress={() => {
            void signOut({ forgetTotpSecret: true }).then(() => router.replace('/login'));
          }}
          hitSlop={14}
          style={{ alignSelf: 'center' }}
        >
          <Text variant="caption" color={theme.colors.textSecondary}>
            Entrar con otra cuenta
          </Text>
        </Pressable>
      </Stack>
    </Screen>
  );
}

function formatCountdown(seconds: number): string {
  const minutos = Math.floor(seconds / 60);
  const resto = seconds % 60;
  if (minutos === 0) return `${resto} s`;
  return `${minutos}:${String(resto).padStart(2, '0')}`;
}
