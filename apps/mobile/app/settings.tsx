/**
 * Ajustes.
 *
 * No está en el diseño, pero hacen falta dos interruptores reales:
 *
 *  - la paleta segura para daltonismo. En este producto el color ES la
 *    información: un recepcionista que no distingue verde de rojo no puede
 *    operar la puerta. El diseño la trae como propiedad del lienzo; en la app
 *    tiene que ser una preferencia de la persona;
 *  - el cambio de rol. El mismo binario sirve al alumno, a recepción y al dueño
 *    (MD 4.6). En producción el rol viene de la sesión; hasta que exista la api,
 *    este es el único camino para recorrer el modo staff.
 */
import { Pressable, Switch, View } from 'react-native';
import { router } from 'expo-router';
import type { AppRole } from '@sinchi/shared';
import { SEMAPHORE_COLORBLIND_SAFE, SEMAPHORE_DEFAULT } from '@sinchi/ui';
import { Card, Divider, Dot, Eyebrow, Logo, Row, Stack, Text } from '../src/design/primitives';
import { Screen } from '../src/design/screen';
import { useTheme, useThemeContext } from '../src/design/theme';
import { useStore } from '../src/data/hooks';
import { signOut } from '../src/data/auth';
import { useSession } from '../src/data/session-hooks';
import { resetState, setRole } from '../src/data/store';

const ROLES: readonly { readonly value: AppRole; readonly label: string; readonly hint: string }[] =
  [
    { value: 'student', label: 'Alumno', hint: 'Su plan, su QR, su historial' },
    { value: 'front_desk', label: 'Recepción', hint: 'Escanear, marcar manual, cobrar' },
    { value: 'owner', label: 'Dueño', hint: 'Todo lo anterior más reportes' },
  ];

