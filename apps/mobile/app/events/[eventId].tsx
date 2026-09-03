/**
 * El día del evento: quién tiene plaza, quién pagó y quién vino.
 *
 * Es la pantalla que el mostrador tiene abierta mientras entra la gente, y por
 * eso las tres cifras de arriba son las tres preguntas que le hacen: cuántos
 * caben, cuántos vienen y cuánto falta por cobrar.
 *
 * Cada fila distingue **reservada** de **pagada**, que no son lo mismo: el
 * sábado se presentan las reservadas y a las que faltan hay que cobrarles ahí
 * mismo. Por eso «Cobrar» está en la fila y no detrás de otra pantalla.
 *
 * Y dice quién es alumno y quién viene de fuera, porque explica por qué dos
 * personas de la misma lista pagan distinto.
 */
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { formatPEN, type Cents } from '@sinchi/shared';
import { withAlpha } from '@sinchi/ui';
import { Button, Card, Eyebrow, Row, Stack, Text } from '../../src/design/primitives';
import { Screen } from '../../src/design/screen';
import { useTheme } from '../../src/design/theme';
import { useEvento } from '../../src/data/hooks';
import { useRole } from '../../src/data/session-hooks';
import { cobrarPlazaDeEvento, marcarPlaza } from '../../src/data/actions';
import type { PlazaDto } from '../../src/data/api';
import { formatEventDate } from '../../src/lib/format';

export default function EventoScreen() {
  const theme = useTheme();
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  // De la sesión: el del store llega con el padrón y esta pantalla se abre sola.
  const esDueno = useRole() === 'owner';
  const { evento, plazas, error, cargando, recargar } = useEvento(eventId);
  const [trabajando, setTrabajando] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const vivas = plazas.filter((p) => p.registration.status !== 'canceled');
  const porCobrar = vivas.filter((p) => !p.paid);
  const recaudado = vivas
    .filter((p) => p.paid)
    .reduce((sum, p) => sum + p.registration.priceCents, 0);

  async function accion(id: string, fn: () => Promise<unknown>): Promise<void> {
    setTrabajando(id);
    setAviso(null);
    try {
      await fn();
      recargar();
    } catch (e: unknown) {
      setAviso(e instanceof Error ? e.message : 'No se pudo hacer.');
    } finally {
      setTrabajando(null);
    }
  }

  return (
    <Screen scroll>
      <Row style={{ paddingTop: 8 }}>
        <Text variant="titleSmall" weight="bold" numberOfLines={1} style={{ flex: 1 }}>
          {evento?.event.name ?? 'Evento'}
        </Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={16}>
          <Text variant="body" color={theme.colors.textSecondary}>
            Cerrar
          </Text>
        </Pressable>
      </Row>

      {cargando ? (
        <Text variant="bodySmall" color={theme.colors.textSecondary} style={{ marginTop: 20 }}>
          Trayendo el evento…
        </Text>
      ) : error !== null || evento === null ? (
        <Card tone="sunken" borderColor={theme.semaphore.bad} style={{ marginTop: 20 }}>
          <Text variant="bodySmall" color={theme.semaphore.bad}>
            {error ?? 'No se encontró el evento.'}
          </Text>
        </Card>
      ) : (
        <>
          <Text variant="captionSmall" color={theme.colors.textSecondary} style={{ marginTop: 6 }}>
            {formatEventDate(evento.event.date)} · {evento.event.startTime}–{evento.event.endTime}
            {evento.event.instructor === null ? '' : ` · ${evento.event.instructor}`}
          </Text>

          {evento.event.status === 'canceled' && (
            <Card
              tone="sunken"
              borderColor={withAlpha(theme.semaphore.bad, 0.4)}
              style={{ marginTop: 14 }}
            >
              <Text variant="bodySmall" color={theme.semaphore.bad}>
                Cancelado. La lista se conserva para que puedas avisarle a quien tenía plaza.
              </Text>
            </Card>
          )}

          {evento.event.status === 'draft' && (
            <Card tone="sunken" style={{ marginTop: 14 }}>
              <Text variant="bodySmall" color={theme.colors.textSecondary}>
                Sin publicar: todavía no sale en el directorio y nadie puede reservar.
              </Text>
            </Card>
          )}

          {/* Las tres preguntas del mostrador, en el orden en que las hace. */}
          <Row gap={10} align="stretch" style={{ marginTop: 18 }}>
            <Metrica
              valor={
                evento.seatsLeft === null
                  ? String(evento.seatsTaken)
                  : `${evento.seatsTaken}/${evento.seatsTaken + evento.seatsLeft}`
              }
              etiqueta={evento.seatsLeft === null ? 'inscritos' : 'plazas'}
              color={
                evento.seatsLeft !== null && evento.seatsLeft === 0
                  ? theme.semaphore.warn
                  : theme.colors.ink
              }
            />
            <Metrica
              valor={formatPEN(recaudado as Cents, { withDecimals: false })}
              etiqueta="cobrado"
              color={theme.semaphore.ok}
            />
            <Metrica
              valor={String(porCobrar.length)}
              etiqueta={porCobrar.length === 1 ? 'por cobrar' : 'por cobrar'}
              color={porCobrar.length > 0 ? theme.semaphore.warn : theme.colors.ink}
            />
          </Row>

          {esDueno && (
            <Button
              label="Editar el evento"
              variant="secondary"
              style={{ marginTop: 14 }}
              onPress={() => router.push(`/events/edit/${eventId}`)}
            />
          )}

          {aviso !== null && (
            <Card tone="sunken" borderColor={theme.semaphore.bad} style={{ marginTop: 14 }}>
              <Text variant="bodySmall" color={theme.semaphore.bad}>
                {aviso}
              </Text>
            </Card>
          )}

          <Stack gap={10} style={{ marginTop: 24 }}>
            <Row>
              <Eyebrow>Quién viene</Eyebrow>
              <Text variant="micro" color={theme.colors.textFaint}>
                {vivas.length} {vivas.length === 1 ? 'persona' : 'personas'}
              </Text>
            </Row>

            {vivas.length === 0 ? (
              <Card tone="sunken">
                <Text variant="bodySmall" color={theme.colors.textSecondary} align="center">
                  Nadie se ha inscrito todavía. Al publicarlo sale en tu ficha del directorio y lo
                  puede reservar cualquiera, sea alumno tuyo o no.
                </Text>
              </Card>
            ) : (
              vivas.map((plaza) => (
                <FilaDePlaza
                  key={plaza.registration.id}
                  plaza={plaza}
                  ocupado={trabajando === plaza.registration.id}
                  onCobrar={() =>
                    void accion(plaza.registration.id, () =>
                      cobrarPlazaDeEvento(plaza.registration.id, 'cash'),
                    )
                  }
                  onVino={() =>
                    void accion(plaza.registration.id, () =>
                      marcarPlaza(
                        plaza.registration.id,
                        plaza.registration.status === 'attended' ? 'booked' : 'attended',
                      ),
                    )
                  }
                />
              ))
            )}
          </Stack>

          <View style={{ height: 28 }} />
        </>
      )}
    </Screen>
  );
}

