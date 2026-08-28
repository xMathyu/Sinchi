/**
 * S2 y S3 · Resultado de la validación.
 *
 * La pantalla que decide si el alumno pasa. Tres reglas de diseño que vienen
 * del MD:
 *
 *  - la FOTO va grande. No es decorativa: es lo único que impide que un alumno
 *    le pase el celular a un amigo en la puerta (MD 4.6);
 *  - el rechazo dice el MOTIVO, nunca "acceso denegado" a secas (MD 4.3). Cada
 *    motivo tiene una acción distinta y el recepcionista tiene que saber cuál;
 *  - se puede cobrar sin salir de aquí: el gimnasio recupera la plata en el
 *    momento en que el moroso está parado frente al mostrador, que es el único
 *    momento en que va a pagar.
 */
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { formatPEN, formatPENShort } from '@sinchi/shared';
import { semaphoreStyle } from '@sinchi/ui';
import { Button, Dot, Row, Stack, Text } from '../../src/design/primitives';
import { PhotoCircle } from '../../src/design/photo';
import { TintedScreen } from '../../src/design/screen';
import { useTheme } from '../../src/design/theme';
import { useRoster, useScanVerdict, useToday } from '../../src/data/hooks';
import { clearScanVerdict, validateScan } from '../../src/data/store';
import { marcarAsistencia } from '../../src/data/actions';
import { formatClock, formatShortDate } from '../../src/lib/format';

export default function ScanResultScreen() {
  const theme = useTheme();
  const today = useToday();
  const { membershipId } = useLocalSearchParams<{ membershipId: string }>();
  const roster = useRoster();

  // Lo que dijo el servidor manda: es el unico que verifico la firma del QR. El
  // calculo local es el respaldo sin conexion, no la version buena.
  const verdict = useScanVerdict(membershipId);
  const local = useMemo(
    () => validateScan(membershipId, today),
    [membershipId, today, roster],
  );
  const entry = local.entry;
  const result = verdict?.result ?? local.result;
  const message = verdict?.message ?? local.message;
  const registrado = verdict?.registered === true;

  const semaphore = semaphoreStyle(theme, message.level);
  const ink = semaphore.ink;

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Sale de la pantalla soltando el veredicto: el siguiente alumno es otro. */
  const salir = () => {
    clearScanVerdict();
    router.back();
  };

  const confirm = () => {
    // Si el servidor ya lo registro al validar el QR, volver a marcar seria una
    // segunda asistencia del mismo dia. Aqui solo se cierra la pantalla.
    if (registrado) {
      salir();
      return;
    }
    setGuardando(true);
    setError(null);
    void marcarAsistencia({ membershipId, method: 'qr' })
      .then(salir)
      .catch((causa: unknown) =>
        setError(causa instanceof Error ? causa.message : 'No se pudo registrar el ingreso.'),
      )
      .finally(() => setGuardando(false));
  };

  return (
    <TintedScreen
      gradient={semaphore.gradient}
      ink={ink}
      watermark={result.allowed ? 'PASA' : 'ALTO'}
    >
      <Row>
        <Text variant="eyebrow" weight="extrabold" color={ink} style={{ letterSpacing: 2 }}>
          {result.allowed ? 'Acceso permitido' : 'Acceso denegado'}
        </Text>
        <Text variant="captionSmall" weight="bold" color={ink} style={{ opacity: 0.55 }}>
          {formatClock(new Date())} · QR
        </Text>
      </Row>

      {result.allowed ? (
        <AllowedBody entry={entry} ink={ink} />
      ) : (
        <DeniedBody entry={entry} ink={ink} />
      )}

      <View
        style={{
          marginTop: 24,
          backgroundColor: result.allowed ? 'rgba(10,10,11,0.10)' : semaphore.ink,
          borderRadius: theme.radii.xxl,
          padding: 20,
          gap: 8,
        }}
      >
        <Row gap={10} justify="flex-start">
          <Dot color={semaphore.color} size={12} />
          <Text
            variant="displaySmall"
            weight="extrabold"
            color={result.allowed ? ink : '#FFFFFF'}
            style={{ flex: 1 }}
          >
            {message.title}
          </Text>
        </Row>
        <Text
          variant="bodySmall"
          color={result.allowed ? ink : '#E8D5D5'}
          style={result.allowed ? { opacity: 0.7 } : undefined}
        >
          {message.reason}
          {message.detail === null ? '' : ` ${message.detail}`}
        </Text>
      </View>

      <Stack gap={10} style={{ marginTop: 'auto' }}>
        {result.allowed ? (
          <>
            <Text variant="captionSmall" color={ink} align="center" style={{ opacity: 0.6 }}>
              {registrado
                ? 'Firma verificada e ingreso registrado en el servidor'
                : 'Validado en el dispositivo · se sincroniza al volver el wifi'}
            </Text>
            {error === null ? null : (
              <Text variant="captionSmall" color={semaphore.ink} align="center">
                {error}
              </Text>
            )}
            <Button
              label={guardando ? 'Registrando…' : registrado ? 'Listo' : 'Confirmar ingreso'}
              variant="accent"
              accentColor={semaphore.ink}
              accentInk={theme.colors.ink}
              disabled={guardando}
              onPress={confirm}
            />
          </>
        ) : (
          <>
            <Text variant="captionSmall" color={ink} align="center" style={{ opacity: 0.62 }}>
              Cobra aquí y el acceso se libera al instante, sin salir de esta pantalla.
            </Text>
            <Button
              label={message.action ?? 'Registrar pago'}
              variant="accent"
              accentColor={semaphore.ink}
              accentInk={theme.colors.ink}
              onPress={() =>
                // El patron de la ruta va literal y el id dentro de `params`.
                // Interpolarlo en `pathname` compila con las rutas tipadas hasta
                // que expo-router regenera los tipos, y entonces falla — que es
                // exactamente lo que paso.
                router.replace({
                  pathname: '/charge/[membershipId]',
                  params: {
                    membershipId: entry.view.membership.id,
                    type: result.reason.code === 'quota_exhausted' ? 'drop_in' : 'renewal',
                  },
                })
              }
            />
            <Row gap={10}>
              <OverrideButton membershipId={entry.view.membership.id} ink={ink} />
              <Pressable
                accessibilityRole="button"
                onPress={salir}
                style={{
                  flex: 1,
                  backgroundColor: 'rgba(10,10,11,0.12)',
                  borderRadius: 16,
                  paddingVertical: 14,
                  alignItems: 'center',
                }}
              >
                <Text variant="bodySmall" weight="semibold" color={ink}>
                  Siguiente
                </Text>
              </Pressable>
            </Row>
          </>
        )}
      </Stack>
    </TintedScreen>
  );
}

