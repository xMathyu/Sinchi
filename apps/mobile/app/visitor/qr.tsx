/**
 * Mi QR, para quien todavía no tiene ficha.
 *
 * No abre ninguna puerta: es con lo que recepción la inscribe sin teclear su
 * nombre ni su celular. Reemplaza al código de 6 dígitos, que había que dictar y
 * que alguien confirmaba a mano; ahora se escanea, y lo que queda es que la
 * persona acepte la solicitud que le llega aquí mismo (decisiones §14).
 *
 * Las solicitudes se piden cada pocos segundos mientras la pantalla está abierta,
 * y no es un lujo: es la pantalla que se tiene en la mano en el mostrador, y la
 * solicitud llega mientras recepción termina el alta. Sin esto había que salir y
 * volver para verla.
 */
import { useEffect, useRef, useState } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { encodeAccountQrPayload } from '@sinchi/shared';
import { Card, Eyebrow, Row, Stack, Text } from '../../src/design/primitives';
import { Screen } from '../../src/design/screen';
import { LinkRequestList } from '../../src/design/link-requests';
import { SinchiQrCode } from '../../src/design/sinchi-qr';
import { useTheme } from '../../src/design/theme';
import { useLinkRequests, usePolling } from '../../src/data/hooks';
import { useSession } from '../../src/data/session-hooks';
import { restoreFirebaseAccount } from '../../src/data/auth';
import { acceptLinkRequest, rejectLinkRequest } from '../../src/data/link-requests';

/** Cada cuánto se reintenta renovar un QR vencido si la red no respondió. */
const RENEW_RETRY_MS = 15_000;

const STEPS = [
  'Recepción escanea tu QR y lee tu DNI.',
  'Te llega aquí la solicitud del gimnasio.',
  'La aceptas, y tu membresía aparece en la app con tu plan.',
] as const;

export default function AccountQrScreen() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const session = useSession();
  const requests = useLinkRequests();
  usePolling(requests.reload, 6_000);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const expiresAt = session.status === 'unlinked' ? session.expiresAt : 0;
  const expired = expiresAt > 0 && expiresAt <= now;

  /**
   * Vencido, se renueva solo.
   *
   * Volver a entrar con la credencial guardada le da uno nuevo, en la misma fila
   * de la api. Con candado de tiempo: sin red, reintentar en cada vuelta del reloj
   * de arriba sería una petición por segundo que nadie ve fallar.
   */
  const lastRenewal = useRef(0);
  useEffect(() => {
    if (!expired || now - lastRenewal.current < RENEW_RETRY_MS) return;
    lastRenewal.current = now;
    void restoreFirebaseAccount();
  }, [expired, now]);

  if (session.status !== 'unlinked') return null;

  const side = Math.min(width - 120, 260);
  const secondsLeft = Math.max(0, Math.round((expiresAt - now) / 1000));

  return (
    <Screen scroll>
      <Stack gap={3} style={{ paddingTop: 8 }}>
        <Text variant="titleSmall" weight="bold">
          Mi QR
        </Text>
        <Text variant="captionSmall" color={theme.colors.textSecondary}>
          Muéstraselo a recepción para que te inscriban. No abre la puerta: eso lo hace el QR
          de tu membresía, cuando la tengas.
        </Text>
      </Stack>

      {requests.details.length > 0 ? (
        <Stack gap={10} style={{ marginTop: 20 }}>
          <Eyebrow>Te agregaron</Eyebrow>
          <LinkRequestList
            requests={requests.details}
            onAccept={acceptLinkRequest}
            onReject={rejectLinkRequest}
            onAnswered={requests.reload}
          />
        </Stack>
      ) : null}

      <Stack gap={14} style={{ marginTop: 26, alignItems: 'center' }}>
        {/* Blanco y con margen propio aunque el tema sea oscuro: una cámara de
            mostrador lee mal un QR invertido, y peor todavía sin borde. Vencido
            se apaga en vez de desaparecer, para que no parezca que se rompió. */}
        <View
          style={{
            padding: 18,
            borderRadius: theme.radii.xxl,
            backgroundColor: '#FFFFFF',
            opacity: expired ? 0.2 : 1,
          }}
        >
          <SinchiQrCode value={encodeAccountQrPayload(session.qrToken)} size={side} />
        </View>
        {session.fullName === null ? null : (
          <Text variant="heading" weight="semibold">
            {session.fullName}
          </Text>
        )}
        <Text variant="caption" color={theme.colors.textSecondary}>
          {expired ? 'Renovando tu QR…' : `Vence en ${formatCountdown(secondsLeft)} · se renueva solo`}
        </Text>
      </Stack>

      <Card tone="sunken" style={{ marginTop: 26 }}>
        <Stack gap={10}>
          <Eyebrow>Cómo te inscriben</Eyebrow>
          {STEPS.map((step, index) => (
            <Row key={step} gap={10} align="flex-start" justify="flex-start">
              <Text variant="captionSmall" weight="bold" color={theme.semaphore.ok}>
                {index + 1}
              </Text>
              <Text variant="captionSmall" color={theme.colors.textSecondary} style={{ flex: 1 }}>
                {step}
              </Text>
            </Row>
          ))}
        </Stack>
      </Card>
    </Screen>
  );
}

function formatCountdown(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes === 0 ? `${rest} s` : `${minutes}:${String(rest).padStart(2, '0')}`;
}
