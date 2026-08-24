/**
 * Barra de pestanas propia.
 *
 * Se construye sobre las pestanas headless de expo-router (`expo-router/ui`)
 * en vez de la barra que viene hecha: el diseno pide iconos geometricos de
 * trazo y etiquetas de 10.5px, iguales en las dos plataformas (MD 3). Una barra
 * dibujada no rompe la convencion de plataforma — lo que si se respeta por
 * plataforma es la navegacion (boton atras de Android, gesto de iOS), y de eso
 * se encarga el Stack nativo del layout raiz.
 */
import { forwardRef, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type PressableProps } from 'react-native';
import { BlurView } from 'expo-blur';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from './primitives';
import { useTheme } from './theme';

export type TabIconShape = 'card' | 'qr' | 'circle' | 'lines' | 'viewfinder' | 'search';

/**
 * Icono de trazo dibujado con bordes.
 *
 * Sin libreria de iconos a proposito: son seis formas, y una dependencia de
 * megas para seis rectangulos no se paga.
 */
function TabIcon({ shape, color }: { readonly shape: TabIconShape; readonly color: string }) {
  switch (shape) {
    case 'card':
      return (
        <View style={[styles.stroke, { width: 20, height: 16, borderRadius: 4, borderColor: color }]} />
      );
    case 'qr':
      return (
        <View style={[styles.stroke, { width: 18, height: 18, borderRadius: 3, borderColor: color }]}>
          <View style={{ width: 4, height: 4, borderRadius: 1, backgroundColor: color }} />
        </View>
      );
    case 'circle':
      return (
        <View style={[styles.stroke, { width: 18, height: 18, borderRadius: 9, borderColor: color }]} />
      );
    case 'lines':
      return (
        <View style={{ width: 18, height: 14, justifyContent: 'space-between' }}>
          <View style={{ height: 2, backgroundColor: color }} />
          <View style={{ height: 2, width: 12, backgroundColor: color }} />
          <View style={{ height: 2, backgroundColor: color }} />
        </View>
      );
    case 'viewfinder':
      return (
        <View style={{ width: 20, height: 20 }}>
          <View
            style={[styles.corner, { top: 0, left: 0, borderTopWidth: 2, borderLeftWidth: 2, borderColor: color }]}
          />
          <View
            style={[styles.corner, { top: 0, right: 0, borderTopWidth: 2, borderRightWidth: 2, borderColor: color }]}
          />
          <View
            style={[styles.corner, { bottom: 0, left: 0, borderBottomWidth: 2, borderLeftWidth: 2, borderColor: color }]}
          />
          <View
            style={[styles.corner, { bottom: 0, right: 0, borderBottomWidth: 2, borderRightWidth: 2, borderColor: color }]}
          />
        </View>
      );
    case 'search':
      return (
        <View style={{ width: 19, height: 19 }}>
          <View style={[styles.stroke, { width: 14, height: 14, borderRadius: 7, borderColor: color }]} />
          <View
            style={{
              position: 'absolute',
              right: 0,
              bottom: 1,
              width: 7,
              height: 2,
              backgroundColor: color,
              transform: [{ rotate: '45deg' }],
            }}
          />
        </View>
      );
  }
}

/**
 * Envuelve el contenido de las pestanas anulando el inset inferior.
 *
 * La barra ya ocupa la zona segura de abajo; sin esto, cada pantalla sumaria ese
 * margen otra vez y el contenido quedaria flotando sobre la barra.
 */
export function TabContent({ children }: { readonly children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <SafeAreaInsetsContext.Provider value={{ ...insets, bottom: 0 }}>
      {children}
    </SafeAreaInsetsContext.Provider>
  );
}

/** Contenedor de la barra. Se pasa a `<TabList asChild>`. */
export function TabBarShell({ children }: { readonly children: ReactNode }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <BlurView
      intensity={40}
      tint="dark"
      style={{
        flexDirection: 'row',
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.hairline,
        backgroundColor: 'rgba(14,14,17,0.88)',
        paddingTop: 10,
        paddingBottom: insets.bottom > 0 ? insets.bottom : 12,
      }}
    >
      {children}
    </BlurView>
  );
}

/**
 * Solo se declara lo que `TabTrigger asChild` realmente inyecta. No se extiende
 * `TabTriggerSlotProps` porque expo-router declara sus manejadores de eventos
 * contra otra copia de los tipos de react-native y el conflicto no aporta nada.
 */
export interface TabButtonProps {
  readonly icon: TabIconShape;
  readonly label: string;
  readonly isFocused?: boolean;
  readonly onPress?: PressableProps['onPress'];
  readonly href?: string;
}

/**
 * Boton de pestana. Recibe `isFocused` y `onPress` del `TabTrigger` que lo
 * envuelve, por eso va como `forwardRef`.
 */
export const TabButton = forwardRef<View, TabButtonProps>(function TabButton(
  { icon, label, isFocused, onPress },
  ref,
) {
  const theme = useTheme();
  const color = isFocused === true ? theme.colors.ink : theme.colors.textFaint;

  return (
    <Pressable
      ref={ref}
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: isFocused === true }}
      accessibilityLabel={label}
      style={styles.tab}
    >
      <TabIcon shape={icon} color={color} />
      <Text
        variant="eyebrow"
        weight={isFocused === true ? 'semibold' : 'medium'}
        color={color}
        style={styles.tabLabel}
      >
        {label}
      </Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  tab: { flex: 1, alignItems: 'center', gap: 5 },
  tabLabel: { letterSpacing: 0, fontSize: 10.5 },
  stroke: { borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  corner: { position: 'absolute', width: 7, height: 7 },
});
