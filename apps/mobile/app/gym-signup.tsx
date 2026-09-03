/**
 * Alta de un gimnasio, desde la app.
 *
 * Hasta aqui un gimnasio solo podia nacer de un script que corriamos nosotros.
 * Eso servia para los tres primeros clientes y no sirve para una oferta: quien
 * escucha «el primer mes es gratis» en un dojo el martes tiene que poder empezar
 * el martes.
 *
 * Un solo formulario y no un asistente de tres pasos. Son seis campos: partirlos
 * en pantallas anade tres toques y una barra de progreso para que el dueno vea
 * menos de lo que va a escribir, y lo que hace que abandone un alta es no saber
 * cuanto falta.
 *
 * El escalon se ELIGE aqui solo para que sepa cuanto le va a costar. Lo que se
 * le cobre sale del padron real, asi que equivocarse eligiendo no le cuesta
 * dinero — y por eso el texto no lo trata como una decision grave.
 */
import { useState } from 'react';
import { Pressable, TextInput } from 'react-native';
import { router } from 'expo-router';
import {
  SAAS_TIER_LABELS,
  SAAS_TIER_PRICES,
  checkRuc,
  formatPEN,
  rucDenialMessage,
  type SaasTier,
} from '@sinchi/shared';
import { withAlpha } from '@sinchi/ui';
import { Button, Card, Eyebrow, Row, Stack, Text } from '../src/design/primitives';
import { Screen } from '../src/design/screen';
import { useTheme } from '../src/design/theme';
import { registrarGimnasio } from '../src/data/actions';

const ESCALONES: readonly SaasTier[] = ['free', 'up_to_60', 'up_to_150', 'unlimited'];

