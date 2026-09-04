/**
 * Primitivas del design system.
 *
 * iOS-flavored en ambas plataformas (MD 3): nada de componentes Material. En
 * iOS estas formas coinciden con lo nativo; en Android se replican con estos
 * mismos valores, que salen de `@sinchi/ui`.
 */
import type { ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text as RNText,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import {
  LOGO_BAR_PATH,
  LOGO_BAR_WIDTH,
  LOGO_OUTLINE_PATH,
  LOGO_VIEWBOX,
  WORDMARK,
  WORDMARK_TRACKING_RATIO,
  withAlpha,
  type TypeToken,
} from '@sinchi/ui';
import { displayFamily } from './fonts';
import { useTheme } from './theme';

// ---------------------------------------------------------------------------
// Tipografia
// ---------------------------------------------------------------------------

type Weight = 'regular' | 'medium' | 'semibold' | 'bold' | 'extrabold' | 'black';

const WEIGHT_VALUE: Record<Weight, TextStyle['fontWeight']> = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
  extrabold: '800',
  black: '900',
};

export interface TextProps {
  readonly variant?: TypeToken;
  readonly weight?: Weight;
  readonly color?: string;
  readonly align?: TextStyle['textAlign'];
  readonly uppercase?: boolean;
  readonly numberOfLines?: number;
  readonly style?: StyleProp<TextStyle>;
  readonly children: ReactNode;
}

/**
 * Texto tipado por token de escala. No se pasan tamanos sueltos: si una
 * pantalla necesita un tamano que no existe, el token se agrega a `@sinchi/ui`
 * y queda disponible para las tres superficies.
 */
export function Text({
  variant = 'body',
  weight,
  color,
  align,
  uppercase,
  numberOfLines,
  style,
  children,
}: TextProps) {
  const theme = useTheme();
  const token = theme.typeScale[variant];
  const isDisplay = token.family === 'display';

  return (
    <RNText
      numberOfLines={numberOfLines}
      style={[
        {
          fontSize: token.size,
          lineHeight: token.lineHeight,
          letterSpacing: token.letterSpacing,
          color: color ?? theme.colors.ink,
          textAlign: align,
          textTransform: uppercase === true ? 'uppercase' : undefined,
        },
        isDisplay
          ? { fontFamily: displayFamily(weight) }
          : { fontWeight: WEIGHT_VALUE[weight ?? 'regular'] },
        style,
      ]}
    >
      {children}
    </RNText>
  );
}

/** Etiqueta en versalitas con tracking abierto: el recurso que ordena todas las pantallas. */
export function Eyebrow({
  children,
  color,
  style,
}: {
  readonly children: ReactNode;
  readonly color?: string;
  readonly style?: StyleProp<TextStyle>;
}) {
  const theme = useTheme();
  return (
    <Text
      variant="eyebrow"
      weight="bold"
      uppercase
      color={color ?? theme.colors.textTertiary}
      style={style}
    >
      {children}
    </Text>
  );
}

// ---------------------------------------------------------------------------
// Superficies
// ---------------------------------------------------------------------------

export interface CardProps {
  readonly children: ReactNode;
  readonly tone?: 'default' | 'sunken' | 'raised';
  /** Barra vertical de color a la izquierda: el semaforo de la lista. */
  readonly accent?: string;
  readonly borderColor?: string;
  readonly radius?: number;
  readonly padded?: boolean;
  readonly style?: StyleProp<ViewStyle>;
}

export function Card({
  children,
  tone = 'default',
  accent,
  borderColor,
  radius,
  padded = true,
  style,
}: CardProps) {
  const theme = useTheme();
  const background =
    tone === 'sunken'
      ? theme.colors.surfaceSunken
      : tone === 'raised'
        ? theme.colors.surfaceRaised
        : theme.colors.surface;

  return (
    <View
      style={[
        {
          backgroundColor: background,
          borderRadius: radius ?? theme.radii.xxl,
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderColor: borderColor ?? theme.colors.hairline,
          overflow: 'hidden',
          flexDirection: accent === undefined ? 'column' : 'row',
        },
        style,
      ]}
    >
      {accent !== undefined ? <View style={{ width: 4, backgroundColor: accent }} /> : null}
      <View style={[accent === undefined ? null : styles.flexOne, padded ? styles.cardPad : null]}>
        {children}
      </View>
    </View>
  );
}

export function Divider({ inset = 0 }: { readonly inset?: number }) {
  const theme = useTheme();
  return (
    <View style={{ height: 1, marginHorizontal: inset, backgroundColor: theme.colors.hairline }} />
  );
}

export function Row({
  children,
  gap = 0,
  align = 'center',
  justify = 'space-between',
  style,
}: {
  readonly children: ReactNode;
  readonly gap?: number;
  readonly align?: ViewStyle['alignItems'];
  readonly justify?: ViewStyle['justifyContent'];
  readonly style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[{ flexDirection: 'row', alignItems: align, justifyContent: justify, gap }, style]}
    >
      {children}
    </View>
  );
}

