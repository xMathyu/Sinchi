/**
 * Baja de cuenta.
 *
 * Google Play la exige por dos caminos para cualquier app con registro: uno
 * dentro de la app y una URL publica. La URL es sinchi.fit/eliminar-cuenta;
 * esta pantalla es el otro.
 *
 * Lo que se pide es una SOLICITUD, y la pantalla lo dice sin adornos. Prometer
 * un borrado instantaneo y luego tardar treinta dias seria peor que explicar el
 * plazo: quien se va tiene derecho a saber que pasa con lo suyo, y sobre todo
 * QUE SE QUEDA — el asiento del cobro, sin su nombre, porque su gimnasio tiene
 * que poder cuadrar la caja de un mes ya cerrado.
 *
 * La confirmacion es de dos pasos a proposito. No es friccion decorativa: es la
 * unica accion de la app que no se deshace sola.
 */
import { useCallback, useEffect, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Button, Card, Divider, Row, Stack, Text } from '../src/design/primitives';
import { Screen } from '../src/design/screen';
import { useTheme } from '../src/design/theme';
import {
  cancelarBajaDeCuenta,
  consultarBajaDeCuenta,
  pedirBajaDeCuenta,
  type DeletionRequestDto,
} from '../src/data/api';

const SE_BORRA = [
  'Tu nombre, documento, teléfono, correo y foto.',
  'Tu acceso a la app y la cuenta con la que entras.',
  'El historial de qué días marcaste y a qué clases.',
  'Tus reservas de clase de prueba y tus inscripciones a eventos.',
] as const;

