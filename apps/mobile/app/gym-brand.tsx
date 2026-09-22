/**
 * Logo y redes.
 *
 * El alta lo ofrece todo, pero opcional y en medio de otros seis campos: muchos
 * lo van a saltar ese día y lo van a querer poner después, cuando el diseñador
 * les mande el archivo o cuando abran su página. Esta pantalla es ese después, y
 * la única puerta para los gimnasios que se dieron de alta antes de que
 * existiera.
 *
 * Dos formas de guardar, a propósito y cada una con su motivo:
 *
 *  · el LOGO se sube al elegirlo, sin botón: es un solo dato, y un «Guardar»
 *    aparte deja al dueño creyendo que ya lo cambió cuando cierra la hoja;
 *  · la WEB Y LAS REDES llevan «Guardar»: son cuatro campos de texto, y guardar
 *    con cada letra mandaría a la api direcciones a medio escribir.
 */
import { useEffect, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { withAlpha } from '@sinchi/ui';
import { Button, Card, Eyebrow, Row, Stack, Text } from '../src/design/primitives';
import { Screen } from '../src/design/screen';
import { useTheme } from '../src/design/theme';
import { GymLogo, GymLogoField } from '../src/design/gym-logo';
import {
  draftFromLinks,
  EMPTY_LINKS_DRAFT,
  GymLinksFields,
  linksDraftDenial,
  type GymLinksDraft,
} from '../src/design/gym-links';
import { useGymLinks, useGymLogo, useMyGyms, useStore } from '../src/data/hooks';
import { useRole } from '../src/data/session-hooks';
import { removeGymLogo, saveGymLinks, saveGymLogo } from '../src/data/actions';
import { pickGymLogo } from '../src/data/gym-logo-file';

export default function GymBrandScreen() {
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

  // -- La web y las redes ----------------------------------------------------

  const { links, error: linksLoadError } = useGymLinks();
  const [draft, setDraft] = useState<GymLinksDraft>(EMPTY_LINKS_DRAFT);
  const [savedDraft, setSavedDraft] = useState<GymLinksDraft>(EMPTY_LINKS_DRAFT);
  const [savingLinks, setSavingLinks] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [linksNotice, setLinksNotice] = useState<string | null>(null);

  // Lo guardado llena los campos una vez, al llegar. Después manda lo que
  // teclea: volver a pisarlo con cada recarga le borraría lo que está escribiendo.
  useEffect(() => {
    if (links === null) return;
    const fromServer = draftFromLinks(links);
    setDraft(fromServer);
    setSavedDraft(fromServer);
  }, [links]);

  const linksDenial = linksDraftDenial(draft);
  const linksChanged = JSON.stringify(draft) !== JSON.stringify(savedDraft);

  async function saveLinks(): Promise<void> {
    setLinksNotice(null);
    setError(null);
    setSavingLinks(true);
    try {
      const saved = draftFromLinks(await saveGymLinks(draft));
      // Se vuelve a pintar lo que guardó la api, que es la forma normalizada:
      // quien pegó el enlace entero de Instagram ve ahora su @usuario, que es la
      // prueba de que se entendió.
      setDraft(saved);
      setSavedDraft(saved);
      setAttempted(false);
      setLinksNotice('Guardado. Ya se ve en tu ficha del directorio.');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'No se pudieron guardar tus redes.');
    } finally {
      setSavingLinks(false);
    }
  }

  const shownError = error ?? loadError ?? linksLoadError;

  return (
    <Screen scroll>
      <Row style={{ paddingTop: 8 }}>
        <Text variant="titleSmall" weight="bold">
          Logo y redes
        </Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={16}>
          <Text variant="body" color={theme.colors.textSecondary}>
            Cerrar
          </Text>
        </Pressable>
      </Row>

      <Text variant="bodySmall" color={theme.colors.textSecondary} style={{ marginTop: 10 }}>
        Lo que ve quien te encuentra en el directorio, y tus alumnos en su billetera. Todo es
        opcional: sin logo se muestran tus iniciales.
      </Text>

      <Stack gap={10} style={{ marginTop: 22 }}>
        <Eyebrow>Tu logo</Eyebrow>
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

      <Stack gap={10} style={{ marginTop: 26 }}>
        <Eyebrow>Tu web y tus redes</Eyebrow>
        <Card radius={theme.radii.xl}>
          <GymLinksFields
            values={draft}
            onChange={(next) => {
              setDraft(next);
              setLinksNotice(null);
            }}
            editable={isOwner && !savingLinks}
            showAll={attempted}
          />
        </Card>
        {isOwner ? null : (
          <Text variant="captionSmall" color={theme.colors.textSecondary}>
            Solo el dueño puede cambiarlas.
          </Text>
        )}
      </Stack>

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

      {isOwner ? (
        <Stack gap={10} style={{ marginTop: 22 }}>
          {/* Apagado sin cambios: un «Guardar» vivo que no guarda nada nuevo
              hace dudar de si lo anterior quedó guardado. */}
          <Button
            label={savingLinks ? 'Guardando…' : 'Guardar web y redes'}
            disabled={!linksChanged || linksDenial !== null || savingLinks}
            onPress={() => void saveLinks()}
            onBlockedPress={
              savingLinks || !linksChanged ? undefined : () => setAttempted(true)
            }
          />
          {attempted && linksDenial !== null ? (
            <Text variant="caption" color={theme.semaphore.bad} align="center">
              {linksDenial}
            </Text>
          ) : linksNotice !== null ? (
            <Text variant="caption" color={theme.semaphore.ok} align="center">
              {linksNotice}
            </Text>
          ) : null}
        </Stack>
      ) : null}

      <View style={{ height: 32 }} />
    </Screen>
  );
}