function FilaDePlaza({
  plaza,
  ocupado,
  onCobrar,
  onVino,
}: {
  readonly plaza: PlazaDto;
  readonly ocupado: boolean;
  readonly onCobrar: () => void;
  readonly onVino: () => void;
}) {
  const theme = useTheme();
  const { registration: r, paid, isMember } = plaza;
  const vino = r.status === 'attended';

  return (
    <Card
      radius={theme.radii.lg}
      borderColor={vino ? withAlpha(theme.semaphore.ok, 0.35) : theme.colors.hairline}
    >
      <Stack gap={12}>
        <Row align="flex-start">
          <Stack gap={2} style={{ flex: 1, paddingRight: 12 }}>
            <Text variant="bodySmall" weight="semibold" numberOfLines={1}>
              {r.fullName}
            </Text>
            <Text variant="micro" color={theme.colors.textFaint} numberOfLines={1}>
              {r.phone} · {isMember ? 'alumno del local' : 'viene de fuera'}
            </Text>
          </Stack>
          <Stack gap={1} style={{ alignItems: 'flex-end' }}>
            <Text variant="bodySmall" weight="bold">
              {formatPEN(r.priceCents as Cents, { withDecimals: false })}
            </Text>
            <Text
              variant="micro"
              color={paid ? theme.semaphore.ok : theme.semaphore.warn}
            >
              {paid ? 'pagada' : 'sin pagar'}
            </Text>
          </Stack>
        </Row>

        <Row gap={8} justify="flex-start">
          {/* Cobrar solo cuando falta: un botón que no hace nada es peor que
              ninguno, y aquí se toca con la persona delante. */}
          {!paid && (
            <Button
              label={ocupado ? 'Cobrando…' : 'Cobrar en efectivo'}
              variant="secondary"
              disabled={ocupado}
              style={{ flex: 1 }}
              onPress={onCobrar}
            />
          )}
          <Button
            label={vino ? 'Vino ✓' : 'Marcar que vino'}
            variant={vino ? 'accent' : 'ghost'}
            accentColor={withAlpha(theme.semaphore.ok, 0.2)}
            accentInk={theme.semaphore.ok}
            disabled={ocupado}
            style={{ flex: 1 }}
            onPress={onVino}
          />
        </Row>
      </Stack>
    </Card>
  );
}

function Metrica({
  valor,
  etiqueta,
  color,
}: {
  readonly valor: string;
  readonly etiqueta: string;
  readonly color: string;
}) {
  const theme = useTheme();
  return (
    <Card radius={theme.radii.lg} tone="sunken" style={{ flex: 1 }}>
      <Stack gap={1}>
        <Text variant="heading" weight="bold" color={color} numberOfLines={1}>
          {valor}
        </Text>
        <Text variant="micro" color={theme.colors.textFaint}>
          {etiqueta}
        </Text>
      </Stack>
    </Card>
  );
}
