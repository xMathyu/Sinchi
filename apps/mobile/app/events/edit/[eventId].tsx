/**
 * Escribir un evento.
 *
 * `nuevo` como id es la pantalla de creación: una ruta aparte obligaría a
 * mantener dos formularios iguales y el segundo siempre se queda atrás.
 *
 * Los DOS precios están uno al lado del otro a propósito, y con la etiqueta
 * diciendo a quién le toca cada uno. Es la decisión comercial entera del
 * seminario en una fila: si el de fuera paga lo mismo que el de casa, el
 * gimnasio está regalando el único día del año en que entra gente nueva.
 *
 * Publicar es un interruptor y no un botón aparte: escribir el evento el martes
 * con el precio a medias y publicarlo el viernes, cuando el invitado confirma,
 * es exactamente cómo pasa.
 */
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, Switch, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import {
  checkEventDraft,
  eventDenialMessage,
  formatPlainDate,
  parsePlainDate,
  type LocalTime,
} from '@sinchi/shared';
import { Button, Card, Eyebrow, Field, Row, Stack, Text } from '../../../src/design/primitives';
import { Screen } from '../../../src/design/screen';
import { useTheme } from '../../../src/design/theme';
import { useEvents, useToday } from '../../../src/data/hooks';
import { removeEvent, saveEvent, publishEvent } from '../../../src/data/actions';