export default function EliminarCuentaScreen() {
  const theme = useTheme();
  const [pendiente, setPendiente] = useState<DeletionRequestDto | null>(null);
  const [cargando, setCargando] = useState(true);
  const [confirmando, setConfirmando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [trabajando, setTrabajando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const refrescar = useCallback(() => {
    setCargando(true);
    consultarBajaDeCuenta()
      .then(({ request }) => setPendiente(request))
      .catch((causa: unknown) =>
        setAviso(causa instanceof Error ? causa.message : 'No se pudo consultar el estado.'),
      )
      .finally(() => setCargando(false));
  }, []);

  useEffect(refrescar, [refrescar]);

  const pedir = () => {
    setTrabajando(true);
    setAviso(null);
    pedirBajaDeCuenta(motivo)
      .then(({ request }) => {
        setPendiente(request);
        setConfirmando(false);
        setMotivo('');
      })
      .catch((causa: unknown) =>
        setAviso(causa instanceof Error ? causa.message : 'No se pudo registrar la solicitud.'),
      )
      .finally(() => setTrabajando(false));
  };

  const cancelar = () => {
    setTrabajando(true);
    setAviso(null);
    cancelarBajaDeCuenta()
      .then(() => setPendiente(null))
      .catch((causa: unknown) =>
        setAviso(causa instanceof Error ? causa.message : 'No se pudo cancelar.'),
      )
      .finally(() => setTrabajando(false));
  };

  return (
    <Screen scroll>
      <Row style={{ paddingTop: 8 }}>
        <Text variant="titleSmall" weight="bold">
          Eliminar mi cuenta
        </Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={16}>
          <Text variant="body" color={theme.colors.textSecondary}>
            Cerrar
          </Text>
        </Pressable>
      </Row>

      <Stack gap={16} style={{ paddingTop: 18 }}>
        {cargando ? (
          <Text variant="body" color={theme.colors.textSecondary}>
            Consultando…
          </Text>
        ) : pendiente !== null ? (
          // ---------------------------------------------------------------
          // Ya la pidio. Lo que necesita ver es que esta en curso y desde
          // cuando, no un boton que parece no haber hecho nada.
          // ---------------------------------------------------------------
          <Card>
            <Stack gap={12}>
              <Text variant="bodySmall" weight="bold" color={theme.semaphore.alert}>
                Tu baja está en curso
              </Text>
              <Text variant="body" color={theme.colors.textSecondary}>
                La pediste el {formatearFecha(pendiente.requestedAt)}. La completamos dentro de los
                30 días siguientes.
              </Text>
              <Divider />
              <Text variant="body" color={theme.colors.textSecondary}>
                Si cambiaste de opinión, puedes detenerla y todo sigue como estaba.
              </Text>
              <Button
                label={trabajando ? 'Deteniendo…' : 'Me arrepentí, no la borres'}
                variant="secondary"
                disabled={trabajando}
                onPress={cancelar}
              />
            </Stack>
          </Card>
        ) : confirmando ? (
          // ---------------------------------------------------------------
          // Segundo paso. Es la unica accion de la app que no se deshace sola.
          // ---------------------------------------------------------------
          <Card>
            <Stack gap={14}>
              <Text variant="bodySmall" weight="bold" color={theme.semaphore.bad}>
                ¿Seguro?
              </Text>
              <Text variant="body" color={theme.colors.textSecondary}>
                Borrar la cuenta no cancela tu membresía ni te devuelve lo pagado — eso se ve con tu
                gimnasio. Si vuelves a entrenar, van a tener que inscribirte otra vez desde cero.
              </Text>
              <TextInput
                value={motivo}
                onChangeText={(v) => setMotivo(v.slice(0, 500))}
                placeholder="¿Por qué te vas? (opcional)"
                placeholderTextColor={theme.colors.textPlaceholder}
                multiline
                accessibilityLabel="Motivo, opcional"
                style={{
                  color: theme.colors.ink,
                  fontSize: 15,
                  minHeight: 64,
                  paddingVertical: 8,
                  borderBottomWidth: 1,
                  borderBottomColor: theme.colors.hairline,
                }}
              />
              <Button
                label={trabajando ? 'Enviando…' : 'Sí, elimina mi cuenta'}
                variant="accent"
                accentColor={theme.semaphore.bad}
                accentInk={theme.semaphoreInk.bad}
                disabled={trabajando}
                onPress={pedir}
              />
              <Button
                label="Mejor no"
                variant="ghost"
                disabled={trabajando}
                onPress={() => {
                  setConfirmando(false);
                  setMotivo('');
                }}
              />
            </Stack>
          </Card>
        ) : (
          <>
            <Card>
              <Stack gap={12}>
                <Text variant="bodySmall" weight="bold">
                  Qué se borra
                </Text>
                {SE_BORRA.map((linea) => (
                  <Row key={linea} style={{ alignItems: 'flex-start', gap: 10 }}>
                    <View
                      style={{
                        width: 4,
                        height: 4,
                        borderRadius: 2,
                        marginTop: 8,
                        backgroundColor: theme.colors.textTertiary,
                      }}
                    />
                    <Text variant="body" color={theme.colors.textSecondary} style={{ flex: 1 }}>
                      {linea}
                    </Text>
                  </Row>
                ))}
              </Stack>
            </Card>

            <Card>
              <Stack gap={12}>
                <Text variant="bodySmall" weight="bold">
                  Qué se queda
                </Text>
                <Text variant="body" color={theme.colors.textSecondary}>
                  Los pagos que te registró el gimnasio. No la ficha con tu nombre —eso se va— sino
                  el asiento: que tal día entraron tantos soles, sin decir de quién.
                </Text>
                <Text variant="body" color={theme.colors.textSecondary}>
                  Es la única excepción, y no es un capricho: tu gimnasio tiene que poder cuadrar su
                  caja de un mes ya cerrado.
                </Text>
              </Stack>
            </Card>

            <Text variant="captionSmall" color={theme.colors.textTertiary}>
              Tardamos hasta 30 días. Puedes detenerla mientras tanto.
            </Text>

            <Button
              label="Eliminar mi cuenta"
              variant="accent"
              accentColor={theme.semaphore.bad}
              accentInk={theme.semaphoreInk.bad}
              onPress={() => setConfirmando(true)}
            />
          </>
        )}

        {aviso === null ? null : (
          <Text variant="captionSmall" color={theme.semaphore.alert}>
            {aviso}
          </Text>
        )}
      </Stack>
    </Screen>
  );
}

/** «4 de septiembre», sin año: la baja es reciente por definición. */
function formatearFecha(iso: string): string {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return 'hace poco';
  return fecha.toLocaleDateString('es-PE', { day: 'numeric', month: 'long' });
}
