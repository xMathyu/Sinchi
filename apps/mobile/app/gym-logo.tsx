/**
 * Tu logo.
 *
 * El alta lo ofrece, pero opcional y en medio de otros seis campos: muchos lo
 * van a saltar ese día y lo van a querer poner después, cuando el diseñador les
 * mande el archivo. Esta pantalla es ese después, y la única puerta para los
 * gimnasios que se dieron de alta antes de que existiera.
 *
 * Se sube al elegir, sin botón de guardar: es un solo dato, y un «Guardar»
 * aparte deja al dueño creyendo que ya lo cambió cuando cierra la hoja.
 */
import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { withAlpha } from '@sinchi/ui';
import { Card, Eyebrow, Row, Stack, Text } from '../src/design/primitives';
import { Screen } from '../src/design/screen';
import { useTheme } from '../src/design/theme';
import { GymLogo, GymLogoField } from '../src/design/gym-logo';
import { useGymLogo, useMyGyms, useStore } from '../src/data/hooks';
import { useRole } from '../src/data/session-hooks';
import { removeGymLogo, saveGymLogo } from '../src/data/actions';
import { pickGymLogo } from '../src/data/gym-logo-file';

export default function GymLogoScreen() {
  const theme = useTheme();
  // De la sesión y no del store: esta pantalla se abre sola desde un enlace.
  const isOwner = useRole() === 'owner';
  const { logoId, error: loadError, reload } = useGymLogo();

  // El nombre, para las iniciales. El padrón lo trae en cada ficha, pero un
  // gimnasio recién dado de alta no tiene fichas: ahí sale de sus puestos.
  const tenantId = useStore((state) => state.staff.tenantId);
  const fromRoster = useStore((state) => state.tenants.find((t) => t.id === tenantId)?.name);
  const fromPosts = useMyGyms().find((post) => post.tenantId === tenantId)?.tenantName;
  const name = fromRoster ?? fromPosts ?? '';

  const [busy, setBusy] = useState<'uploading' | 'removing' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pick(): Promise<void> {
    setError(null);
    try {
      const picked = await pickGymLogo();
      if (picked === null) return;
      setBusy('uploading');
      await saveGymLogo(picked);
      reload();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'No se pudo subir el logo.');
    } finally {
      setBusy(null);
    }
  }

  function remove(): void {
    Alert.alert(
      '¿Quitar el logo?',
      'Tu gimnasio vuelve a mostrarse con sus iniciales. Puedes poner otro cuando quieras.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Quitar',
          style: 'destructive',
          onPress: () => {
            setError(null);
            setBusy('removing');
            void removeGymLogo()
              .then(reload)
              .catch((e: unknown) =>
                setError(e instanceof Error ? e.message : 'No se pudo quitar el logo.'),
              )
              .finally(() => setBusy(null));
          },
        },
      ],
    );
  }

  const shownError = error ?? loadError;

  return (
    <Screen scroll>
      <Row style={{ paddingTop: 8 }}>
        <Text variant="titleSmall" weight="bold">
          Tu logo
        </Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={16}>
          <Text variant="body" color={theme.colors.textSecondary}>
            Cerrar
          </Text>
        </Pressable>
      </Row>

      <Text variant="bodySmall" color={theme.colors.textSecondary} style={{ marginTop: 10 }}>
        Sale en tu ficha del directorio, en la billetera de tus alumnos y en la puerta. Es
        opcional: sin logo se muestran tus iniciales.
      </Text>

      <Stack gap={10} style={{ marginTop: 22 }}>
        <Eyebrow>Así se ve</Eyebrow>
        <Card radius={theme.radii.xl}>
          {logoId === undefined && loadError === null ? (
            <View style={{ height: 72 }} />
          ) : isOwner ? (
            <GymLogoField
              name={name}
              logoId={logoId ?? null}
              busy={busy !== null}
              busyLabel={busy === 'removing' ? 'Quitando…' : 'Subiendo…'}
              onPick={() => void pick()}
              onRemove={remove}
              hint={
                logoId == null
                  ? 'Un PNG o una foto. Si tiene forma alargada, se ve entero.'
                  : 'Al cambiarlo, tus alumnos ven el nuevo la próxima vez que abran la app.'
              }
            />
          ) : (
            <Row gap={14} justify="flex-start">
              <GymLogo name={name} logoId={logoId ?? null} size={72} />
              <Text variant="captionSmall" color={theme.colors.textSecondary} style={{ flex: 1 }}>
                Solo el dueño puede cambiarlo.
              </Text>
            </Row>
          )}
        </Card>
      </Stack>

      {/* Lo que se descubre DESPUÉS de subirlo si no se dice antes: la baldosa
          es blanca en los dos temas, y un logo blanco con fondo transparente
          desaparece en ella. */}
      {isOwner ? (
        <Text variant="micro" color={theme.colors.textFaint} style={{ marginTop: 10 }}>
          Se muestra sobre blanco. Si tu logo es blanco con fondo transparente, elige la versión
          con fondo de color.
        </Text>
      ) : null}

      {shownError === null ? null : (
        <Card
          tone="sunken"
          borderColor={withAlpha(theme.semaphore.bad, 0.4)}
          style={{ marginTop: 18 }}
        >
          <Text variant="bodySmall" color={theme.semaphore.bad}>
            {shownError}
          </Text>
        </Card>
      )}

      <View style={{ height: 32 }} />
    </Screen>
  );
}
