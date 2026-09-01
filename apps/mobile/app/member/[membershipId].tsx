/**
 * Ficha del alumno para el mostrador.
 *
 * Faltaba, y el padrón iba directo a cobrar: la única forma de mirar a alguien
 * era empezar a cobrarle. En el mostrador la pregunta suele ser otra —«¿por qué
 * no pasa?», «¿cuándo pagó la última vez?», «¿cuántas sesiones le quedan?»— y
 * responderla desde la pantalla de cobro obliga a cancelar para no dejar un
 * cargo a medias.
 *
 * El historial se pide aquí y no en el padrón a propósito: `/staff/roster`
 * devuelve el gimnasio entero con su semáforo, y traer los cargos y asistencias
 * de cada uno para pintar una lista serían sesenta peticiones. Se piden al abrir
 * a UNA persona, que es cuando de verdad se necesitan.
 */
import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { formatPEN, weekdayName, type Cents } from '@sinchi/shared';
import { semaphoreStyle, withAlpha } from '@sinchi/ui';
import {
  Badge,
  Button,
  Card,
  Divider,
  Eyebrow,
  Row,
  SegmentedControl,
  Stack,
  Text,
} from '../../src/design/primitives';
import { PhotoCircle } from '../../src/design/photo';
import { Screen } from '../../src/design/screen';
import { useTheme } from '../../src/design/theme';
import { usePlanesDelGimnasio, useStaffMember } from '../../src/data/hooks';
import { railLabel, type MembershipView } from '../../src/data/store';
import { marcarAsistencia, reactivarSuscripcion } from '../../src/data/actions';
import { formatCheckInMoment, formatLongDate, formatShortDate } from '../../src/lib/format';

type Pestana = 'attendance' | 'payments';

export default function MemberScreen() {
  const theme = useTheme();
  const { membershipId } = useLocalSearchParams<{ membershipId: string }>();
  const ficha = useStaffMember(membershipId);

  if (ficha.view === null) {
    return (
      <Screen>
        <Cabecera />
        <View style={{ flex: 1, justifyContent: 'center', gap: 14 }}>
          {ficha.cargando ? (
            <ActivityIndicator color={theme.colors.ink} />
          ) : (
            <Text variant="bodySmall" color={theme.colors.textSecondary} align="center">
              {ficha.error ?? 'No se encontró a este alumno en el padrón.'}
            </Text>
          )}
          {ficha.error !== null && !ficha.cargando ? (
            <Button label="Reintentar" variant="secondary" onPress={ficha.recargar} />
          ) : null}
        </View>
      </Screen>
    );
  }

  return <Ficha view={ficha.view} parcial={ficha.parcial} error={ficha.error} />;
}

function Cabecera() {
  const theme = useTheme();
  return (
    <Row style={{ paddingTop: 8 }}>
      <Text variant="titleSmall" weight="bold">
        Ficha del alumno
      </Text>
      <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={16}>
        <Text variant="body" color={theme.colors.textSecondary}>
          Cerrar
        </Text>
      </Pressable>
    </Row>
  );
}

