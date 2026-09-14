/**
 * Las solicitudes de los gimnasios que la agregaron, con Aceptar y Rechazar.
 *
 * Vive en tres pantallas —el directorio y el QR de quien no tiene ficha, y la
 * billetera de quien sí— porque la solicitud llega mientras la persona mira
 * cualquiera de ellas, y tiene que poder contestarla sin ir a buscarla.
 *
 * Rechazar pide confirmación y aceptar no. Aceptar por error se arregla hablando
 * con el gimnasio; rechazar por error deja a alguien fuera de su billetera hasta
 * que recepción se la vuelva a mandar, y lo más probable es que no sepa que tiene
 * que pedirlo.
 */
import { useState } from 'react';
import { Alert } from 'react-native';
import { withAlpha } from '@sinchi/ui';
import type { LinkRequestDto } from '../data/api';
import { Button, Card, Stack, Text } from './primitives';
import { useTheme } from './theme';

export function LinkRequestList({
  requests,
  onAccept,
  onReject,
  onAnswered,
}: {
  readonly requests: readonly LinkRequestDto[];
  readonly onAccept: (requestId: string) => Promise<void>;
  readonly onReject: (requestId: string) => Promise<void>;
  /** Tras contestar, para volver a pedir la lista. */
  readonly onAnswered: () => void;
}) {
  const theme = useTheme();
  const [busy, setBusy] = useState<string | null>(null);

  const answer = (requestId: string, run: (requestId: string) => Promise<void>): void => {
    setBusy(requestId);
    void run(requestId)
      .then(onAnswered)
      .catch((causa: unknown) => {
        Alert.alert(
          'No se pudo contestar',
          causa instanceof Error ? causa.message : 'Intenta de nuevo.',
        );
      })
      .finally(() => setBusy(null));
  };

  return (
    <Stack gap={10}>
      {requests.map((request) => {
        const working = busy === request.id;
        return (
          <Card
            key={request.id}
            accent={theme.semaphore.ok}
            borderColor={withAlpha(theme.semaphore.ok, 0.3)}
            radius={theme.radii.xl}
          >
            <Stack gap={12}>
              <Stack gap={4}>
                <Text variant="bodySmall" weight="semibold">
                  {request.gymName} te agregó
                </Text>
                <Text variant="captionSmall" color={theme.colors.textSecondary}>
                  Si entrenas ahí, acepta y tu membresía aparece en la app, con tu plan y tu
                  QR para entrar.
                </Text>
              </Stack>
              <Button
                label={working ? 'Un momento…' : 'Aceptar'}
                disabled={busy !== null}
                onPress={() => answer(request.id, onAccept)}
              />
              <Button
                label="No entreno ahí"
                variant="ghost"
                disabled={busy !== null}
                onPress={() =>
                  Alert.alert(
                    `Rechazar a ${request.gymName}`,
                    'No aparecerá en tu app. Si fue un error, pídele al gimnasio que te la vuelva a enviar.',
                    [
                      { text: 'Cancelar', style: 'cancel' },
                      {
                        text: 'Rechazar',
                        style: 'destructive',
                        onPress: () => answer(request.id, onReject),
                      },
                    ],
                  )
                }
              />
            </Stack>
          </Card>
        );
      })}
    </Stack>
  );
}
