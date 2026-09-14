/**
 * El celular: primero el país, con su bandera, y después el número.
 *
 * Era un campo de texto que arrancaba con «+51» escrito, y nada impedía borrar el
 * prefijo: `987654321` pasaba por una persona distinta de `+51987654321`, con lo
 * que se esquivaba la clase gratis por celular y el vínculo por celular no
 * encontraba a nadie (decisiones §16). Con el país aparte, un número sin país no
 * se puede escribir, y quien viene de fuera elige el suyo en vez de adivinar el
 * formato.
 *
 * Hacia fuera es UN valor, el que se guarda: `+51987654321`, o '' sin número. Las
 * pantallas no se enteran de que por dentro son dos.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Modal,
  Platform,
  Pressable,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Check from 'lucide-react-native/icons/check';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import Search from 'lucide-react-native/icons/search';
import {
  DEFAULT_PHONE_COUNTRY,
  flagEmoji,
  joinPhoneNumber,
  searchPhoneCountries,
  splitPhoneNumber,
  type PhoneCountry,
} from '@sinchi/shared';
import { screenPadding, withAlpha } from '@sinchi/ui';
import { Row, Stack, Text } from './primitives';
import { useTheme } from './theme';

/** E.164 admite 15 dígitos, contando los del código del país. */
const E164_DIGITS = 15;

export interface PhoneFieldProps {
  readonly label: string;
  /** Lo que se guarda: `+51987654321`, o '' si todavía no hay número. */
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly hint?: string | undefined;
  readonly error?: string | undefined;
  readonly editable?: boolean;
  /**
   * Cómo se dibuja.
   *
   * `box` es el de `Field`. `line` es el de los formularios que todavía van con
   * una línea abajo —la reserva, el chat, el alta en el mostrador—: un celular con
   * caja entre campos de línea se lee como otra cosa.
   */
  readonly look?: 'box' | 'line';
  readonly returnKeyType?: TextInputProps['returnKeyType'];
  readonly onSubmitEditing?: () => void;
}

export function PhoneField({
  label,
  value,
  onChange,
  hint,
  error,
  editable = true,
  look = 'box',
  returnKeyType,
  onSubmitEditing,
}: PhoneFieldProps) {
  const theme = useTheme();
  const [country, setCountry] = useState<PhoneCountry>(
    () => splitPhoneNumber(value).country ?? DEFAULT_PHONE_COUNTRY,
  );
  const [national, setNational] = useState(() => splitPhoneNumber(value).national);
  const [picking, setPicking] = useState(false);

  /**
   * El último valor que salió de aquí.
   *
   * Distingue lo que llega de fuera —el celular de `/me` al abrir Mi cuenta, lo
   * que dio al registrarse— de lo que este campo acaba de mandar. Sin él, cada
   * tecla volvería a separar el número, y quien eligió Canadá (+1, como Estados
   * Unidos) vería saltar la bandera al escribir.
   */
  const emitted = useRef(value);
  useEffect(() => {
    if (value === emitted.current) return;
    emitted.current = value;
    const split = splitPhoneNumber(value, country);
    setCountry(split.country ?? country);
    setNational(split.national);
    // Solo cuando cambia desde fuera: el país elegido se lee en ese instante.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const emit = (nextCountry: PhoneCountry, nextNational: string): void => {
    const next = joinPhoneNumber(nextCountry, nextNational);
    emitted.current = next;
    onChange(next);
  };

  const type = (text: string): void => {
    // El autocompletado de iOS y lo copiado de un contacto traen el país delante
    // («+51 987 654 321»). Se separa y la bandera se pone sola; si no, el +51
    // quedaba dentro del número y el país se contaba dos veces.
    const split = text.includes('+') ? splitPhoneNumber(text, country) : null;
    const nextCountry = split?.country ?? country;
    const digits = (split?.national ?? text.replace(/\D/g, '')).slice(
      0,
      E164_DIGITS - nextCountry.dialCode.length,
    );
    setCountry(nextCountry);
    setNational(digits);
    emit(nextCountry, digits);
  };

  const pick = (next: PhoneCountry): void => {
    const digits = national.slice(0, E164_DIGITS - next.dialCode.length);
    setPicking(false);
    setCountry(next);
    setNational(digits);
    emit(next, digits);
  };

  const hasError = error !== undefined && error.length > 0;
  const boxed = look === 'box';

  return (
    <Stack gap={boxed ? 6 : 4}>
      <Text variant="captionSmall" color={theme.colors.textSecondary}>
        {label}
      </Text>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          opacity: editable ? 1 : 0.5,
          ...(boxed
            ? {
                height: 50,
                borderRadius: theme.radii.md,
                backgroundColor: theme.colors.surfaceSunken,
                borderWidth: 1,
                borderColor: hasError ? withAlpha(theme.semaphore.bad, 0.6) : theme.colors.border,
              }
            : {
                borderBottomWidth: 1,
                borderBottomColor: hasError ? theme.semaphore.bad : theme.colors.hairline,
              }),
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`País del celular: ${country.name}, más ${country.dialCode}`}
          accessibilityHint="Abre la lista de países"
          disabled={!editable}
          onPress={() => setPicking(true)}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            alignSelf: 'stretch',
            gap: 6,
            paddingLeft: boxed ? 12 : 0,
            paddingRight: 10,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Text style={{ fontSize: 20, lineHeight: 26 }}>{flagEmoji(country.iso)}</Text>
          <Text style={{ fontSize: 16, lineHeight: 22 }} color={theme.colors.ink}>
            +{country.dialCode}
          </Text>
          <ChevronDown size={14} color={theme.colors.textTertiary} />
        </Pressable>
        <View
          style={{
            width: 1,
            alignSelf: 'stretch',
            marginVertical: boxed ? 12 : 8,
            backgroundColor: boxed ? theme.colors.border : theme.colors.hairline,
          }}
        />
        <TextInput
          value={national}
          onChangeText={type}
          // El ejemplo solo cuando se sabe cómo es: un celular de Perú. De otro
          // país, un ejemplo peruano enseñaría la forma equivocada.
          placeholder={country.iso === DEFAULT_PHONE_COUNTRY.iso ? '987 654 321' : 'Número'}
          placeholderTextColor={theme.colors.textPlaceholder}
          editable={editable}
          keyboardType="phone-pad"
          autoComplete="tel"
          autoCorrect={false}
          returnKeyType={returnKeyType}
          onSubmitEditing={onSubmitEditing}
          accessibilityLabel={label}
          style={{
            flex: 1,
            alignSelf: 'stretch',
            paddingHorizontal: 12,
            paddingVertical: boxed ? 0 : 8,
            // 16 y no un token, como en `Field`: por debajo iOS hace zoom al enfocar.
            fontSize: 16,
            color: theme.colors.ink,
          }}
        />
      </View>
      {hasError ? (
        <Text variant="micro" color={theme.semaphore.bad}>
          {error}
        </Text>
      ) : hint === undefined ? null : (
        <Text variant="micro" color={theme.colors.textFaint}>
          {hint}
        </Text>
      )}

      <Modal
        visible={picking}
        animationType="slide"
        // La hoja de iOS deja ver que se sigue dentro del mismo formulario, y se
        // cierra bajándola con el dedo. Android no la tiene: abre a pantalla completa.
        presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'}
        onRequestClose={() => setPicking(false)}
      >
        <CountryPicker selected={country} onPick={pick} onClose={() => setPicking(false)} />
      </Modal>
    </Stack>
  );
}

