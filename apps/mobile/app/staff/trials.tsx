/**
 * S4 · Clases gratis.
 *
 * La lista de posibles alumnos: gente que encontró el gimnasio en la app, eligió
 * un horario y dijo que vendría. Es la contraparte del directorio — sin esta
 * pantalla, la reserva es una fila en una tabla que nadie mira y el interesado
 * aparece un martes sin que nadie lo espere.
 *
 * Se ordena por CUÁNDO VIENEN, no por cuándo reservaron: lo que el mostrador
 * pregunta al abrirla es "¿a quién espero hoy?".
 *
 * El celular va grande y visible a propósito. Es lo único que convierte la lista
 * en algo accionable: quien no aparece se merece una llamada, y quien vino,
 * también.
 */
import { useState } from 'react';
import { Alert, Linking, Pressable, Switch, View } from 'react-native';
import { formatPENShort, type TrialBooking, type TrialBookingStatus } from '@sinchi/shared';
import { withAlpha } from '@sinchi/ui';
import {
  Badge,
  Card,
  Chip,
  Eyebrow,
  Row,
  SegmentedControl,
  Stack,
  Text,
} from '../../src/design/primitives';
import { Screen } from '../../src/design/screen';
import { EstadoSinConexion, EstadoVacio } from '../../src/design/empty';
import { CargandoSeccion } from '../../src/design/loading';
import { useTheme } from '../../src/design/theme';
import { useClasesGratisDelGimnasio, useOfreceClaseGratis, useStore } from '../../src/data/hooks';
import { setTrialClassEnabled, setTrialStatus } from '../../src/data/api';
import { formatWeekdayAndDay } from '../../src/lib/format';

type Vista = 'proximas' | 'pasadas';

export default function TrialsScreen() {
  const theme = useTheme();
  const [vista, setVista] = useState<Vista>('proximas');
  const {
    datos: reservas,
    cargando,
    error,
    recargar,
  } = useClasesGratisDelGimnasio(vista === 'pasadas');

  const vigentes = reservas.filter((reserva) => reserva.status !== 'canceled');

  return (
    <Screen scroll>
      <Stack gap={3} style={{ paddingTop: 8 }}>
        <Text variant="titleSmall" weight="bold">
          Clases de prueba
        </Text>
        <Text variant="captionSmall" color={theme.colors.textSecondary}>
          Quién viene a probar. Todavía no son alumnos de nadie.
        </Text>
      </Stack>

      <Interruptor />

      <View style={{ marginTop: 18 }}>
        <SegmentedControl<Vista>
          options={[
            { value: 'proximas', label: 'Por venir' },
            { value: 'pasadas', label: 'Historial' },
          ]}
          value={vista}
          onChange={setVista}
        />
      </View>

      {cargando && reservas.length === 0 ? (
        <View style={{ minHeight: 320 }}>
          <CargandoSeccion texto="Trayendo la lista…" />
        </View>
      ) : error !== null && reservas.length === 0 ? (
        <View style={{ minHeight: 320 }}>
          <EstadoSinConexion error={error} onReintentar={recargar} />
        </View>
      ) : vigentes.length === 0 ? (
        <View style={{ minHeight: 320 }}>
          <EstadoVacio
            titulo={vista === 'proximas' ? 'Nadie viene a probar todavía' : 'Sin historial'}
            cuerpo={
              vista === 'proximas'
                ? 'Cuando alguien reserve su clase de prueba desde la app, aparecerá aquí con el día, la hora y su WhatsApp.'
                : 'Aquí quedan las clases de prueba que ya pasaron, con quién vino y quién no.'
            }
            pie="Tu gimnasio sale en la lista de la app mientras la clase gratis esté activa."
          />
        </View>
      ) : (
        <Stack gap={12} style={{ marginTop: 20 }}>
          <Eyebrow>
            {vigentes.length} {vigentes.length === 1 ? 'persona' : 'personas'}
          </Eyebrow>
          {vigentes.map((reserva) => (
            <TrialCard key={reserva.id} reserva={reserva} onCambio={recargar} />
          ))}
        </Stack>
      )}
    </Screen>
  );
}

