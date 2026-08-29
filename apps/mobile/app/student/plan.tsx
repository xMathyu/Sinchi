/**
 * A3 · Mi plan y cupo semanal.
 *
 * El cupo se muestra derivado, contando asistencias de la semana ISO: no hay
 * contador guardado que pueda desincronizarse (MD 4.3). Los dias permitidos se
 * pintan siempre, incluso en planes ilimitados, porque es la pregunta que el
 * alumno hace en la puerta.
 */
import { useMemo, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import {
  allWeekdays,
  formatPENShort,
  isoWeekday,
  weekdayInitial,
  weekdayName,
  type IsoWeekday,
} from '@sinchi/shared';
import { semaphoreStyle, withAlpha } from '@sinchi/ui';
import { Button, Card, Divider, Eyebrow, Row, Stack, Text } from '../../src/design/primitives';
import { Screen } from '../../src/design/screen';
import { EstadoSinConexion, EstadoVacio } from '../../src/design/empty';
import { useTheme } from '../../src/design/theme';
import { useErrorDeCarga, useStore, useToday, useWallet } from '../../src/data/hooks';
import { railLabel, type MembershipView } from '../../src/data/store';
import { cancelarSuscripcion } from '../../src/data/actions';
import { formatShortDate } from '../../src/lib/format';

export default function PlanScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ membershipId?: string }>();
  const activeTenantId = useStore((state) => state.activeTenantId);
  const wallet = useWallet();
  const { error: errorDeCarga, reintentar } = useErrorDeCarga();

  const entry =
    wallet.find((item) => item.membership.id === params.membershipId) ??
    wallet.find((item) => item.tenant.id === activeTenantId) ??
    wallet[0];

  if (entry === undefined) {
    // Un fallo de red y una cuenta sin nada NO son lo mismo, y decirle "todavía
    // no tienes un plan" a quien sí lo tiene se lee como que perdió sus datos.
    if (errorDeCarga !== null) {
      return (
        <Screen>
          <EstadoSinConexion error={errorDeCarga} onReintentar={reintentar} />
        </Screen>
      );
    }
    return (
      <Screen>
        <EstadoVacio
          titulo="Todavía no tienes un plan"
          cuerpo="Cuando te inscribas en un gimnasio verás aquí tu plan, tu cupo de la semana y cuándo te toca renovar."
          pie="Si cancelaste y quieres volver, pídelo en el mostrador: tu ficha y tu historial siguen ahí."
        />
      </Screen>
    );
  }

  const semaphore = semaphoreStyle(theme, entry.level);

  return (
    <Screen scroll>
      <Row justify="flex-start" gap={12} style={{ paddingTop: 10 }}>
        <Text variant="titleSmall" weight="bold">
          {entry.tenant.name}
        </Text>
      </Row>

      <Card radius={theme.radii.xxl} style={{ marginTop: 18 }}>
        <Stack gap={18}>
          <Row align="flex-start">
            <Stack gap={3}>
              <Eyebrow>Plan actual</Eyebrow>
              <Text variant="displaySmall" weight="extrabold">
                {entry.plan.name}
              </Text>
            </Stack>
            <Stack gap={0} style={{ alignItems: 'flex-end' }}>
              <Text variant="titleSmall" weight="bold">
                {formatPENShort(entry.plan.priceCents)}
              </Text>
              <Text variant="micro" color={theme.colors.textTertiary}>
                al mes
              </Text>
            </Stack>
          </Row>

          <Divider />
          <QuotaBlock entry={entry} />
        </Stack>
      </Card>

      <SemanaYHorario entry={entry} />

      <Card radius={theme.radii.xl} style={{ marginTop: 18 }}>
        <Stack gap={12}>
          <Row>
            <Text variant="bodySmall" color={theme.colors.textSecondary}>
              {entry.receivable.due ? 'Debes' : 'Próximo cobro'}
            </Text>
            <Text variant="bodySmall" weight="semibold">
              {entry.receivable.due
                ? formatPENShort(entry.receivable.amountCents)
                : `${formatShortDate(entry.subscription.nextBillingDate)} · ${formatPENShort(entry.plan.priceCents)}`}
            </Text>
          </Row>
          <Row>
            <Text variant="bodySmall" color={theme.colors.textSecondary}>
              Cómo pagas
            </Text>
            <Text variant="bodySmall" weight="semibold">
              En mostrador
            </Text>
          </Row>
          {entry.charges[0] === undefined ? null : (
            <Row>
              <Text variant="bodySmall" color={theme.colors.textSecondary}>
                Último pago
              </Text>
              <Text variant="bodySmall" weight="semibold">
                {entry.charges[0].periodStart === null
                  ? railLabel(entry.charges[0].rail)
                  : `${formatShortDate(entry.charges[0].periodStart)} · ${railLabel(entry.charges[0].rail)}`}
              </Text>
            </Row>
          )}
        </Stack>
      </Card>

      {entry.pendingPlan === null ? null : (
        <View
          style={{
            marginTop: 14,
            backgroundColor: withAlpha(theme.semaphore.warn, 0.09),
            borderWidth: 1,
            borderColor: withAlpha(theme.semaphore.warn, 0.22),
            borderRadius: theme.radii.lg,
            padding: 14,
          }}
        >
          <Text variant="captionSmall" color="#D9CFA8">
            Cambio a {entry.pendingPlan.name} programado para el{' '}
            {formatShortDate(entry.subscription.nextBillingDate)}. Hasta entonces sigues con{' '}
            {entry.plan.name}.
          </Text>
        </View>
      )}

      <Stack gap={10} style={{ marginTop: 22 }}>
        <View
          style={{
            backgroundColor: withAlpha(theme.semaphore.warn, 0.09),
            borderWidth: 1,
            borderColor: withAlpha(theme.semaphore.warn, 0.22),
            borderRadius: theme.radii.lg,
            padding: 14,
          }}
        >
          <Text variant="captionSmall" color="#D9CFA8">
            Subir de plan se cobra hoy solo por los días que faltan del mes, prorrateado. Bajar de
            plan se aplica en tu próxima renovación, sin devoluciones.
          </Text>
        </View>

        <Button
          label="Cambiar de plan"
          onPress={() => router.push(`/plan-change/${entry.membership.id}`)}
        />

        {entry.receivable.due ? (
          <Button
            label={`Pagar ${formatPENShort(entry.receivable.amountCents)}`}
            variant="accent"
            accentColor={semaphore.color}
            accentInk={semaphore.ink}
            onPress={() => router.push(`/pay/${entry.membership.id}`)}
          />
        ) : null}

        <CancelButton membershipId={entry.membership.id} gimnasio={entry.tenant.name} />
        <Text variant="micro" color={theme.colors.textFaint} align="center">
          Cancelar no borra tu historial. Volver es un toque, cuando quieras.
        </Text>
      </Stack>
    </Screen>
  );
}