type Entry = ReturnType<typeof validateScan>['entry'];

function AllowedBody({ entry, ink }: { readonly entry: Entry; readonly ink: string }) {
  const theme = useTheme();
  const { view } = entry;

  return (
    <>
      <Stack gap={18} style={{ marginTop: 26, alignItems: 'center' }}>
        <PhotoCircle
          name={entry.user.name}
          photoUrl={entry.user.photoUrl}
          size={200}
          ringColor="rgba(255,255,255,0.6)"
          ringWidth={7}
        />
        <Stack gap={6} style={{ alignItems: 'center' }}>
          <Text variant="hero" weight="black" color={ink} uppercase align="center">
            {entry.user.name}
          </Text>
          <Text variant="bodySmall" weight="semibold" color={ink} style={{ opacity: 0.62 }}>
            {view.plan.name} · {view.tenant.name}
          </Text>
        </Stack>
      </Stack>

      <Row gap={10} style={{ marginTop: 24 }} align="stretch">
        <StatTile
          label="Plan"
          value={view.plan.name}
          ink={ink}
          style={{ flex: 1 }}
        />
        <StatTile
          label="Sesiones"
          value={
            view.quota.limit === null
              ? 'Sin límite'
              : `${view.quota.remaining ?? 0} de ${view.quota.limit}`
          }
          ink={ink}
          style={{ flex: 1 }}
        />
      </Row>
      <View
        style={{
          marginTop: 10,
          backgroundColor: 'rgba(10,10,11,0.10)',
          borderRadius: theme.radii.xl,
          padding: 15,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Stack gap={3}>
          <Text variant="eyebrow" weight="extrabold" color={ink} style={{ opacity: 0.5 }}>
            Suscripción
          </Text>
          <Text variant="heading" weight="semibold" color={ink}>
            Al día · renueva {formatShortDate(view.subscription.nextBillingDate)}
          </Text>
        </Stack>
      </View>
    </>
  );
}

function DeniedBody({ entry, ink }: { readonly entry: Entry; readonly ink: string }) {
  const theme = useTheme();
  const { view } = entry;

  return (
    <>
      <Row gap={16} justify="flex-start" style={{ marginTop: 26 }}>
        <PhotoCircle
          name={entry.user.name}
          photoUrl={entry.user.photoUrl}
          size={96}
          ringColor="rgba(255,255,255,0.5)"
          ringWidth={5}
        />
        <Stack gap={5} style={{ flex: 1 }}>
          <Text variant="display" weight="black" color={ink} uppercase>
            {entry.user.name}
          </Text>
          <Text variant="caption" weight="semibold" color={ink} style={{ opacity: 0.62 }}>
            {view.plan.name} · {formatPENShort(view.plan.priceCents)}
          </Text>
        </Stack>
      </Row>

      <Stack gap={9} style={{ marginTop: 16 }}>
        {view.receivable.due ? (
          <Row
            style={{
              backgroundColor: 'rgba(10,10,11,0.10)',
              borderRadius: theme.radii.lg,
              paddingHorizontal: 16,
              paddingVertical: 14,
            }}
          >
            <Text variant="caption" weight="semibold" color={ink}>
              Deuda
            </Text>
            <Text variant="titleSmall" weight="extrabold" color={ink}>
              {formatPEN(view.receivable.amountCents)}
            </Text>
          </Row>
        ) : null}
        {view.charges[0] === undefined ? null : (
          <Row
            style={{
              backgroundColor: 'rgba(10,10,11,0.10)',
              borderRadius: theme.radii.lg,
              paddingHorizontal: 16,
              paddingVertical: 14,
            }}
          >
            <Text variant="caption" weight="semibold" color={ink}>
              Último pago
            </Text>
            <Text variant="bodySmall" weight="semibold" color={ink}>
              {formatShortDate(
                view.charges[0].periodStart ?? view.subscription.periodStart,
              )}
            </Text>
          </Row>
        )}
      </Stack>
    </>
  );
}

function StatTile({
  label,
  value,
  ink,
  style,
}: {
  readonly label: string;
  readonly value: string;
  readonly ink: string;
  readonly style?: object;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: 'rgba(10,10,11,0.10)',
          borderRadius: theme.radii.xl,
          padding: 15,
          gap: 4,
        },
        style,
      ]}
    >
      <Text variant="eyebrow" weight="extrabold" color={ink} style={{ opacity: 0.5 }}>
        {label}
      </Text>
      <Text variant="titleSmall" weight="extrabold" color={ink}>
        {value}
      </Text>
    </View>
  );
}

