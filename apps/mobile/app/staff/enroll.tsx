/**
 * Alta de un alumno en el mostrador.
 *
 * Faltaba entera, y su ausencia sostenía media app en el aire: vincular cuentas
 * exige una ficha del padrón contra la que vincular, el escáner valida contra un
 * padrón que nadie podía llenar, y las pantallas vacías del alumno le dicen «te
 * agregan con tu DNI» — apuntando a un flujo que no existía. `POST /staff/members`
 * llevaba escrito desde el principio sin que ninguna pantalla lo llamara.
 *
 * Los cuatro datos son los mínimos del dominio y ninguno es decorativo: el
 * documento es lo que recepción compara con el carné, el celular es la llave
 * ÚNICA en toda la red —es con lo que el alumno se reconoce— y el plan decide
 * desde el primer día qué puede hacer en la puerta.
 *
 * La identidad es global (MD 5). Si el celular o el documento ya existen, la api
 * reutiliza esa persona y le suma este gimnasio en vez de crear una segunda. Y
 * si coincide uno de los dos pero no el otro, se niega: es o un tipeo o dos
 * personas distintas, y adivinarlo es como se fusionan dos alumnos por error.
 */
import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { formatPEN } from '@sinchi/shared';
import { withAlpha } from '@sinchi/ui';
import { Button, Card, Eyebrow, Row, Stack, Text } from '../../src/design/primitives';
import { Screen } from '../../src/design/screen';
import { useTheme } from '../../src/design/theme';
import { usePlanesDelGimnasio } from '../../src/data/hooks';
import { inscribirAlumno } from '../../src/data/actions';

export default function EnrollScreen() {
  const theme = useTheme();
  const planes = usePlanesDelGimnasio();

  const [nombre, setNombre] = useState('');
  const [documento, setDocumento] = useState('');
  const [celular, setCelular] = useState('+51');
  const [correo, setCorreo] = useState('');
  const [planId, setPlanId] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const plan = planes.find((p) => p.id === planId) ?? null;
  const listo =
    nombre.trim().length >= 2 &&
    documento.trim().length >= 6 &&
    celular.trim().length >= 7 &&
    plan !== null;

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
        <Eyebrow>Quién es</Eyebrow>
        <Card radius={theme.radii.xl}>
          <Stack gap={16}>
            <Campo
              etiqueta="Nombre completo"
              valor={nombre}
              onChange={setNombre}
              placeholder="Como figura en su documento"
              autoCapitalize="words"
            />
            <Campo
              etiqueta="DNI o carné de extranjería"
              valor={documento}
              onChange={(texto) => setDocumento(texto.replace(/\s/g, ''))}
              placeholder="71448902"
              keyboardType="number-pad"
            />
            <Campo
              etiqueta="Celular"
              valor={celular}
              onChange={setCelular}
              placeholder="+51 987 654 321"
              keyboardType="phone-pad"
              pie="Es su llave única en toda la red: con este número entra a su app."
            />
            <Campo
              etiqueta="Correo (opcional)"
              valor={correo}
              onChange={setCorreo}
              placeholder="para vincular su cuenta de Google"
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </Stack>
        </Card>
      </Stack>

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
              name: nombre.trim(),
              documentId: documento.trim(),
              phone: celular.trim(),
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
