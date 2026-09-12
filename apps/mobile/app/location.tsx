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
import { Alert, Platform, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import Crosshair from 'lucide-react-native/icons/crosshair';
import { withAlpha } from '@sinchi/ui';
import { Button, Card, Eyebrow, Field, Row, Stack, Text } from '../src/design/primitives';
import { Screen } from '../src/design/screen';
import { useTheme } from '../src/design/theme';
import { useGymLocation } from '../src/data/hooks';
import { useRole } from '../src/data/session-hooks';
import { saveGymLocation } from '../src/data/actions';
import { MapPicker } from '../src/design/map-picker';

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

/**
 * «Estoy en el gimnasio»: el camino corto y el más exacto.
 *
 * El dueño casi siempre escribe esto estando dentro de su local, y entonces el
 * GPS del teléfono ES la respuesta — mejor que cualquier cosa que pueda señalar
 * moviendo un mapa con el dedo.
 *
 * El permiso se pide AQUÍ y no al abrir la app: preguntar por la ubicación sin
 * que nadie la haya pedido es la clase de permiso que se deniega por reflejo, y
 * denegado no vuelve a preguntarse. Pedido justo al tocar el botón que dice para
 * qué es, se concede.
 */
function GpsButton({
  onReady,
}: {
  readonly onReady: (pin: { readonly lat: number; readonly lng: number }) => void;
}) {
  const theme = useTheme();
  const [locating, setLocating] = useState(false);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Usar mi ubicación actual"
      disabled={locating}
      onPress={() => {
        setLocating(true);
        void currentPosition()
          .then((point) => {
            if (point === null) {
              Alert.alert(
                'Sin permiso de ubicación',
                Platform.OS === 'ios'
                  ? 'Actívalo en Ajustes › Sinchi › Ubicación, o mueve el mapa a mano.'
                  : 'Actívalo en los ajustes de la app, o mueve el mapa a mano.',
              );
              return;
            }
            onReady(point);
          })
          .catch(() => {
            Alert.alert(
              'No se pudo leer tu ubicación',
              'Puede que estés bajo techo. Mueve el mapa a mano y toca donde queda tu puerta.',
            );
          })
          .finally(() => setLocating(false));
      }}
      style={({ pressed }) => ({
        flex: 1,
        height: 44,
        borderRadius: theme.radii.md,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: withAlpha(theme.semaphore.ok, 0.12),
        borderWidth: 1,
        borderColor: withAlpha(theme.semaphore.ok, 0.3),
        opacity: pressed || locating ? 0.7 : 1,
      })}
    >
      <Crosshair size={15} color={theme.semaphore.ok} />
      <Text variant="captionSmall" weight="semibold" color={theme.semaphore.ok}>
        {locating ? 'Buscándote…' : 'Estoy en el gimnasio'}
      </Text>
    </Pressable>
  );
}

/**
 * El GPS, si esta persona lo permite. `null` cuando dice que no.
 *
 * `expo-location` se carga en diferido por lo mismo que `react-native-maps`: es
 * un módulo NATIVO, y un binario que no lo trae —uno viejo que alguien todavía
 * tenga instalado— reventaría la pantalla entera al importarlo. Lo que se pierde
 * sin él es el atajo; el mapa y la dirección siguen ahí.
 */
async function currentPosition(): Promise<{ readonly lat: number; readonly lng: number } | null> {
  let Location: typeof import('expo-location');
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    Location = require('expo-location') as typeof import('expo-location');
  } catch {
    return null;
  }

  const permit = await Location.requestForegroundPermissionsAsync();
  if (!permit.granted) return null;

  const posicion = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.High,
  });
  return { lat: posicion.coords.latitude, lng: posicion.coords.longitude };
}
