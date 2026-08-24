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
import { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { withAlpha } from '@sinchi/ui';
import { Button, Dot, Eyebrow, Row, Stack, Text } from '../../src/design/primitives';
import { Screen } from '../../src/design/screen';
import { useTheme } from '../../src/design/theme';
import { useRoster, useStore } from '../../src/data/hooks';
import { resolveQr, setOnline } from '../../src/data/store';
import { formatClock } from '../../src/lib/format';

export default function ScannerScreen() {
  const theme = useTheme();
  const staff = useStore((state) => state.staff);
  const tenants = useStore((state) => state.tenants);
  const online = useStore((state) => state.online);
  const attendances = useStore((state) => state.attendances);
  const roster = useRoster();

  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  // Un QR sigue en cuadro varios fotogramas: sin este candado se disparan
  // cinco navegaciones por un solo escaneo.
  const locked = useRef(false);

  const tenant = tenants.find((item) => item.id === staff.tenantId);

  const recent = useMemo(
    () =>
      attendances
        .filter((attendance) => attendance.tenantId === staff.tenantId)
        .slice()
        .sort((a, b) => b.checkedInAt.getTime() - a.checkedInAt.getTime())
        .slice(0, 3),
    [attendances, staff.tenantId],
  );

  const openResult = useCallback((membershipId: string) => {
    router.push(`/result/${membershipId}`);
  }, []);

  const onBarcode = useCallback(
    ({ data }: { readonly data: string }) => {
      if (locked.current) return;
      const resolution = resolveQr(data);
      if (!resolution.ok) {
        locked.current = true;
        Alert.alert(
          'Código no reconocido',
          resolution.reason === 'not_sinchi'
            ? 'Ese QR no es de Sinchi.'
            : resolution.reason === 'unknown_user'
              ? 'El código es de Sinchi, pero no corresponde a ningún usuario.'
              : 'Este alumno no tiene membresía en este local.',
          [{ text: 'Entendido', onPress: () => (locked.current = false) }],
        );
        return;
      }
      locked.current = true;
      setScanning(false);
      openResult(resolution.membershipId);
      setTimeout(() => (locked.current = false), 1200);
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
      <Row style={{ paddingTop: 8 }}>
        <Stack gap={1}>
          <Text variant="titleSmall" weight="bold">
            Puerta principal
          </Text>
          <Text variant="captionSmall" color={theme.colors.textSecondary}>
            {tenant?.name ?? ''} · {staff.displayName} ({staff.role === 'owner' ? 'dueño' : 'recepción'})
          </Text>
        </Stack>
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
            paddingHorizontal: 11,
            paddingVertical: 6,
            borderRadius: theme.radii.pill,
          }}
        >
          <Dot color={online ? theme.semaphore.ok : theme.semaphore.alert} size={7} />
          <Text
            variant="micro"
            weight="bold"
            color={online ? theme.semaphore.ok : theme.semaphore.alert}
          >
            {online ? 'EN LÍNEA' : 'OFFLINE'}
          </Text>
        </Pressable>
      </Row>

      <View
        style={{
          marginTop: 22,
          aspectRatio: 1,
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
          recent.map((attendance) => {
            const entry = roster.find(
              (item) => item.view.membership.id === attendance.membershipId,
            );
            return (
              <Row
                key={attendance.id}
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
                  {entry?.user.name ?? 'Alumno'}
                  {attendance.method === 'manual' ? (
                    <Text variant="bodySmall" color={theme.colors.textTertiary}>
                      {' '}
                      · manual
                    </Text>
                  ) : null}
                </Text>
                <Text variant="captionSmall" color={theme.colors.textTertiary}>
                  {formatClock(attendance.checkedInAt)}
                </Text>
              </Row>
            );
          })
        )}
      </Stack>

      <Stack gap={10}>
        <Button
          label={scanning ? 'Leyendo QR…' : 'Escanear QR'}
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
        <Row gap={10}>
          <Button
            label="Marcar manual"
            variant="secondary"
            style={{ flex: 1 }}
            onPress={() => router.push('/staff/manual')}
          />
          <Button
            label="Simular escaneo"
            variant="secondary"
            style={{ flex: 1 }}
            onPress={simulate}
          />
        </Row>
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
