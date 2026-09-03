/**
 * Eventos: lo que el gimnasio vende una sola vez.
 *
 * El seminario con el invitado, el taller del sábado, la clase especial. Es lo
 * tercero que un local vende —después de las mensualidades y la clase suelta— y
 * el único que le trae gente NUEVA por la puerta: un seminario con alguien
 * conocido lo llenan personas que todavía no entrenan ahí.
 *
 * Cada fila lleva el cupo delante, y no es adorno: es la única cifra que decide
 * si hay que empujar la venta o si ya no caben más. Al lado va cuántas están
 * pagadas, que es otra cosa — el sábado se presentan las reservadas, y se cobra
 * a las que faltan.
 *
 * La lista la lee todo el staff. Escribir un evento es del dueño: lleva precios.
 */
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { formatPEN, type Cents } from '@sinchi/shared';
import { withAlpha } from '@sinchi/ui';
import { Button, Card, Chip, Eyebrow, Row, Stack, Text } from '../../src/design/primitives';
import { Screen } from '../../src/design/screen';
import { useTheme } from '../../src/design/theme';
import { formatEventDate } from '../../src/lib/format';
import { useEventos } from '../../src/data/hooks';
import { useRole } from '../../src/data/session-hooks';
import type { EventoConCupo } from '../../src/data/api';

export default function EventosScreen() {
  const theme = useTheme();
  /**
   * El rol sale de la SESIÓN y no del store, y no es un detalle de estilo.
   *
   * `state.staff.role` llega con el padrón, que es una petición aparte: al abrir
   * esta pantalla directamente —desde un enlace, o antes de que cargue— el dueño
   * se encontraba el vacío diciéndole que creara un evento y sin el botón para
   * hacerlo. La sesión ya trae el rol firmado desde el primer render.
   */
  const esDueno = useRole() === 'owner';
  const [viendoPasados, setViendoPasados] = useState(false);
  const { eventos, error, cargando } = useEventos({
    past: viendoPasados,
    drafts: esDueno && !viendoPasados,
  });

  return (
    <Screen scroll>
      <Row style={{ paddingTop: 8 }}>
        <Text variant="titleSmall" weight="bold">
          Eventos
        </Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={16}>
          <Text variant="body" color={theme.colors.textSecondary}>
            Cerrar
          </Text>
        </Pressable>
      </Row>

      <Text variant="captionSmall" color={theme.colors.textSecondary} style={{ marginTop: 6 }}>
        Seminarios, talleres y clases especiales. Se venden aparte de la mensualidad y los reserva
        también gente que no entrena aquí.
      </Text>

      <Row gap={8} justify="flex-start" style={{ marginTop: 18 }}>
        <Chip label="Lo que viene" selected={!viendoPasados} onPress={() => setViendoPasados(false)} />
        <Chip label="Ya pasaron" selected={viendoPasados} onPress={() => setViendoPasados(true)} />
      </Row>

      {error !== null && (
        <Card tone="sunken" borderColor={theme.semaphore.bad} style={{ marginTop: 16 }}>
          <Text variant="bodySmall" color={theme.semaphore.bad}>
            {error}
          </Text>
        </Card>
      )}

      <Stack gap={10} style={{ marginTop: 18 }}>
        {cargando ? (
          <Text variant="bodySmall" color={theme.colors.textSecondary}>
            Trayendo los eventos…
          </Text>
        ) : (eventos?.length ?? 0) === 0 ? (
          <Card tone="sunken">
            <Stack gap={14}>
              <Text variant="bodySmall" color={theme.colors.textSecondary} align="center">
                {viendoPasados
                  ? 'Todavía no has hecho ningún evento.'
                  : 'No tienes nada programado. Un seminario con alguien conocido es la forma más rápida de que entre gente nueva al local.'}
              </Text>
              {!viendoPasados && esDueno && (
                <Button label="Crear el primero" onPress={() => router.push('/events/edit/nuevo')} />
              )}
            </Stack>
          </Card>
        ) : (
          eventos?.map((fila) => <FilaDeEvento key={fila.event.id} fila={fila} />)
        )}
      </Stack>

      {esDueno && !viendoPasados && (eventos?.length ?? 0) > 0 && (
        <Button
          label="+ Nuevo evento"
          variant="secondary"
          style={{ marginTop: 14 }}
          onPress={() => router.push('/events/edit/nuevo')}
        />
      )}

      <View style={{ height: 28 }} />
    </Screen>
  );
}

function FilaDeEvento({ fila }: { readonly fila: EventoConCupo }) {
  const theme = useTheme();
  const { event, seatsTaken, seatsLeft, paidSeats } = fila;

  const cancelado = event.status === 'canceled';
  const borrador = event.status === 'draft';
  const lleno = seatsLeft !== null && seatsLeft === 0;

  const color = cancelado
    ? theme.semaphore.bad
    : borrador
      ? theme.colors.textFaint
      : lleno
        ? theme.semaphore.warn
        : theme.semaphore.ok;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Abrir ${event.name}`}
      onPress={() => router.push(`/events/${event.id}`)}
    >
      <Card
        radius={theme.radii.lg}
        style={{ opacity: cancelado || borrador ? 0.6 : 1 }}
        borderColor={cancelado ? withAlpha(theme.semaphore.bad, 0.4) : theme.colors.hairline}
      >
        <Row align="flex-start">
          <Stack gap={3} style={{ flex: 1, paddingRight: 12 }}>
            <Text variant="heading" weight="semibold" numberOfLines={1}>
              {event.name}
            </Text>
            <Text variant="captionSmall" color={theme.colors.textSecondary} numberOfLines={1}>
              {formatEventDate(event.date)} · {event.startTime}
              {event.instructor === null ? '' : ` · ${event.instructor}`}
            </Text>

            {/* Reservadas y pagadas son cosas distintas: el sábado se presentan
                las reservadas, y a las que faltan hay que cobrarles. */}
            <Text variant="micro" color={color}>
              {cancelado
                ? 'Cancelado'
                : borrador
                  ? 'Sin publicar'
                  : seatsLeft === null
                    ? `${seatsTaken} ${seatsTaken === 1 ? 'inscrito' : 'inscritos'} · sin límite`
                    : lleno
                      ? `Lleno · ${seatsTaken} de ${seatsTaken}`
                      : `${seatsTaken} de ${seatsTaken + seatsLeft} plazas`}
              {cancelado || borrador ? '' : ` · ${paidSeats} ${paidSeats === 1 ? 'pagada' : 'pagadas'}`}
            </Text>
          </Stack>

          <Stack gap={1} style={{ alignItems: 'flex-end' }}>
            <Text variant="heading" weight="bold">
              {formatPEN(event.memberPriceCents as Cents, { withDecimals: false })}
            </Text>
            <Text variant="micro" color={theme.colors.textFaint}>
              alumnos
            </Text>
            <Text variant="micro" color={theme.colors.textFaint}>
              {formatPEN(event.guestPriceCents as Cents, { withDecimals: false })} de fuera
            </Text>
          </Stack>
        </Row>
      </Card>
    </Pressable>
  );
}
