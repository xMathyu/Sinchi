/**
 * El avatar de la cuenta, arriba a la derecha de cada pestaña.
 *
 * Vivía solo en la billetera y en la puerta, y desde el resto de pestañas no
 * había cómo llegar a Mi cuenta —corregir el nombre, cerrar sesión— sin volver
 * a la primera. Es una pieza y no nueve copias para que diga lo mismo en todas:
 * de quién es la cuenta lo decide la sesión, no cada pantalla.
 */
import type { ReactNode } from 'react';
import { Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Avatar, Row, Stack, Text } from './primitives';
import { useTheme } from './theme';
import { useStore } from '../data/hooks';
import { useSession } from '../data/session-hooks';
import { initials } from '../lib/format';

export function AccountAvatar({ size = 38 }: { readonly size?: number }) {
  const router = useRouter();
  const session = useSession();
  const userName = useStore((state) => state.user.name);
  const staffName = useStore((state) => state.staff.displayName);
  const demoRole = useStore((state) => state.role);

  // Con sesión de staff el store no tiene la billetera de nadie y `user` sigue
  // vacío: su nombre es el de su puesto. Sin ficha, el que dio al registrarse.
  const role = session.status === 'signed_in' ? session.session.role : demoRole;
  const name =
    session.status === 'unlinked'
      ? (session.fullName ?? '')
      : role === 'student'
        ? userName
        : staffName;
  const letters = initials(name);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Mi cuenta"
      hitSlop={12}
      onPress={() => router.push('/settings')}
    >
      <Avatar initials={letters.length > 0 ? letters : '·'} size={size} radius={size / 2} />
    </Pressable>
  );
}

/**
 * La cabecera de una pestaña: su título a la izquierda y la cuenta a la derecha.
 *
 * Para las que no tienen nada más arriba. Las que sí —el padrón con su «+ Alumno»,
 * la puerta con su punto de conexión, el QR con su gimnasio— ponen el avatar en
 * su propia fila en vez de pelear por el mismo sitio.
 */
export function TabHeader({
  title,
  subtitle,
}: {
  readonly title: string;
  readonly subtitle?: string;
}): ReactNode {
  const theme = useTheme();

  return (
    // Con subtítulo, el avatar se alinea con el título y no con el bloque: centrado
    // quedaba a media altura de dos líneas de texto que no son un solo renglón.
    <Row align={subtitle === undefined ? 'center' : 'flex-start'} gap={12} style={{ paddingTop: 8 }}>
      <Stack gap={3} style={{ flex: 1 }}>
        <Text variant="titleSmall" weight="bold">
          {title}
        </Text>
        {subtitle === undefined ? null : (
          <Text variant="captionSmall" color={theme.colors.textSecondary}>
            {subtitle}
          </Text>
        )}
      </Stack>
      <AccountAvatar />
    </Row>
  );
}