function Ficha({
  view,
  parcial,
  error,
}: {
  readonly view: MembershipView;
  readonly parcial: boolean;
  readonly error: string | null;
}) {
  const theme = useTheme();
  const [pestana, setPestana] = useState<Pestana>('attendance');
  const [marcando, setMarcando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const semaphore = semaphoreStyle(theme, view.level);
  const { quota, receivable, delinquency, plan, user } = view;
  const cancelada = view.subscription.status === 'canceled';

  const asistencias = [...view.attendances].sort(
    (a, b) => b.checkedInAt.getTime() - a.checkedInAt.getTime(),
  );
  const cargos = [...view.charges].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return (
    <Screen scroll>
      <Cabecera />

      <Stack gap={14} style={{ marginTop: 18, alignItems: 'center' }}>
        <PhotoCircle
          name={user.name}
          photoUrl={user.photoUrl}
          size={116}
          ringColor={withAlpha(semaphore.color, 0.55)}
          ringWidth={4}
        />
        <Stack gap={6} style={{ alignItems: 'center' }}>
          <Text variant="title" weight="bold" align="center">
            {user.name}
          </Text>
          <Text variant="captionSmall" color={theme.colors.textSecondary}>
            DNI {user.documentId} · {view.tenant.name}
          </Text>
          <Badge label={view.badge.toUpperCase()} color={semaphore.color} />
        </Stack>
      </Stack>

      {/* Lo primero que se pregunta en la puerta no es el plan, es si pasa. */}
      <Card
        radius={theme.radii.xl}
        accent={semaphore.color}
        borderColor={withAlpha(semaphore.color, 0.3)}
        style={{ marginTop: 20 }}
      >
        <Stack gap={4}>
          <Text variant="heading" weight="semibold" color={semaphore.color}>
            {cancelada
              ? 'Dado de baja'
              : delinquency.canTrain
                ? 'Puede entrenar'
                : 'No puede entrenar'}
          </Text>
          <Text variant="captionSmall" color={theme.colors.textSecondary}>
            {motivo(view)}
          </Text>
        </Stack>
      </Card>

      <Row gap={10} style={{ marginTop: 12 }} align="stretch">
        <Dato
          label="Cupo semanal"
          value={quota.limit === null ? 'Sin límite' : `${quota.used} de ${quota.limit}`}
          hint={quota.limit === null ? 'plan ilimitado' : 'se reinicia el lunes'}
        />
        <Dato
          label="Renueva"
          value={formatShortDate(view.subscription.nextBillingDate)}
          hint={`gracia de ${view.tenant.graceDays} días`}
        />
      </Row>

      <Stack gap={10} style={{ marginTop: 18 }}>
        <Eyebrow>Plan y contacto</Eyebrow>
        <Card padded={false} radius={16}>
          <Linea label="Plan" value={`${plan.name} · ${formatPEN(plan.priceCents)}`} />
          <Linea
            label="Días permitidos"
            value={
              plan.allowedDays === null
                ? 'cualquier día'
                : plan.allowedDays.map((d) => weekdayName(d).slice(0, 3)).join(', ')
            }
          />
          {view.pendingPlan === null ? null : (
            <Linea
              label="Cambio pendiente"
              value={`${view.pendingPlan.name} desde el ${formatLongDate(view.subscription.nextBillingDate)}`}
            />
          )}
          <Linea label="Teléfono" value={user.phone} />
          <Linea label="Correo" value={user.email ?? 'sin correo'} last />
        </Card>
      </Stack>

      {receivable.due ? (
        <Card
          radius={theme.radii.xl}
          borderColor={withAlpha(theme.semaphore.bad, 0.3)}
          style={{ marginTop: 18 }}
        >
          <Row align="center">
            <Stack gap={3} style={{ flex: 1 }}>
              <Eyebrow color={theme.semaphore.bad}>Debe</Eyebrow>
              <Text variant="captionSmall" color={theme.colors.textSecondary}>
                {receivable.periodsOwed} {receivable.periodsOwed === 1 ? 'periodo' : 'periodos'} ·
                desde el {formatLongDate(receivable.fromDate)}
                {receivable.capped ? ' (tope aplicado)' : ''}
              </Text>
            </Stack>
            <Text variant="titleSmall" weight="extrabold" color={theme.semaphore.bad}>
              {formatPEN(receivable.amountCents as Cents)}
            </Text>
          </Row>
        </Card>
      ) : null}

      {cancelada ? (
        <Reactivar membershipId={view.membership.id} nombre={user.name} />
      ) : (
        <Stack gap={10} style={{ marginTop: 18 }}>
          <Button
            label={receivable.due ? 'Cobrar' : 'Registrar pago'}
            onPress={() =>
              router.push({
                pathname: '/charge/[membershipId]',
                params: { membershipId: view.membership.id },
              })
            }
          />
          <Button
            label={marcando ? 'Marcando…' : 'Marcar asistencia'}
            variant="secondary"
            disabled={marcando}
            onPress={() => {
              setMarcando(true);
              setAviso(null);
              void marcarAsistencia({
                membershipId: view.membership.id,
                method: 'manual',
                // El mostrador marca a quien tiene delante aunque deba, y aunque
                // sea fuera de horario: el profe alarga la clase, el alumno llega
                // tarde y entrena igual. Queda auditado como excepción a nombre de
                // quien está de turno, con su motivo. Antes solo forzaba lo que la
                // ficha ya veía —mora y cupo—, así que un marcado fuera de horario
                // se perdía sin registrarse.
                overrideDenial: true,
              })
                .then((salida) =>
                  setAviso(
                    !salida.registrada
                      ? `No se registró: ${salida.titulo.toLowerCase()}.`
                      : salida.repetida
                        ? 'Ya estaba marcado hoy.'
                        : 'Asistencia marcada.',
                  ),
                )
                .catch((causa: unknown) =>
                  setAviso(causa instanceof Error ? causa.message : 'No se pudo marcar.'),
                )
                .finally(() => setMarcando(false));
            }}
          />
          {aviso === null ? null : (
            <Text variant="micro" color={theme.colors.textSecondary} align="center">
              {aviso}
            </Text>
          )}
        </Stack>
      )}

      <View style={{ marginTop: 22 }}>
        <SegmentedControl<Pestana>
          value={pestana}
          onChange={setPestana}
          options={[
            { value: 'attendance', label: 'Asistencia' },
            { value: 'payments', label: 'Pagos' },
          ]}
        />
      </View>

      {/* Un historial vacío y un historial que no se pudo traer se ven igual y
          significan lo contrario, así que se dicen distinto. */}
      {parcial ? (
        <Card tone="sunken" radius={16} style={{ marginTop: 12 }}>
          <Text variant="captionSmall" color={theme.colors.textSecondary} align="center">
            {error ?? 'Sin conexión'} · se muestra lo que hay en la caché del padrón, sin historial.
          </Text>
        </Card>
      ) : pestana === 'attendance' ? (
        <Lista
          vacia="Todavía no tiene asistencias registradas."
          filas={asistencias.map((a) => ({
            id: a.id,
            izquierda: formatCheckInMoment(a.checkedInAt),
            derecha: a.overrodeDenial ? 'excepción' : a.method === 'manual' ? 'manual' : 'QR',
            alerta: a.overrodeDenial,
          }))}
        />
      ) : (
        <Lista
          vacia="Todavía no hay pagos registrados."
          filas={cargos.map((c) => ({
            id: c.id,
            izquierda: `${formatPEN(c.amountCents)} · ${railLabel(c.rail)}`,
            derecha: formatShortDate(c.periodStart ?? view.subscription.periodStart),
            alerta: c.status !== 'succeeded',
          }))}
        />
      )}
    </Screen>
  );
}

/** Una línea de por qué el semáforo está donde está. */
function motivo(view: MembershipView): string {
  const { delinquency, receivable, quota } = view;
  if (view.subscription.status === 'canceled') {
    return 'Canceló su suscripción. La ficha y el historial se conservan: puede volver sin registrarse otra vez.';
  }
  if (delinquency.status === 'suspended') {
    return `Suspendido por mora: ${delinquency.daysPastDue} días desde el vencimiento.`;
  }
  if (receivable.due) {
    return `En gracia: le ${delinquency.graceDaysLeft === 1 ? 'queda 1 día' : `quedan ${delinquency.graceDaysLeft} días`} antes de que el escáner deje de validar.`;
  }
  if (quota.exhausted) return 'Al día, pero agotó el cupo de esta semana.';
  if (quota.isLastSession) return 'Al día. Le queda la última sesión de la semana.';
  return 'Al día. Nada pendiente.';
}

function Dato({
  label,
  value,
  hint,
}: {
  readonly label: string;
  readonly value: string;
  readonly hint: string;
}) {
  const theme = useTheme();
  return (
    <Card radius={theme.radii.xl} style={{ flex: 1 }}>
      <Stack gap={3}>
        <Eyebrow>{label}</Eyebrow>
        <Text variant="titleSmall" weight="extrabold">
          {value}
        </Text>
        <Text variant="micro" color={theme.colors.textFaint}>
          {hint}
        </Text>
      </Stack>
    </Card>
  );
}

function Linea({
  label,
  value,
  last = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly last?: boolean;
}) {
  const theme = useTheme();
  return (
    <>
      <Row style={{ paddingHorizontal: 16, paddingVertical: 13 }} gap={12}>
        <Text variant="bodySmall" color={theme.colors.textSecondary}>
          {label}
        </Text>
        <Text variant="bodySmall" weight="semibold" style={{ flex: 1 }} align="right">
          {value}
        </Text>
      </Row>
      {last ? null : <Divider />}
    </>
  );
}

interface Fila {
  readonly id: string;
  readonly izquierda: string;
  readonly derecha: string;
  readonly alerta: boolean;
}

function Lista({ filas, vacia }: { readonly filas: readonly Fila[]; readonly vacia: string }) {
  const theme = useTheme();

  if (filas.length === 0) {
    return (
      <Card tone="sunken" radius={16} style={{ marginTop: 12 }}>
        <Text variant="bodySmall" color={theme.colors.textSecondary} align="center">
          {vacia}
        </Text>
      </Card>
    );
  }

  return (
    <Card padded={false} radius={16} style={{ marginTop: 12 }}>
      {filas.map((fila, index) => (
        <View key={fila.id}>
          <Row style={{ paddingHorizontal: 16, paddingVertical: 13 }} gap={12}>
            <Text variant="bodySmall" weight="semibold" style={{ flex: 1 }}>
              {fila.izquierda}
            </Text>
            <Text
              variant="captionSmall"
              color={fila.alerta ? theme.semaphore.alert : theme.colors.textTertiary}
            >
              {fila.derecha}
            </Text>
          </Row>
          {index === filas.length - 1 ? null : <Divider />}
        </View>
      ))}
    </Card>
  );
}

/**
 * Devuelve a alguien que canceló.
 *
 * No es un alta. La ficha, los pagos y las asistencias siguen ahí —cancelar
 * apaga la suscripción, no borra a la persona— y por eso la api tiene una ruta
 * aparte. Registrarlo de nuevo le crearía una segunda identidad en el mismo
 * local, con el historial partido en dos.
 */
function Reactivar({
  membershipId,
  nombre,
}: {
  readonly membershipId: string;
  readonly nombre: string;
}) {
  const theme = useTheme();
  const planes = usePlanesDelGimnasio();
  const [planId, setPlanId] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Sin esto la reinscripción no daba señal de nada: el botón volvía a estar
  // pulsable, la ficha tardaba en recargarse, y el segundo toque chocaba contra
  // el índice de una suscripción por membresía. Salía como error del servidor.
  const [listo, setListo] = useState(false);

  const elegido = planes.find((plan) => plan.id === planId) ?? null;

  if (listo) {
    return (
      <Card
        radius={theme.radii.xl}
        borderColor={withAlpha(theme.semaphore.ok, 0.35)}
        style={{ marginTop: 18 }}
      >
        <Stack gap={4}>
          <Text variant="heading" weight="semibold" color={theme.semaphore.ok}>
            Reinscrito
          </Text>
          <Text variant="captionSmall" color={theme.colors.textSecondary}>
            {nombre} vuelve a estar en el padrón con su historial completo. Cóbrale la mensualidad
            para que el escáner valide su QR.
          </Text>
        </Stack>
      </Card>
    );
  }

  return (
    <Stack gap={10} style={{ marginTop: 18 }}>
      <Eyebrow>Volver a inscribir</Eyebrow>
      {planes.length === 0 ? (
        <Text variant="captionSmall" color={theme.colors.textSecondary}>
          Trayendo los planes del gimnasio…
        </Text>
      ) : (
        planes.map((plan) => {
          const activo = plan.id === planId;
          return (
            <Pressable
              key={plan.id}
              accessibilityRole="radio"
              accessibilityState={{ selected: activo }}
              onPress={() => setPlanId(plan.id)}
            >
              <Card
                radius={theme.radii.lg}
                borderColor={activo ? theme.semaphore.ok : theme.colors.hairline}
              >
                <Row>
                  <Text variant="heading" weight="semibold">
                    {plan.name}
                  </Text>
                  <Text variant="heading" weight="semibold">
                    {formatPEN(plan.priceCents)}
                  </Text>
                </Row>
              </Card>
            </Pressable>
          );
        })
      )}

      <Button
        label={
          guardando
            ? 'Reinscribiendo…'
            : elegido === null
              ? 'Elige un plan'
              : `Reinscribir a ${nombre.trim().split(/\s+/)[0] ?? nombre} en ${elegido.name}`
        }
        disabled={elegido === null || guardando}
        onPress={() => {
          if (elegido === null || guardando) return;
          setGuardando(true);
          setError(null);
          void reactivarSuscripcion(membershipId, elegido.id)
            .then(() => setListo(true))
            .catch((causa: unknown) => {
              setError(causa instanceof Error ? causa.message : 'No se pudo reinscribir.');
            })
            .finally(() => setGuardando(false));
        }}
      />
      {error === null ? null : (
        <Text variant="captionSmall" color={theme.semaphore.bad} align="center">
          {error}
        </Text>
      )}
    </Stack>
  );
}