/**
 * La lista de países, con buscador.
 *
 * Una hoja con buscador y no un desplegable: son más de doscientos países, y un
 * menú que no se filtra obliga a quien viene de Venezuela —que en Lima no es un
 * caso raro— a bajar hasta la V.
 */
function CountryPicker({
  selected,
  onPick,
  onClose,
}: {
  readonly selected: PhoneCountry;
  readonly onPick: (country: PhoneCountry) => void;
  readonly onClose: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const countries = useMemo(() => searchPhoneCountries(query), [query]);

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.colors.screen,
        // La hoja de iOS ya empieza por debajo de la barra de estado.
        paddingTop: Platform.OS === 'ios' ? 18 : insets.top + 12,
      }}
    >
      <View style={{ paddingHorizontal: screenPadding }}>
        <Row justify="space-between" align="center">
          <Text variant="title" weight="bold">
            Código del país
          </Text>
          <Pressable accessibilityRole="button" onPress={onClose} hitSlop={12}>
            <Text variant="bodySmall" weight="semibold" color={theme.colors.textSecondary}>
              Cerrar
            </Text>
          </Pressable>
        </Row>
        <Row
          gap={8}
          align="center"
          style={{
            marginTop: 14,
            height: 44,
            borderRadius: theme.radii.md,
            backgroundColor: theme.colors.surfaceSunken,
            borderWidth: 1,
            borderColor: theme.colors.border,
            paddingHorizontal: 12,
          }}
        >
          <Search size={16} color={theme.colors.textTertiary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Busca tu país o su código"
            placeholderTextColor={theme.colors.textPlaceholder}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            accessibilityLabel="Buscar país"
            style={{ flex: 1, alignSelf: 'stretch', fontSize: 16, color: theme.colors.ink }}
          />
        </Row>
      </View>

      <FlatList
        data={countries}
        keyExtractor={(country) => country.iso}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        style={{ marginTop: 10 }}
        contentContainerStyle={{ paddingHorizontal: screenPadding, paddingBottom: insets.bottom + 16 }}
        ItemSeparatorComponent={() => (
          <View style={{ height: 1, backgroundColor: theme.colors.hairline }} />
        )}
        ListEmptyComponent={
          <Text
            variant="bodySmall"
            color={theme.colors.textSecondary}
            align="center"
            style={{ marginTop: 24 }}
          >
            Ningún país coincide con «{query.trim()}».
          </Text>
        }
        renderItem={({ item }) => {
          const current = item.iso === selected.iso;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: current }}
              accessibilityLabel={`${item.name}, más ${item.dialCode}`}
              onPress={() => onPick(item)}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                minHeight: 52,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Text style={{ fontSize: 22, lineHeight: 28 }}>{flagEmoji(item.iso)}</Text>
              <Text
                variant="bodySmall"
                weight={current ? 'semibold' : 'regular'}
                numberOfLines={1}
                style={{ flex: 1 }}
              >
                {item.name}
              </Text>
              <Text variant="bodySmall" color={theme.colors.textSecondary}>
                +{item.dialCode}
              </Text>
              <View style={{ width: 18 }}>
                {current ? <Check size={18} color={theme.semaphore.ok} /> : null}
              </View>
            </Pressable>
          );
        }}
      />
    </View>
  );
}