export default function SettingsScreen() {
  const theme = useTheme();
  const { colorBlindSafe, setColorBlindSafe } = useThemeContext();
  const role = useStore((state) => state.role);
  const user = useStore((state) => state.user);
  const session = useSession();

  return (
    <Screen scroll>
      <Row style={{ paddingTop: 8 }}>
        <Text variant="titleSmall" weight="bold">
          Ajustes
        </Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()}>
          <Text variant="body" color={theme.colors.textSecondary}>
            Cerrar
          </Text>
        </Pressable>
      </Row>

      <Card radius={theme.radii.xl} style={{ marginTop: 16 }}>
        <Row gap={12} justify="flex-start">
          <Logo size={28} />
          <Stack gap={1} style={{ flex: 1 }}>
            <Text variant="heading" weight="semibold">
              {user.name}
            </Text>
            <Text variant="captionSmall" color={theme.colors.textSecondary}>
              {user.phone} · identidad Sinchi
            </Text>
          </Stack>
        </Row>
      </Card>

      <Stack gap={10} style={{ marginTop: 20 }}>
        <Eyebrow>Accesibilidad</Eyebrow>
        <Card radius={theme.radii.xl}>
          <Stack gap={14}>
            <Row>
              <Stack gap={2} style={{ flex: 1, paddingRight: 12 }}>
                <Text variant="bodySmall" weight="semibold">
                  Paleta para daltonismo
                </Text>
                <Text variant="captionSmall" color={theme.colors.textSecondary}>
                  Cambia el verde/rojo del semáforo por azul/magenta, que se distinguen con
                  deficiencia al rojo-verde.
                </Text>
              </Stack>
              <Switch
                value={colorBlindSafe}
                onValueChange={setColorBlindSafe}
                accessibilityLabel="Usar paleta segura para daltonismo"
                trackColor={{ true: theme.semaphore.ok, false: theme.colors.surfaceHigh }}
                thumbColor={theme.colors.ink}
              />
            </Row>
            <Divider />
            <Row justify="flex-start" gap={18}>
              <PaletteSample
                label="Estándar"
                colors={[
                  SEMAPHORE_DEFAULT.ok,
                  SEMAPHORE_DEFAULT.warn,
                  SEMAPHORE_DEFAULT.alert,
                  SEMAPHORE_DEFAULT.bad,
                ]}
                active={!colorBlindSafe}
              />
              <PaletteSample
                label="Daltonismo"
                colors={[
                  SEMAPHORE_COLORBLIND_SAFE.ok,
                  SEMAPHORE_COLORBLIND_SAFE.warn,
                  SEMAPHORE_COLORBLIND_SAFE.alert,
                  SEMAPHORE_COLORBLIND_SAFE.bad,
                ]}
                active={colorBlindSafe}
              />
            </Row>
            <Text variant="micro" color={theme.colors.textFaint}>
              El motivo del rechazo siempre va escrito, con paleta o sin ella. El color acelera la
              lectura, no la sustituye.
            </Text>
          </Stack>
        </Card>
      </Stack>

      <Stack gap={10} style={{ marginTop: 20 }}>
        <Eyebrow>Rol de la sesión</Eyebrow>
        {ROLES.map((option) => (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: role === option.value }}
            onPress={() => {
              setRole(option.value);
              router.replace(option.value === 'student' ? '/student' : '/staff');
            }}
          >
            <Card
              radius={theme.radii.lg}
              borderColor={role === option.value ? theme.semaphore.ok : theme.colors.hairline}
            >
              <Row>
                <Stack gap={1} style={{ flex: 1 }}>
                  <Text variant="heading" weight="semibold">
                    {option.label}
                  </Text>
                  <Text variant="captionSmall" color={theme.colors.textSecondary}>
                    {option.hint}
                  </Text>
                </Stack>
                {role === option.value ? <Dot color={theme.semaphore.ok} size={10} /> : null}
              </Row>
            </Card>
          </Pressable>
        ))}
        <Text variant="micro" color={theme.colors.textFaint}>
          En producción el rol lo define la sesión, no la persona. Este selector existe mientras no
          hay api.
        </Text>
      </Stack>

        {/* La sesion de demostracion no tenia salida: se entraba desde la
            puerta de desarrollo y no habia forma de volver. Los datos falsos
            —Mathyu Quispe y sus tres gimnasios— se veian como si vinieran del
            servidor, que es exactamente la confusion que provocaba. */}
        {session.status === 'demo' && (
          <Stack gap={10} style={{ marginTop: 24 }}>
            <Eyebrow color={theme.semaphore.warn}>Estás en modo demostración</Eyebrow>
            <Text variant="captionSmall" color={theme.colors.textSecondary}>
              Los datos que ves son inventados y viven dentro de la app. Sal para
              entrar con tu cuenta real.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                void signOut({ forgetTotpSecret: false }).then(() => {
                  resetState();
                  router.replace('/login');
                });
              }}
            >
              <Card radius={theme.radii.lg} borderColor={theme.semaphore.warn}>
                <Text variant="bodySmall" weight="semibold" color={theme.semaphore.warn}>
                  Salir del modo demostración
                </Text>
              </Card>
            </Pressable>
          </Stack>
        )}

        {session.status === 'signed_in' && (
          <Stack gap={10} style={{ marginTop: 24 }}>
            <Eyebrow>Sesión</Eyebrow>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                // Se olvida el secreto del QR: si presta el telefono, el
                // siguiente no debe poder generar su codigo.
                void signOut({ forgetTotpSecret: true }).then(() => {
                  resetState();
                  router.replace('/login');
                });
              }}
            >
              <Card radius={theme.radii.lg}>
                <Text variant="bodySmall" weight="semibold" color={theme.semaphore.bad}>
                  Cerrar sesión
                </Text>
              </Card>
            </Pressable>
          </Stack>
        )}

      <Stack gap={10} style={{ marginTop: 24 }}>
        <Eyebrow>Datos de demostración</Eyebrow>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            resetState();
            router.replace('/');
          }}
        >
          <Card radius={theme.radii.lg}>
            <Text variant="bodySmall" weight="semibold" color={theme.semaphore.bad}>
              Reiniciar datos
            </Text>
          </Card>
        </Pressable>
      </Stack>
    </Screen>
  );
}

function PaletteSample({
  label,
  colors,
  active,
}: {
  readonly label: string;
  readonly colors: readonly string[];
  readonly active: boolean;
}) {
  const theme = useTheme();
  return (
    <Stack gap={6}>
      <Row gap={5} justify="flex-start">
        {colors.map((color) => (
          <View
            key={color}
            style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: color }}
          />
        ))}
      </Row>
      <Text
        variant="captionSmall"
        weight={active ? 'semibold' : 'regular'}
        color={active ? theme.colors.ink : theme.colors.textTertiary}
      >
        {label}
      </Text>
    </Stack>
  );
}