/**
 * El interruptor de la clase gratis.
 *
 * No todos los gimnasios la dan, y esa es una decisión suya: hasta ahora la
 * columna existía en la base y no había forma de tocarla sin un UPDATE a mano,
 * que es lo mismo que no poder.
 *
 * Apagarlo NO cancela lo ya reservado —esa promesa ya se hizo, y borrarla deja a
 * alguien presentándose en un local que no lo espera—: corta lo de adelante, el
 * gimnasio deja de aparecer con horas para probar.
 */
function Interruptor() {
  const theme = useTheme();
  const rol = useStore((estado) => estado.staff.role);
  const { datos: remoto, error, recargar } = useOfreceClaseGratis();
  const [local, setLocal] = useState<boolean | null>(null);
  const [guardando, setGuardando] = useState(false);

  // Lo que se pinta es lo último decidido aquí, si lo hay; si no, lo que dijo el
  // servidor. `null` = todavía no se sabe, y el interruptor no puede adivinar.
  const activa = local ?? remoto;
  const esDueño = rol === 'owner';

  const cambiar = (valor: boolean): void => {
    setLocal(valor);
    setGuardando(true);

    void setTrialClassEnabled(valor)
      .then((salida) => setLocal(salida.trialClassEnabled))
      .catch((causa: unknown) => {
        // Se revierte: dejar el interruptor donde el dedo lo puso, cuando el
        // servidor no lo aceptó, es mentirle al dueño sobre su propio gimnasio.
        setLocal(null);
        recargar();
        Alert.alert(
          'No se pudo cambiar',
          causa instanceof Error ? causa.message : 'Intenta de nuevo.',
        );
      })
      .finally(() => setGuardando(false));
  };

  return (
    <Card radius={theme.radii.xl} style={{ marginTop: 18 }}>
      <Stack gap={10}>
        <Row align="flex-start" style={{ gap: 12 }}>
          <Stack gap={5} style={{ flex: 1 }}>
            <Text variant="bodySmall" weight="semibold">
              Aceptamos reservas de clase de prueba
            </Text>
            <Text variant="captionSmall" color={theme.colors.textSecondary}>
              {activa === false
                ? 'Tu gimnasio sale en la lista de la app con sus horarios y precios, pero sin clase de prueba.'
                : 'Quien te encuentre en la app puede reservar una clase para conocerte, el día y la hora que elija. Si tu prueba tiene precio, lo cobras al llegar.'}
            </Text>
          </Stack>
          <Switch
            value={activa === true}
            onValueChange={cambiar}
            disabled={!esDueño || activa === null || guardando}
            accessibilityLabel="Ofrecer la primera clase gratis"
            trackColor={{ true: theme.semaphore.ok, false: theme.colors.surfaceHigh }}
            thumbColor={theme.colors.ink}
          />
        </Row>

        {!esDueño ? (
          <Text variant="micro" color={theme.colors.textFaint}>
            Solo el dueño puede cambiarlo.
          </Text>
        ) : activa === false ? (
          <Text variant="micro" color={theme.colors.textFaint}>
            Las clases ya reservadas siguen en pie: abajo están.
          </Text>
        ) : null}

        {error !== null && activa === null ? (
          <Text variant="micro" color={theme.semaphore.alert}>
            {error}
          </Text>
        ) : null}
      </Stack>
    </Card>
  );
}

