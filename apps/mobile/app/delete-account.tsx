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
 *
 * LA CUENTA SIN FICHA SE BORRA EN EL ACTO, y es otra pantalla dentro de esta.
 * Apple rechazó la 1.0.0 por la 5.1.1(v): con Google o con Apple se CREABA una
 * cuenta, y hasta que un gimnasio la inscribía no había forma de borrarla. Esa
 * cuenta no tiene ficha ni cobros en ningún gimnasio —lo que deja son sus
 * reservas y sus conversaciones—, así que no hay nada que esperar treinta días:
 * se borra al confirmar y la pantalla lo dice antes de soltar la sesión.
 */
import { useCallback, useEffect, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Button, Card, Divider, Row, Stack, Text } from '../src/design/primitives';
import { Screen } from '../src/design/screen';
import { useTheme } from '../src/design/theme';
import {
  cancelAccountDeletion,
  deleteOwnAccount,
  fetchAccountDeletion,
  requestAccountDeletion,
  type DeletionRequestDto,
} from '../src/data/api';
import { signOut } from '../src/data/auth';
import { useSession } from '../src/data/session-hooks';
import { resetState } from '../src/data/store';

const SE_BORRA = [
  'Tu nombre, documento, teléfono, correo y foto.',
  'Tu acceso a la app y la cuenta con la que entras.',
  'El historial de qué días marcaste y a qué clases.',
  'Tus reservas de clase de prueba y tus inscripciones a eventos.',
] as const;

const SE_BORRA_SIN_FICHA = [
  'Tu cuenta y la forma con la que entras (Google o Apple).',
  'Tu nombre y tu celular.',
  'Tus reservas de clases y lo que les escribiste a los gimnasios.',
] as const;

export default function DeleteAccountScreen() {
  const session = useSession();
  // Una sola ruta para las dos bajas: la de quien busca «Eliminar mi cuenta» en
  // Ajustes no tiene por qué saber si ya tiene ficha o no.
  if (session.status === 'unlinked') return <DeleteUnlinkedAccount idToken={session.idToken} />;
  return <DeletionRequest />;
}

