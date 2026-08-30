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
// Uno a uno, no desde el indice. Metro no hace tree-shaking: importar del barrel
// mete los mas de mil iconos de Lucide en el bundle —medido: +1.8 MB por estos
// siete— y es exactamente el coste que el comentario anterior temia. Por la
// puerta de `./icons/*` son 7 archivos y nada mas.
import CalendarDays from 'lucide-react-native/icons/calendar-days';
import CalendarCheck from 'lucide-react-native/icons/calendar-check';
// `History` es un alias: el archivo se llama por su forma, no por su uso.
import History from 'lucide-react-native/icons/rotate-ccw-clock';
import QrCode from 'lucide-react-native/icons/qr-code';
import ScanLine from 'lucide-react-native/icons/scan-line';
import Smartphone from 'lucide-react-native/icons/smartphone';
import Users from 'lucide-react-native/icons/users';
import Wallet from 'lucide-react-native/icons/wallet';
import type { LucideIcon } from 'lucide-react-native';
import { BlurView } from 'expo-blur';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from './primitives';
import { useTheme } from './theme';

/**
 * Iconos de las pestanas.
 *
 * Antes eran seis formas dibujadas con `View` —un rectangulo, un circulo, tres
 * lineas— y el comentario decia que una libreria de iconos "para seis
 * rectangulos" no se pagaba. Tenia razon sobre el coste y no sobre el resultado:
 * dos de las seis eran literalmente un circulo, asi que «Plan» y «Dispositivo»
 * se distinguian por su etiqueta y nada mas. Un icono que no significa nada es
 * peor que ninguno, porque ocupa el sitio del que si.
 *
 * Se usa Lucide y no un pack de fuente: dibuja SVG sobre `react-native-svg`, que
 * ya es dependencia del QR y de la marca, en vez de cargar una fuente de iconos
 * entera para gastar siete glifos. Y su rejilla —24 puntos, trazo de 2— es la
 * misma que ya usaban las formas a mano, asi que no hay que reajustar nada.
 *
 * Los nombres dicen la PANTALLA, no el dibujo. `card` y `lines` no sobrevivian a
 * cambiar de icono; `wallet` y `history` si.
 */
export type TabIconShape =
  | 'wallet'
  | 'qr'
  | 'plan'
  | 'history'
  | 'door'
  | 'roster'
  | 'trials'
  | 'device';

const ICONS: Readonly<Record<TabIconShape, LucideIcon>> = {
  wallet: Wallet,
  qr: QrCode,
  trials: CalendarCheck,
  plan: CalendarDays,
  history: History,
  door: ScanLine,
  roster: Users,
  device: Smartphone,
};

function TabIcon({ shape, color }: { readonly shape: TabIconShape; readonly color: string }) {
  const Icon = ICONS[shape];
  return <Icon size={21} color={color} strokeWidth={2} />;
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
});
