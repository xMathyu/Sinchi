/**
 * El logo del gimnasio, y el campo para elegirlo.
 *
 * Sin logo se ven las INICIALES, como un alumno sin foto (`PhotoCircle`): no
 * todo dojo tiene logo, y una lista donde unos tienen baldosa y otros un hueco
 * se lee como una lista rota. Con la misma baldosa para todos, el logo es lo
 * que distingue y no lo que desalinea.
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, View } from 'react-native';
import { Row, Stack, Text } from './primitives';
import { useTheme } from './theme';
import { gymLogoUrl } from '../data/api';
import { initials } from '../lib/format';

/**
 * Blanco en los dos temas, y a propósito.
 *
 * Casi todo logo se diseñó sobre papel blanco, y muchos llegan con el fondo
 * transparente: sobre la superficie oscura del tema, un escudo negro con fondo
 * transparente desaparece. Sobre blanco se ve como se dibujó. El que es blanco
 * sobre transparente se pierde aquí, y por eso la pantalla del logo lo avisa
 * antes de subirlo.
 */
const LOGO_PAPER = '#FFFFFF';

export function GymLogo({
  name,
  logoId,
  localUri,
  size = 44,
}: {
  readonly name: string;
  /** El logo en la api. `null` o ausente = iniciales. */
  readonly logoId?: string | null;
  /** Un logo que todavía está en el teléfono: el del alta, antes de subirlo. */
  readonly localUri?: string | null;
  readonly size?: number;
}) {
  const theme = useTheme();
  const uri = localUri ?? (logoId == null ? null : gymLogoUrl(logoId));

  // Si la imagen no llega —sin red y sin caché, o un logo que se acaba de
  // cambiar desde otro teléfono— quedan las iniciales, no una baldosa en blanco.
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [uri]);

  const radius = Math.round(size * 0.26);

  if (uri === null || failed) {
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor: theme.colors.avatar,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text
          weight="bold"
          color={theme.colors.textStrong}
          style={{ fontSize: Math.max(10, size * 0.34), lineHeight: Math.max(12, size * 0.4) }}
        >
          {initials(name)}
        </Text>
      </View>
    );
  }

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        backgroundColor: LOGO_PAPER,
        borderWidth: 1,
        borderColor: theme.colors.hairline,
        overflow: 'hidden',
      }}
    >
      {/* `contain` y no `cover`: un logo que es un nombre escrito es apaisado,
          y recortarlo al cuadrado le come las letras de los costados. */}
      <Image
        source={{ uri }}
        resizeMode="contain"
        accessibilityLabel={`Logo de ${name}`}
        // El «invertir colores» de iOS no le da la vuelta a una marca.
        accessibilityIgnoresInvertColors
        onError={() => setFailed(true)}
        style={{ width: '100%', height: '100%' }}
      />
    </View>
  );
}

/**
 * El logo con sus dos botones: elegir (o cambiar) y quitar.
 *
 * Lo usan el alta —donde el logo espera en el teléfono hasta que el gimnasio
 * exista— y «Tu logo», donde se sube al momento. Qué hacer al elegir lo decide
 * cada pantalla; aquí solo se dibuja.
 */
export function GymLogoField({
  name,
  logoId,
  localUri,
  busy = false,
  busyLabel = 'Preparando…',
  onPick,
  onRemove,
  hint,
}: {
  readonly name: string;
  readonly logoId?: string | null;
  readonly localUri?: string | null;
  readonly busy?: boolean;
  readonly busyLabel?: string;
  readonly onPick: () => void;
  readonly onRemove: () => void;
  readonly hint?: string;
}) {
  const theme = useTheme();
  const hasLogo = localUri != null || logoId != null;

  return (
    <Row gap={14} align="center" justify="flex-start">
      <GymLogo name={name.trim().length > 0 ? name : 'Tu gimnasio'} logoId={logoId} localUri={localUri} size={72} />
      <Stack gap={8} style={{ flex: 1 }}>
        {hint === undefined ? null : (
          <Text variant="captionSmall" color={theme.colors.textSecondary}>
            {hint}
          </Text>
        )}
        {busy ? (
          <Row gap={8} justify="flex-start" style={{ height: 36 }}>
            <ActivityIndicator color={theme.colors.textSecondary} />
            <Text variant="captionSmall" color={theme.colors.textSecondary}>
              {busyLabel}
            </Text>
          </Row>
        ) : (
          <Row gap={6} justify="flex-start">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={hasLogo ? 'Cambiar el logo' : 'Elegir un logo de tus fotos'}
              onPress={onPick}
              style={({ pressed }) => ({
                height: 36,
                paddingHorizontal: 14,
                borderRadius: theme.radii.pill,
                justifyContent: 'center',
                backgroundColor: theme.colors.actionSecondary,
                borderWidth: 1,
                borderColor: theme.colors.border,
                opacity: pressed ? 0.75 : 1,
              })}
            >
              <Text variant="captionSmall" weight="semibold">
                {hasLogo ? 'Cambiar' : 'Elegir imagen'}
              </Text>
            </Pressable>
            {hasLogo ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Quitar el logo"
                onPress={onRemove}
                hitSlop={8}
                style={{ height: 36, paddingHorizontal: 10, justifyContent: 'center' }}
              >
                <Text variant="captionSmall" color={theme.colors.textTertiary}>
                  Quitar
                </Text>
              </Pressable>
            ) : null}
          </Row>
        )}
      </Stack>
    </Row>
  );
}