export function Stack({
  children,
  gap = 0,
  style,
}: {
  readonly children: ReactNode;
  readonly gap?: number;
  readonly style?: StyleProp<ViewStyle>;
}) {
  return <View style={[{ gap }, style]}>{children}</View>;
}

// ---------------------------------------------------------------------------
// Indicadores
// ---------------------------------------------------------------------------

/**
 * Punto de estado con halo.
 *
 * El halo (`shadow`) no es decorativo: a un metro de distancia, en la puerta,
 * es lo que hace que el punto se lea antes que el texto.
 */
export function Dot({ color, size = 10 }: { readonly color: string; readonly size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        shadowColor: color,
        shadowOpacity: 0.9,
        shadowRadius: size * 1.2,
        shadowOffset: { width: 0, height: 0 },
        elevation: 0,
      }}
    />
  );
}

export function Badge({
  label,
  color,
  background,
}: {
  readonly label: string;
  readonly color: string;
  readonly background?: string;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        backgroundColor: background ?? withAlpha(color, 0.12),
        paddingHorizontal: 9,
        paddingVertical: 5,
        borderRadius: theme.radii.pill,
      }}
    >
      <Text variant="eyebrow" weight="bold" color={color} style={{ letterSpacing: 0.9 }}>
        {label}
      </Text>
    </View>
  );
}

export function Avatar({
  initials,
  size = 44,
  radius,
}: {
  readonly initials: string;
  readonly size?: number;
  readonly radius?: number;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius ?? size * 0.31,
        backgroundColor: theme.colors.avatar,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text variant="bodySmall" weight="bold" color={theme.colors.textStrong}>
        {initials}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Acciones
// ---------------------------------------------------------------------------

export interface ButtonProps {
  readonly label: string;
  readonly onPress?: () => void;
  readonly variant?: 'primary' | 'secondary' | 'ghost' | 'accent';
  readonly accentColor?: string;
  readonly accentInk?: string;
  readonly disabled?: boolean;
  readonly style?: StyleProp<ViewStyle>;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  accentColor,
  accentInk,
  disabled = false,
  style,
}: ButtonProps) {
  const theme = useTheme();

  const background =
    variant === 'primary'
      ? theme.colors.actionPrimary
      : variant === 'accent'
        ? (accentColor ?? theme.semaphore.ok)
        : variant === 'secondary'
          ? theme.colors.actionSecondary
          : 'transparent';

  const ink =
    variant === 'primary'
      ? theme.colors.actionPrimaryInk
      : variant === 'accent'
        ? (accentInk ?? theme.semaphoreInk.ok)
        : variant === 'ghost'
          ? theme.colors.textTertiary
          : theme.colors.ink;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [
        {
          backgroundColor: background,
          borderRadius: theme.radii.lg,
          paddingVertical: variant === 'ghost' ? 8 : 16,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: variant === 'secondary' ? StyleSheet.hairlineWidth * 2 : 0,
          borderColor: theme.colors.border,
          opacity: disabled ? 0.4 : pressed ? 0.78 : 1,
        },
        style,
      ]}
    >
      <Text variant="heading" weight="semibold" color={ink}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Chip seleccionable: concepto de cobro, metodo de pago, filtros. */
export function Chip({
  label,
  selected = false,
  onPress,
  selectedColor,
}: {
  readonly label: string;
  readonly selected?: boolean;
  readonly onPress?: () => void;
  readonly selectedColor?: string;
}) {
  const theme = useTheme();
  const activeBackground = selectedColor ?? theme.colors.actionPrimary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: selected ? activeBackground : theme.colors.surfaceRaised,
        borderWidth: selected ? 0 : StyleSheet.hairlineWidth * 2,
        borderColor: theme.colors.border,
        borderRadius: theme.radii.pill,
        paddingHorizontal: 15,
        paddingVertical: 9,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <Text
        variant="caption"
        weight="semibold"
        color={selected ? theme.colors.actionPrimaryInk : theme.colors.textStrong}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** Barra segmentada estilo iOS: Asistencia / Pagos. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly value: T;
  readonly onChange: (value: T) => void;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: theme.colors.surfaceMuted,
        borderRadius: theme.radii.sm,
        padding: 3,
      }}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(option.value)}
            style={{
              flex: 1,
              alignItems: 'center',
              paddingVertical: 8,
              borderRadius: theme.radii.xs,
              backgroundColor: active ? theme.colors.chipActive : 'transparent',
            }}
          >
            <Text
              variant="bodySmall"
              weight={active ? 'semibold' : 'medium'}
              color={active ? theme.colors.ink : theme.colors.textSecondary}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Marca
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Campos
// ---------------------------------------------------------------------------

