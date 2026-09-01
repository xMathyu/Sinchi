/**
 * Escáner de QR, a pantalla completa.
 *
 * Vivía dentro de la puerta como un cuadrado que, con la cámara apagada, no
 * enseñaba nada: 200px para decir «apunta al QR» o «concede el permiso», y
 * empujaba contra los botones lo que el mostrador de verdad lee entre alumno y
 * alumno. Ahora la cámara sólo existe mientras se escanea, y entonces se lleva
 * la pantalla entera — que es cuando la merece.
 *
 * Se queda ABIERTO detrás del resultado a propósito: al confirmar el ingreso se
 * vuelve aquí con el siguiente alumno ya delante, sin pasar por la puerta.
 *
 * La cámara se desmonta al perder el foco, y no es un ahorro de batería: montada
 * debajo del resultado sigue leyendo el mismo QR y apila una validación por
 * fotograma. El candado `locked` cubre los fotogramas de un escaneo; el foco
 * cubre el rato entero que el resultado está encima.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { screenPadding } from '@sinchi/ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Stack, Text } from '../src/design/primitives';
import { useTheme } from '../src/design/theme';
import { useRoster } from '../src/data/hooks';
import { evaluarQr } from '../src/data/actions';

/** Lado del objetivo. El QR se lee mucho antes de llenarlo; es una guía, no un marco. */
const TARGET = 288;

export default function ScanScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const roster = useRoster();

  const [permission, requestPermission] = useCameraPermissions();
  const [validando, setValidando] = useState(false);
  const [enfocada, setEnfocada] = useState(true);
  // Un QR sigue en cuadro varios fotogramas: sin este candado se disparan cinco
  // navegaciones por un solo escaneo.
  const locked = useRef(false);
  // El permiso se pide UNA vez por montaje. Sin el candado, cada render que
  // llega antes de la respuesta vuelve a abrir el diálogo del sistema.
  const pedido = useRef(false);

  useFocusEffect(
    useCallback(() => {
      locked.current = false;
      setEnfocada(true);
      return () => setEnfocada(false);
    }, []),
  );

  useEffect(() => {
    if (pedido.current || permission === null) return;
    if (permission.granted || !permission.canAskAgain) return;
    pedido.current = true;
    void requestPermission();
  }, [permission, requestPermission]);

  const onBarcode = useCallback(({ data }: { readonly data: string }) => {
    if (locked.current) return;
    locked.current = true;
    setValidando(true);

    // La firma TOTP la verifica el servidor, no este aparato: `evaluarQr`
    // decide a quién preguntar y cae a la caché si no hay red.
    void evaluarQr(data)
      .then((salida) => {
        if (!salida.ok) {
          Alert.alert(salida.titulo, salida.detalle, [
            { text: 'Entendido', onPress: () => (locked.current = false) },
          ]);
          return;
        }
        router.push(`/result/${salida.membershipId}`);
      })
      .finally(() => setValidando(false));
  }, []);

  /** Recorre el padrón sin cámara. Herramienta de desarrollo: en un local de
      verdad, un botón que inventa escaneos ensucia la asistencia y el cupo de
      alguien real. */
  const simulate = useCallback(() => {
    const next = roster[Math.floor(Math.random() * roster.length)];
    if (next !== undefined) router.push(`/result/${next.view.membership.id}`);
  }, [roster]);

  const permitida = permission?.granted === true;
  const activa = permitida && enfocada;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.canvas }}>
      {activa ? (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={onBarcode}
        />
      ) : null}

      <View
        style={{
          flex: 1,
          paddingTop: insets.top + 8,
          paddingBottom: insets.bottom + 16,
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            paddingHorizontal: screenPadding,
          }}
        >
          <Text variant="titleSmall" weight="bold" style={{ flex: 1 }}>
            Escanear QR
          </Text>
          <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={16}>
            <Text variant="body" color={theme.colors.textSecondary}>
              Cerrar
            </Text>
          </Pressable>
        </View>

        <View style={styles.flexOne} />

        {permitida ? (
          <View style={{ width: TARGET, height: TARGET, alignSelf: 'center' }}>
            <Corner position="topLeft" />
            <Corner position="topRight" />
            <Corner position="bottomLeft" />
            <Corner position="bottomRight" />
          </View>
        ) : (
          <Stack gap={14} style={{ paddingHorizontal: 30, alignItems: 'center' }}>
            <Text variant="body" weight="semibold" align="center">
              Sin permiso de cámara
            </Text>
            <Text variant="captionSmall" color={theme.colors.textSecondary} align="center">
              {permission?.canAskAgain === false
                ? 'Actívalo en los ajustes del sistema. Mientras tanto puedes marcar manualmente, buscando al alumno por nombre o documento.'
                : 'Concédelo para leer el QR del alumno. Mientras tanto puedes marcar manualmente.'}
            </Text>
            {permission?.canAskAgain === true ? (
              <Button
                label="Permitir cámara"
                onPress={() => void requestPermission()}
                style={{ alignSelf: 'stretch' }}
              />
            ) : null}
          </Stack>
        )}

        <Stack gap={3} style={{ marginTop: 30, paddingHorizontal: 30 }}>
          <Text variant="body" weight="medium" align="center">
            {validando ? 'Validando…' : 'Apunta al QR del alumno'}
          </Text>
          <Text variant="captionSmall" color={theme.colors.textTertiary} align="center">
            Se valida contra el padrón en caché: funciona sin wifi.
          </Text>
        </Stack>

        <View style={styles.flexOne} />

        <Stack gap={10} style={{ paddingHorizontal: screenPadding }}>
          <Button
            label="Marcar manual"
            variant="secondary"
            onPress={() => router.replace('/manual')}
          />
          {__DEV__ ? <Button label="Simular escaneo" variant="ghost" onPress={simulate} /> : null}
        </Stack>
      </View>
    </View>
  );
}

/** Esquinas del objetivo. Cuatro Views: no hace falta una imagen. */
function Corner({
  position,
}: {
  readonly position: 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';
}) {
  const size = 46;
  const border = 4;
  const color = '#F4F1EA';

  const base = {
    position: 'absolute' as const,
    width: size,
    height: size,
    borderColor: color,
  };

  switch (position) {
    case 'topLeft':
      return (
        <View
          style={[
            base,
            {
              top: 0,
              left: 0,
              borderTopWidth: border,
              borderLeftWidth: border,
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
              top: 0,
              right: 0,
              borderTopWidth: border,
              borderRightWidth: border,
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
              bottom: 0,
              left: 0,
              borderBottomWidth: border,
              borderLeftWidth: border,
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
              bottom: 0,
              right: 0,
              borderBottomWidth: border,
              borderRightWidth: border,
              borderBottomRightRadius: 14,
            },
          ]}
        />
      );
  }
}

const styles = StyleSheet.create({
  flexOne: { flex: 1 },
});
