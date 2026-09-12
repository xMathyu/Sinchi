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
import { useOwnerSchedules } from '../../src/data/hooks';
import {
  setScheduleActive,
  createSchedules,
  removeSchedule,
  saveSchedule,
} from '../../src/data/actions';

/**
 * Lo que el dueño teclea → `HH:MM`.
 *
 * Acepta las tres formas en que se escribe una hora en un teléfono —`1900`,
 * `19.00`, `19:00`— y rellena el cero de delante. Lo que no reconoce lo devuelve
 * tal cual: que lo rechace el dominio, con su mensaje, en vez de que esto
 * invente una hora que nadie escribió.
 */
export function normalizeTime(text: string): string {
  const trimmed = text.trim().replace(/[.\s]/g, ':');
  const digitsOnly = trimmed.replace(/\D/g, '');

  const withColon = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (withColon !== null) {
    return `${withColon[1]!.padStart(2, '0')}:${withColon[2]}`;
  }
  if (digitsOnly.length === 4) {
    return `${digitsOnly.slice(0, 2)}:${digitsOnly.slice(2)}`;
  }
  if (digitsOnly.length === 3) {
    return `0${digitsOnly.slice(0, 1)}:${digitsOnly.slice(1)}`;
  }
  return text.trim();
}

/** `"19:00"` y `"20:30"` → `"1 h 30 min"`. `null` si alguna no se entiende. */
export function duracionLegible(startTime: string, endTime: string): string | null {
  const read = (time: string): number | null => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(time);
    if (m === null) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  };

  const from = read(startTime);
  const until = read(endTime);
  if (from === null || until === null || until <= from) return null;

  const total = until - from;
  const times = Math.floor(total / 60);
  const minutos = total % 60;
  if (times === 0) return `${minutos} min`;
  if (minutos === 0) return `${times} h`;
  return `${times} h ${minutos} min`;
}

