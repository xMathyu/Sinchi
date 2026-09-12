/**
 * El mapa donde el dueño toca para marcar su puerta.
 *
 * Empieza en LIMA y no en el centro del mundo: es donde están todos los locales
 * de la red, y abrir en la vista del planeta convierte «marca tu gimnasio» en un
 * ejercicio de navegación. El atajo de verdad es el botón de GPS de la pantalla
 * de al lado; esto es para quien escribe la dirección desde su casa.
 *
 * Igual que `DondeQueda`, carga `react-native-maps` en diferido: es una
 * dependencia nativa y un binario que no la trae no puede reventar la pantalla
 * entera. Sin ella se ven las coordenadas en texto, que no sirve para elegir
 * pero sí para comprobar que el botón de GPS hizo algo.
 */
import { useState } from 'react';
import { View } from 'react-native';
import { Card, Text } from './primitives';
import { useTheme } from './theme';

export interface Punto {
  readonly lat: number;
  readonly lng: number;
}

/** Lima. El delta cubre la ciudad entera sin perder las avenidas. */
const LIMA = { latitude: -12.0464, longitude: -77.0428, latitudeDelta: 0.25, longitudeDelta: 0.25 };

/** Cerca: lo que se ve al volver a abrir un pin ya puesto. */
const CERCA = { latitudeDelta: 0.004, longitudeDelta: 0.004 };

export function MapaParaElegir({
  pin,
  onElegir,
}: {
  readonly pin: Punto | null;
  readonly onElegir: (punto: Punto) => void;
}) {
  const theme = useTheme();
  const [falloElMapa, setFalloElMapa] = useState(false);

  const mapa = falloElMapa ? null : cargarMapa();

  if (mapa === null) {
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

  const { MapView, Marker } = mapa;

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
        style={{ flex: 1 }}
        initialRegion={
          pin === null ? LIMA : { latitude: pin.lat, longitude: pin.lng, ...CERCA }
        }
        onPress={(evento: { nativeEvent: { coordinate: { latitude: number; longitude: number } } }) =>
          onElegir({
            lat: evento.nativeEvent.coordinate.latitude,
            lng: evento.nativeEvent.coordinate.longitude,
          })
        }
        onError={() => setFalloElMapa(true)}
      >
        {pin === null ? null : (
          <Marker
            coordinate={{ latitude: pin.lat, longitude: pin.lng }}
            // Arrastrable además de tocable: corregir dos metros arrastrando es
            // más natural que volver a tocar, y tocar encima del propio pin no
            // siempre dispara el `onPress` del mapa.
            draggable
            onDragEnd={(evento: {
              nativeEvent: { coordinate: { latitude: number; longitude: number } };
            }) =>
              onElegir({
                lat: evento.nativeEvent.coordinate.latitude,
                lng: evento.nativeEvent.coordinate.longitude,
              })
            }
          />
        )}
      </MapView>
    </View>
  );
}

type ModuloDeMapa = {
  readonly MapView: React.ComponentType<Record<string, unknown>>;
  readonly Marker: React.ComponentType<Record<string, unknown>>;
};

let moduloDeMapa: ModuloDeMapa | null | undefined;

function cargarMapa(): ModuloDeMapa | null {
  if (moduloDeMapa !== undefined) return moduloDeMapa;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require('react-native-maps') as {
      default: React.ComponentType<Record<string, unknown>>;
      Marker: React.ComponentType<Record<string, unknown>>;
    };
    moduloDeMapa = { MapView: m.default, Marker: m.Marker };
  } catch {
    moduloDeMapa = null;
  }
  return moduloDeMapa;
}