export interface FieldProps {
  readonly label: string;
  readonly value: string;
  readonly onChangeText: (texto: string) => void;
  readonly placeholder: string;
  /** Explicacion bajo el campo. La sustituye `error` cuando lo hay. */
  readonly hint?: string | undefined;
  readonly error?: string | undefined;
  /**
   * Borde punteado sobre el fondo de pantalla, para lo opcional.
   *
   * Es la misma senal que ya usa la tarjeta de "unirme a otro gimnasio": lo
   * punteado se lee como "esto puedes dejarlo vacio" sin gastar una linea de
   * texto en decirlo.
   */
  readonly optional?: boolean;
  /**
   * Caja alta, para lo que se escribe en parrafos.
   *
   * Existe por las instrucciones de una rutina: "como se hace un uchimata" no
   * cabe en una linea de 50px, y en una caja de una linea el dueno escribe tres
   * palabras porque el campo le dice que ahi no cabe mas.
   */
  readonly multiline?: boolean;
  readonly editable?: boolean;
  readonly secureTextEntry?: boolean;
  readonly keyboardType?: TextInputProps['keyboardType'];
  readonly autoCapitalize?: TextInputProps['autoCapitalize'];
  readonly autoComplete?: TextInputProps['autoComplete'];
  readonly returnKeyType?: TextInputProps['returnKeyType'];
  readonly onSubmitEditing?: () => void;
}

/**
 * Campo de formulario con caja.
 *
 * Antes cada pantalla dibujaba su `TextInput` con una linea abajo. La caja no es
 * un capricho: el alta de un gimnasio se llena de pie y con una mano, y una
 * linea de un pixel no dice donde hay que tocar. Con caja, el area tactil es la
 * que se ve —50px— y el campo vacio se distingue del texto suelto que tiene al
 * lado.
 *
 * `fontSize: 16` es obligatorio y no un token: por debajo, iOS hace zoom al
 * enfocar el campo y la pantalla salta.
 */
export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  hint,
  error,
  optional = false,
  multiline = false,
  editable = true,
  secureTextEntry,
  keyboardType,
  autoCapitalize = 'sentences',
  autoComplete,
  returnKeyType,
  onSubmitEditing,
}: FieldProps) {
  const theme = useTheme();
  const conError = error !== undefined && error.length > 0;

  return (
    <Stack gap={6}>
      <Text variant="captionSmall" color={theme.colors.textSecondary}>
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.textPlaceholder}
        editable={editable}
        multiline={multiline}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoComplete={autoComplete}
        autoCorrect={false}
        returnKeyType={returnKeyType}
        onSubmitEditing={onSubmitEditing}
        accessibilityLabel={label}
        style={{
          // Alta y crecida desde arriba cuando es de parrafos: con `height`
          // fija, el texto se centra verticalmente y la segunda linea empuja a
          // la primera fuera de la vista.
          ...(multiline
            ? { minHeight: 112, paddingTop: 12, paddingBottom: 12, textAlignVertical: 'top' as const }
            : { height: 50 }),
          borderRadius: theme.radii.md,
          backgroundColor: optional ? theme.colors.screen : theme.colors.surfaceSunken,
          borderWidth: 1,
          borderStyle: optional ? 'dashed' : 'solid',
          borderColor: conError
            ? withAlpha(theme.semaphore.bad, 0.6)
            : optional
              ? theme.colors.borderDashed
              : theme.colors.border,
          paddingHorizontal: 14,
          fontSize: 16,
          color: theme.colors.ink,
          opacity: editable ? 1 : 0.5,
        }}
      />
      {conError ? (
        <Text variant="micro" color={theme.semaphore.bad}>
          {error}
        </Text>
      ) : hint === undefined ? null : (
        <Text variant="micro" color={theme.colors.textFaint}>
          {hint}
        </Text>
      )}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Marca
// ---------------------------------------------------------------------------

export function Logo({
  size = 28,
  color,
  barColor,
}: {
  readonly size?: number;
  readonly color?: string;
  readonly barColor?: string;
}) {
  const theme = useTheme();
  return (
    <Svg width={size} height={size} viewBox={LOGO_VIEWBOX}>
      <Path d={LOGO_OUTLINE_PATH} fill={color ?? theme.colors.ink} />
      <Path
        d={LOGO_BAR_PATH}
        stroke={barColor ?? theme.colors.screen}
        strokeWidth={LOGO_BAR_WIDTH}
      />
    </Svg>
  );
}

export function Wordmark({
  size = 30,
  color,
}: {
  readonly size?: number;
  readonly color?: string;
}) {
  const theme = useTheme();
  return (
    <RNText
      style={{
        fontFamily: displayFamily('black'),
        fontSize: size,
        lineHeight: size * 1.02,
        letterSpacing: size * WORDMARK_TRACKING_RATIO,
        color: color ?? theme.colors.ink,
      }}
    >
      {WORDMARK}
    </RNText>
  );
}

const styles = StyleSheet.create({
  cardPad: { padding: 16 },
  flexOne: { flex: 1 },
});
