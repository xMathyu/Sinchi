/**
 * Vincular la cuenta de un alumno con su ficha del padrón.
 *
 * Es la mitad que faltaba del flujo de `docs/autenticacion.md`. El alumno entra
 * con Google, la api responde que su cuenta no está vinculada y le da un código
 * de seis dígitos; alguien tiene que canjearlo contra una ficha, y ese alguien es
 * recepción. Sin esta pantalla el alumno se quedaba en `unlinked` para siempre:
 * con cuenta de Google válida, sin membresía, y enseñando un código que nadie
 * podía usar.
 *
 * El emparejamiento no se automatiza por correo a propósito (MD y
 * `docs/autenticacion.md`): exigirlo obliga a recepción a escribirlo sin error, y
 * un typo vincula a la persona equivocada. Aquí lo confirma quien tiene al alumno
 * delante y puede mirarle el DNI.
 */
import { useMemo, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { withAlpha } from '@sinchi/ui';
import { Avatar, Button, Card, Eyebrow, Row, Stack, Text } from '../../src/design/primitives';
import { Screen } from '../../src/design/screen';
import { useTheme } from '../../src/design/theme';
import { useClaims, useRoster } from '../../src/data/hooks';
import { vincularCuenta, type Vinculacion } from '../../src/data/actions';
import { formatDocument, initials } from '../../src/lib/format';

export default function ClaimsScreen() {
  const theme = useTheme();
  const { claims, cargando, error, recargar } = useClaims();
  const roster = useRoster();

  const [elegida, setElegida] = useState<Vinculacion | null>(null);
  const [membershipId, setMembershipId] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const candidatos = useMemo(() => {
    const texto = busqueda.trim().toLowerCase();
    if (texto.length === 0) return roster;
    return roster.filter(
      (entrada) =>
        entrada.user.name.toLowerCase().includes(texto) ||
        entrada.user.documentId.includes(texto.replace(/\s/g, '')),
    );
  }, [roster, busqueda]);

  const elegido = candidatos.find((e) => e.view.membership.id === membershipId) ?? null;

  return (
    <Screen scroll>
      <Row style={{ paddingTop: 8 }}>
        <Text variant="titleSmall" weight="bold">
          Vincular cuentas
        </Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={16}>
          <Text variant="body" color={theme.colors.textSecondary}>
            Cerrar
          </Text>
        </Pressable>
      </Row>

      <Text variant="captionSmall" color={theme.colors.textSecondary} style={{ marginTop: 8 }}>
        El alumno entró con su cuenta de Google y la app le dio un código. Búscalo aquí,
        elige su ficha y confirma.
      </Text>

      <Stack gap={10} style={{ marginTop: 20 }}>
        <Row align="baseline">
          <Eyebrow>Códigos vigentes</Eyebrow>
          <Pressable accessibilityRole="button" onPress={recargar} hitSlop={12}>
            <Text variant="captionSmall" color={theme.colors.textSecondary}>
              Actualizar
            </Text>
          </Pressable>
        </Row>

        {cargando && claims.length === 0 ? (
          <Text variant="bodySmall" color={theme.colors.textSecondary}>
            Buscando códigos…
          </Text>
        ) : claims.length === 0 ? (
          <Card tone="sunken" radius={theme.radii.lg}>
            <Text variant="bodySmall" color={theme.colors.textSecondary} align="center">
              {error ?? 'No hay ningún código esperando. Duran diez minutos: pídele al alumno que vuelva a entrar en su app.'}
            </Text>
          </Card>
        ) : (
          claims.map((claim) => (
            <CodigoFila
              key={claim.id}
              claim={claim}
              seleccionada={elegida?.id === claim.id}
              onPress={() => {
                setElegida(claim);
                setAviso(null);
              }}
            />
          ))
        )}
      </Stack>

      {/* El padrón solo aparece cuando ya hay un código elegido: sin él no hay
          nada que confirmar, y enseñar la lista entera invita a tocarla. */}
      {elegida === null ? null : (
        <>
          <Stack gap={10} style={{ marginTop: 22 }}>
            <Eyebrow>¿De quién es la cuenta {elegida.code}?</Eyebrow>
            <TextInput
              value={busqueda}
              onChangeText={setBusqueda}
              placeholder="Buscar por nombre o documento"
              placeholderTextColor={theme.colors.textPlaceholder}
              autoCorrect={false}
              autoCapitalize="words"
              accessibilityLabel="Buscar la ficha del alumno"
              style={{
                color: theme.colors.ink,
                fontSize: 15,
                paddingVertical: 12,
                borderBottomWidth: 1,
                borderBottomColor: theme.colors.hairline,
              }}
            />
          </Stack>

          <Stack gap={9} style={{ marginTop: 12 }}>
            {candidatos.slice(0, 8).map((entrada) => {
              const activa = entrada.view.membership.id === membershipId;
              return (
                <Pressable
                  key={entrada.view.membership.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: activa }}
                  onPress={() => setMembershipId(entrada.view.membership.id)}
                >
                  <Card
                    radius={theme.radii.lg}
                    borderColor={activa ? theme.semaphore.ok : theme.colors.hairline}
                  >
                    <Row gap={12} justify="flex-start">
                      <Avatar initials={initials(entrada.user.name)} size={40} />
                      <Stack gap={1} style={{ flex: 1 }}>
                        <Text variant="heading" weight="semibold">
                          {entrada.user.name}
                        </Text>
                        <Text variant="captionSmall" color={theme.colors.textSecondary}>
                          DNI {formatDocument(entrada.user.documentId)} · {entrada.view.plan.name}
                        </Text>
                      </Stack>
                    </Row>
                  </Card>
                </Pressable>
              );
            })}
            {candidatos.length === 0 ? (
              <Card radius={theme.radii.lg}>
                <Text variant="bodySmall" color={theme.colors.textSecondary} align="center">
                  Nadie en el padrón coincide. La ficha tiene que existir antes de vincular.
                </Text>
              </Card>
            ) : null}
          </Stack>

          <View
            style={{
              marginTop: 18,
              backgroundColor: withAlpha(theme.semaphore.alert, 0.08),
              borderWidth: 1,
              borderColor: withAlpha(theme.semaphore.alert, 0.22),
              borderRadius: theme.radii.lg,
              padding: 14,
            }}
          >
            <Text variant="captionSmall" color="#D3B394">
              Comprueba el DNI antes de confirmar. Si vinculas la cuenta a la ficha equivocada,
              esa persona ve los pagos de otra — y solo el dueño puede deshacerlo.
            </Text>
          </View>

          <Stack gap={8} style={{ marginTop: 18 }}>
            <Button
              label={
                guardando
                  ? 'Vinculando…'
                  : elegido === null
                    ? 'Elige la ficha del alumno'
                    : `Vincular ${elegida.code} con ${elegido.user.name}`
              }
              disabled={elegido === null || guardando}
              onPress={() => {
                if (elegido === null || guardando) return;
                setGuardando(true);
                setAviso(null);
                void vincularCuenta(elegida.code, elegido.view.membership.id)
                  .then(() => {
                    setAviso(`Listo. ${elegido.user.name} ya puede usar su app.`);
                    setElegida(null);
                    setMembershipId(null);
                    setBusqueda('');
                    recargar();
                  })
                  .catch((causa: unknown) => {
                    setAviso(
                      causa instanceof Error ? causa.message : 'No se pudo vincular la cuenta.',
                    );
                  })
                  .finally(() => setGuardando(false));
              }}
            />
          </Stack>
        </>
      )}

      {aviso === null ? null : (
        <Text
          variant="captionSmall"
          color={theme.colors.textSecondary}
          align="center"
          style={{ marginTop: 14 }}
        >
          {aviso}
        </Text>
      )}
    </Screen>
  );
}

