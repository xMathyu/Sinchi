/**
 * Alta de un alumno en el mostrador.
 *
 * Faltaba entera, y su ausencia sostenia media app en el aire: vincular cuentas
 * exige una ficha del padron contra la que vincular, el escaner valida contra un
 * padron que nadie podia llenar, y las pantallas vacias del alumno le dicen "te
 * agregan con tu DNI" — apuntando a un flujo que no existia.
 *
 * Empieza por el CORREO, y la api solo responde si existe o no. No devuelve el
 * nombre ni el documento, y eso no es tacaneria: `users` es global, asi que
 * rellenar el alta desde una busqueda por correo dejaria a cualquier recepcion
 * cosechar datos de gente que entrena en otro local. Lo que se ahorra igual es
 * el 80% del tecleo, que era el objetivo.
 *
 * El ancla de la identidad es el DOCUMENTO, no el correo. El correo no es unico
 * en `users` —dos personas pueden compartirlo— y un tipeo en uno ajeno
 * inscribiria a un desconocido. El documento es lo que recepcion esta leyendo
 * del carne que tiene delante, y es lo que la api usa para reutilizar.
 */
import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { formatPEN } from '@sinchi/shared';
import { withAlpha } from '@sinchi/ui';
import { Button, Card, Eyebrow, Row, Stack, Text } from '../src/design/primitives';
import { Screen } from '../src/design/screen';
import { useTheme } from '../src/design/theme';
import { usePlanesDelGimnasio } from '../src/data/hooks';
import { existeIdentidad, inscribirAlumno, YaEnElPadron } from '../src/data/actions';

