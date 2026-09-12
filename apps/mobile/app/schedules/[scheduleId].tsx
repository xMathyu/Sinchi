/**
 * Escribir una clase del horario.
 *
 * La validación es la MISMA función que usa la api (`checkScheduleDraft`): el
 * botón se apaga por el motivo exacto por el que el POST habría respondido 400.
 * Es lo que evita llenar cuatro campos para que te digan que no al final.
 *
 * `nuevo` como id es la pantalla de creación, igual que en planes. Una ruta
 * aparte para eso obligaba a mantener dos formularios iguales, y el segundo
 * siempre se queda atrás. Acepta `?weekday=3` para llegar con el día puesto
 * desde el hueco del martes.
 *
 * Las horas van en campos de texto y no en un selector nativo a propósito: el
 * selector es una dependencia nativa —otro `prebuild`, otro binario— para
 * escribir cuatro dígitos que el dueño ya se sabe de memoria. Lo que sí hace
 * falta es que «1900» y «19.00» acaben valiendo `19:00`, y eso lo hace
 * `normalizaHora` al salir del campo.
 */
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import {
  allWeekdays,
  checkScheduleDraft,
  scheduleDenialMessage,
  weekdayInitial,
  weekdayName,
  type IsoWeekday,
} from '@sinchi/shared';
import { withAlpha } from '@sinchi/ui';
import { Button, Card, Eyebrow, Field, Row, Stack, Text } from '../../src/design/primitives';
import { Screen } from '../../src/design/screen';
import { useTheme } from '../../src/design/theme';
import { useHorariosDelDueno } from '../../src/data/hooks';
import {
  archivarOReactivarHorario,
  eliminarHorario,
  guardarHorario,
} from '../../src/data/actions';

/**
 * Lo que el dueño teclea → `HH:MM`.
 *
 * Acepta las tres formas en que se escribe una hora en un teléfono —`1900`,
 * `19.00`, `19:00`— y rellena el cero de delante. Lo que no reconoce lo devuelve
 * tal cual: que lo rechace el dominio, con su mensaje, en vez de que esto
 * invente una hora que nadie escribió.
 */
export function normalizaHora(texto: string): string {
  const limpio = texto.trim().replace(/[.\s]/g, ':');
  const soloDigitos = limpio.replace(/\D/g, '');

  const conDosPuntos = /^(\d{1,2}):(\d{2})$/.exec(limpio);
  if (conDosPuntos !== null) {
    return `${conDosPuntos[1]!.padStart(2, '0')}:${conDosPuntos[2]}`;
  }
  if (soloDigitos.length === 4) {
    return `${soloDigitos.slice(0, 2)}:${soloDigitos.slice(2)}`;
  }
  if (soloDigitos.length === 3) {
    return `0${soloDigitos.slice(0, 1)}:${soloDigitos.slice(1)}`;
  }
  return texto.trim();
}

/** `"19:00"` y `"20:30"` → `"1 h 30 min"`. `null` si alguna no se entiende. */
export function duracionLegible(inicio: string, fin: string): string | null {
  const leer = (hora: string): number | null => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(hora);
    if (m === null) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  };

  const desde = leer(inicio);
  const hasta = leer(fin);
  if (desde === null || hasta === null || hasta <= desde) return null;

  const total = hasta - desde;
  const horas = Math.floor(total / 60);
  const minutos = total % 60;
  if (horas === 0) return `${minutos} min`;
  if (minutos === 0) return `${horas} h`;
  return `${horas} h ${minutos} min`;
}

