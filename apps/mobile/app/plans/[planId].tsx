/**
 * Escribir un plan.
 *
 * Los cuatro tipos no son cuatro sabores de lo mismo, y la pantalla lo dice en
 * vez de esconderlo: al elegir "clase suelta" el precio deja de ser "al mes" y
 * pasa a ser "por clase", y desaparece el campo de sesiones. Si los campos no
 * cambian con el tipo, el dueño escribe S/ 25 pensando en una clase y le queda
 * una mensualidad de S/ 25.
 *
 * La validación es la MISMA función que usa la api (`checkPlanDraft`): el botón
 * se apaga por el motivo exacto por el que el POST habría respondido 400. Es lo
 * que evita llenar cuatro campos para que te digan que no al final.
 *
 * `nuevo` como id es la pantalla de creación. Una ruta aparte para eso obligaba
 * a mantener dos formularios iguales, y el segundo siempre se queda atrás.
 */
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import {
  allWeekdays,
  checkPlanDraft,
  planDenialMessage,
  planPriceUnit,
  weekdayInitial,
  type IsoWeekday,
  type PlanType,
} from '@sinchi/shared';
import { withAlpha } from '@sinchi/ui';
import { Button, Card, Eyebrow, Field, Row, Stack, Text } from '../../src/design/primitives';
import { Screen } from '../../src/design/screen';
import { useTheme } from '../../src/design/theme';
import { useOwnerPlans } from '../../src/data/hooks';
import { setPlanActive, removePlan, savePlan } from '../../src/data/actions';
import { aCentimos } from '../../src/lib/format';

const TYPES: readonly { readonly value: PlanType; readonly label: string; readonly hint: string }[] =
  [
    {
      value: 'sessions_per_week',
      label: 'Por semana',
      hint: 'Entrena N veces por semana. El cupo se reinicia el lunes.',
    },
    {
      value: 'unlimited',
      label: 'Ilimitado',
      hint: 'Sin límite de sesiones.',
    },
    {
      value: 'fixed_days',
      label: 'Días fijos',
      hint: 'Solo los días que elijas. Esos días SON su cupo.',
    },
    {
      value: 'drop_in',
      label: 'Clase suelta',
      hint: 'Paga cada vez que entrena. No debe mensualidad y la puerta le pide el pago del día.',
    },
  ];