/**
 * "Dejar pasar hoy".
 *
 * Existe porque el recepcionista lo va a hacer de todas formas, con o sin
 * boton. Teniendolo, queda registrado con su nombre y la hora en vez de
 * volverse invisible (MD 4.6).
 */
function OverrideButton({
  membershipId,
  ink,
}: {
  readonly membershipId: string;
  readonly ink: string;
}) {
  const [guardando, setGuardando] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: guardando }}
      accessibilityHint="Queda registrado con tu nombre y la hora"
      onPress={() => {
        if (guardando) return;
        setGuardando(true);
        // Por `actions`, no por el store: con sesion real la excepcion tiene que
        // llegar al servidor. Escrita solo en memoria, el rastro que la auditoria
        // existe para dejar se pierde al cerrar la app.
        void marcarAsistencia({ membershipId, method: 'manual', overrideDenial: true })
          .then(() => {
            clearScanVerdict();
            router.back();
          })
          .finally(() => setGuardando(false));
      }}
      style={{
        flex: 1,
        backgroundColor: 'rgba(10,10,11,0.12)',
        borderRadius: 16,
        paddingVertical: 14,
        alignItems: 'center',
      }}
    >
      <Text variant="bodySmall" weight="semibold" color={ink}>
        {guardando ? 'Registrando…' : 'Dejar pasar hoy'}
      </Text>
    </Pressable>
  );
}