export default function GymSignUpScreen() {
  const theme = useTheme();

  const [nombre, setNombre] = useState('');
  const [ruc, setRuc] = useState('');
  const [duenoNombre, setDuenoNombre] = useState('');
  const [documento, setDocumento] = useState('');
  const [celular, setCelular] = useState('+51');
  const [escalon, setEscalon] = useState<SaasTier>('free');
  const [codigo, setCodigo] = useState('');

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Se comprueba mientras escribe y solo cuando ya tiene los once digitos: decir
  // «RUC invalido» al tercer digito es reganar a alguien que va bien.
  const rucFalla = ruc.replace(/\D/g, '').length >= 11 ? checkRuc(ruc) : null;
  const listo =
    nombre.trim().length >= 3 && rucFalla === null && ruc.trim().length > 0 && documento.trim().length >= 6;

  const crear = async (): Promise<void> => {
    setError(null);
    setGuardando(true);
    try {
      const alta = await registrarGimnasio({
        gymName: nombre.trim(),
        taxId: ruc.trim(),
        saasTier: escalon,
        ownerName: duenoNombre.trim().length >= 2 ? duenoNombre.trim() : undefined,
        documentId: documento.trim(),
        phone: celular.trim().length >= 6 ? celular.trim() : undefined,
        promoCode: codigo.trim().length > 0 ? codigo.trim() : undefined,
      });

      /**
       * El alta deja la sesión de dueño puesta, así que se entra directo al
       * padrón: es donde está la cuenta atrás del mes gratis y el botón de
       * inscribir, que es lo único que un gimnasio recién creado puede hacer.
       * La puerta, vacía, no le dice nada todavía.
       */
      void alta;
      router.replace('/staff/padron');
    } catch (causa: unknown) {
      setError(causa instanceof Error ? causa.message : 'No se pudo crear el gimnasio.');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Screen scroll>
      <Stack gap={24} style={{ paddingVertical: 24 }}>
        <Stack gap={6}>
          <Eyebrow color={theme.semaphore.ok}>Tu gimnasio en Sinchi</Eyebrow>
          <Text variant="title">Regístralo</Text>
          <Text variant="bodySmall" color={theme.colors.textSecondary}>
            El primer mes es gratis. Después pagas según cuántos alumnos tengas, y
            hasta 10 no pagas nunca.
          </Text>
        </Stack>

        <Stack gap={18}>
          <Campo
            etiqueta="Nombre del gimnasio"
            valor={nombre}
            onChange={setNombre}
            placeholder="Dojo Shotokan Miraflores"
            autoCapitalize="words"
          />
          <Campo
            etiqueta="RUC"
            valor={ruc}
            onChange={setRuc}
            placeholder="20100070970"
            keyboardType="number-pad"
            pie={rucFalla === null ? 'El de la boleta que le das a tus alumnos.' : undefined}
            error={rucFalla === null ? undefined : rucDenialMessage(rucFalla)}
          />
        </Stack>

        <Stack gap={10}>
          <Eyebrow>¿Cuántos alumnos tienes?</Eyebrow>
          {ESCALONES.map((tier) => (
            <Escalon
              key={tier}
              tier={tier}
              elegido={escalon === tier}
              onPress={() => setEscalon(tier)}
            />
          ))}
          <Text variant="micro" color={theme.colors.textFaint}>
            Es solo para que sepas cuánto costará. Lo que se cobra sale de tu padrón
            real, así que elegir de más no te cuesta nada.
          </Text>
        </Stack>

        <Stack gap={18}>
          <Eyebrow>Tus datos</Eyebrow>
          <Campo
            etiqueta="Tu nombre"
            valor={duenoNombre}
            onChange={setDuenoNombre}
            placeholder="Como quieres que te vean tus alumnos"
            autoCapitalize="words"
          />
          <Campo
            etiqueta="Tu documento"
            valor={documento}
            onChange={setDocumento}
            placeholder="DNI o carné de extranjería"
            keyboardType="number-pad"
          />
          <Campo
            etiqueta="Tu celular"
            valor={celular}
            onChange={setCelular}
            placeholder="+51987654321"
            keyboardType="phone-pad"
          />
          <Campo
            etiqueta="Código de promoción (opcional)"
            valor={codigo}
            onChange={setCodigo}
            placeholder="Si tienes uno, suma meses gratis"
            autoCapitalize="none"
          />
        </Stack>

        {error === null ? null : (
          <Card borderColor={withAlpha(theme.semaphore.bad, 0.4)}>
            <Text variant="bodySmall" color={theme.semaphore.bad}>
              {error}
            </Text>
          </Card>
        )}

        <Button
          label={guardando ? 'Creando…' : 'Crear mi gimnasio'}
          onPress={() => void crear()}
          disabled={!listo || guardando}
        />
      </Stack>
    </Screen>
  );
}

/** Una fila por escalón, con su precio delante. */
function Escalon({
  tier,
  elegido,
  onPress,
}: {
  readonly tier: SaasTier;
  readonly elegido: boolean;
  readonly onPress: () => void;
}) {
  const theme = useTheme();
  const precio = SAAS_TIER_PRICES[tier];
  const gratis = precio === 0;

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: elegido }}
      accessibilityLabel={SAAS_TIER_LABELS[tier]}
      onPress={onPress}
    >
      <Card
        borderColor={elegido ? withAlpha(theme.semaphore.ok, 0.5) : theme.colors.hairline}
        style={{ paddingVertical: 14 }}
      >
        <Row>
          <Text variant="bodySmall" weight={elegido ? 'semibold' : 'regular'}>
            {SAAS_TIER_LABELS[tier]}
          </Text>
          <Text
            variant="bodySmall"
            weight="semibold"
            color={gratis ? theme.semaphore.ok : theme.colors.ink}
          >
            {gratis ? 'Gratis' : `${formatPEN(precio, { withDecimals: false })}/mes`}
          </Text>
        </Row>
      </Card>
    </Pressable>
  );
}

function Campo({
  etiqueta,
  valor,
  onChange,
  placeholder,
  pie,
  error,
  keyboardType,
  autoCapitalize = 'sentences',
}: {
  readonly etiqueta: string;
  readonly valor: string;
  readonly onChange: (texto: string) => void;
  readonly placeholder: string;
  readonly pie?: string | undefined;
  readonly error?: string | undefined;
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
          borderBottomColor:
            error === undefined ? theme.colors.hairline : withAlpha(theme.semaphore.bad, 0.6),
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
