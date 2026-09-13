/**
 * Dónde queda el gimnasio.
 *
 * El directorio listaba dojos con su precio, su horario y sus disciplinas y
 * callaba lo primero que pregunta quien busca dónde entrenar. Los locales nuevos
 * la escriben en el alta; esta pantalla es donde se corrige, y la única puerta
 * para los que se dieron de alta antes de que se pidiera.
 *
 * DOS DATOS Y NO UNO, y el segundo es opcional a propósito:
 *
 *   · la DIRECCIÓN es lo que se lee, y basta. Con ella sola, «cómo llegar» abre
 *     el mapa buscándola, que es lo que haría cualquiera a mano;
 *   · el PIN es lo que no falla. No se deriva de la dirección —geocodificar un
 *     texto escrito a mano acierta casi siempre y falla justo donde importa: la
 *     cuadra sin número, el pasaje que el mapa no conoce— y un pin equivocado no
 *     es un dato peor, es una persona parada frente a otra puerta a las siete de
 *     la tarde.
 *
 * Por eso el pin lo pone el dueño, y la forma más corta de hacerlo bien es
 * estando dentro del local: «Estoy en el gimnasio» toma el GPS del teléfono y
 * termina. Quien lo escribe desde su casa mueve el mapa a mano, que es más
 * trabajo pero también es su decisión.
 */
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { Button, Card, Eyebrow, Field, Row, Stack, Text } from '../src/design/primitives';
import { Screen } from '../src/design/screen';
import { useTheme } from '../src/design/theme';
import { useGymLocation } from '../src/data/hooks';
import { useRole } from '../src/data/session-hooks';
import { saveGymLocation } from '../src/data/actions';
import { GpsButton, MapPicker } from '../src/design/map-picker';

/** Lo mínimo que se acepta. «Lima» son cuatro letras y no lleva a una puerta. */
const ADDRESS_MIN = 10;

export default function LocalScreen() {
  const theme = useTheme();
  // De la sesión y no del store: esta pantalla se abre sola desde un enlace.
  const isOwner = useRole() === 'owner';
  const { location, reload } = useGymLocation();

  const [address, setAddress] = useState('');
  const [pin, setPin] = useState<{ readonly lat: number; readonly lng: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (location === null) return;
    setAddress(location.address ?? '');
    setPin(
      location.latitude === null || location.longitude === null
        ? null
        : { lat: location.latitude, lng: location.longitude },
    );
  }, [location]);

  const falta =
    address.trim().length === 0
      ? 'Escribe dónde queda tu gimnasio. Es lo primero que mira quien te busca.'
      : address.trim().length < ADDRESS_MIN
        ? 'Un poco más: calle, número y distrito.'
        : null;
  const ready = falta === null && !saving;

  async function save(): Promise<void> {
    if (!ready) return;
    setSaving(true);
    setError(null);
    try {
      await saveGymLocation({
        address: address.trim(),
        latitude: pin?.lat ?? null,
        longitude: pin?.lng ?? null,
      });
      reload();
      router.back();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar la dirección.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen scroll>
      <Row style={{ paddingTop: 8 }}>
        <Text variant="titleSmall" weight="bold">
          Dónde queda
        </Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={16}>
          <Text variant="body" color={theme.colors.textSecondary}>
            Cerrar
          </Text>
        </Pressable>
      </Row>

      <Text variant="bodySmall" color={theme.colors.textSecondary} style={{ marginTop: 10 }}>
        Sale en tu ficha del directorio, con el mapa y un botón que abre Google Maps,
        Waze o Apple Maps.
      </Text>

      <Stack gap={10} style={{ marginTop: 22 }}>
        <Eyebrow>La dirección</Eyebrow>
        <Card radius={theme.radii.xl}>
          <Field
            label="Calle, número y distrito"
            value={address}
            onChangeText={setAddress}
            placeholder="Av. Primavera 120, Surco"
            autoCapitalize="words"
            editable={isOwner && !saving}
            hint="Como se la dirías a un taxista."
            error={attempted ? (falta ?? undefined) : undefined}
          />
        </Card>
      </Stack>

      <Stack gap={10} style={{ marginTop: 22 }}>
        <Eyebrow>El punto exacto</Eyebrow>
        <Text variant="micro" color={theme.colors.textFaint}>
          {pin === null
            ? 'Opcional. Sin él, «cómo llegar» busca tu dirección en el mapa; con él, lleva a tu puerta.'
            : 'Toca el mapa para moverlo. Es lo que abre el navegador de tus alumnos.'}
        </Text>

        {isOwner ? (
          <MapPicker pin={pin} onPick={setPin} />
        ) : (
          <Text variant="captionSmall" color={theme.colors.textSecondary}>
            Solo el dueño puede cambiarlo.
          </Text>
        )}

        {isOwner ? (
          <Row gap={10} align="stretch">
            <GpsButton onReady={setPin} />
            {pin !== null ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => setPin(null)}
                style={{ height: 44, justifyContent: 'center', paddingHorizontal: 12 }}
              >
                <Text variant="captionSmall" color={theme.colors.textTertiary}>
                  Quitar el punto
                </Text>
              </Pressable>
            ) : null}
          </Row>
        ) : null}
      </Stack>

      {error !== null ? (
        <Card tone="sunken" borderColor={theme.semaphore.bad} style={{ marginTop: 18 }}>
          <Text variant="bodySmall" color={theme.semaphore.bad}>
            {error}
          </Text>
        </Card>
      ) : null}

      {isOwner ? (
        <Button
          label={saving ? 'Guardando…' : 'Guardar'}
          disabled={!ready}
          style={{ marginTop: 22 }}
          onPress={() => void save()}
          onBlockedPress={saving ? undefined : () => setAttempted(true)}
        />
      ) : null}

      <View style={{ height: 32 }} />
    </Screen>
  );
}