export default function EnrollScreen() {
  const theme = useTheme();
  const planes = usePlanesDelGimnasio();

  const [correo, setCorreo] = useState('');
  // `null` = todavia no se ha comprobado el correo.
  const [yaExiste, setYaExiste] = useState<boolean | null>(null);
  const [comprobando, setComprobando] = useState(false);

  const [nombre, setNombre] = useState('');
  const [documento, setDocumento] = useState('');
  const [celular, setCelular] = useState('+51');
  const [planId, setPlanId] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Cuando la persona ya está en el padrón, la api dice cuál es su ficha. Es el
  // caso normal —alguien que canceló y vuelve— y no tiene sentido dejar al
  // mostrador leyendo "ya existe" sin un camino.
  const [fichaExistente, setFichaExistente] = useState<string | null>(null);

  const plan = planes.find((p) => p.id === planId) ?? null;
  const correoValido = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo.trim());

  // Reutilizando identidad no hacen falta ni el nombre ni el celular: la api ya
  // los tiene, y pedirlos otra vez es teclear para confirmar lo que ya sabe.
  const listo =
    plan !== null &&
    documento.trim().length >= 6 &&
    (yaExiste === true || (nombre.trim().length >= 2 && celular.trim().length >= 7));

  return (
    <Screen scroll>
      <Row style={{ paddingTop: 8 }}>
        <Text variant="titleSmall" weight="bold">
          Inscribir alumno
        </Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={16}>
          <Text variant="body" color={theme.colors.textSecondary}>
            Cancelar
          </Text>
        </Pressable>
      </Row>

      <Stack gap={10} style={{ marginTop: 20 }}>
        <Eyebrow>Su correo</Eyebrow>
        <Card radius={theme.radii.xl}>
          <Stack gap={14}>
            <Campo
              etiqueta="Correo"
              valor={correo}
              onChange={(texto) => {
                setCorreo(texto);
                setYaExiste(null);
              }}
              placeholder="alumno@correo.com"
              keyboardType="email-address"
              autoCapitalize="none"
              pie="Con él, su cuenta se activa sola al entrar con Google."
            />

            {yaExiste === null ? (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: !correoValido || comprobando }}
                onPress={() => {
                  if (!correoValido || comprobando) return;
                  setComprobando(true);
                  setError(null);
                  void existeIdentidad(correo.trim())
                    .then(setYaExiste)
                    .catch(() => setYaExiste(false))
                    .finally(() => setComprobando(false));
                }}
                style={{ opacity: correoValido && !comprobando ? 1 : 0.4 }}
              >
                <Text variant="bodySmall" weight="semibold" color={theme.semaphore.ok}>
                  {comprobando ? 'Comprobando…' : 'Continuar'}
                </Text>
              </Pressable>
            ) : (
              <Row>
                <Text variant="captionSmall" color={theme.colors.textSecondary} style={{ flex: 1 }}>
                  {yaExiste
                    ? 'Ya hay una identidad Sinchi con ese correo. Confirma su documento y se le suma este gimnasio.'
                    : 'No hay ninguna identidad con ese correo. Hacen falta su nombre y su celular.'}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  hitSlop={10}
                  onPress={() => setYaExiste(null)}
                >
                  <Text variant="captionSmall" color={theme.colors.textSecondary}>
                    Cambiar
                  </Text>
                </Pressable>
              </Row>
            )}
          </Stack>
        </Card>
      </Stack>

      {yaExiste === null ? null : (
        <Stack gap={10} style={{ marginTop: 20 }}>
          <Eyebrow>{yaExiste ? 'Confirma quién es' : 'Quién es'}</Eyebrow>
          <Card radius={theme.radii.xl}>
            <Stack gap={16}>
              {yaExiste ? null : (
                <Campo
                  etiqueta="Nombre completo"
                  valor={nombre}
                  onChange={setNombre}
                  placeholder="Como figura en su documento"
                  autoCapitalize="words"
                />
              )}
              <Campo
                etiqueta="DNI o carné de extranjería"
                valor={documento}
                onChange={(texto) => setDocumento(texto.replace(/\s/g, ''))}
                placeholder="71448902"
                keyboardType="number-pad"
                pie={
                  yaExiste
                    ? 'Compáralo con su carné: es lo que decide a qué identidad se suma este gimnasio.'
                    : undefined
                }
              />
              {yaExiste ? null : (
                <Campo
                  etiqueta="Celular"
                  valor={celular}
                  onChange={setCelular}
                  placeholder="+51 987 654 321"
                  keyboardType="phone-pad"
                  pie="Es su llave única en toda la red: con este número entra a su app."
                />
              )}
            </Stack>
          </Card>
        </Stack>
      )}

      {yaExiste === null ? null : (
      <Stack gap={10} style={{ marginTop: 20 }}>
        <Eyebrow>Con qué plan empieza</Eyebrow>
        {planes.length === 0 ? (
          <Text variant="bodySmall" color={theme.colors.textSecondary}>
            Trayendo los planes del gimnasio…
          </Text>
        ) : (
          planes.map((opcion) => {
            const activo = opcion.id === planId;
            return (
              <Pressable
                key={opcion.id}
                accessibilityRole="radio"
                accessibilityState={{ selected: activo }}
                onPress={() => setPlanId(opcion.id)}
              >
                <Card
                  radius={theme.radii.lg}
                  borderColor={activo ? theme.semaphore.ok : theme.colors.hairline}
                >
                  <Row>
                    <Text variant="heading" weight="semibold">
                      {opcion.name}
                    </Text>
                    <Text variant="heading" weight="semibold">
                      {formatPEN(opcion.priceCents)}
                    </Text>
                  </Row>
                </Card>
              </Pressable>
            );
          })
        )}
      </Stack>
      )}

      <View
        style={{
          marginTop: 18,
          backgroundColor: withAlpha(theme.semaphore.ok, 0.07),
          borderWidth: 1,
          borderColor: withAlpha(theme.semaphore.ok, 0.2),
          borderRadius: theme.radii.lg,
          padding: 14,
        }}
      >
        <Text variant="captionSmall" color="#A9C9B4">
          Si ya entrena en otro local de la red, no se crea una persona nueva: se le suma
          este gimnasio a la billetera que ya tiene. Su historial no se parte en dos.
        </Text>
      </View>

      <Stack gap={8} style={{ marginTop: 20 }}>
        <Button
          label={guardando ? 'Inscribiendo…' : 'Inscribir'}
          disabled={!listo || guardando}
          onPress={() => {
            if (!listo || plan === null || guardando) return;
            setGuardando(true);
            setError(null);

            void inscribirAlumno({
              documentId: documento.trim(),
              ...(yaExiste ? {} : { name: nombre.trim(), phone: celular.trim() }),
              ...(correo.trim().length > 0 ? { email: correo.trim() } : {}),
              planId: plan.id,
            })
              .then((salida) => {
                // A la ficha recién creada: es donde se cobra la matrícula, que
                // es lo siguiente que pasa en el mostrador.
                router.replace({
                  pathname: '/member/[membershipId]',
                  params: { membershipId: salida.membershipId },
                });
              })
              .catch((causa: unknown) => {
                // El mensaje de la api es concreto y está en español —"ya existe
                // alguien con ese celular o ese documento"—. Reescribirlo aquí
                // solo lo empeoraría.
                setError(causa instanceof Error ? causa.message : 'No se pudo inscribir.');
                setFichaExistente(causa instanceof YaEnElPadron ? causa.membershipId : null);
              })
              .finally(() => setGuardando(false));
          }}
        />
        {error === null ? null : (
          <Text variant="captionSmall" color={theme.semaphore.bad} align="center">
            {error}
          </Text>
        )}
        {fichaExistente === null ? null : (
          <Button
            label="Abrir su ficha"
            variant="secondary"
            onPress={() =>
              router.replace({
                pathname: '/member/[membershipId]',
                params: { membershipId: fichaExistente },
              })
            }
          />
        )}
      </Stack>
    </Screen>
  );
}

function Campo({
  etiqueta,
  valor,
  onChange,
  placeholder,
  pie,
  keyboardType,
  autoCapitalize = 'sentences',
}: {
  readonly etiqueta: string;
  readonly valor: string;
  readonly onChange: (texto: string) => void;
  readonly placeholder: string;
  readonly pie?: string;
  readonly keyboardType?: 'number-pad' | 'phone-pad' | 'email-address';
  readonly autoCapitalize?: 'none' | 'sentences' | 'words';
}) {
  const theme = useTheme();
  return (
    <Stack gap={4}>
      <Text variant="captionSmall" color={theme.colors.textSecondary}>
        {etiqueta}
      </Text>
      <TextInput
        value={valor}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.textPlaceholder}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        accessibilityLabel={etiqueta}
        style={{
          color: theme.colors.ink,
          fontSize: 16,
          paddingVertical: 8,
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.hairline,
        }}
      />
      {pie === undefined ? null : (
        <Text variant="micro" color={theme.colors.textFaint}>
          {pie}
        </Text>
      )}
    </Stack>
  );
}