/** Cupo de la semana: numero, barra de sesiones y la regla que lo explica. */
function QuotaBlock({ entry }: { readonly entry: MembershipView }) {
  const theme = useTheme();
  const { quota } = entry;

  if (quota.limit === null) {
    return (
      <Stack gap={11}>
        <Row align="baseline">
          <Text variant="caption" color={theme.colors.textSecondary}>
            Sesiones de esta semana
          </Text>
          <Text variant="caption" weight="bold">
            Sin límite
          </Text>
        </Row>
        <Text variant="micro" color={theme.colors.textTertiary}>
          Pagas el mes y entras cuando quieras.
        </Text>
      </Stack>
    );
  }

  const usedColor = quota.exhausted
    ? theme.semaphore.alert
    : quota.isLastSession
      ? theme.semaphore.warn
      : theme.semaphore.ok;

  return (
    <Stack gap={11}>
      <Row align="baseline">
        <Text variant="caption" color={theme.colors.textSecondary}>
          Sesiones de esta semana
        </Text>
        <Text variant="caption" weight="bold">
          <Text variant="caption" weight="bold" color={usedColor}>
            {quota.used}
          </Text>{' '}
          de {quota.limit}
        </Text>
      </Row>
      <Row gap={7} justify="flex-start">
        {Array.from({ length: quota.limit }, (_, index) => (
          <View
            key={index}
            style={{
              flex: 1,
              height: 8,
              borderRadius: theme.radii.pill,
              backgroundColor: index < quota.used ? usedColor : 'rgba(255,255,255,0.11)',
            }}
          />
        ))}
      </Row>
      <Text variant="micro" color={theme.colors.textTertiary}>
        El cupo se reinicia el lunes. Las sesiones no usadas no se acumulan.
      </Text>
    </Stack>
  );
}