function TrialCard({
  reserva,
  onCambio,
}: {
  readonly reserva: TrialBooking;
  readonly onCambio: () => void;
}) {
  const theme = useTheme();
  const [guardando, setGuardando] = useState(false);

  const marcar = (status: TrialBookingStatus): void => {
    // Ya está en ese estado, o hay una petición en vuelo: no se manda otra.
    if (guardando || reserva.status === status) return;
    setGuardando(true);
    void setTrialStatus(reserva.id, status)
      .then(() => onCambio())
      .catch((causa: unknown) => {
        Alert.alert(
          'No se pudo guardar',
          causa instanceof Error ? causa.message : 'Intenta de nuevo.',
        );
      })
      .finally(() => setGuardando(false));
  };

  const color =
    reserva.status === 'attended'
      ? theme.semaphore.ok
      : reserva.status === 'no_show'
        ? theme.semaphore.alert
        : theme.colors.textTertiary;

  return (
    <Card accent={color} radius={theme.radii.xl}>
      <Stack gap={10}>
        <Row align="flex-start" style={{ gap: 10 }}>
          <Stack gap={2} style={{ flex: 1 }}>
            <Text variant="heading" weight="bold" numberOfLines={1}>
              {reserva.fullName}
            </Text>
            {/* El celular ABRE WhatsApp. Es por donde se coordina de verdad en
                este mercado —confirmar, mover la hora, decir cómo llegar— y sin
                esto había que copiar el número a mano justo cuando el mostrador
                quiere responder rápido. */}
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={`Escribir por WhatsApp a ${reserva.fullName}`}
              hitSlop={8}
              onPress={() => {
                const digitos = reserva.phone.replace(/\D/g, '');
                if (digitos.length < 9) return;
                void Linking.openURL(`https://wa.me/${digitos}`).catch(() => {
                  Alert.alert('No se pudo abrir WhatsApp', reserva.phone);
                });
              }}
            >
              <Text variant="captionSmall" color={theme.semaphore.ok}>
                {reserva.phone} · WhatsApp
              </Text>
            </Pressable>
          </Stack>
          {reserva.status === 'booked' ? null : (
            <Badge
              label={reserva.status === 'attended' ? 'VINO' : 'NO VINO'}
              color={color}
              background={withAlpha(color, 0.14)}
            />
          )}
        </Row>

        <Text variant="bodySmall">
          {formatWeekdayAndDay(reserva.date)} · {reserva.startTime}–{reserva.endTime}
        </Text>
        <Row justify="flex-start" gap={8}>
          <Text variant="captionSmall" color={theme.colors.textTertiary}>
            {reserva.className}
          </Text>
          {reserva.priceCents > 0 ? (
            <Text variant="captionSmall" color={theme.colors.textSecondary}>
              · cobrar {formatPENShort(reserva.priceCents)}
            </Text>
          ) : null}
        </Row>

        {/* Marcar quién vino es lo que convierte la lista en un dato: sin esto,
            el gimnasio no sabe si la clase gratis le trae alumnos o curiosos. */}
        <Row justify="flex-start" style={{ gap: 8, marginTop: 2 }}>
          {/* Chips, y no dos textos con uno «apagado».
              
              El apagado era invisible: distinguía `textSecondary` (#9C9CA6) de
              `textFaint` (#8C8C95), y esos dos dejaron de ser dos colores cuando
              la rampa de grises se aplanó al suelo que pasa AA — `textFaint` y
              `textTertiary` son hoy el MISMO hex. Asi que tocar «Vino» en una
              reserva que ya estaba en «vino» no hacia nada y nada en la pantalla
              explicaba por que: se leia como un boton roto.
              
              El chip elegido se pinta con su color del semaforo, que es el mismo
              lenguaje que la insignia de arriba y el que ya usa el padron para
              «Activos / Bajas». Las dos siguen tocables porque el mostrador se
              equivoca y tiene que poder corregir. */}
          <Chip
            label="Vino"
            selected={reserva.status === 'attended'}
            selectedColor={theme.semaphore.ok}
            onPress={() => marcar('attended')}
          />
          <Chip
            label="No vino"
            selected={reserva.status === 'no_show'}
            selectedColor={theme.semaphore.alert}
            onPress={() => marcar('no_show')}
          />
        </Row>
      </Stack>
    </Card>
  );
}
