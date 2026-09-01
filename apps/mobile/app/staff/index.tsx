/**
 * S1 · La puerta.
 *
 * Es la pantalla que el gimnasio usa más veces al día, y va antes que el modo
 * alumno en el orden de construcción (MD 11, fase 3): sin ella el local no
 * puede operar.
 *
 * En reposo NO hay cámara. El visor vivía aquí, apagado, ocupando 200px para
 * decir «apunta al QR» o «concede el permiso» — y empujaba contra los botones
 * «Últimos marcados», que es lo que el mostrador de verdad lee entre alumno y
 * alumno. La cámara se llevó a `/scan`, donde se abre a pantalla completa: es
 * cuando la merece. Escanear sigue estando a UN toque, así que la puerta no
 * perdió velocidad.
 *
 * Lo que ocupa ese sitio ahora son tres cifras del día y las dos formas de
 * marcar, como opciones y no como dos botones a lo ancho.
 *
 * Dos decisiones que se ven aquí:
 *  - la validación es LOCAL, contra el padrón en caché, funcione o no el wifi.
 *    El indicador de conexión se muestra, pero no bloquea nada;
 *  - las tres cifras salen de datos que recepción YA puede pedir. No usan
 *    `/staff/summary`, que es del dueño y responde 403 al mostrador.
 */
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useTabTrigger } from 'expo-router/ui';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import QrCode from 'lucide-react-native/icons/qr-code';
import UserRoundCheck from 'lucide-react-native/icons/user-round-check';
import type { LucideIcon } from 'lucide-react-native';
import { TZ_LIMA, isSameDay, plainDateInZone } from '@sinchi/shared';
import { withAlpha } from '@sinchi/ui';
import { Avatar, Card, Dot, Eyebrow, Row, Stack, Text } from '../../src/design/primitives';
import { EstadoVacio } from '../../src/design/empty';
import { Screen } from '../../src/design/screen';
import { useTheme } from '../../src/design/theme';
import {
  useClasesGratisDelGimnasio,
  useRecentCheckIns,
  useRefresco,
  useRoster,
  useStore,
  useToday,
} from '../../src/data/hooks';
import { setOnline } from '../../src/data/store';
import { formatClock, initials } from '../../src/lib/format';

/** Cuántos marcados se guardan en la lista. Sobra para llenar cualquier pantalla
    y el resto se desplaza: recortar a un número fijo clipaba en las chicas. */
const MAX_MARCADOS = 10;

