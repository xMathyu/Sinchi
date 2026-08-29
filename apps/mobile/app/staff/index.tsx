/**
 * S1 · Escáner de la puerta.
 *
 * Es la pantalla que el gimnasio usa mas veces al dia, y va antes que el modo
 * alumno en el orden de construccion (MD 11, fase 3): sin ella el local no
 * puede operar.
 *
 * Dos decisiones que se ven aqui:
 *  - la validacion es LOCAL, contra el padron en cache, funcione o no el wifi.
 *    El indicador de conexion se muestra, pero no bloquea nada;
 *  - hay un boton de escaneo simulado. No es un adorno de demo: en un local sin
 *    permiso de camara todavia concedido, o con la camara ocupada, recepcion
 *    necesita una via para atender al alumno que ya esta en la puerta.
 */
import { useCallback, useRef, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { withAlpha } from '@sinchi/ui';
import { Avatar, Button, Dot, Eyebrow, Row, Stack, Text } from '../../src/design/primitives';
import { Screen } from '../../src/design/screen';
import { useTheme } from '../../src/design/theme';
import { useRecentCheckIns, useRefresco, useRoster, useStore } from '../../src/data/hooks';
import { setOnline } from '../../src/data/store';
import { evaluarQr } from '../../src/data/actions';
import { formatClock, initials } from '../../src/lib/format';

export default function ScannerScreen() {
  const theme = useTheme();
  const staff = useStore((state) => state.staff);
  const tenants = useStore((state) => state.tenants);
  const online = useStore((state) => state.online);
  const roster = useRoster();
  const recent = useRecentCheckIns();
  // Al volver a la puerta se relee el padrón: puede haber cambiado fuera.
  useRefresco();

  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const [validando, setValidando] = useState(false);
  // Un QR sigue en cuadro varios fotogramas: sin este candado se disparan
  // cinco navegaciones por un solo escaneo.
  const locked = useRef(false);

  const tenant = tenants.find((item) => item.id === staff.tenantId);

  const openResult = useCallback((membershipId: string) => {
    router.push(`/result/${membershipId}`);
  }, []);

  const onBarcode = useCallback(
    ({ data }: { readonly data: string }) => {
      if (locked.current) return;
      locked.current = true;
      setValidando(true);

      // La firma TOTP la verifica el servidor, no este aparato: `evaluarQr`
      // decide a quien preguntar y cae a la cache si no hay red.
      void evaluarQr(data)
        .then((salida) => {
          if (!salida.ok) {
            Alert.alert(salida.titulo, salida.detalle, [
              { text: 'Entendido', onPress: () => (locked.current = false) },
            ]);
            return;
          }
          setScanning(false);
          openResult(salida.membershipId);
          setTimeout(() => (locked.current = false), 1200);
        })
        .finally(() => setValidando(false));
    },
    [openResult],
  );

  const simulate = useCallback(() => {
    // Recorre el padron para que el recorrido muestre los distintos veredictos.
    const next = roster[Math.floor(Math.random() * roster.length)];
    if (next !== undefined) openResult(next.view.membership.id);
  }, [roster, openResult]);

  return (
    <Screen background={theme.colors.screenScanner}>
      <Row style={{ paddingTop: 8 }} gap={10}>
        {/* `flex: 1` y una sola linea: sin ellos, el nombre del gimnasio hace
            crecer esta columna, la linea se parte en dos y empuja el indicador
            de conexion y el avatar fuera de la pantalla. */}
        <Stack gap={1} style={{ flex: 1 }}>
          <Text variant="titleSmall" weight="bold" numberOfLines={1}>
            {tenant?.name ?? 'Puerta principal'}
          </Text>
          <Text variant="captionSmall" color={theme.colors.textSecondary} numberOfLines={1}>
            {staff.displayName} · {staff.role === 'owner' ? 'dueño' : 'recepción'}
          </Text>
        </Stack>
        <Row gap={9} justify="flex-end">
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: online }}
          accessibilityLabel={online ? 'En línea. Toca para simular corte.' : 'Sin conexión. Toca para reconectar.'}
          onPress={() => setOnline(!online)}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 7,
            backgroundColor: withAlpha(online ? theme.semaphore.ok : theme.semaphore.alert, 0.13),
            borderWidth: 1,
            borderColor: withAlpha(online ? theme.semaphore.ok : theme.semaphore.alert, 0.28),
            paddingHorizontal: online ? 8 : 11,
            paddingVertical: online ? 8 : 6,
            borderRadius: theme.radii.pill,
          }}
        >
          <Dot color={online ? theme.semaphore.ok : theme.semaphore.alert} size={7} />
          {/* Estando en linea basta el punto: es el estado normal y el color ya
              lo dice. La palabra se reserva para OFFLINE, que es el que pide
              atencion — y de paso devuelve 80 puntos de ancho al nombre del
              gimnasio, que se estaba cortando por escribir "todo bien". */}
          {online ? null : (
            <Text variant="micro" weight="bold" color={theme.semaphore.alert}>
              OFFLINE
            </Text>
          )}
        </Pressable>
        {/* La unica salida del modo staff: sin esto no habia forma de cerrar
            turno desde la puerta, que es donde se pasa el dia. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Ajustes y cerrar turno"
          onPress={() => router.push('/settings')}
        >
          <Avatar initials={initials(staff.displayName)} size={34} radius={17} />
        </Pressable>
        </Row>
      </Row>

      {/* Cuadrado solo cuando hay camara. Apagado ocupaba el 40% de la pantalla
          para decir "concede el permiso", y empujaba «Últimos marcados» —lo que
          el mostrador de verdad lee entre alumno y alumno— contra los botones. */}
      <View
        style={{
          marginTop: 22,
          aspectRatio: scanning && permission?.granted === true ? 1 : undefined,
          height: scanning && permission?.granted === true ? undefined : 200,
          borderRadius: theme.radii.xxxl,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: theme.colors.hairline,
          backgroundColor: '#1C1C22',
        }}
      >
        {scanning && permission?.granted === true ? (
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={onBarcode}
          />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Text variant="caption" color={theme.colors.textTertiary} align="center">
              {permission?.granted === true
                ? 'Apunta al QR del alumno'
                : 'Concede el permiso de cámara para escanear'}
            </Text>
          </View>
        )}

        <Corner position="topLeft" />
        <Corner position="topRight" />
        <Corner position="bottomLeft" />
        <Corner position="bottomRight" />
      </View>

      <Stack gap={9} style={{ marginTop: 20, flex: 1 }}>
        <Eyebrow>Últimos marcados</Eyebrow>
        {recent.length === 0 ? (
          <Text variant="captionSmall" color={theme.colors.textTertiary}>
            Todavía no hay marcados en este turno.
          </Text>
        ) : (
          recent.slice(0, 3).map((marcado) => (
            <Row
              key={marcado.id}
              gap={11}
              justify="flex-start"
              style={{
                backgroundColor: '#141418',
                borderRadius: theme.radii.md,
                paddingHorizontal: 13,
                paddingVertical: 11,
              }}
            >
              <Dot color={theme.semaphore.ok} size={8} />
              <Text variant="bodySmall" weight="semibold" style={{ flex: 1 }}>
                {marcado.name}
                {marcado.manual ? (
                  <Text variant="bodySmall" color={theme.colors.textTertiary}>
                    {' '}
                    · manual
                  </Text>
                ) : null}
              </Text>
              <Text variant="captionSmall" color={theme.colors.textTertiary}>
                {formatClock(marcado.at)}
              </Text>
            </Row>
          ))
        )}
      </Stack>

      <Stack gap={10}>
        <Button
          label={validando ? 'Validando…' : scanning ? 'Leyendo QR…' : 'Escanear QR'}
          disabled={validando}
          onPress={async () => {
            if (permission?.granted !== true) {
              const result = await requestPermission();
              if (result?.granted !== true) {
                Alert.alert(
                  'Sin permiso de cámara',
                  'Puedes marcar manualmente mientras tanto, buscando al alumno por nombre o documento.',
                );
                return;
              }
            }
            setScanning((value) => !value);
          }}
        />
        {/* El padrón ya es una pestaña, así que aquí solo queda el atajo que
            de verdad pertenece a la puerta: el alumno sin celular que está
            esperando delante. */}
        <Button
          label="Marcar manual"
          variant="secondary"
          onPress={() => router.push('/manual')}
        />
        {/* Recorre el padron sin camara. Es una herramienta de desarrollo: en un
            local de verdad, un boton que inventa escaneos ensucia la asistencia
            y el cupo de alguien real. */}
        {__DEV__ ? (
          <Button label="Simular escaneo" variant="ghost" onPress={simulate} />
        ) : null}
      </Stack>
    </Screen>
  );
}