/** Quien tiene ficha: la solicitud de 30 días, que completa Sinchi. */
function DeletionRequest() {
  const theme = useTheme();
  const [pendiente, setPendiente] = useState<DeletionRequestDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmando, setConfirmando] = useState(false);
  const [denial, setDenial] = useState('');
  const [trabajando, setTrabajando] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refrescar = useCallback(() => {
    setLoading(true);
    fetchAccountDeletion()
      .then(({ request }) => setPendiente(request))
      .catch((causa: unknown) =>
        setNotice(causa instanceof Error ? causa.message : 'No se pudo consultar el estado.'),
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(refrescar, [refrescar]);

  const askForDeletion = () => {
    setTrabajando(true);
    setNotice(null);
    requestAccountDeletion(denial)
      .then(({ request }) => {
        setPendiente(request);
        setConfirmando(false);
        setDenial('');
      })
      .catch((causa: unknown) =>
        setNotice(causa instanceof Error ? causa.message : 'No se pudo registrar la solicitud.'),
      )
      .finally(() => setTrabajando(false));
  };

  const cancelar = () => {
    setTrabajando(true);
    setNotice(null);
    cancelAccountDeletion()
      .then(() => setPendiente(null))
      .catch((causa: unknown) =>
        setNotice(causa instanceof Error ? causa.message : 'No se pudo cancelar.'),
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
        {loading ? (
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
                La pediste el {formatDate(pendiente.requestedAt)}. La completamos dentro de los
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
                value={denial}
                onChangeText={(v) => setDenial(v.slice(0, 500))}
                placeholder="¿Por qué te vas? (opcional)"
                placeholderTextColor={theme.colors.textPlaceholder}
                keyboardAppearance={theme.scheme}
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
                onPress={askForDeletion}
              />
              <Button
                label="Mejor no"
                variant="ghost"
                disabled={trabajando}
                onPress={() => {
                  setConfirmando(false);
                  setDenial('');
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

        {notice === null ? null : (
          <Text variant="captionSmall" color={theme.semaphore.alert}>
            {notice}
          </Text>
        )}
      </Stack>
    </Screen>
  );
}

/** «4 de septiembre», sin año: la baja es reciente por definición. */
function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'hace poco';
  return date.toLocaleDateString('es-PE', { day: 'numeric', month: 'long' });
}

type UnlinkedStep = 'inicio' | 'confirmando' | 'borrando' | 'hecho';

/**
 * Quien todavía no tiene ficha: se borra en el acto.
 *
 * Termina en una pantalla que dice que se borró, y la sesión se suelta recién al
 * tocar «Salir». Soltarla antes la mandaba directo al login, y quien acababa de
 * borrar su cuenta no veía en ningún sitio que se hubiera borrado — que es justo
 * lo que Apple pide ver de principio a fin.
 */
function DeleteUnlinkedAccount({ idToken }: { readonly idToken: string }) {
  const theme = useTheme();
  const [step, setStep] = useState<UnlinkedStep>('inicio');
  const [notice, setNotice] = useState<string | null>(null);

  const borrar = (): void => {
    setStep('borrando');
    setNotice(null);
    deleteOwnAccount(idToken)
      .then(() => setStep('hecho'))
      .catch((causa: unknown) => {
        setStep('confirmando');
        setNotice(causa instanceof Error ? causa.message : 'No se pudo eliminar la cuenta.');
      });
  };

  const salir = (): void => {
    void signOut({ forgetTotpSecret: true }).then(() => {
      resetState();
      router.replace('/login');
    });
  };

  return (
    <Screen scroll>
      <Row style={{ paddingTop: 8 }}>
        <Text variant="titleSmall" weight="bold">
          Eliminar mi cuenta
        </Text>
        {/* Sin «Cerrar» al terminar: la cuenta ya no existe, y volver a Ajustes
            sería volver a una sesión de nadie. La salida es «Salir». */}
        {step === 'hecho' ? null : (
          <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={16}>
            <Text variant="body" color={theme.colors.textSecondary}>
              Cerrar
            </Text>
          </Pressable>
        )}
      </Row>

      <Stack gap={16} style={{ paddingTop: 18 }}>
        {step === 'hecho' ? (
          <Card>
            <Stack gap={12}>
              <Text variant="bodySmall" weight="bold" color={theme.semaphore.ok}>
                Tu cuenta se eliminó
              </Text>
              <Text variant="body" color={theme.colors.textSecondary}>
                Borramos tu cuenta, tus datos y lo que dejaste en los gimnasios. Si algún día
                quieres volver, puedes crear una cuenta nueva.
              </Text>
              <Button label="Salir" onPress={salir} />
            </Stack>
          </Card>
        ) : step === 'inicio' ? (
          <>
            <Card>
              <Stack gap={12}>
                <Text variant="bodySmall" weight="bold">
                  Qué se borra
                </Text>
                {SE_BORRA_SIN_FICHA.map((linea) => (
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
            <Text variant="captionSmall" color={theme.colors.textTertiary}>
              Es en el acto: todavía no estás en el padrón de ningún gimnasio, así que no hay nada
              que esperar.
            </Text>
            <Button
              label="Eliminar mi cuenta"
              variant="accent"
              accentColor={theme.semaphore.bad}
              accentInk={theme.semaphoreInk.bad}
              onPress={() => setStep('confirmando')}
            />
          </>
        ) : (
          <Card>
            <Stack gap={14}>
              <Text variant="bodySmall" weight="bold" color={theme.semaphore.bad}>
                ¿Seguro?
              </Text>
              <Text variant="body" color={theme.colors.textSecondary}>
                No se puede deshacer. Tus reservas se cancelan y los gimnasios dejan de ver tus
                mensajes.
              </Text>
              <Button
                label={step === 'borrando' ? 'Eliminando…' : 'Sí, elimina mi cuenta'}
                variant="accent"
                accentColor={theme.semaphore.bad}
                accentInk={theme.semaphoreInk.bad}
                disabled={step === 'borrando'}
                onPress={borrar}
              />
              <Button
                label="Mejor no"
                variant="ghost"
                disabled={step === 'borrando'}
                onPress={() => setStep('inicio')}
              />
            </Stack>
          </Card>
        )}

        {notice === null ? null : (
          <Text variant="captionSmall" color={theme.semaphore.alert}>
            {notice}
          </Text>
        )}
      </Stack>
    </Screen>
  );
}
