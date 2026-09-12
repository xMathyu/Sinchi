/**
 * Dónde queda el gimnasio, y cómo llegar.
 *
 * El directorio decía el precio, el horario y las disciplinas de cada dojo y
 * callaba lo primero que pregunta quien busca dónde entrenar. Y decirlo no
 * basta: una dirección escrita obliga a seleccionarla, copiarla, abrir otra app
 * y pegarla — tres pasos y dos oportunidades de abandonar, justo en la pantalla
 * donde alguien estaba a punto de ir a probar.
 *
 * Los tres mapas y no uno: en Perú buena parte navega con Waze por el tráfico,
 * quien tiene iPhone tiene Apple Maps sin instalar nada, y Google Maps es el que
 * casi todos usan para buscar. Elegir por la persona la manda a instalar una app
 * para ir a una clase de prueba.
 *
 * En Android no se ofrece Apple Maps: el enlace abriría la web de un mapa que no
 * navega. Y es `Linking.openURL` sobre un `https://` —no un esquema propio— para
 * que el botón haga algo aunque la app no esté instalada; ver `directionsUrl`.
 */
import { useState } from 'react';
import { Alert, Linking, Platform, Pressable, View } from 'react-native';
import MapPin from 'lucide-react-native/icons/map-pin';
import {
  MAP_APP_LABELS,
  directionsUrl,
  hasLocation,
  type GymPlace,
  type MapApp,
} from '@sinchi/shared';
import { withAlpha } from '@sinchi/ui';
import { Card, Eyebrow, Row, Stack, Text } from './primitives';
import { useTheme } from './theme';

/** Apple Maps solo donde existe. En Android abriría una web que no navega. */
const MAPAS: readonly MapApp[] =
  Platform.OS === 'ios' ? ['google', 'apple', 'waze'] : ['google', 'waze'];

export function GymLocationBlock({
  place,
  title = 'Dónde queda',
}: {
  readonly place: GymPlace;
  readonly title?: string;
}) {
  const theme = useTheme();

  // Sin dirección ni pin no hay nada que enseñar, y un bloque «Dónde queda» en
  // blanco es peor que su ausencia: parece que la app no cargó.
  if (!hasLocation(place)) return null;

  return (
    <Stack gap={12} style={{ marginTop: 24 }}>
      <Eyebrow>{title}</Eyebrow>

      <Card radius={theme.radii.xl}>
        <Stack gap={14}>
          <Row gap={10} align="flex-start" justify="flex-start">
            <MapPin size={18} color={theme.semaphore.ok} style={{ marginTop: 2 }} />
            <Text variant="bodySmall" style={{ flex: 1 }}>
              {place.address ?? 'El gimnasio marcó su punto en el mapa.'}
            </Text>
          </Row>

          <GymMiniMap place={place} />

          <Row gap={8} align="stretch">
            {MAPAS.map((app) => (
              <MapButton key={app} place={place} app={app} />
            ))}
          </Row>
        </Stack>
      </Card>
    </Stack>
  );
}

function MapButton({ place, app }: { readonly place: GymPlace; readonly app: MapApp }) {
  const theme = useTheme();
  const url = directionsUrl(place, app);
  if (url === null) return null;

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`Cómo llegar con ${MAP_APP_LABELS[app]}`}
      onPress={() => {
        void Linking.openURL(url).catch(() => {
          // Que un mapa no abra no puede quedar en silencio: quien lo toca está
          // decidiendo si va, y un botón que no hace nada se lee como que la
          // app está rota.
          Alert.alert(
            `No se pudo abrir ${MAP_APP_LABELS[app]}`,
            'Prueba con otro de los mapas.',
          );
        });
      }}
      style={({ pressed }) => ({
        flex: 1,
        height: 44,
        borderRadius: theme.radii.md,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: withAlpha(theme.semaphore.ok, 0.12),
        borderWidth: 1,
        borderColor: withAlpha(theme.semaphore.ok, 0.3),
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <Text variant="captionSmall" weight="semibold" color={theme.semaphore.ok}>
        {MAP_APP_LABELS[app]}
      </Text>
    </Pressable>
  );
}

/**
 * El mapa, cuando el dueño puso su pin.
 *
 * Se carga en diferido (`require` dentro de un try) y no con un `import` de
 * arriba a propósito: `react-native-maps` es una dependencia NATIVA, y un
 * binario que no la trae —un Expo Go, un build viejo que alguien todavía tiene
 * en el teléfono— reventaría la pantalla entera al importarla. Así, lo que se
 * pierde es el recuadro del mapa; la dirección y los tres botones siguen ahí, y
 * son lo que de verdad lleva a alguien a la puerta.
 */
function GymMiniMap({ place }: { readonly place: GymPlace }) {
  const theme = useTheme();
  const [mapFailed, setMapFailed] = useState(false);

  const pin =
    place.latitude === null || place.longitude === null
      ? null
      : { latitude: place.latitude, longitude: place.longitude };
  if (pin === null || mapFailed) return null;

  const maps = loadMaps();
  if (maps === null) return null;
  const { MapView, Marker } = maps;

  return (
    <View
      style={{
        height: 160,
        borderRadius: theme.radii.md,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: theme.colors.border,
      }}
    >
      <MapView
        style={{ flex: 1 }}
        // El mapa de cada plataforma —Apple en iOS, Google en Android— y no
        // Google en las dos. Forzar Google en iOS mete el SDK de Google Maps
        // dentro del binario y exige una segunda clave de api para un recuadro
        // de 160 puntos que solo dice por dónde queda. Lo que tiene que ser
        // igual en los dos teléfonos es el PIN, y ese sale de la misma fila.
        initialRegion={{ ...pin, latitudeDelta: 0.006, longitudeDelta: 0.006 }}
        // Mirar, no navegar: el mapa de aquí responde «¿por dónde queda?», y
        // para lo otro están los tres botones de abajo.
        scrollEnabled={false}
        zoomEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        pointerEvents="none"
        onError={() => setMapFailed(true)}
      >
        <Marker coordinate={pin} title={place.name} description={place.address ?? undefined} />
      </MapView>
    </View>
  );
}

/**
 * `react-native-maps`, si este binario la trae.
 *
 * Un `require` en un try y no un import estático: ver `MapaDelLocal`. El
 * resultado se guarda porque este componente se monta en cada ficha de gimnasio
 * que se abre, y un `require` que falla no es gratis.
 */
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
