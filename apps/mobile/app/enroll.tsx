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
import { useGymPlans } from '../src/data/hooks';
import { existeIdentidad, enrollStudent, AlreadyInRoster } from '../src/data/actions';

/**
 * Lo que dice el pie del botón cuando no se puede inscribir.
 *
 * Con un solo problema, repite su motivo: leerlo debajo del botón que acabas de
 * tocar es más rápido que buscar cuál de los cuatro se puso rojo. Con varios,
 * los cuenta.
 */
function missingSummary(problems: Readonly<Record<string, string | undefined>>): string {
  const reasons = Object.values(problems).filter((r): r is string => r !== undefined);
  if (reasons.length === 1) return reasons[0]!;
  return `Faltan ${reasons.length} datos, marcados arriba en rojo.`;
}

/** Los campos del alta, para marcarlos de uno en uno. */
type EnrollField = 'name' | 'documentId' | 'phone' | 'plan';

export default function EnrollScreen() {
  const theme = useTheme();
  const plans = useGymPlans();

  const [correo, setCorreo] = useState('');
  // `null` = todavia no se ha comprobado el correo.
  const [alreadyExists, setAlreadyExists] = useState<boolean | null>(null);
  const [comprobando, setComprobando] = useState(false);

  const [name, setName] = useState('');
  const [documentId, setDocumentId] = useState('');
  const [phone, setPhone] = useState('+51');
  const [planId, setPlanId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Cuando la persona ya está en el padrón, la api dice cuál es su ficha. Es el
  // caso normal —alguien que canceló y vuelve— y no tiene sentido dejar al
  // mostrador leyendo "ya existe" sin un camino.
  const [existingRecord, setExistingRecord] = useState<string | null>(null);

  const plan = plans.find((p) => p.id === planId) ?? null;
  const correoValido = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo.trim());

  // Reutilizando identidad no hacen falta ni el nombre ni el celular: la api ya
  // los tiene, y pedirlos otra vez es teclear para confirmar lo que ya sabe.
  const ready =
    plan !== null &&
    documentId.trim().length >= 6 &&
    (alreadyExists === true || (name.trim().length >= 2 && phone.trim().length >= 7));

  /**
   * Que le falta a cada campo.
   *
   * El boton se apagaba sin decir nada, y esta pantalla se opera con el alumno
   * delante del mostrador: quien la usa no puede ponerse a tocar campos a ver
   * cual despierta el boton mientras alguien espera.
   */
  const problems: Readonly<Partial<Record<EnrollField, string>>> = {
    ...(documentId.trim().length === 0
      ? { documentId: 'Falta su documento.' }
      : documentId.trim().length < 6
        ? { documentId: 'Un DNI tiene 8 dígitos; un carné de extranjería, 9.' }
        : {}),
    ...(alreadyExists === true
      ? {}
      : {
          ...(name.trim().length < 2 ? { name: 'Falta su nombre completo.' } : {}),
          ...(phone.trim().length < 7
            ? { phone: 'Falta su celular: es su llave única en toda la red.' }
            : {}),
        }),
    ...(plan === null ? { plan: 'Elige con qué plan entra.' } : {}),
  };

  const [attempted, setAttempted] = useState(false);
  const denial = (field: EnrollField): string | undefined =>
    attempted ? problems[field] : undefined;

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
            <LabeledInput
              label="Correo"
              value={correo}
              onChange={(text) => {
                setCorreo(text);
                setAlreadyExists(null);
              }}
              placeholder="alumno@correo.com"
              keyboardType="email-address"
              autoCapitalize="none"
              pie="Con él, su cuenta se activa sola al entrar con Google."
            />

            {alreadyExists === null ? (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: !correoValido || comprobando }}
                onPress={() => {
                  if (!correoValido || comprobando) return;
                  setComprobando(true);
                  setError(null);
                  void existeIdentidad(correo.trim())
                    .then(setAlreadyExists)
                    .catch(() => setAlreadyExists(false))
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
                  {alreadyExists
                    ? 'Ya hay una identidad Sinchi con ese correo. Confirma su documento y se le suma este gimnasio.'
                    : 'No hay ninguna identidad con ese correo. Hacen falta su nombre y su celular.'}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  hitSlop={10}
                  onPress={() => setAlreadyExists(null)}
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

      {alreadyExists === null ? null : (
        <Stack gap={10} style={{ marginTop: 20 }}>
          <Eyebrow>{alreadyExists ? 'Confirma quién es' : 'Quién es'}</Eyebrow>
          <Card radius={theme.radii.xl}>
            <Stack gap={16}>
              {alreadyExists ? null : (
                <LabeledInput
                  label="Nombre completo"
                  value={name}
                  onChange={setName}
                  placeholder="Como figura en su documento"
                  autoCapitalize="words"
                  error={denial('name')}
                />
              )}
              <LabeledInput
                label="DNI o carné de extranjería"
                value={documentId}
                onChange={(text) => setDocumentId(text.replace(/\s/g, ''))}
                placeholder="71448902"
                keyboardType="number-pad"
                pie={
                  alreadyExists
                    ? 'Compáralo con su carné: es lo que decide a qué identidad se suma este gimnasio.'
                    : undefined
                }
                error={denial('documentId')}
              />
              {alreadyExists ? null : (
                <LabeledInput
                  label="Celular"
                  value={phone}
                  onChange={setPhone}
                  placeholder="+51 987 654 321"
                  keyboardType="phone-pad"
                  pie="Es su llave única en toda la red: con este número entra a su app."
                  error={denial('phone')}
                />
              )}
            </Stack>
          </Card>
        </Stack>
      )}

      {alreadyExists === null ? null : (
      <Stack gap={10} style={{ marginTop: 20 }}>
        <Eyebrow>Con qué plan empieza</Eyebrow>
        {plans.length === 0 ? (
          <Text variant="bodySmall" color={theme.colors.textSecondary}>
            Trayendo los planes del gimnasio…
          </Text>
        ) : (
          plans.map((option) => {
            const active = option.id === planId;
            return (
              <Pressable
                key={option.id}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                onPress={() => setPlanId(option.id)}
              >
                <Card
                  radius={theme.radii.lg}
                  borderColor={active ? theme.semaphore.ok : theme.colors.hairline}
                >
                  <Row>
                    <Text variant="heading" weight="semibold">
                      {option.name}
                    </Text>
                    <Text variant="heading" weight="semibold">
                      {formatPEN(option.priceCents)}
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
        {/* El plan se elige de una lista, no de un campo, así que su motivo no
            tiene dónde pintarse en rojo: se dice aquí, junto al botón que no
            responde. Con varios campos mal, los cuenta — los rojos ya están
            puestos arriba y repetirlos tapa la pantalla. */}
        {attempted && !ready ? (
          <Text variant="caption" color={theme.semaphore.bad} align="center">
            {missingSummary(problems)}
          </Text>
        ) : null}
        <Button
          label={saving ? 'Inscribiendo…' : 'Inscribir'}
          disabled={!ready || saving}
          onBlockedPress={saving ? undefined : () => setAttempted(true)}
          onPress={() => {
            if (!ready || plan === null || saving) return;
            setSaving(true);
            setError(null);

            void enrollStudent({
              documentId: documentId.trim(),
              ...(alreadyExists ? {} : { name: name.trim(), phone: phone.trim() }),
              ...(correo.trim().length > 0 ? { email: correo.trim() } : {}),
              planId: plan.id,
            })
              .then((outcome) => {
                // A la ficha recién creada: es donde se cobra la matrícula, que
                // es lo siguiente que pasa en el mostrador.
                router.replace({
                  pathname: '/member/[membershipId]',
                  params: { membershipId: outcome.membershipId },
                });
              })
              .catch((causa: unknown) => {
                // El mensaje de la api es concreto y está en español —"ya existe
                // alguien con ese celular o ese documento"—. Reescribirlo aquí
                // solo lo empeoraría.
                setError(causa instanceof Error ? causa.message : 'No se pudo inscribir.');
                setExistingRecord(causa instanceof AlreadyInRoster ? causa.membershipId : null);
              })
              .finally(() => setSaving(false));
          }}
        />
        {error === null ? null : (
          <Text variant="captionSmall" color={theme.semaphore.bad} align="center">
            {error}
          </Text>
        )}
        {existingRecord === null ? null : (
          <Button
            label="Abrir su ficha"
            variant="secondary"
            onPress={() =>
              router.replace({
                pathname: '/member/[membershipId]',
                params: { membershipId: existingRecord },
              })
            }
          />
        )}
      </Stack>
    </Screen>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
  pie,
  error,
  keyboardType,
  autoCapitalize = 'sentences',
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (text: string) => void;
  readonly placeholder: string;
  readonly pie?: string;
  /** Qué le falta a este campo. Lo pinta en rojo y lo dice debajo, como `Field`. */
  readonly error?: string | undefined;
  readonly keyboardType?: 'number-pad' | 'phone-pad' | 'email-address';
  readonly autoCapitalize?: 'none' | 'sentences' | 'words';
}) {
  const theme = useTheme();
  return (
    <Stack gap={4}>
      <Text variant="captionSmall" color={theme.colors.textSecondary}>
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.textPlaceholder}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        accessibilityLabel={label}
        style={{
          color: theme.colors.ink,
          fontSize: 16,
          paddingVertical: 8,
          borderBottomWidth: 1,
          borderBottomColor:
            error === undefined ? theme.colors.hairline : theme.semaphore.bad,
        }}
      />
      {error !== undefined ? (
        <Text variant="micro" color={theme.semaphore.bad}>
          {error}
        </Text>
      ) : pie === undefined ? null : (
        <Text variant="micro" color={theme.colors.textFaint}>
          {pie}
        </Text>
      )}
    </Stack>
  );
}