function CodigoFila({
  claim,
  seleccionada,
  onPress,
}: {
  readonly claim: Vinculacion;
  readonly seleccionada: boolean;
  readonly onPress: () => void;
}) {
  const theme = useTheme();
  const minutos = Math.max(0, Math.round((claim.expiresAt.getTime() - Date.now()) / 60_000));

  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ selected: seleccionada }} onPress={onPress}>
      <Card
        radius={theme.radii.lg}
        borderColor={seleccionada ? theme.semaphore.ok : theme.colors.hairline}
      >
        <Row align="center" gap={12}>
          <Stack gap={2} style={{ flex: 1 }}>
            {/* Los seis dígitos grandes y separados en dos grupos de tres, como
                en la pantalla del alumno: es el mismo código leído de lejos y al
                revés desde el otro lado del mostrador. */}
            <Text variant="displaySmall" weight="extrabold">
              {claim.code.slice(0, 3)} {claim.code.slice(3)}
            </Text>
            <Text variant="captionSmall" color={theme.colors.textSecondary}>
              {claim.displayName ?? claim.email ?? 'cuenta de Google'}
            </Text>
          </Stack>
          <Text
            variant="captionSmall"
            color={minutos <= 2 ? theme.semaphore.alert : theme.colors.textTertiary}
          >
            {minutos === 0 ? 'vencido' : `${minutos} min`}
          </Text>
        </Row>
      </Card>
    </Pressable>
  );
}