export default function EditorDePlanScreen() {
  const theme = useTheme();
  const { planId } = useLocalSearchParams<{ planId: string }>();
  const isNew = planId === 'nuevo';
  const { plans, reload } = useOwnerPlans();

  const existente = useMemo(
    () => (isNew ? null : (plans?.find((p) => p.plan.id === planId) ?? null)),
    [plans, planId, isNew],
  );

  const [name, setName] = useState('');
  const [kind, setKind] = useState<PlanType>('sessions_per_week');
  const [sessions, setSessions] = useState('3');
  const [days, setDays] = useState<readonly IsoWeekday[] | null>(null);
  const [price, setPrice] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // El formulario se llena cuando llega el plan, no antes: la lista es remota y
  // el primer render ocurre con `planes === null`.
  useEffect(() => {
    if (existente === null) return;
    const { plan } = existente;
    setName(plan.name);
    setKind(plan.type);
    setSessions(plan.sessionsPerWeek === null ? '3' : String(plan.sessionsPerWeek));
    setDays(plan.allowedDays);
    setPrice(String(plan.priceCents / 100));
  }, [existente]);

  const centimos = aCentimos(price);
  const usesSessionQuota = kind === 'sessions_per_week';
  const needsDays = kind === 'fixed_days';

  const draft = {
    name: name,
    type: kind,
    sessionsPerWeek: usesSessionQuota ? Number(sessions) : null,
    allowedDays: days,
    priceCents: centimos ?? -1,
  };
  const denial = centimos === null ? 'price_negative' : checkPlanDraft(draft);
  const ready = denial === null && !saving;

  /**
   * Si ya intento guardar.
   *
   * El motivo estaba calculado desde siempre, pero solo se ensenaba con el
   * nombre ya escrito: el formulario recien abierto tenia el boton apagado y ni
   * una palabra de por que. Ahora el toque en el boton apagado es lo que lo
   * enciende, que es justo cuando hace falta.
   */
  const [attempted, setAttempted] = useState(false);

  /** El motivo, puesto en el campo del que habla. */
  const denialFor = (field: 'name' | 'price'): string | undefined => {
    if (!attempted || denial === null) return undefined;
    // Los motivos de `sessions_*` y `days_*` no salen aqui: los eligen dos
    // selectores, no campos de texto, y un selector no tiene donde pintarse en
    // rojo. Para esos sigue hablando el aviso de abajo, con el mismo mensaje.
    const suyo: Record<typeof field, boolean> = {
      name: denial === 'name_too_short' || denial === 'name_too_long',
      price:
        denial === 'price_negative' ||
        denial === 'price_not_integer' ||
        denial === 'price_too_high',
    };
    return suyo[field] ? planDenialMessage(denial) : undefined;
  };


  async function save(): Promise<void> {
    if (!ready || centimos === null) return;
    setSaving(true);
    setError(null);
    try {
      await savePlan(isNew ? null : planId, {
        name: name.trim(),
        type: kind,
        sessionsPerWeek: usesSessionQuota ? Number(sessions) : null,
        allowedDays: days,
        priceCents: centimos,
        active: existente?.plan.active ?? true,
      });
      reload();
      router.back();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar el plan.');
    } finally {
      setSaving(false);
    }
  }

  function toggleDay(day: IsoWeekday): void {
    setDays((actuales) => {
      const base = actuales ?? [];
      const nextValue = base.includes(day)
        ? base.filter((d) => d !== day)
        : [...base, day].sort((a, b) => a - b);
      // Ningún día seleccionado se guarda como `null` («cualquier día»), que es
      // lo que significa la columna vacía. Un arreglo vacío dejaría al alumno
      // sin ningún día permitido y la puerta lo rechazaría siempre.
      return nextValue.length === 0 ? null : nextValue;
    });
  }

  return (
    <Screen scroll>
      <Row style={{ paddingTop: 8 }}>
        <Text variant="titleSmall" weight="bold">
          {isNew ? 'Nuevo plan' : 'Editar plan'}
        </Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={16}>
          <Text variant="body" color={theme.colors.textSecondary}>
            Cancelar
          </Text>
        </Pressable>
      </Row>

      <Stack gap={10} style={{ marginTop: 20 }}>
        <Eyebrow>Cómo se llama</Eyebrow>
        <Card radius={theme.radii.xl}>
          <Field
            label="Nombre"
            value={name}
            onChangeText={setName}
            placeholder="3 veces por semana"
            hint="Es lo que ve el alumno en su plan y lo que lee recepción al inscribirlo."
            error={denialFor('name')}
          />
        </Card>
      </Stack>

      <Stack gap={10} style={{ marginTop: 20 }}>
        <Eyebrow>Cómo se cobra</Eyebrow>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {TYPES.map((option) => {
            const active = option.value === kind;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                onPress={() => {
                  setKind(option.value);
                  // Cambiar a días fijos sin días deja un plan que no valida.
                  // Se proponen los de lunes a viernes, que es lo normal.
                  if (option.value === 'fixed_days' && days === null) setDays([1, 3, 5]);
                }}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 9,
                  borderRadius: theme.radii.pill,
                  backgroundColor: active
                    ? withAlpha(theme.semaphore.ok, 0.16)
                    : theme.colors.surfaceRaised,
                  borderWidth: 1,
                  borderColor: active ? theme.semaphore.ok : theme.colors.border,
                }}
              >
                <Text
                  variant="caption"
                  weight="semibold"
                  color={active ? theme.semaphore.ok : theme.colors.textStrong}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text variant="micro" color={theme.colors.textFaint}>
          {TYPES.find((t) => t.value === kind)?.hint}
        </Text>
      </Stack>

      {usesSessionQuota && (
        <Stack gap={10} style={{ marginTop: 20 }}>
          <Eyebrow>Cuántas veces por semana</Eyebrow>
          <Row gap={8} justify="flex-start">
            {[1, 2, 3, 4, 5, 6, 7].map((n) => {
              const active = String(n) === sessions;
              return (
                <Pressable
                  key={n}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  onPress={() => setSessions(String(n))}
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
                    {n}
                  </Text>
                </Pressable>
              );
            })}
          </Row>
        </Stack>
      )}

      <Stack gap={10} style={{ marginTop: 20 }}>
        <Eyebrow>{needsDays ? 'Qué días' : 'Días permitidos'}</Eyebrow>
        <Row gap={8} justify="flex-start">
          {allWeekdays().map((day) => {
            const active = days?.includes(day) ?? false;
            return (
              <Pressable
                key={day}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: active }}
                accessibilityLabel={`Día ${day}`}
                onPress={() => toggleDay(day)}
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
                  {weekdayInitial(day)}
                </Text>
              </Pressable>
            );
          })}
        </Row>
        <Text variant="micro" color={theme.colors.textFaint}>
          {days === null
            ? needsDays
              ? 'Un plan de días fijos necesita al menos un día.'
              : 'Sin marcar ninguno, entrena cualquier día.'
            : needsDays
              ? 'Esos días son su cupo: no puede entrenar más veces por semana.'
              : 'Solo esos días, además del límite de sesiones.'}
        </Text>
      </Stack>

      <Stack gap={10} style={{ marginTop: 20 }}>
        <Eyebrow>Cuánto cuesta</Eyebrow>
        <Card radius={theme.radii.xl}>
          <Field
            label={`Precio en soles, ${planPriceUnit(kind)}`}
            value={price}
            onChangeText={setPrice}
            placeholder="150"
            keyboardType="decimal-pad"
            hint={
              kind === 'drop_in'
                ? 'Lo que cuesta UNA clase. No es una mensualidad: la puerta se lo pide cada día que viene.'
                : 'Lo que se le cobra cada periodo.'
            }
            error={denialFor('price')}
          />
        </Card>
      </Stack>

      {(error !== null || (denial !== null && attempted)) && (
        <Card
          tone="sunken"
          borderColor={theme.semaphore.bad}
          style={{ marginTop: 16 }}
        >
          <Text variant="bodySmall" color={theme.semaphore.bad}>
            {error ?? (denial === null ? '' : planDenialMessage(denial))}
          </Text>
        </Card>
      )}

      <Button
        label={saving ? 'Guardando…' : isNew ? 'Crear plan' : 'Guardar cambios'}
        disabled={!ready}
        style={{ marginTop: 20 }}
        onPress={() => void save()}
        onBlockedPress={saving ? undefined : () => setAttempted(true)}
      />

      {existente !== null && (
        <Stack gap={10} style={{ marginTop: 26 }}>
          <Eyebrow>Dejar de ofrecerlo</Eyebrow>
          <Text variant="micro" color={theme.colors.textFaint}>
            {existente.plan.active
              ? existente.activeMembers === 0
                ? 'Nadie lo tiene todavía, así que también puedes borrarlo del todo.'
                : `${existente.activeMembers} ${existente.activeMembers === 1 ? 'alumno lo tiene' : 'alumnos lo tienen'}. Al archivarlo dejan de verlo los nuevos, pero ellos lo conservan.`
              : 'Está archivado: no sale en el alta ni en el cambio de plan.'}
          </Text>

          <Button
            label={existente.plan.active ? 'Archivar' : 'Volver a ofrecer'}
            variant="secondary"
            onPress={() => {
              void setPlanActive(planId, !existente.plan.active)
                .then(() => {
                  reload();
                  router.back();
                })
                .catch((e: unknown) =>
                  setError(e instanceof Error ? e.message : 'No se pudo archivar.'),
                );
            }}
          />

          {existente.deletable && (
            <Button
              label="Borrar"
              variant="ghost"
              onPress={() => {
                Alert.alert(
                  `Borrar "${existente.plan.name}"`,
                  'Nadie lo tiene, así que no se pierde ningún historial. No se puede deshacer.',
                  [
                    { text: 'Cancelar', style: 'cancel' },
                    {
                      text: 'Borrar',
                      style: 'destructive',
                      onPress: () => {
                        void removePlan(planId)
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
          )}
        </Stack>
      )}

      <View style={{ height: 32 }} />
    </Screen>
  );
}
