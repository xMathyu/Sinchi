/**
 * El mapa donde el dueño toca para marcar su puerta.
 *
 * Empieza en LIMA y no en el centro del mundo: es donde están todos los locales
 * de la red, y abrir en la vista del planeta convierte «marca tu gimnasio» en un
 * ejercicio de navegación. El atajo de verdad es el botón de GPS de la pantalla
 * de al lado; esto es para quien escribe la dirección desde su casa.
 *
 * Igual que `GymLocationBlock`, carga `react-native-maps` en diferido: es una
 * dependencia nativa y un binario que no la trae no puede reventar la pantalla
 * entera. Sin ella se ven las coordenadas en texto, que no sirve para elegir
 * pero sí para comprobar que el botón de GPS hizo algo.
 */
import { useEffect, useRef, useState } from 'react';
import { Alert, Platform, Pressable, View } from 'react-native';
import Crosshair from 'lucide-react-native/icons/crosshair';
import { withAlpha } from '@sinchi/ui';
import { Card, Text } from './primitives';
import { useTheme } from './theme';

export interface MapPoint {
  readonly lat: number;
  readonly lng: number;
}

/** Lima. El delta cubre la ciudad entera sin perder las avenidas. */
const LIMA = { latitude: -12.0464, longitude: -77.0428, latitudeDelta: 0.25, longitudeDelta: 0.25 };

/** Cerca: lo que se ve al volver a abrir un pin ya puesto. */
const CERCA = { latitudeDelta: 0.004, longitudeDelta: 0.004 };

export function MapPicker({
  pin,
  onPick,
  focus,
}: {
  readonly pin: MapPoint | null;
  readonly onPick: (point: MapPoint) => void;
  /**
   * Un punto al que llevar la cámara, cuando NO lo puso el dedo del usuario.
   *
   * Existe porque `initialRegion` se honra una sola vez, al montar: elegir una
   * sugerencia del buscador colocaba el marcador y dejaba la cámara mirando Lima
   * entera, con el pin fuera de vista. Eso anula la razón de tener mapa aquí,
   * que es CORROBORAR que la dirección escrita cae donde el dueño cree.
   *
   * Es una prop aparte y no una reacción a `pin` a propósito: si la cámara
   * siguiera cualquier cambio del pin, tocar o arrastrar le arrancaría la vista
   * al usuario en medio del gesto. Solo se mueve cuando el punto viene de fuera
   * —una sugerencia, el GPS—, que es cuando no está mirando el mapa.
   */
  readonly focus?: MapPoint | null;
}) {
  const theme = useTheme();
  const [mapFailed, setMapFailed] = useState(false);
  // Sin tipar: el módulo se carga con `require` y sus componentes son
  // `ComponentType<Record<string, unknown>>`, así que no hay tipo de instancia.
  const mapRef = useRef<{ animateToRegion?: (region: unknown, ms?: number) => void } | null>(null);

  useEffect(() => {
    if (focus === null || focus === undefined) return;
    // Defensivo: en un binario sin el módulo nativo el ref queda vacío, y en web
    // el método no existe. Perder la animación no puede tumbar la pantalla.
    mapRef.current?.animateToRegion?.(
      { latitude: focus.lat, longitude: focus.lng, ...CERCA },
      450,
    );
  }, [focus]);

  const maps = mapFailed ? null : loadMaps();

  if (maps === null) {
    return (
      <Card tone="sunken" radius={theme.radii.md}>
        <Text variant="captionSmall" color={theme.colors.textSecondary}>
          {pin === null
            ? 'El mapa no está disponible en esta versión de la app. Puedes guardar solo la dirección: «cómo llegar» la buscará en el mapa de tus alumnos.'
            : `Punto guardado: ${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}.`}
        </Text>
      </Card>
    );
  }

  const { MapView, Marker } = maps;

  return (
    <View
      style={{
        height: 220,
        borderRadius: theme.radii.md,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: theme.colors.border,
      }}
    >
      <MapView
        ref={mapRef}
        style={{ flex: 1 }}
        initialRegion={
          pin === null ? LIMA : { latitude: pin.lat, longitude: pin.lng, ...CERCA }
        }
        onPress={(event: { nativeEvent: { coordinate: { latitude: number; longitude: number } } }) =>
          onPick({
            lat: event.nativeEvent.coordinate.latitude,
            lng: event.nativeEvent.coordinate.longitude,
          })
        }
        onError={() => setMapFailed(true)}
      >
        {pin === null ? null : (
          <Marker
            coordinate={{ latitude: pin.lat, longitude: pin.lng }}
            // Arrastrable además de tocable: corregir dos metros arrastrando es
            // más natural que volver a tocar, y tocar encima del propio pin no
            // siempre dispara el `onPress` del mapa.
            draggable
            onDragEnd={(event: {
              nativeEvent: { coordinate: { latitude: number; longitude: number } };
            }) =>
              onPick({
                lat: event.nativeEvent.coordinate.latitude,
                lng: event.nativeEvent.coordinate.longitude,
              })
            }
          />
        )}
      </MapView>
    </View>
  );
}

/**
 * «Estoy en el gimnasio»: el camino corto y el más exacto.
 *
 * Vive aquí y no en una pantalla desde que lo piden DOS: la de «dónde queda» del
 * dueño y el alta. Y en el alta es casi obligatorio — el mapa abre a escala de
 * ciudad, así que sin este atajo la única forma de apuntar a una puerta es hacer
 * pinch-zoom desde una vista de Lima entera.
 *
 * El dueño casi siempre escribe esto estando dentro de su local, y entonces el
 * GPS del teléfono ES la respuesta, mejor que cualquier cosa que pueda señalar
 * con el dedo.
 *
 * El permiso se pide AQUÍ y no al abrir la app: preguntar por la ubicación sin
 * que nadie la haya pedido es la clase de permiso que se deniega por reflejo, y
 * denegado no vuelve a preguntarse. Pedido justo al tocar el botón que dice para
 * qué es, se concede.
 */
export function GpsButton({
  onReady,
}: {
  readonly onReady: (pin: MapPoint) => void;
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
export async function currentPosition(): Promise<MapPoint | null> {
  let Location: typeof import('expo-location');
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    Location = require('expo-location') as typeof import('expo-location');
  } catch {
    return null;
  }

  const permit = await Location.requestForegroundPermissionsAsync();
  if (!permit.granted) return null;

  const position = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.High,
  });
  return { lat: position.coords.latitude, lng: position.coords.longitude };
}

type MapsModule = {
  readonly MapView: React.ComponentType<Record<string, unknown>>;
  readonly Marker: React.ComponentType<Record<string, unknown>>;
};

let mapsModule: MapsModule | null | undefined;

function loadMaps(): MapsModule | null {
  if (mapsModule !== undefined) return mapsModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require('react-native-maps') as {
      default: React.ComponentType<Record<string, unknown>>;
      Marker: React.ComponentType<Record<string, unknown>>;
    };
    mapsModule = { MapView: m.default, Marker: m.Marker };
  } catch {
    mapsModule = null;
  }
  return mapsModule;
}
