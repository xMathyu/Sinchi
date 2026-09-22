/**
 * La web y las redes del gimnasio: los cuatro campos para escribirlas, y la
 * lista que las abre desde la ficha.
 *
 * Los campos juzgan con `checkGymLink`, la misma regla con la que la api va a
 * decidir, así que el botón de guardar se apaga por la misma razón exacta por la
 * que el POST respondería 400.
 */
import { useState } from 'react';
import { Alert, Linking, Pressable } from 'react-native';
import AtSign from 'lucide-react-native/icons/at-sign';
import ExternalLink from 'lucide-react-native/icons/external-link';
import Globe from 'lucide-react-native/icons/globe';
import {
  checkGymLink,
  displayGymLink,
  editableGymLink,
  gymLinkDenialMessage,
  GYM_LINK_KINDS,
  GYM_LINK_LABELS,
  type GymLinkKind,
  type GymLinks,
} from '@sinchi/shared';
import { Card, Eyebrow, Field, Row, Stack, Text } from './primitives';
import { useTheme } from './theme';

/** Lo que se teclea: un texto por campo, vacío si no tiene. */
export type GymLinksDraft = Readonly<Record<GymLinkKind, string>>;

export const EMPTY_LINKS_DRAFT: GymLinksDraft = { website: '', instagram: '', facebook: '', tiktok: '' };

/** Lo guardado, como borrador para editarlo. Ver `editableGymLink`. */
export function draftFromLinks(links: GymLinks): GymLinksDraft {
  const draft: Record<GymLinkKind, string> = { ...EMPTY_LINKS_DRAFT };
  for (const kind of GYM_LINK_KINDS) {
    const url = links[kind];
    draft[kind] = url === null ? '' : editableGymLink(kind, url);
  }
  return draft;
}

const PLACEHOLDERS: Readonly<Record<GymLinkKind, string>> = {
  website: 'midojo.pe',
  instagram: '@midojo',
  facebook: 'facebook.com/midojo',
  tiktok: '@midojo',
};

const HINTS: Readonly<Record<GymLinkKind, string>> = {
  website: 'Tu página, si tienes una.',
  instagram: 'Tu usuario, o el enlace de tu perfil.',
  facebook: 'El enlace de tu página, o su usuario.',
  tiktok: 'Tu usuario, o el enlace de tu perfil.',
};

/**
 * Los cuatro campos.
 *
 * El motivo de un campo se dice al salir de él, o cuando ya intentó guardar
 * (`showAll`): pintar en rojo «midoj» mientras escribe «midojo.pe» es regañarle
 * por no haber terminado.
 */
export function GymLinksFields({
  values,
  onChange,
  editable = true,
  showAll = false,
}: {
  readonly values: GymLinksDraft;
  readonly onChange: (next: GymLinksDraft) => void;
  readonly editable?: boolean;
  readonly showAll?: boolean;
}) {
  const [touched, setTouched] = useState<ReadonlySet<GymLinkKind>>(new Set());

  return (
    <Stack gap={14}>
      {GYM_LINK_KINDS.map((kind) => {
        const denial = checkGymLink(kind, values[kind]);
        const visible = denial !== null && (showAll || touched.has(kind));
        return (
          <Field
            key={kind}
            label={`${GYM_LINK_LABELS[kind]} (opcional)`}
            value={values[kind]}
            onChangeText={(text) => onChange({ ...values, [kind]: text })}
            onBlur={() => setTouched((previous) => new Set(previous).add(kind))}
            placeholder={PLACEHOLDERS[kind]}
            hint={HINTS[kind]}
            error={visible ? gymLinkDenialMessage(denial) : undefined}
            keyboardType={kind === 'website' || kind === 'facebook' ? 'url' : 'default'}
            autoCapitalize="none"
            editable={editable}
            optional
          />
        );
      })}
    </Stack>
  );
}

/** El primer motivo de los cuatro campos, o `null` si se pueden guardar. */
export function linksDraftDenial(values: GymLinksDraft): string | null {
  for (const kind of GYM_LINK_KINDS) {
    const denial = checkGymLink(kind, values[kind]);
    if (denial !== null) return gymLinkDenialMessage(denial);
  }
  return null;
}

/**
 * La web y las redes en la ficha del gimnasio, cada una abre la suya.
 *
 * Sin ninguna no se pinta nada: un bloque «Web y redes» vacío parece que la app
 * no cargó, igual que el de la dirección.
 */
export function GymLinksList({ links }: { readonly links: GymLinks | undefined }) {
  const theme = useTheme();
  if (links === undefined) return null;
  const present = GYM_LINK_KINDS.filter((kind) => links[kind] !== null);
  if (present.length === 0) return null;

  return (
    <Stack gap={12} style={{ marginTop: 24 }}>
      <Eyebrow>Web y redes</Eyebrow>
      <Card padded={false} radius={theme.radii.xl}>
        {present.map((kind, index) => {
          const url = links[kind]!;
          const Icon = kind === 'website' ? Globe : AtSign;
          return (
            <Pressable
              key={kind}
              accessibilityRole="link"
              accessibilityLabel={`Abrir ${GYM_LINK_LABELS[kind]}: ${displayGymLink(kind, url)}`}
              onPress={() => {
                void Linking.openURL(url).catch(() => {
                  // Un enlace que no abre no puede quedar en silencio: quien lo
                  // toca está decidiendo si va, y un botón mudo se lee como que la
                  // app está rota.
                  Alert.alert(`No se pudo abrir ${GYM_LINK_LABELS[kind]}`, displayGymLink(kind, url));
                });
              }}
              style={({ pressed }) => ({
                paddingHorizontal: 16,
                paddingVertical: 14,
                borderTopWidth: index === 0 ? 0 : 1,
                borderTopColor: theme.colors.hairline,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Row gap={12} justify="flex-start">
                <Icon size={18} color={theme.colors.textSecondary} />
                <Stack gap={1} style={{ flex: 1 }}>
                  <Text variant="captionSmall" color={theme.colors.textSecondary}>
                    {GYM_LINK_LABELS[kind]}
                  </Text>
                  <Text variant="bodySmall" weight="semibold" numberOfLines={1}>
                    {displayGymLink(kind, url)}
                  </Text>
                </Stack>
                <ExternalLink size={16} color={theme.colors.textFaint} />
              </Row>
            </Pressable>
          );
        })}
      </Card>
    </Stack>
  );
}