/** Esquinas del visor. Cuatro Views: no hace falta una imagen. */
function Corner({
  position,
}: {
  readonly position: 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';
}) {
  const size = 46;
  const border = 4;
  const color = '#F4F1EA';
  const offset = '8%';

  const base = { position: 'absolute' as const, width: size, height: size };

  switch (position) {
    case 'topLeft':
      return (
        <View
          style={[
            base,
            {
              top: offset,
              left: offset,
              borderTopWidth: border,
              borderLeftWidth: border,
              borderColor: color,
              borderTopLeftRadius: 14,
            },
          ]}
        />
      );
    case 'topRight':
      return (
        <View
          style={[
            base,
            {
              top: offset,
              right: offset,
              borderTopWidth: border,
              borderRightWidth: border,
              borderColor: color,
              borderTopRightRadius: 14,
            },
          ]}
        />
      );
    case 'bottomLeft':
      return (
        <View
          style={[
            base,
            {
              bottom: offset,
              left: offset,
              borderBottomWidth: border,
              borderLeftWidth: border,
              borderColor: color,
              borderBottomLeftRadius: 14,
            },
          ]}
        />
      );
    case 'bottomRight':
      return (
        <View
          style={[
            base,
            {
              bottom: offset,
              right: offset,
              borderBottomWidth: border,
              borderRightWidth: border,
              borderColor: color,
              borderBottomRightRadius: 14,
            },
          ]}
        />
      );
  }
}