export default function ScheduleEditorScreen() {
  const theme = useTheme();
  const { scheduleId, weekday } = useLocalSearchParams<{
    scheduleId: string;
    weekday?: string;
  }>();
  const isNew = scheduleId === 'nuevo';
  const { schedules, reload } = useOwnerSchedules();

  const existente = useMemo(
    () => (isNew ? null : (schedules?.find((h) => h.schedule.id === scheduleId) ?? null)),
    [schedules, scheduleId, isNew],
  );

  const suggestedDay = Number(weekday);
  const [name, setName] = useState('');
  /**
   * Los dias marcados. Al crear pueden ser varios; al editar es siempre uno.
   *
   * Un conjunto y no un dia suelto porque la clase que se da lunes, miercoles y
   * viernes a las 19:00 es lo normal en un dojo, y escribir seis campos tres
   * veces para eso es un peaje que el tercero no paga: se abandona a medias y el
   * horario publicado queda incompleto. Lo pidieron los primeros duenos.
   *
   * Siguen siendo TRES BLOQUES en la base, no uno con tres dias. Es lo que
   * permite lo otro que pidieron en la misma frase —«puede variar la hora»—:
   * creados de golpe, al viernes se le baja la hora sin tocar el lunes.
   */
  const [days, setDays] = useState<readonly IsoWeekday[]>([
    Number.isInteger(suggestedDay) && suggestedDay >= 1 && suggestedDay <= 7
      ? (suggestedDay as IsoWeekday)
      : 1,
  ]);
  const [startTime, setStartTime] = useState('19:00');
  const [endTime, setEndTime] = useState('20:30');
  const [capacity, setCapacity] = useState('');
  const [instructor, setInstructor] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // El formulario se llena cuando llega la clase, no antes: la lista es remota y
  // el primer render ocurre con `horarios === null`.
  useEffect(() => {
    if (existente === null) return;
    const { schedule } = existente;
    setName(schedule.name);
    setDays([schedule.weekday]);
    setStartTime(schedule.startTime);
    setEndTime(schedule.endTime);
    setCapacity(schedule.capacity === null ? '' : String(schedule.capacity));
    setInstructor(schedule.instructor ?? '');
  }, [existente]);

  const trimmedCapacity = capacity.trim();
  const capacidad = trimmedCapacity.length === 0 ? null : Number(trimmedCapacity);

  const draft = {
    name: name,
    // Para validar da igual cual: lo unico que `checkScheduleDraft` mira del dia
    // es que sea de lunes a domingo, y todos los marcados lo son. El caso que
    // importa —ninguno marcado— se comprueba aparte, abajo.
    weekday: days[0] ?? 1,
    startTime: startTime,
    endTime: endTime,
    capacity: capacidad,
    instructor: instructor.trim().length === 0 ? null : instructor,
  };
  const denial = checkScheduleDraft(draft);
  const ready = denial === null && days.length > 0 && !saving;

  /**
   * Si ya intento guardar.
   *
   * El motivo estaba calculado desde siempre, pero solo se ensenaba con el
   * nombre ya escrito: el formulario recien abierto tenia el boton apagado y ni
   * una palabra de por que. Ahora el toque en el boton apagado es lo que lo
   * enciende, que es justo cuando hace falta.
   */
  const [attempted, setAttempted] = useState(false);

  /**
   * El motivo, puesto en el campo del que habla.
   *
   * `ScheduleDenial` ya dice CUAL de los cinco campos esta mal —para eso
   * devuelve un motivo y no un booleano— asi que el mensaje puede ir debajo del
   * campo en vez de en un aviso al final que obliga a adivinar a que se refiere.
   */
  const denialFor = (field: 'name' | 'hours' | 'capacity' | 'instructor'): string | undefined => {
    if (!attempted || denial === null) return undefined;
    const suyo: Record<typeof field, boolean> = {
      name: denial === 'name_too_short' || denial === 'name_too_long',
      hours:
        denial === 'time_malformed' ||
        denial === 'ends_before_start' ||
        denial === 'too_short',
      capacity: denial === 'capacity_not_integer' || denial === 'capacity_out_of_range',
      instructor: denial === 'instructor_too_long',
    };
    return suyo[field] ? scheduleDenialMessage(denial) : undefined;
  };

  const duracion = duracionLegible(startTime, endTime);

  async function save(): Promise<void> {
    if (!ready) return;
    setSaving(true);
    setError(null);
    const comun = {
      name: name.trim(),
      startTime: startTime,
      endTime: endTime,
      capacity: capacidad,
      instructor: instructor.trim().length === 0 ? null : instructor.trim(),
      active: existente?.active ?? true,
    };
    try {
      if (isNew) {
        // Una sola petición aunque sean cinco días: la api los escribe en una
        // transacción. Con cinco peticiones, la tercera puede fallar —la red de
        // un celular en un sótano es lo normal— y el horario queda a medias sin
        // que nadie lo haya decidido.
        await createSchedules({ ...comun, weekdays: days });
      } else {
        await saveSchedule(scheduleId, { ...comun, weekday: days[0]! });
      }
      reload();
      router.back();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar la clase.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen scroll>
      <Row style={{ paddingTop: 8 }}>
        <Text variant="titleSmall" weight="bold">
          {isNew ? 'Nueva clase' : 'Editar clase'}
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
            value={name}
            onChangeText={setName}
            placeholder="Muay Thai principiantes"
            hint="Sale en tu ficha del directorio. Es lo que alguien lee para saber si esta clase es para él."
            error={denialFor('name')}
          />
        </Card>
      </Stack>

      <Stack gap={10} style={{ marginTop: 20 }}>
        <Eyebrow>{isNew ? 'Qué días' : 'Qué día'}</Eyebrow>
        <Row gap={8} justify="flex-start">
          {allWeekdays().map((option) => {
            const active = days.includes(option);
            return (
              <Pressable
                key={option}
                // Al crear son casillas —se marcan varias— y al editar una
                // opción única. El rol lo dice de verdad: un lector de pantalla
                // que anuncia «radio» sobre algo que acepta cinco marcas está
                // describiendo otra pantalla.
                accessibilityRole={isNew ? 'checkbox' : 'radio'}
                accessibilityState={isNew ? { checked: active } : { selected: active }}
                accessibilityLabel={weekdayName(option)}
                onPress={() => {
                  if (!isNew) {
                    setDays([option]);
                    return;
                  }
                  setDays((posts) =>
                    posts.includes(option)
                      ? posts.filter((d) => d !== option)
                      : [...posts, option].sort((a, b) => a - b),
                  );
                }}
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 19,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: active
                    ? withAlpha(theme.semaphore.ok, 0.16)
                    : theme.colors.surfaceRaised,
                  borderWidth: 1,
                  borderColor: active ? theme.semaphore.ok : theme.colors.border,
                }}
              >
                <Text
                  variant="bodySmall"
                  weight="semibold"
                  color={active ? theme.semaphore.ok : theme.colors.textStrong}
                >
                  {weekdayInitial(option)}
                </Text>
              </Pressable>
            );
          })}
        </Row>
        {/* Que salgan varios bloques y no uno con varios días no es un detalle
            de implementación: es lo que hace posible lo otro que se pidió en la
            misma frase —«puede variar la hora»—. Creados de golpe, al viernes se
            le baja la hora sin tocar el lunes. */}
        <Text variant="micro" color={theme.colors.textFaint}>
          {!isNew
            ? 'Cada bloque es de un día. Para darla otro día más, créala de nuevo marcando ese día.'
            : days.length === 0
              ? 'Marca al menos un día.'
              : days.length === 1
                ? 'Puedes marcar varios: se publica la misma clase en cada uno.'
                : `Se publican ${days.length} clases, una por día, todas a las ${startTime}. Después puedes cambiarle la hora a una sin tocar las otras.`}
        </Text>
      </Stack>

      <Stack gap={10} style={{ marginTop: 20 }}>
        <Eyebrow>A qué hora</Eyebrow>
        <Card radius={theme.radii.xl}>
          <Row gap={12} align="flex-start">
            <View style={{ flex: 1 }}>
              <Field
                label="Empieza"
                value={startTime}
                onChangeText={setStartTime}
                onBlur={() => setStartTime((actual) => normalizeTime(actual))}
                placeholder="19:00"
                keyboardType="numbers-and-punctuation"
                error={denialFor('hours')}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                label="Termina"
                value={endTime}
                onChangeText={setEndTime}
                onBlur={() => setEndTime((actual) => normalizeTime(actual))}
                placeholder="20:30"
                keyboardType="numbers-and-punctuation"
                error={denialFor('hours')}
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
              value={capacity}
              onChangeText={setCapacity}
              placeholder="Sin límite"
              keyboardType="number-pad"
              hint="Déjalo vacío si no limitas el cupo. Es lo que corta las reservas de clase de prueba cuando se llena."
              error={denialFor('capacity')}
            />
            <Field
              label="Quién la da"
              value={instructor}
              onChangeText={setInstructor}
              placeholder="Opcional"
              autoCapitalize="words"
              error={denialFor('instructor')}
            />
          </Stack>
        </Card>
      </Stack>

      {(error !== null || ((denial !== null || days.length === 0) && attempted)) && (
        <Card tone="sunken" borderColor={theme.semaphore.bad} style={{ marginTop: 16 }}>
          <Text variant="bodySmall" color={theme.semaphore.bad}>
            {error ??
              (days.length === 0
                ? 'Marca al menos un día de la semana.'
                : denial === null
                  ? ''
                  : scheduleDenialMessage(denial))}
          </Text>
        </Card>
      )}

      <Button
        label={
          saving
            ? 'Guardando…'
            : !isNew
              ? 'Guardar cambios'
              : days.length > 1
                ? `Publicar ${days.length} clases`
                : 'Publicar clase'
        }
        disabled={!ready}
        style={{ marginTop: 20 }}
        onPress={() => void save()}
        onBlockedPress={saving ? undefined : () => setAttempted(true)}
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
              void setScheduleActive(scheduleId, !existente.active)
                .then(() => {
                  reload();
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
                      void removeSchedule(scheduleId)
                        .then(() => {
                          reload();
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