export default function EditorDeHorarioScreen() {
  const theme = useTheme();
  const { scheduleId, weekday } = useLocalSearchParams<{
    scheduleId: string;
    weekday?: string;
  }>();
  const esNuevo = scheduleId === 'nuevo';
  const { horarios, recargar } = useHorariosDelDueno();

  const existente = useMemo(
    () => (esNuevo ? null : (horarios?.find((h) => h.schedule.id === scheduleId) ?? null)),
    [horarios, scheduleId, esNuevo],
  );

  const diaSugerido = Number(weekday);
  const [nombre, setNombre] = useState('');
  const [dia, setDia] = useState<IsoWeekday>(
    Number.isInteger(diaSugerido) && diaSugerido >= 1 && diaSugerido <= 7
      ? (diaSugerido as IsoWeekday)
      : 1,
  );
  const [inicio, setInicio] = useState('19:00');
  const [fin, setFin] = useState('20:30');
  const [aforo, setAforo] = useState('');
  const [profesor, setProfesor] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // El formulario se llena cuando llega la clase, no antes: la lista es remota y
  // el primer render ocurre con `horarios === null`.
  useEffect(() => {
    if (existente === null) return;
    const { schedule } = existente;
    setNombre(schedule.name);
    setDia(schedule.weekday);
    setInicio(schedule.startTime);
    setFin(schedule.endTime);
    setAforo(schedule.capacity === null ? '' : String(schedule.capacity));
    setProfesor(schedule.instructor ?? '');
  }, [existente]);

  const aforoLimpio = aforo.trim();
  const capacidad = aforoLimpio.length === 0 ? null : Number(aforoLimpio);

  const borrador = {
    name: nombre,
    weekday: dia,
    startTime: inicio,
    endTime: fin,
    capacity: capacidad,
    instructor: profesor.trim().length === 0 ? null : profesor,
  };
  const motivo = checkScheduleDraft(borrador);
  const listo = motivo === null && !guardando;

  /**
   * Si ya intento guardar.
   *
   * El motivo estaba calculado desde siempre, pero solo se ensenaba con el
   * nombre ya escrito: el formulario recien abierto tenia el boton apagado y ni
   * una palabra de por que. Ahora el toque en el boton apagado es lo que lo
   * enciende, que es justo cuando hace falta.
   */
  const [intentado, setIntentado] = useState(false);

  /**
   * El motivo, puesto en el campo del que habla.
   *
   * `ScheduleDenial` ya dice CUAL de los cinco campos esta mal —para eso
   * devuelve un motivo y no un booleano— asi que el mensaje puede ir debajo del
   * campo en vez de en un aviso al final que obliga a adivinar a que se refiere.
   */
  const fallaDe = (campo: 'nombre' | 'horas' | 'aforo' | 'profesor'): string | undefined => {
    if (!intentado || motivo === null) return undefined;
    const suyo: Record<typeof campo, boolean> = {
      nombre: motivo === 'name_too_short' || motivo === 'name_too_long',
      horas:
        motivo === 'time_malformed' ||
        motivo === 'ends_before_start' ||
        motivo === 'too_short',
      aforo: motivo === 'capacity_not_integer' || motivo === 'capacity_out_of_range',
      profesor: motivo === 'instructor_too_long',
    };
    return suyo[campo] ? scheduleDenialMessage(motivo) : undefined;
  };

  const duracion = duracionLegible(inicio, fin);

  async function guardar(): Promise<void> {
    if (!listo) return;
    setGuardando(true);
    setError(null);
    try {
      await guardarHorario(esNuevo ? null : scheduleId, {
        name: nombre.trim(),
        weekday: dia,
        startTime: inicio,
        endTime: fin,
        capacity: capacidad,
        instructor: profesor.trim().length === 0 ? null : profesor.trim(),
        active: existente?.active ?? true,
      });
      recargar();
      router.back();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar la clase.');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Screen scroll>
      <Row style={{ paddingTop: 8 }}>
        <Text variant="titleSmall" weight="bold">
          {esNuevo ? 'Nueva clase' : 'Editar clase'}
        </Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={16}>
          <Text variant="body" color={theme.colors.textSecondary}>
            Cancelar
          </Text>
        </Pressable>
      </Row>

      <Stack gap={10} style={{ marginTop: 20 }}>
        <Eyebrow>Qué se entrena</Eyebrow>
        <Card radius={theme.radii.xl}>
          <Field
            label="Nombre de la clase"
            value={nombre}
            onChangeText={setNombre}
            placeholder="Muay Thai principiantes"
            hint="Sale en tu ficha del directorio. Es lo que alguien lee para saber si esta clase es para él."
            error={fallaDe('nombre')}
          />
        </Card>
      </Stack>

      <Stack gap={10} style={{ marginTop: 20 }}>
        <Eyebrow>Qué día</Eyebrow>
        <Row gap={8} justify="flex-start">
          {allWeekdays().map((opcion) => {
            const activo = opcion === dia;
            return (
              <Pressable
                key={opcion}
                accessibilityRole="radio"
                accessibilityState={{ selected: activo }}
                accessibilityLabel={weekdayName(opcion)}
                onPress={() => setDia(opcion)}
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 19,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: activo
                    ? withAlpha(theme.semaphore.ok, 0.16)
                    : theme.colors.surfaceRaised,
                  borderWidth: 1,
                  borderColor: activo ? theme.semaphore.ok : theme.colors.border,
                }}
              >
                <Text
                  variant="bodySmall"
                  weight="semibold"
                  color={activo ? theme.semaphore.ok : theme.colors.textStrong}
                >
                  {weekdayInitial(opcion)}
                </Text>
              </Pressable>
            );
          })}
        </Row>
        {/* Un bloque es de UN día. La clase que se repite martes y jueves son dos
            bloques, y así es como se puede cambiar la hora del jueves sin tocar
            la del martes. */}
        <Text variant="micro" color={theme.colors.textFaint}>
          Una clase por día. Si la das martes y jueves, escríbela dos veces: así puedes
          cambiarle la hora a una sin tocar la otra.
        </Text>
      </Stack>

      <Stack gap={10} style={{ marginTop: 20 }}>
        <Eyebrow>A qué hora</Eyebrow>
        <Card radius={theme.radii.xl}>
          <Row gap={12} align="flex-start">
            <View style={{ flex: 1 }}>
              <Field
                label="Empieza"
                value={inicio}
                onChangeText={setInicio}
                onBlur={() => setInicio((actual) => normalizaHora(actual))}
                placeholder="19:00"
                keyboardType="numbers-and-punctuation"
                error={fallaDe('horas')}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                label="Termina"
                value={fin}
                onChangeText={setFin}
                onBlur={() => setFin((actual) => normalizaHora(actual))}
                placeholder="20:30"
                keyboardType="numbers-and-punctuation"
                error={fallaDe('horas')}
              />
            </View>
          </Row>
        </Card>
        <Text variant="micro" color={theme.colors.textFaint}>
          {duracion === null
            ? 'En hora local del gimnasio, formato 24 horas.'
            : `Dura ${duracion}. La puerta valida con media hora de margen antes y después.`}
        </Text>
      </Stack>

      <Stack gap={10} style={{ marginTop: 20 }}>
        <Eyebrow>Aforo y profesor</Eyebrow>
        <Card radius={theme.radii.xl}>
          <Stack gap={14}>
            <Field
              label="Cuánta gente cabe"
              value={aforo}
              onChangeText={setAforo}
              placeholder="Sin límite"
              keyboardType="number-pad"
              hint="Déjalo vacío si no limitas el cupo. Es lo que corta las reservas de clase de prueba cuando se llena."
              error={fallaDe('aforo')}
            />
            <Field
              label="Quién la da"
              value={profesor}
              onChangeText={setProfesor}
              placeholder="Opcional"
              autoCapitalize="words"
              error={fallaDe('profesor')}
            />
          </Stack>
        </Card>
      </Stack>

      {(error !== null || (motivo !== null && intentado)) && (
        <Card tone="sunken" borderColor={theme.semaphore.bad} style={{ marginTop: 16 }}>
          <Text variant="bodySmall" color={theme.semaphore.bad}>
            {error ?? (motivo === null ? '' : scheduleDenialMessage(motivo))}
          </Text>
        </Card>
      )}

      <Button
        label={guardando ? 'Guardando…' : esNuevo ? 'Publicar clase' : 'Guardar cambios'}
        disabled={!listo}
        style={{ marginTop: 20 }}
        onPress={() => void guardar()}
        onBlockedPress={guardando ? undefined : () => setIntentado(true)}
      />

      {existente !== null && (
        <Stack gap={10} style={{ marginTop: 26 }}>
          <Eyebrow>Quitarla del horario</Eyebrow>
          <Text variant="micro" color={theme.colors.textFaint}>
            {existente.active
              ? existente.upcomingTrials === 0
                ? 'Sacarla la esconde de tu ficha y de la puerta, y la puedes devolver cuando quieras.'
                : `${existente.upcomingTrials} ${existente.upcomingTrials === 1 ? 'persona viene' : 'personas vienen'} a probar en esta clase. Su reserva sigue en pie con la hora que le dijiste; lo que dejas de ofrecer es de aquí en adelante.`
              : 'Está fuera del horario: no sale en tu ficha ni valida en la puerta.'}
          </Text>

          <Button
            label={existente.active ? 'Sacar del horario' : 'Volver a ofrecerla'}
            variant="secondary"
            onPress={() => {
              void archivarOReactivarHorario(scheduleId, !existente.active)
                .then(() => {
                  recargar();
                  router.back();
                })
                .catch((e: unknown) =>
                  setError(e instanceof Error ? e.message : 'No se pudo cambiar.'),
                );
            }}
          />

          {/* Se puede borrar SIEMPRE, al revés que un plan: lo que apunta a este
              bloque —asistencias y reservas— lleva copiada la clase y la hora,
              así que no se pierde ningún historial. */}
          <Button
            label="Borrar"
            variant="ghost"
            onPress={() => {
              Alert.alert(
                `Borrar "${existente.schedule.name}"`,
                existente.upcomingTrials === 0
                  ? 'Desaparece de tu horario. No se puede deshacer.'
                  : `${existente.upcomingTrials} ${existente.upcomingTrials === 1 ? 'persona sigue esperada' : 'personas siguen esperadas'} a esa hora: su reserva se conserva con la clase y la hora que le dijiste. No se puede deshacer.`,
                [
                  { text: 'Cancelar', style: 'cancel' },
                  {
                    text: 'Borrar',
                    style: 'destructive',
                    onPress: () => {
                      void eliminarHorario(scheduleId)
                        .then(() => {
                          recargar();
                          router.back();
                        })
                        .catch((e: unknown) =>
                          setError(e instanceof Error ? e.message : 'No se pudo borrar.'),
                        );
                    },
                  },
                ],
              );
            }}
          />
        </Stack>
      )}

      <View style={{ height: 32 }} />
    </Screen>
  );
}