export default function DoorScreen() {
  const theme = useTheme();
  const staff = useStore((state) => state.staff);
  const tenants = useStore((state) => state.tenants);
  const online = useStore((state) => state.online);
  const today = useToday();
  const roster = useRoster();
  const recent = useRecentCheckIns();
  const { datos: pruebas } = useClasesGratisDelGimnasio();
  // Al volver a la puerta se relee el padrón: puede haber cambiado fuera.
  useRefresco();

  // Las pestañas no se alcanzan con `router.push`: una ruta bajo `app/staff/`
  // se ENFOCA, no se apila, y este es el gancho que expo-router da para eso.
  const { switchTab } = useTabTrigger({ name: 'door' });

  const tenant = tenants.find((item) => item.id === staff.tenantId);

  /**
   * El servidor ya devuelve sólo las de hoy (`recentToday`), pero sin conexión
   * esta lista cae a las asistencias en memoria, que no están recortadas por
   * día. Se filtra aquí para que la cifra diga lo que promete el «Hoy».
   */
  const marcadosHoy = useMemo(
    () => recent.filter((marcado) => isSameDay(plainDateInZone(marcado.at, TZ_LIMA), today)).length,
    [recent, today],
  );

  const pruebasHoy = useMemo(
    () => pruebas.filter((r) => r.status !== 'canceled' && isSameDay(r.date, today)).length,
    [pruebas, today],
  );

  const conDeuda = roster.filter((e) => e.view.receivable.amountCents > 0).length;

  return (
    <Screen background={theme.colors.screenScanner}>
      <Row style={{ paddingTop: 8 }} gap={10}>
        {/* `flex: 1` y una sola linea: sin ellos, el nombre del gimnasio hace
            crecer esta columna, la linea se parte en dos y empuja el indicador
            de conexion y el avatar fuera de la pantalla. */}
        <Stack gap={1} style={styles.flexOne}>
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
            accessibilityLabel={
              online ? 'En línea. Toca para simular corte.' : 'Sin conexión. Toca para reconectar.'
            }
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

      {/* Tres cifras y nada más. Las dos que llevan a algún sitio lo dicen con
          el chevron; «marcados» no lleva a ninguna parte y por eso no lo tiene. */}
      <Stack gap={10} style={{ marginTop: 20 }}>
        <Eyebrow>Hoy</Eyebrow>
        <Row gap={8} align="stretch">
          <Cifra valor={String(marcadosHoy)} etiqueta="marcados" color={theme.colors.ink} />
          <Cifra
            valor={String(pruebasHoy)}
            etiqueta="a probar"
            color={theme.colors.ink}
            onPress={() => switchTab('trials', {})}
            accessibilityLabel={`${pruebasHoy} vienen a probar hoy. Abre la lista.`}
          />
          <Cifra
            valor={String(conDeuda)}
            etiqueta="con deuda"
            color={conDeuda > 0 ? theme.semaphore.warn : theme.colors.ink}
            onPress={() => switchTab('padron', {})}
            accessibilityLabel={`${conDeuda} alumnos con deuda. Abre el padrón.`}
          />
        </Row>
      </Stack>

      <Stack gap={10} style={{ marginTop: 18 }}>
        <Eyebrow>Marcar entrada</Eyebrow>
        <Row gap={10} align="stretch">
          {/* El QR pesa más porque es el 90% del trabajo de la puerta. Sigue a un
              toque: lo que cambió es que la cámara ya no está esperando puesta. */}
          <Opcion
            icon={QrCode}
            label="Escanear QR"
            destacada
            onPress={() => router.push('/scan')}
          />
          {/* El padrón ya es una pestaña, así que aquí solo queda el atajo que
              de verdad pertenece a la puerta: el alumno sin celular que está
              esperando delante. */}
          <Opcion
            icon={UserRoundCheck}
            label="Marcar manual"
            onPress={() => router.push('/manual')}
          />
        </Row>
      </Stack>

      {/* El vacío se lleva la región entera y no una línea suelta arriba: con la
          cámara fuera, en la puerta recién abierta quedaban 460px de aire debajo
          de «Todavía no hay marcados» — que es exactamente la pantalla rota que
          `EstadoVacio` existe para evitar. Y es el estado de CADA mañana. */}
      <View style={{ marginTop: 22, flex: 1 }}>
        {recent.length === 0 ? (
          <EstadoVacio
            titulo="Nadie ha marcado todavía"
            cuerpo="Aquí van apareciendo los alumnos conforme entran, con su hora y si se les marcó a mano."
          />
        ) : (
          <Stack gap={9} style={styles.flexOne}>
            <Eyebrow>Últimos marcados</Eyebrow>
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.marcados}
              // Sin esto, en una pantalla alta la lista corta se pega arriba y en
              // una baja no se llega a la última fila.
              style={styles.flexOne}
            >
              {recent.slice(0, MAX_MARCADOS).map((marcado) => (
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
                  <Text variant="bodySmall" weight="semibold" style={styles.flexOne}>
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
              ))}
            </ScrollView>
          </Stack>
        )}
      </View>
    </Screen>
  );
}

/** Una cifra del día. Con `onPress` lleva a la pestaña que la explica. */
function Cifra({
  valor,
  etiqueta,
  color,
  onPress,
  accessibilityLabel,
}: {
  readonly valor: string;
  readonly etiqueta: string;
  readonly color: string;
  readonly onPress?: () => void;
  readonly accessibilityLabel?: string;
}) {
  const theme = useTheme();

  const cuerpo = (
    <Card radius={theme.radii.xl} padded={false} style={styles.flexOne}>
      <Stack gap={2} style={styles.cifra}>
        <Text variant="displaySmall" weight="extrabold" color={color}>
          {valor}
        </Text>
        <Row gap={4} justify="flex-start">
          <Text variant="captionSmall" color={theme.colors.textSecondary}>
            {etiqueta}
          </Text>
          {onPress === undefined ? null : (
            <ChevronRight size={12} color={theme.colors.textTertiary} strokeWidth={2.4} />
          )}
        </Row>
      </Stack>
    </Card>
  );

  if (onPress === undefined) return cuerpo;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [styles.flexOne, { opacity: pressed ? 0.78 : 1 }]}
    >
      {cuerpo}
    </Pressable>
  );
}

/** Una de las dos formas de marcar. Opción, no botón a lo ancho. */
function Opcion({
  icon: Icon,
  label,
  destacada = false,
  onPress,
}: {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly destacada?: boolean;
  readonly onPress: () => void;
}) {
  const theme = useTheme();
  const ink = destacada ? theme.colors.actionPrimaryInk : theme.colors.ink;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        gap: 9,
        padding: 14,
        borderRadius: theme.radii.xl,
        backgroundColor: destacada ? theme.colors.actionPrimary : theme.colors.actionSecondary,
        borderWidth: StyleSheet.hairlineWidth * 2,
        borderColor: destacada ? 'transparent' : theme.colors.border,
        opacity: pressed ? 0.78 : 1,
      })}
    >
      <Icon size={22} color={ink} strokeWidth={2} />
      <Text variant="body" weight="semibold" color={ink}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flexOne: { flex: 1 },
  cifra: { paddingVertical: 14, paddingHorizontal: 13 },
  marcados: { gap: 9, paddingBottom: 4 },
});