/**
 * Cancelar la suscripción.
 *
 * Dos cambios sobre lo que había. Iba por `cancelSubscription` de `store.ts`, que
 * escribe en memoria: con sesión real la pantalla se pintaba cancelada y la
 * siguiente carga desde la api lo revertía sin decir nada.
 *
 * Y no preguntaba. Un toque en un texto gris, sin confirmación ni deshacer,
 * terminaba la suscripción del alumno — justo al lado del botón de pagar. Es la
 * acción más destructiva de la app y era la más fácil de disparar sin querer.
 */
function CancelButton({
  membershipId,
  gimnasio,
}: {
  readonly membershipId: string;
  readonly gimnasio: string;
}) {
  const theme = useTheme();
  const [cancelando, setCancelando] = useState(false);

  const confirmar = () => {
    Alert.alert(
      `¿Cancelar tu plan en ${gimnasio}?`,
      'Dejarás de renovar y el escáner dejará de validar tu QR al terminar el periodo que ya pagaste. Tu historial se conserva.',
      [
        { text: 'Seguir suscrito', style: 'cancel' },
        {
          text: 'Cancelar el plan',
          style: 'destructive',
          onPress: () => {
            setCancelando(true);
            void cancelarSuscripcion(membershipId)
              .catch((causa: unknown) => {
                Alert.alert(
                  'No se pudo cancelar',
                  causa instanceof Error ? causa.message : 'Intenta de nuevo.',
                );
              })
              .finally(() => setCancelando(false));
          },
        },
      ],
    );
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: cancelando }}
      onPress={cancelando ? undefined : confirmar}
      hitSlop={8}
      style={{ paddingVertical: 10 }}
    >
      <Text variant="caption" color={theme.colors.textTertiary} align="center">
        {cancelando ? 'Cancelando…' : 'Cancelar suscripción'}
      </Text>
    </Pressable>
  );
}


/**
 * La semana del alumno: que dias le cubre su plan y que clases hay en cada uno.
 *
 * Eran dos cosas separadas —una tira de dias permitidos y una lista con los seis
 * dias apilados— y juntarlas sale mejor por dos razones. La tira ya era un
 * calendario semanal, solo que no se podia tocar; y la lista obligaba a leer
 * catorce filas para responder "¿puedo ir hoy?", que es la pregunta que trae
 * aqui a casi todo el mundo.
 *
 * No se usa una rejilla de horas por dias, que es lo que parece pedir un horario:
 * con estas clases —seis dias, catorce clases, y tres de esos dias con una sola—
 * quedaria un 85% vacia, y a 390px cada columna mide cincuenta puntos, donde
 * "Judo Kids (4 a 7 años)" no entra. La rejilla dibuja sobre todo el hueco.
 */
