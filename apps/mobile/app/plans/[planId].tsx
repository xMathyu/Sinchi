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
import { usePlanesDelDueno } from '../../src/data/hooks';
import { archivarOReactivarPlan, eliminarPlan, guardarPlan } from '../../src/data/actions';

const TIPOS: readonly { readonly value: PlanType; readonly label: string; readonly hint: string }[] =
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

/** Soles escritos a mano → céntimos enteros. Nunca se guarda un decimal. */
function aCentimos(texto: string): number | null {
  const limpio = texto.trim().replace(',', '.');
  if (limpio.length === 0) return null;
  const valor = Number(limpio);
  if (!Number.isFinite(valor) || valor < 0) return null;
  return Math.round(valor * 100);
}

export default function EditorDePlanScreen() {
  const theme = useTheme();
  const { planId } = useLocalSearchParams<{ planId: string }>();
  const esNuevo = planId === 'nuevo';
  const { planes, recargar } = usePlanesDelDueno();

  const existente = useMemo(
    () => (esNuevo ? null : (planes?.find((p) => p.plan.id === planId) ?? null)),
    [planes, planId, esNuevo],
  );

  const [nombre, setNombre] = useState('');
  const [tipo, setTipo] = useState<PlanType>('sessions_per_week');
  const [sesiones, setSesiones] = useState('3');
  const [dias, setDias] = useState<readonly IsoWeekday[] | null>(null);
  const [precio, setPrecio] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // El formulario se llena cuando llega el plan, no antes: la lista es remota y
  // el primer render ocurre con `planes === null`.
  useEffect(() => {
    if (existente === null) return;
    const { plan } = existente;
    setNombre(plan.name);
    setTipo(plan.type);
    setSesiones(plan.sessionsPerWeek === null ? '3' : String(plan.sessionsPerWeek));
    setDias(plan.allowedDays);
    setPrecio(String(plan.priceCents / 100));
  }, [existente]);

  const centimos = aCentimos(precio);
  const llevaSesiones = tipo === 'sessions_per_week';
  const exigeDias = tipo === 'fixed_days';

  const borrador = {
    name: nombre,
    type: tipo,
    sessionsPerWeek: llevaSesiones ? Number(sesiones) : null,
    allowedDays: dias,
    priceCents: centimos ?? -1,
  };
  const motivo = centimos === null ? 'price_negative' : checkPlanDraft(borrador);
  const listo = motivo === null && !guardando;

  async function guardar(): Promise<void> {
    if (!listo || centimos === null) return;
    setGuardando(true);
    setError(null);
    try {
      await guardarPlan(esNuevo ? null : planId, {
        name: nombre.trim(),
        type: tipo,
        sessionsPerWeek: llevaSesiones ? Number(sesiones) : null,
        allowedDays: dias,
        priceCents: centimos,
        active: existente?.plan.active ?? true,
      });
      recargar();
      router.back();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar el plan.');
    } finally {
      setGuardando(false);
    }
  }

  function alternarDia(dia: IsoWeekday): void {
    setDias((actuales) => {
      const base = actuales ?? [];
      const siguiente = base.includes(dia)
        ? base.filter((d) => d !== dia)
        : [...base, dia].sort((a, b) => a - b);
      // Ningún día seleccionado se guarda como `null` («cualquier día»), que es
      // lo que significa la columna vacía. Un arreglo vacío dejaría al alumno
      // sin ningún día permitido y la puerta lo rechazaría siempre.
      return siguiente.length === 0 ? null : siguiente;
    });
  }

  return (
    <Screen scroll>
      <Row style={{ paddingTop: 8 }}>
        <Text variant="titleSmall" weight="bold">
          {esNuevo ? 'Nuevo plan' : 'Editar plan'}
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
            value={nombre}
            onChangeText={setNombre}
            placeholder="3 veces por semana"
            hint="Es lo que ve el alumno en su plan y lo que lee recepción al inscribirlo."
          />
        </Card>
      </Stack>

      <Stack gap={10} style={{ marginTop: 20 }}>
        <Eyebrow>Cómo se cobra</Eyebrow>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {TIPOS.map((opcion) => {
            const activo = opcion.value === tipo;
            return (
              <Pressable
                key={opcion.value}
                accessibilityRole="radio"
                accessibilityState={{ selected: activo }}
                onPress={() => {
                  setTipo(opcion.value);
                  // Cambiar a días fijos sin días deja un plan que no valida.
                  // Se proponen los de lunes a viernes, que es lo normal.
                  if (opcion.value === 'fixed_days' && dias === null) setDias([1, 3, 5]);
                }}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 9,
                  borderRadius: theme.radii.pill,
                  backgroundColor: activo
                    ? withAlpha(theme.semaphore.ok, 0.16)
                    : theme.colors.surfaceRaised,
                  borderWidth: 1,
                  borderColor: activo ? theme.semaphore.ok : theme.colors.border,
                }}
              >
                <Text
                  variant="caption"
                  weight="semibold"
                  color={activo ? theme.semaphore.ok : theme.colors.textStrong}
                >
                  {opcion.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text variant="micro" color={theme.colors.textFaint}>
          {TIPOS.find((t) => t.value === tipo)?.hint}
        </Text>
      </Stack>

      {llevaSesiones && (
        <Stack gap={10} style={{ marginTop: 20 }}>
          <Eyebrow>Cuántas veces por semana</Eyebrow>
          <Row gap={8} justify="flex-start">
            {[1, 2, 3, 4, 5, 6, 7].map((n) => {
              const activo = String(n) === sesiones;
              return (
                <Pressable
                  key={n}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: activo }}
                  onPress={() => setSesiones(String(n))}
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
                    {n}
                  </Text>
                </Pressable>
              );
            })}
          </Row>
        </Stack>
      )}

      <Stack gap={10} style={{ marginTop: 20 }}>
        <Eyebrow>{exigeDias ? 'Qué días' : 'Días permitidos'}</Eyebrow>
        <Row gap={8} justify="flex-start">
          {allWeekdays().map((dia) => {
            const activo = dias?.includes(dia) ?? false;
            return (
              <Pressable
                key={dia}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: activo }}
                accessibilityLabel={`Día ${dia}`}
                onPress={() => alternarDia(dia)}
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
                  {weekdayInitial(dia)}
                </Text>
              </Pressable>
            );
          })}
        </Row>
        <Text variant="micro" color={theme.colors.textFaint}>
          {dias === null
            ? exigeDias
              ? 'Un plan de días fijos necesita al menos un día.'
              : 'Sin marcar ninguno, entrena cualquier día.'
            : exigeDias
              ? 'Esos días son su cupo: no puede entrenar más veces por semana.'
              : 'Solo esos días, además del límite de sesiones.'}
        </Text>
      </Stack>

      <Stack gap={10} style={{ marginTop: 20 }}>
        <Eyebrow>Cuánto cuesta</Eyebrow>
        <Card radius={theme.radii.xl}>
          <Field
            label={`Precio en soles, ${planPriceUnit(tipo)}`}
            value={precio}
            onChangeText={setPrecio}
            placeholder="150"
            keyboardType="decimal-pad"
            hint={
              tipo === 'drop_in'
                ? 'Lo que cuesta UNA clase. No es una mensualidad: la puerta se lo pide cada día que viene.'
                : 'Lo que se le cobra cada periodo.'
            }
          />
        </Card>
      </Stack>

      {(error !== null || (motivo !== null && nombre.trim().length > 0)) && (
        <Card
          tone="sunken"
          borderColor={theme.semaphore.bad}
          style={{ marginTop: 16 }}
        >
          <Text variant="bodySmall" color={theme.semaphore.bad}>
            {error ?? (motivo === null ? '' : planDenialMessage(motivo))}
          </Text>
        </Card>
      )}

      <Button
        label={guardando ? 'Guardando…' : esNuevo ? 'Crear plan' : 'Guardar cambios'}
        disabled={!listo}
        style={{ marginTop: 20 }}
        onPress={() => void guardar()}
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
              void archivarOReactivarPlan(planId, !existente.plan.active)
                .then(() => {
                  recargar();
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
                        void eliminarPlan(planId)
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
          )}
        </Stack>
      )}

      <View style={{ height: 32 }} />
    </Screen>
  );
}