/** Soles escritos a mano → céntimos enteros. */
function aCentimos(text: string): number | null {
  const trimmed = text.trim().replace(',', '.');
  if (trimmed.length === 0) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;

export default function EventEditorScreen() {
  const theme = useTheme();
  const hoy = useToday();
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const isNew = eventId === 'nuevo';

  // Se busca en las dos listas: un evento que ya pasó también se edita —corregir
  // el nombre del invitado después del seminario es legítimo—.
  const { events: upcoming, reload: reloadUpcoming } = useEvents({ drafts: true });
  const { events: past } = useEvents({ past: true });

  const existente = useMemo(() => {
    if (isNew) return null;
    return (
      [...(upcoming ?? []), ...(past ?? [])].find((f) => f.event.id === eventId) ?? null
    );
  }, [upcoming, past, eventId, isNew]);

  const [name, setName] = useState('');
  const [invitado, setInvitado] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [date, setDate] = useState(formatPlainDate(hoy));
  const [startTime, setStartTime] = useState('10:00');
  const [endTime, setEndTime] = useState('13:00');
  const [quota, setQuota] = useState('');
  const [memberPrice, setMemberPrice] = useState('');
  const [guestPrice, setGuestPrice] = useState('');
  const [published, setPublished] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (existente === null) return;
    const { event } = existente;
    setName(event.name);
    setInvitado(event.instructor ?? '');
    setDescripcion(event.description ?? '');
    setDate(formatPlainDate(event.date));
    setStartTime(event.startTime);
    setEndTime(event.endTime);
    setQuota(event.capacity === null ? '' : String(event.capacity));
    setMemberPrice(String(event.memberPriceCents / 100));
    setGuestPrice(String(event.guestPriceCents / 100));
    setPublished(event.status === 'published');
  }, [existente]);

  const studentCents = aCentimos(memberPrice);
  const centimosFuera = aCentimos(guestPrice);
  const quotaNumber = quota.trim().length === 0 ? null : Number(quota.trim());
  const formatoOk = DATE.test(date) && TIME.test(startTime) && TIME.test(endTime);

  const denial = useMemo(() => {
    if (!formatoOk) return null;
    if (studentCents === null || centimosFuera === null) return 'price_negative' as const;
    return checkEventDraft(
      {
        name: name,
        description: descripcion.trim().length === 0 ? null : descripcion,
        instructor: invitado.trim().length === 0 ? null : invitado,
        date: parsePlainDate(date),
        startTime: startTime as LocalTime,
        endTime: endTime as LocalTime,
        capacity: quotaNumber,
        memberPriceCents: studentCents,
        guestPriceCents: centimosFuera,
      },
      // Solo al crear: editar algo pasado es legítimo.
      isNew ? hoy : undefined,
    );
  }, [
    formatoOk, name, descripcion, invitado, date, startTime, endTime,
    quotaNumber, studentCents, centimosFuera, isNew, hoy,
  ]);

  const ready = formatoOk && denial === null && !saving;

  /**
   * Si ya intento guardar.
   *
   * El motivo estaba calculado desde siempre, pero solo se ensenaba con el
   * nombre ya escrito: el formulario recien abierto tenia el boton apagado y ni
   * una palabra de por que. Ahora el toque en el boton apagado es lo que lo
   * enciende, que es justo cuando hace falta.
   */
  const [attempted, setAttempted] = useState(false);


  async function save(): Promise<void> {
    if (!ready || studentCents === null || centimosFuera === null) return;
    setSaving(true);
    setError(null);
    try {
      await saveEvent(isNew ? null : eventId, {
        name: name.trim(),
        description: descripcion.trim().length === 0 ? null : descripcion.trim(),
        instructor: invitado.trim().length === 0 ? null : invitado.trim(),
        date: date,
        startTime: startTime,
        endTime: endTime,
        capacity: quotaNumber,
        memberPriceCents: studentCents,
        guestPriceCents: centimosFuera,
        published: published,
      });
      reloadUpcoming();
      router.back();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar el evento.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen scroll>
      <Row style={{ paddingTop: 8 }}>
        <Text variant="titleSmall" weight="bold">
          {isNew ? 'Nuevo evento' : 'Editar evento'}
        </Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={16}>
          <Text variant="body" color={theme.colors.textSecondary}>
            Cancelar
          </Text>
        </Pressable>
      </Row>

      <Stack gap={10} style={{ marginTop: 20 }}>
        <Eyebrow>Qué es</Eyebrow>
        <Card radius={theme.radii.xl}>
          <Stack gap={16}>
            <Field
              label="Nombre"
              value={name}
              onChangeText={setName}
              placeholder="Seminario de boxeo"
              hint="Es el titular que va a leer la gente en el directorio."
            />
            <Field
              label="Quién lo da"
              value={invitado}
              onChangeText={setInvitado}
              placeholder="Jorge Linares"
              optional
              hint="El invitado es lo que vende la plaza. Déjalo vacío si lo das tú."
            />
            <Field
              label="Descripción"
              value={descripcion}
              onChangeText={setDescripcion}
              placeholder="Tres horas de técnica, para todos los niveles."
              optional
            />
          </Stack>
        </Card>
      </Stack>

      <Stack gap={10} style={{ marginTop: 20 }}>
        <Eyebrow>Cuándo</Eyebrow>
        <Card radius={theme.radii.xl}>
          <Stack gap={16}>
            <Field
              label="Fecha"
              value={date}
              onChangeText={setDate}
              placeholder="2026-09-20"
              keyboardType="numbers-and-punctuation"
              error={DATE.test(date) ? undefined : 'La fecha va como 2026-09-20.'}
            />
            <Row gap={12} align="stretch">
              <View style={{ flex: 1 }}>
                <Field
                  label="Empieza"
                  value={startTime}
                  onChangeText={setStartTime}
                  placeholder="10:00"
                  keyboardType="numbers-and-punctuation"
                  error={TIME.test(startTime) ? undefined : 'Como 10:00.'}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Field
                  label="Termina"
                  value={endTime}
                  onChangeText={setEndTime}
                  placeholder="13:00"
                  keyboardType="numbers-and-punctuation"
                  error={TIME.test(endTime) ? undefined : 'Como 13:00.'}
                />
              </View>
            </Row>
          </Stack>
        </Card>
      </Stack>

      <Stack gap={10} style={{ marginTop: 20 }}>
        <Eyebrow>Cuánto cuesta y para cuántos</Eyebrow>
        <Card radius={theme.radii.xl}>
          <Stack gap={16}>
            <Row gap={12} align="stretch">
              <View style={{ flex: 1 }}>
                <Field
                  label="Tus alumnos"
                  value={memberPrice}
                  onChangeText={setMemberPrice}
                  placeholder="80"
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Field
                  label="Los de fuera"
                  value={guestPrice}
                  onChangeText={setGuestPrice}
                  placeholder="120"
                  keyboardType="decimal-pad"
                />
              </View>
            </Row>
            <Text variant="micro" color={theme.colors.textFaint}>
              En soles. Quien viene de fuera suele pagar más, y ese es el punto: el seminario es
              el día en que entra gente nueva al local.
            </Text>
            <Field
              label="Cupo"
              value={quota}
              onChangeText={setQuota}
              placeholder="30"
              keyboardType="number-pad"
              optional
              hint="Vacío es sin límite. Cuando se llene, la app deja de aceptar reservas sola."
            />
          </Stack>
        </Card>
      </Stack>

      <Stack gap={10} style={{ marginTop: 20 }}>
        <Card radius={theme.radii.xl}>
          <Row>
            <Stack gap={2} style={{ flex: 1, paddingRight: 12 }}>
              <Text variant="bodySmall" weight="semibold">
                Publicarlo
              </Text>
              <Text variant="captionSmall" color={theme.colors.textSecondary}>
                Sale en tu ficha del directorio y cualquiera puede reservar. Apagado se queda como
                borrador, para escribirlo ahora y publicarlo cuando confirme el invitado.
              </Text>
            </Stack>
            <Switch
              value={published}
              onValueChange={setPublished}
              accessibilityLabel="Publicar el evento"
              trackColor={{ true: theme.semaphore.ok, false: theme.colors.surfaceHigh }}
              thumbColor={theme.colors.ink}
            />
          </Row>
        </Card>
      </Stack>

      {(error !== null || (denial !== null && attempted)) && (
        <Card tone="sunken" borderColor={theme.semaphore.bad} style={{ marginTop: 16 }}>
          <Text variant="bodySmall" color={theme.semaphore.bad}>
            {error ?? (denial === null ? '' : eventDenialMessage(denial))}
          </Text>
        </Card>
      )}

      <Button
        label={saving ? 'Guardando…' : isNew ? 'Crear evento' : 'Guardar cambios'}
        disabled={!ready}
        style={{ marginTop: 20 }}
        onPress={() => void save()}
        onBlockedPress={saving ? undefined : () => setAttempted(true)}
      />

      {existente !== null && (
        <Stack gap={10} style={{ marginTop: 26 }}>
          <Eyebrow>Si se cae</Eyebrow>
          <Text variant="micro" color={theme.colors.textFaint}>
            {existente.seatsTaken === 0
              ? 'Nadie tiene plaza todavía, así que también puedes borrarlo del todo.'
              : `${existente.seatsTaken} ${existente.seatsTaken === 1 ? 'persona tiene' : 'personas tienen'} plaza. Al cancelarlo se quedan en la lista: son a quienes hay que avisar.`}
          </Text>

          {existente.event.status !== 'canceled' && (
            <Button
              label="Cancelar el evento"
              variant="secondary"
              onPress={() => {
                Alert.alert(
                  `Cancelar "${existente.event.name}"`,
                  existente.seatsTaken === 0
                    ? 'Dejará de ofrecerse.'
                    : `Hay ${existente.seatsTaken} con plaza. Se quedan en la lista para que puedas avisarles.`,
                  [
                    { text: 'Volver', style: 'cancel' },
                    {
                      text: 'Cancelar evento',
                      style: 'destructive',
                      onPress: () => {
                        void publishEvent(eventId, 'canceled')
                          .then(() => {
                            reloadUpcoming();
                            router.back();
                          })
                          .catch((e: unknown) =>
                            setError(e instanceof Error ? e.message : 'No se pudo cancelar.'),
                          );
                      },
                    },
                  ],
                );
              }}
            />
          )}

          {existente.seatsTaken === 0 && (
            <Button
              label="Borrar"
              variant="ghost"
              onPress={() => {
                void removeEvent(eventId)
                  .then(() => {
                    reloadUpcoming();
                    router.back();
                  })
                  .catch((e: unknown) =>
                    setError(e instanceof Error ? e.message : 'No se pudo borrar.'),
                  );
              }}
            />
          )}
        </Stack>
      )}

      <View style={{ height: 32 }} />
    </Screen>
  );
}