function SemanaYHorario({ entry }: { readonly entry: MembershipView }) {
  const theme = useTheme();
  const hoy = useToday();
  const todas = useStore((state) => state.schedules);
  const diaDeHoy = isoWeekday(hoy);
  const [elegido, setElegido] = useState<IsoWeekday>(diaDeHoy);

  const delLocal = useMemo(
    () => todas.filter((clase) => clase.tenantId === entry.tenant.id),
    [todas, entry.tenant.id],
  );

  const permitidos = entry.plan.allowedDays;
  const permite = (dia: IsoWeekday) => permitidos === null || permitidos.includes(dia);

  const clasesDe = (dia: IsoWeekday) =>
    delLocal
      .filter((clase) => clase.weekday === dia)
      .slice()
      .sort((a, b) => a.startTime.localeCompare(b.startTime));

  const delDia = clasesDe(elegido);
  const nombre = weekdayName(elegido);
  const hayHorario = delLocal.length > 0;

  return (
    <Stack gap={10} style={{ marginTop: 18 }}>
      <Eyebrow>{hayHorario ? 'Tu semana' : 'Días permitidos'}</Eyebrow>

      <Row gap={6} justify="flex-start">
        {allWeekdays().map((dia) => {
          const cubierto = permite(dia);
          const activo = dia === elegido;
          const tieneClases = clasesDe(dia).length > 0;

          return (
            <Pressable
              key={dia}
              accessibilityRole={hayHorario ? 'button' : 'text'}
              accessibilityState={{ selected: activo }}
              accessibilityLabel={`${weekdayName(dia)}${cubierto ? '' : ', fuera de tu plan'}${
                tieneClases ? '' : ', sin clases'
              }`}
              onPress={hayHorario ? () => setElegido(dia) : undefined}
              style={{
                flex: 1,
                aspectRatio: 1,
                borderRadius: theme.radii.sm,
                alignItems: 'center',
                justifyContent: 'center',
                gap: 3,
                backgroundColor: cubierto ? theme.colors.surfaceHigh : theme.colors.surfaceSunken,
                borderWidth: activo && hayHorario ? 1.5 : cubierto ? 0 : 1,
                borderStyle: activo || cubierto ? 'solid' : 'dashed',
                borderColor: activo && hayHorario ? theme.semaphore.ok : theme.colors.borderStrong,
              }}
            >
              <Text
                variant="caption"
                weight={cubierto ? 'bold' : 'semibold'}
                color={cubierto ? theme.colors.ink : theme.colors.textDisabled}
              >
                {weekdayInitial(dia)}
              </Text>
              {/* El punto dice que ese dia hay clase: sin el, un dia vacio y uno
                  lleno se ven igual hasta tocarlos. */}
              <View
                style={{
                  width: 4,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: !hayHorario
                    ? 'transparent'
                    : !tieneClases
                      ? 'transparent'
                      : dia === diaDeHoy
                        ? theme.semaphore.ok
                        : theme.colors.textTertiary,
                }}
              />
            </Pressable>
          );
        })}
      </Row>

      {!hayHorario ? null : (
        <Card padded={false} radius={theme.radii.xl}>
          <Row style={{ paddingHorizontal: 16, paddingTop: 13, paddingBottom: delDia.length === 0 ? 13 : 4 }} gap={8} justify="flex-start">
            <Text variant="captionSmall" weight="bold" color={theme.colors.textSecondary}>
              {`${nombre.charAt(0).toUpperCase()}${nombre.slice(1)}`}
            </Text>
            {elegido === diaDeHoy ? (
              <Text variant="micro" weight="bold" color={theme.semaphore.ok}>
                HOY
              </Text>
            ) : null}
            {permite(elegido) ? null : (
              <Text variant="micro" color={theme.colors.textTertiary}>
                fuera de tu plan
              </Text>
            )}
          </Row>

          {delDia.length === 0 ? (
            <Text
              variant="bodySmall"
              color={theme.colors.textSecondary}
              style={{ paddingHorizontal: 16, paddingBottom: 14 }}
            >
              No hay clases este día.
            </Text>
          ) : (
            <Stack gap={9} style={{ paddingHorizontal: 16, paddingBottom: 14, paddingTop: 6 }}>
              {delDia.map((clase) => (
                <Row key={clase.id} gap={12}>
                  <Text variant="bodySmall" style={{ flex: 1 }}>
                    {clase.name}
                  </Text>
                  <Text variant="bodySmall" weight="semibold" color={theme.colors.textStrong}>
                    {clase.startTime} – {clase.endTime}
                  </Text>
                </Row>
              ))}
            </Stack>
          )}
        </Card>
      )}

      {!hayHorario ? null : (
        <Text variant="micro" color={theme.colors.textFaint}>
          El escáner valida solo dentro del horario, con media hora de margen antes y después.
        </Text>
      )}
    </Stack>
  );
}
