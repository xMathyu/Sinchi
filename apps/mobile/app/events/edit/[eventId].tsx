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
import { useEventos, useToday } from '../../../src/data/hooks';
import { eliminarEvento, guardarEvento, publicarEvento } from '../../../src/data/actions';

/** Soles escritos a mano → céntimos enteros. */
function aCentimos(texto: string): number | null {
  const limpio = texto.trim().replace(',', '.');
  if (limpio.length === 0) return null;
  const valor = Number(limpio);
  if (!Number.isFinite(valor) || valor < 0) return null;
  return Math.round(valor * 100);
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^\d{2}:\d{2}$/;

export default function EditorDeEventoScreen() {
  const theme = useTheme();
  const hoy = useToday();
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const esNuevo = eventId === 'nuevo';

  // Se busca en las dos listas: un evento que ya pasó también se edita —corregir
  // el nombre del invitado después del seminario es legítimo—.
  const { eventos: proximos, recargar: recargarProximos } = useEventos({ drafts: true });
  const { eventos: pasados } = useEventos({ past: true });

  const existente = useMemo(() => {
    if (esNuevo) return null;
    return (
      [...(proximos ?? []), ...(pasados ?? [])].find((f) => f.event.id === eventId) ?? null
    );
  }, [proximos, pasados, eventId, esNuevo]);

  const [nombre, setNombre] = useState('');
  const [invitado, setInvitado] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [fecha, setFecha] = useState(formatPlainDate(hoy));
  const [inicio, setInicio] = useState('10:00');
  const [fin, setFin] = useState('13:00');
  const [cupo, setCupo] = useState('');
  const [precioAlumno, setPrecioAlumno] = useState('');
  const [precioFuera, setPrecioFuera] = useState('');
  const [publicado, setPublicado] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (existente === null) return;
    const { event } = existente;
    setNombre(event.name);
    setInvitado(event.instructor ?? '');
    setDescripcion(event.description ?? '');
    setFecha(formatPlainDate(event.date));
    setInicio(event.startTime);
    setFin(event.endTime);
    setCupo(event.capacity === null ? '' : String(event.capacity));
    setPrecioAlumno(String(event.memberPriceCents / 100));
    setPrecioFuera(String(event.guestPriceCents / 100));
    setPublicado(event.status === 'published');
  }, [existente]);

  const centimosAlumno = aCentimos(precioAlumno);
  const centimosFuera = aCentimos(precioFuera);
  const cupoNumero = cupo.trim().length === 0 ? null : Number(cupo.trim());
  const formatoOk = FECHA.test(fecha) && HORA.test(inicio) && HORA.test(fin);

  const motivo = useMemo(() => {
    if (!formatoOk) return null;
    if (centimosAlumno === null || centimosFuera === null) return 'price_negative' as const;
    return checkEventDraft(
      {
        name: nombre,
        description: descripcion.trim().length === 0 ? null : descripcion,
        instructor: invitado.trim().length === 0 ? null : invitado,
        date: parsePlainDate(fecha),
        startTime: inicio as LocalTime,
        endTime: fin as LocalTime,
        capacity: cupoNumero,
        memberPriceCents: centimosAlumno,
        guestPriceCents: centimosFuera,
      },
      // Solo al crear: editar algo pasado es legítimo.
      esNuevo ? hoy : undefined,
    );
  }, [
    formatoOk, nombre, descripcion, invitado, fecha, inicio, fin,
    cupoNumero, centimosAlumno, centimosFuera, esNuevo, hoy,
  ]);

  const listo = formatoOk && motivo === null && !guardando;

  async function guardar(): Promise<void> {
    if (!listo || centimosAlumno === null || centimosFuera === null) return;
    setGuardando(true);
    setError(null);
    try {
      await guardarEvento(esNuevo ? null : eventId, {
        name: nombre.trim(),
        description: descripcion.trim().length === 0 ? null : descripcion.trim(),
        instructor: invitado.trim().length === 0 ? null : invitado.trim(),
        date: fecha,
        startTime: inicio,
        endTime: fin,
        capacity: cupoNumero,
        memberPriceCents: centimosAlumno,
        guestPriceCents: centimosFuera,
        published: publicado,
      });
      recargarProximos();
      router.back();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar el evento.');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Screen scroll>
      <Row style={{ paddingTop: 8 }}>
        <Text variant="titleSmall" weight="bold">
          {esNuevo ? 'Nuevo evento' : 'Editar evento'}
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
              value={nombre}
              onChangeText={setNombre}
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
              value={fecha}
              onChangeText={setFecha}
              placeholder="2026-09-20"
              keyboardType="numbers-and-punctuation"
              error={FECHA.test(fecha) ? undefined : 'La fecha va como 2026-09-20.'}
            />
            <Row gap={12} align="stretch">
              <View style={{ flex: 1 }}>
                <Field
                  label="Empieza"
                  value={inicio}
                  onChangeText={setInicio}
                  placeholder="10:00"
                  keyboardType="numbers-and-punctuation"
                  error={HORA.test(inicio) ? undefined : 'Como 10:00.'}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Field
                  label="Termina"
                  value={fin}
                  onChangeText={setFin}
                  placeholder="13:00"
                  keyboardType="numbers-and-punctuation"
                  error={HORA.test(fin) ? undefined : 'Como 13:00.'}
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
                  value={precioAlumno}
                  onChangeText={setPrecioAlumno}
                  placeholder="80"
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Field
                  label="Los de fuera"
                  value={precioFuera}
                  onChangeText={setPrecioFuera}
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
              value={cupo}
              onChangeText={setCupo}
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
              value={publicado}
              onValueChange={setPublicado}
              accessibilityLabel="Publicar el evento"
              trackColor={{ true: theme.semaphore.ok, false: theme.colors.surfaceHigh }}
              thumbColor={theme.colors.ink}
            />
          </Row>
        </Card>
      </Stack>

      {(error !== null || (motivo !== null && nombre.trim().length > 0)) && (
        <Card tone="sunken" borderColor={theme.semaphore.bad} style={{ marginTop: 16 }}>
          <Text variant="bodySmall" color={theme.semaphore.bad}>
            {error ?? (motivo === null ? '' : eventDenialMessage(motivo))}
          </Text>
        </Card>
      )}

      <Button
        label={guardando ? 'Guardando…' : esNuevo ? 'Crear evento' : 'Guardar cambios'}
        disabled={!listo}
        style={{ marginTop: 20 }}
        onPress={() => void guardar()}
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
                        void publicarEvento(eventId, 'canceled')
                          .then(() => {
                            recargarProximos();
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
                void eliminarEvento(eventId)
                  .then(() => {
                    recargarProximos();
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
