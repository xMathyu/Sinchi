/**
 * Alta de un gimnasio, desde la app.
 *
 * Hasta aqui un gimnasio solo podia nacer de un script que corriamos nosotros.
 * Eso servia para los tres primeros clientes y no sirve para una oferta: quien
 * escucha «el primer mes es gratis» en un dojo el martes tiene que poder empezar
 * el martes.
 *
 * Cuatro vistas y no un formulario largo. La version anterior era UNA pantalla
 * con seis campos, y el argumento para no partirla era bueno: «lo que hace que
 * abandone un alta es no saber cuanto falta». Pero esa pantalla crecio — ahora
 * lleva delante la oferta, los escalones y lo que incluye — y un scroll de dos
 * mil pixeles esconde el precio igual de bien que un asistente sin barra de
 * progreso. Asi que se parte, y la objecion se responde donde nacio: el «Paso N
 * de 2» y la barra estan a la vista desde el primer campo, y son DOS pasos, no
 * tres.
 *
 * El orden importa: primero se vende y despues se pide. La vista de la oferta se
 * ve sin cuenta —es lo unico de este flujo que se puede mirar sin dar nada— y la
 * cuenta se crea recien al tocar «Empezar gratis», porque `registrarGimnasio`
 * necesita una credencial de Firebase para firmar el alta.
 *
 * El escalon se ELIGE aqui solo para que sepa cuanto le va a costar. Lo que se
 * le cobre sale del padron real, asi que equivocarse eligiendo no le cuesta
 * dinero — y por eso el texto no lo trata como una decision grave.
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import CalendarDays from 'lucide-react-native/icons/calendar-days';
import Check from 'lucide-react-native/icons/check';
import ChevronLeft from 'lucide-react-native/icons/chevron-left';
import CreditCard from 'lucide-react-native/icons/credit-card';
import QrCode from 'lucide-react-native/icons/qr-code';
import ShieldCheck from 'lucide-react-native/icons/shield-check';
import Users from 'lucide-react-native/icons/users';
import type { LucideIcon } from 'lucide-react-native';
import {
  SAAS_FREE_TIER_LIMIT,
  SAAS_GRACE_DAYS,
  SAAS_TIER_LABELS,
  SAAS_TIER_PRICES,
  checkPlanDraft,
  checkRuc,
  formatPEN,
  planDenialMessage,
  isFreeTier,
  rucDenialMessage,
  type SaasTier,
} from '@sinchi/shared';
import { withAlpha } from '@sinchi/ui';
import { Button, Card, Eyebrow, Field, Row, Stack, Text } from '../src/design/primitives';
import { Screen } from '../src/design/screen';
import { useTheme } from '../src/design/theme';
import { registrarGimnasio } from '../src/data/actions';
import { completeEmailSignIn } from '../src/data/auth';
import { firebaseConfigured } from '../src/data/firebase';
import { currentAccountDetails } from '../src/data/session';
import { aCentimos } from '../src/lib/format';
import { useSession } from '../src/data/session-hooks';

const ESCALONES: readonly SaasTier[] = ['free', 'up_to_60', 'up_to_150', 'unlimited'];

/** Etiqueta corta para la pastilla. La larga la da `SAAS_TIER_LABELS`. */
const PASTILLA: Readonly<Record<SaasTier, string>> = {
  free: `Hasta ${SAAS_FREE_TIER_LIMIT}`,
  up_to_60: `${SAAS_FREE_TIER_LIMIT + 1}–60`,
  up_to_150: '61–150',
  unlimited: '+150',
};

/**
 * Las cuatro vistas.
 *
 * `cuenta` solo aparece para quien llega sin sesion. Por eso no entra en el
 * contador: los pasos del ALTA son dos, y crear la cuenta es el peaje de
 * entrada, no una parte del alta.
 */
type Paso = 'oferta' | 'cuenta' | 'plan' | 'datos';

/** Los campos del ultimo paso que pueden estar mal, para marcarlos uno a uno. */
type CampoDelAlta = 'nombre' | 'ruc' | 'documento' | 'mensualidad';

/** Los de la cuenta, que es otro formulario y falla por otras razones. */
type CampoDeLaCuenta = 'duenoNombre' | 'correo' | 'clave' | 'celular';

export default function GymSignUpScreen() {
  const theme = useTheme();
  const sesion = useSession();

  const [paso, setPaso] = useState<Paso>('oferta');

  const [nombre, setNombre] = useState('');
  const [ruc, setRuc] = useState('');
  const [duenoNombre, setDuenoNombre] = useState('');
  const [documento, setDocumento] = useState('');
  const [celular, setCelular] = useState('+51');
  const [escalon, setEscalon] = useState<SaasTier>('free');
  const [codigo, setCodigo] = useState('');
  const [mensualidad, setMensualidad] = useState('');

  // Solo para crear la cuenta, cuando hace falta. El nombre y el celular NO se
  // repiten aqui: son los mismos campos que pide el ultimo paso.
  const [correo, setCorreo] = useState('');
  const [clave, setClave] = useState('');

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Quien llega ya vinculado a un padron no puede registrar un gimnasio.
   *
   * `currentFirebaseToken` —lo que firma el alta— solo existe en el estado
   * `unlinked`. No se arregla aqui; se avisa antes de que llene cinco campos
   * para nada.
   */
  const necesitaCuenta = sesion.status === 'signed_out';
  /**
   * Solo `signed_in` es el callejon: una cuenta con ficha en un padron. Ni
   * `loading` ni `demo` lo son, y tratarlos como tal pintaba el aviso durante el
   * arranque y en el modo de demostracion, donde no significa nada.
   */
  const yaEsAlumno = sesion.status === 'signed_in';

  // Si llego con la cuenta ya hecha, lo que dio al registrarse se reusa. Volver
  // a preguntar el nombre y el celular a quien acaba de escribirlos es la queja
  // que este producto ya se comio una vez.
  useEffect(() => {
    if (paso !== 'datos') return;
    const datos = currentAccountDetails();
    if (datos === null) return;
    setDuenoNombre((previo) => (previo.trim().length > 0 ? previo : (datos.fullName ?? '')));
    setCelular((previo) => (previo.trim().length > 3 ? previo : (datos.phone ?? '+51')));
  }, [paso]);

  /**
   * Que le falta a cada campo, por su nombre.
   *
   * Antes esto era un solo booleano —`listo`— y por eso el boton se apagaba sin
   * decir nada: la pantalla sabia que el formulario no valia pero no por cual de
   * los cinco campos, asi que no tenia como pintar ninguno en rojo. Un mapa por
   * campo cuesta lo mismo de calcular y es lo que deja marcar el que falla.
   */
  const digitosDelRuc = ruc.replace(/\D/g, '').length;
  const rucFalla = digitosDelRuc >= 11 ? checkRuc(ruc) : null;

  /**
   * La mensualidad, comprobada con la MISMA funcion que la api.
   *
   * `checkPlanDraft` es lo que corre `POST /gyms/signup` antes de escribir la
   * tarifa, asi que el campo se pone rojo por el motivo exacto por el que el
   * alta habria respondido 400 — y no despues de haber llenado seis campos.
   */
  const centimosDeLaMensualidad = aCentimos(mensualidad);
  const planFalla =
    centimosDeLaMensualidad === null
      ? null
      : checkPlanDraft({
          name: 'Mensualidad',
          type: 'unlimited',
          sessionsPerWeek: null,
          allowedDays: null,
          priceCents: centimosDeLaMensualidad,
        });

  const problemas: Readonly<Partial<Record<CampoDelAlta, string>>> = {
    ...(nombre.trim().length === 0
      ? { nombre: 'Escribe el nombre de tu gimnasio.' }
      : nombre.trim().length < 3
        ? { nombre: 'Al menos 3 letras: es el nombre que van a buscar tus alumnos.' }
        : {}),
    ...(ruc.trim().length === 0
      ? { ruc: 'Falta tu RUC. Es el de la boleta que le das a tus alumnos.' }
      : digitosDelRuc < 11
        ? { ruc: 'El RUC tiene 11 dígitos.' }
        : rucFalla !== null
          ? { ruc: rucDenialMessage(rucFalla) }
          : {}),
    ...(documento.trim().length === 0
      ? { documento: 'Falta tu documento: es lo que te identifica en la red.' }
      : documento.trim().length < 6
        ? { documento: 'Un DNI tiene 8 dígitos; un carné de extranjería, 9.' }
        : {}),
    ...(mensualidad.trim().length === 0
      ? { mensualidad: 'Escribe cuánto cobras al mes: sin una tarifa no puedes inscribir a nadie.' }
      : centimosDeLaMensualidad === null
        ? { mensualidad: 'Escríbelo en soles, con números: 120 o 120.50.' }
        : planFalla !== null
          ? { mensualidad: planDenialMessage(planFalla) }
          : {}),
  };
  const listo = Object.keys(problemas).length === 0;

  /**
   * Si ya intento guardar.
   *
   * Los errores no se pintan mientras escribe —marcar en rojo un campo vacio que
   * todavia no ha tocado es reganarle por ir en orden— sino cuando toca el boton
   * y el boton no hace nada. Ese es justo el momento en que necesita saber por
   * que.
   */
  const [intentado, setIntentado] = useState(false);

  /**
   * Lo que SI se dice mientras escribe: un dato completo y equivocado.
   *
   * Un RUC de once digitos con el verificador mal no esta a medias, esta mal, y
   * callarlo hasta el boton obliga a volver a un campo que ya se dio por hecho.
   * Vacio es otra cosa: eso es ir en orden.
   */
  const enVivo = (campo: CampoDelAlta): boolean => campo === 'ruc' && digitosDelRuc >= 11;

  const falla = (campo: CampoDelAlta): string | undefined =>
    intentado || enVivo(campo) ? problemas[campo] : undefined;

  /** Lo mismo para el formulario de la cuenta, que falla por otras razones. */
  const problemasDeCuenta: Readonly<Partial<Record<CampoDeLaCuenta, string>>> = {
    ...(duenoNombre.trim().length < 2 ? { duenoNombre: 'Escribe tu nombre.' } : {}),
    ...(correo.trim().length === 0
      ? { correo: 'Falta tu correo.' }
      : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo.trim())
        ? { correo: 'Ese correo no tiene forma de correo. Revisa la arroba y el punto.' }
        : {}),
    ...(clave.length === 0
      ? { clave: 'Falta la contraseña.' }
      : clave.length < 6
        ? { clave: 'La contraseña va de 6 caracteres para arriba.' }
        : {}),
    ...(celular.trim().length < 8
      ? { celular: 'Falta tu celular, con el código del país: +51987654321.' }
      : {}),
  };
  const cuentaLista = Object.keys(problemasDeCuenta).length === 0;
  const fallaDeCuenta = (campo: CampoDeLaCuenta): string | undefined =>
    intentado ? problemasDeCuenta[campo] : undefined;

  // Cada paso es un formulario distinto: entrar al siguiente con los rojos del
  // anterior ya puestos marca campos que esta persona no ha llegado a tocar.
  useEffect(() => {
    setIntentado(false);
  }, [paso]);

  const irADatos = (): void => {
    setError(null);
    setPaso('datos');
  };

  const crearCuenta = (): void => {
    setError(null);
    setGuardando(true);
    void completeEmailSignIn(correo, clave, 'signUp', {
      fullName: duenoNombre.trim(),
      phone: celular.trim(),
    }).then((outcome) => {
      setGuardando(false);
      if (outcome.kind === 'error') {
        setError(outcome.message);
        return;
      }
      // `needs_link` es el resultado ESPERADO: quien registra un gimnasio no
      // tiene ficha en ningun padron, y ese es justo el estado que deja la
      // credencial con la que se firma el alta.
      setPaso('plan');
    });
  };

  const crear = async (): Promise<void> => {
    setError(null);
    setGuardando(true);
    try {
      const alta = await registrarGimnasio({
        gymName: nombre.trim(),
        taxId: ruc.trim(),
        saasTier: escalon,
        monthlyPriceCents: centimosDeLaMensualidad ?? 0,
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

  const avisoDeError =
    error === null ? null : (
      <Card borderColor={withAlpha(theme.semaphore.bad, 0.4)} style={{ marginTop: 18 }}>
        <Text variant="bodySmall" color={theme.semaphore.bad}>
          {error}
        </Text>
      </Card>
    );

  // -------------------------------------------------------------------------
  // La oferta
  // -------------------------------------------------------------------------

  if (paso === 'oferta') {
    return (
      <Screen scroll style={{ flexGrow: 1 }}>
        <Stack gap={0} style={{ flex: 1, paddingBottom: 8 }}>
          <Volver etiqueta="Entrar" onPress={() => router.back()} />

          <Eyebrow color={theme.semaphore.ok} style={{ marginTop: 14 }}>
            Tu gimnasio en Sinchi
          </Eyebrow>

          <Text variant="hero" weight="black" style={{ marginTop: 10 }}>
            Cobra sin perseguir a nadie
          </Text>

          <Text variant="body" color={theme.colors.textStrong} style={{ marginTop: 12 }}>
            Membresías que se cobran solas, puerta con QR y un padrón que te dice de
            un vistazo quién está al día.
          </Text>

          <Card
            borderColor={withAlpha(theme.semaphore.ok, 0.28)}
            style={{ marginTop: 22 }}
          >
            <Stack gap={10}>
              <Promesa texto={`Hasta ${SAAS_FREE_TIER_LIMIT} alumnos, gratis para siempre`} />
              <Promesa texto="Primer mes gratis cuando pases a pagar" />
              <Promesa texto="Sin tarjeta para empezar" />
            </Stack>
          </Card>

          <Eyebrow style={{ marginTop: 28 }}>Todo esto entra en cualquier escalón</Eyebrow>

          <Stack gap={14} style={{ marginTop: 14 }}>
            <Beneficio
              icono={Users}
              titulo="Padrón con semáforo"
              cuerpo="Quién está al día y quién debe."
            />
            <Beneficio
              icono={QrCode}
              titulo="Puerta con QR"
              cuerpo="El alumno muestra su código; ves verde o rojo."
            />
            <Beneficio
              icono={CreditCard}
              titulo="Cobro por adelantado"
              cuerpo="Se cobra solo y avisa si alguien se atrasa."
            />
            <Beneficio
              icono={CalendarDays}
              titulo="Clases de prueba"
              cuerpo="Sales en el directorio de la red."
            />
          </Stack>

          {yaEsAlumno ? (
            <Card borderColor={withAlpha(theme.semaphore.warn, 0.4)} style={{ marginTop: 22 }}>
              <Text variant="bodySmall" color={theme.semaphore.warn}>
                Esta cuenta ya está vinculada a un gimnasio como alumno. Para registrar
                el tuyo, sal de la sesión y entra con otro correo.
              </Text>
            </Card>
          ) : null}

          <Stack gap={12} style={{ marginTop: 'auto', paddingTop: 26 }}>
            <Button
              label="Empezar gratis"
              onPress={() => setPaso(necesitaCuenta ? 'cuenta' : 'plan')}
            />
            <Text variant="caption" color={theme.colors.textFaint} align="center">
              Son dos pasos y no pedimos tarjeta.
            </Text>
          </Stack>
        </Stack>
      </Screen>
    );
  }

  // -------------------------------------------------------------------------
  // La cuenta, solo para quien llega sin sesion
  // -------------------------------------------------------------------------

  if (paso === 'cuenta') {
    return (
      <Screen scroll style={{ flexGrow: 1 }}>
        <Stack gap={0} style={{ flex: 1, paddingBottom: 8 }}>
          <Volver etiqueta="Atrás" onPress={() => setPaso('oferta')} />

          <Text variant="title" weight="bold" style={{ marginTop: 22 }}>
            Crea tu cuenta
          </Text>
          <Text variant="bodySmall" color={theme.colors.textSecondary} style={{ marginTop: 8 }}>
            Es la cuenta con la que vas a entrar a administrar tu gimnasio, y con la
            que el alta queda a tu nombre.
          </Text>

          {avisoDeError}

          {firebaseConfigured() ? (
            <>
              <Stack gap={14} style={{ marginTop: 24 }}>
                <Field
                  label="Tu nombre"
                  value={duenoNombre}
                  onChangeText={setDuenoNombre}
                  placeholder="Nombre y apellido"
                  autoCapitalize="words"
                  autoComplete="name"
                  editable={!guardando}
                  error={fallaDeCuenta('duenoNombre')}
                />
                <Field
                  label="Correo"
                  value={correo}
                  onChangeText={setCorreo}
                  placeholder="tucorreo@ejemplo.com"
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  editable={!guardando}
                  error={fallaDeCuenta('correo')}
                />
                <Field
                  label="Contraseña"
                  value={clave}
                  onChangeText={setClave}
                  placeholder="Al menos 6 caracteres"
                  secureTextEntry
                  autoCapitalize="none"
                  autoComplete="new-password"
                  editable={!guardando}
                  error={fallaDeCuenta('clave')}
                />
                <Field
                  label="Tu celular"
                  value={celular}
                  onChangeText={setCelular}
                  placeholder="+51987654321"
                  keyboardType="phone-pad"
                  autoComplete="tel"
                  editable={!guardando}
                  hint="Es con lo que te ubicamos si algo pasa con tu cuenta."
                  error={fallaDeCuenta('celular')}
                />
              </Stack>

              <View style={{ marginTop: 'auto', paddingTop: 26 }}>
                <Button
                  label={guardando ? 'Creando…' : 'Crear cuenta y seguir'}
                  disabled={!cuentaLista || guardando}
                  onPress={crearCuenta}
                  onBlockedPress={guardando ? undefined : () => setIntentado(true)}
                />
                {intentado && !cuentaLista ? (
                  <Text
                    variant="caption"
                    color={theme.semaphore.bad}
                    align="center"
                    style={{ marginTop: 10 }}
                  >
                    {resumenDeFaltantes(problemasDeCuenta)}
                  </Text>
                ) : null}
              </View>
            </>
          ) : (
            <Card
              borderColor={withAlpha(theme.semaphore.bad, 0.4)}
              style={{ marginTop: 24 }}
            >
              <Text variant="bodySmall" color={theme.semaphore.bad}>
                Este build no trae configuración de Firebase (ver `.env.example`), así
                que no se puede crear la cuenta.
              </Text>
            </Card>
          )}

          {guardando && <ActivityIndicator color={theme.colors.ink} style={{ marginTop: 16 }} />}
        </Stack>
      </Screen>
    );
  }

  // -------------------------------------------------------------------------
  // Paso 1 de 2 — el plan
  // -------------------------------------------------------------------------

  if (paso === 'plan') {
    const precio = SAAS_TIER_PRICES[escalon];
    const gratis = isFreeTier(escalon);
    const nota = gratis
      ? `Con ${SAAS_FREE_TIER_LIMIT} alumnos o menos no se te cobra. Ni ahora ni en un año.`
      : 'Arrancas sin pagar: el primer cobro te llega recién al mes.';

    return (
      <Screen scroll style={{ flexGrow: 1 }}>
        <Stack gap={0} style={{ flex: 1, paddingBottom: 8 }}>
          <Volver
            etiqueta="Atrás"
            onPress={() => setPaso(necesitaCuenta ? 'cuenta' : 'oferta')}
          />

          <Progreso hechos={1} />

          <Text variant="title" weight="bold" style={{ marginTop: 14 }}>
            Tu plan
          </Text>
          <Text variant="bodySmall" color={theme.colors.textSecondary} style={{ marginTop: 8 }}>
            Elige por los alumnos que tienes hoy. Equivocarte no te cuesta nada.
          </Text>

          <Eyebrow style={{ marginTop: 22 }}>¿Cuántos alumnos tienes?</Eyebrow>

          <Row gap={8} style={{ marginTop: 12 }}>
            {ESCALONES.map((tier) => (
              <Pastilla
                key={tier}
                tier={tier}
                elegido={escalon === tier}
                onPress={() => setEscalon(tier)}
              />
            ))}
          </Row>

          <Card padded={false} style={{ marginTop: 18, padding: 22 }} radius={theme.radii.xxl}>
            <Stack gap={10}>
              <Text variant="bodySmall" color={theme.colors.textSecondary}>
                {SAAS_TIER_LABELS[escalon]}
              </Text>
              <Row gap={9} justify="flex-start" align="baseline">
                <Text
                  variant="hero"
                  weight="black"
                  color={gratis ? theme.semaphore.ok : theme.colors.ink}
                >
                  {gratis ? 'Gratis' : formatPEN(precio, { withDecimals: false })}
                </Text>
                <Text variant="bodySmall" color={theme.colors.textFaint}>
                  {gratis ? 'para siempre' : 'al mes'}
                </Text>
              </Row>
              <View
                style={{
                  alignSelf: 'flex-start',
                  backgroundColor: withAlpha(theme.semaphore.ok, 0.12),
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  borderRadius: theme.radii.pill,
                }}
              >
                <Eyebrow color={theme.semaphore.ok}>
                  {gratis ? 'No pagas nunca' : '1er mes gratis'}
                </Eyebrow>
              </View>
              <Text variant="caption" color={theme.colors.textSecondary}>
                {nota}
              </Text>
            </Stack>
          </Card>

          <Row gap={12} align="flex-start" justify="flex-start" style={{ marginTop: 16 }}>
            <ShieldCheck size={18} color={theme.colors.textTertiary} style={{ marginTop: 1 }} />
            <Text variant="caption" color={theme.colors.textTertiary} style={{ flex: 1 }}>
              Se cobra según tu padrón real: si creces sube solo, y si bajas baja solo.
            </Text>
          </Row>

          {/* El codigo vive con el precio y no al final del formulario: es una
              pregunta sobre cuanto va a pagar, no un dato de contacto. */}
          <View style={{ marginTop: 22 }}>
            <Field
              label="Código de promoción (opcional)"
              value={codigo}
              onChangeText={setCodigo}
              placeholder="Si tienes uno, suma meses gratis"
              autoCapitalize="none"
              optional
            />
          </View>

          <View style={{ marginTop: 'auto', paddingTop: 26 }}>
            <Button label="Continuar" onPress={irADatos} />
          </View>
        </Stack>
      </Screen>
    );
  }

  // -------------------------------------------------------------------------
  // Paso 2 de 2 — los datos
  // -------------------------------------------------------------------------

  return (
    <Screen scroll style={{ flexGrow: 1 }}>
      <Stack gap={0} style={{ flex: 1, paddingBottom: 8 }}>
        <Volver etiqueta="Tu plan" onPress={() => setPaso('plan')} />

        <Progreso hechos={2} />

        <Text variant="titleSmall" weight="bold" style={{ marginTop: 14 }}>
          Últimos datos
        </Text>

        {avisoDeError}

        <Eyebrow style={{ marginTop: 20 }}>Tu gimnasio</Eyebrow>

        <Stack gap={14} style={{ marginTop: 10 }}>
          <Field
            label="Nombre del gimnasio"
            value={nombre}
            onChangeText={setNombre}
            placeholder="Dojo Shotokan Miraflores"
            autoCapitalize="words"
            editable={!guardando}
            error={falla('nombre')}
          />
          <Field
            label="RUC"
            value={ruc}
            onChangeText={setRuc}
            placeholder="20100070970"
            keyboardType="number-pad"
            editable={!guardando}
            hint="El de la boleta que le das a tus alumnos."
            error={falla('ruc')}
          />
        </Stack>

        {/* La tarifa se pide AQUI, en el alta, y no se propone.
            El local nacia con cuatro tarifas de ejemplo para que pudiera
            inscribir desde el primer dia, y el efecto fue peor que el problema:
            el directorio anunciaba «desde S/ 120 al mes» a gimnasios que no
            habian escrito un precio. Un precio inventado, puesto donde la gente
            compara dojos, es una mentira con nuestra letra. Es UNA sola —lo
            justo para que el local funcione— y las demas se escriben despues,
            ya sabiendo lo que se cobra. */}
        <Eyebrow style={{ marginTop: 20 }}>Tu mensualidad</Eyebrow>

        <Stack gap={14} style={{ marginTop: 10 }}>
          <Field
            label="Cuánto cobras al mes, en soles"
            value={mensualidad}
            onChangeText={setMensualidad}
            placeholder="120"
            keyboardType="decimal-pad"
            editable={!guardando}
            hint="Se crea como «Mensualidad», sin límite de sesiones. Puedes cambiarla y añadir más tarifas —dos veces por semana, clase suelta— desde Padrón → Planes."
            error={falla('mensualidad')}
          />
        </Stack>

        <Eyebrow style={{ marginTop: 20 }}>Sobre ti</Eyebrow>

        <Stack gap={14} style={{ marginTop: 10 }}>
          <Field
            label="Tu nombre"
            value={duenoNombre}
            onChangeText={setDuenoNombre}
            placeholder="Como quieres que te vean tus alumnos"
            autoCapitalize="words"
            editable={!guardando}
          />
          <Field
            label="Tu documento"
            value={documento}
            onChangeText={setDocumento}
            placeholder="DNI o carné de extranjería"
            keyboardType="number-pad"
            editable={!guardando}
            error={falla('documento')}
          />
          <Field
            label="Tu celular"
            value={celular}
            onChangeText={setCelular}
            placeholder="+51987654321"
            keyboardType="phone-pad"
            editable={!guardando}
          />
        </Stack>

        <Stack gap={12} style={{ marginTop: 'auto', paddingTop: 26 }}>
          <Button
            label={guardando ? 'Creando…' : 'Crear mi gimnasio'}
            onPress={() => void crear()}
            disabled={!listo || guardando}
            onBlockedPress={guardando ? undefined : () => setIntentado(true)}
          />
          {intentado && !listo ? (
            <Text variant="caption" color={theme.semaphore.bad} align="center">
              {resumenDeFaltantes(problemas)}
            </Text>
          ) : null}
          <Text variant="caption" color={theme.colors.textFaint} align="center">
            Sin tarjeta. Si un mes te atrasas tienes {SAAS_GRACE_DAYS} días de gracia y
            la puerta de tus alumnos nunca se cierra.
          </Text>
        </Stack>
      </Stack>
    </Screen>
  );
}

/**
 * Lo que dice el pie del boton cuando no se puede guardar.
 *
 * Con un solo campo mal, repite su motivo: leerlo debajo del boton que acabas de
 * tocar es mas rapido que buscar cual de los cinco se puso rojo. Con varios, los
 * cuenta — repetir tres frases ahi abajo tapa la pantalla, y los rojos ya estan
 * puestos arriba.
 */
function resumenDeFaltantes(problemas: Readonly<Record<string, string | undefined>>): string {
  const motivos = Object.values(problemas).filter(
    (motivo): motivo is string => motivo !== undefined,
  );
  if (motivos.length === 1) return motivos[0]!;
  return `Faltan ${motivos.length} campos, marcados arriba en rojo.`;
}

/** Fila de vuelta, con los 44px que exige un objetivo tactil. */
function Volver({
  etiqueta,
  onPress,
}: {
  readonly etiqueta: string;
  readonly onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Volver a ${etiqueta}`}
      onPress={onPress}
      style={{ height: 44, marginLeft: -8, paddingHorizontal: 8, justifyContent: 'center' }}
    >
      <Row gap={6} justify="flex-start">
        <ChevronLeft size={16} color={theme.colors.textSecondary} />
        <Text variant="bodySmall" color={theme.colors.textSecondary}>
          {etiqueta}
        </Text>
      </Row>
    </Pressable>
  );
}

/**
 * Cuanto falta, dicho sin rodeos.
 *
 * Es la respuesta a la objecion que mantuvo esta pantalla en un solo formulario
 * durante toda su primera version: quien no sabe cuanto le queda, abandona.
 */
function Progreso({ hechos }: { readonly hechos: 1 | 2 }) {
  return (
    <Row gap={12} justify="flex-start" style={{ marginTop: 10 }}>
      <Row gap={5} justify="flex-start">
        <Tramo lleno />
        <Tramo lleno={hechos === 2} />
      </Row>
      <Eyebrow>Paso {hechos} de 2</Eyebrow>
    </Row>
  );
}

function Tramo({ lleno = false }: { readonly lleno?: boolean }) {
  const theme = useTheme();
  return (
    <View
      style={{
        width: 28,
        height: 4,
        borderRadius: theme.radii.pill,
        backgroundColor: lleno ? theme.colors.ink : theme.colors.chipActive,
      }}
    />
  );
}

function Promesa({ texto }: { readonly texto: string }) {
  const theme = useTheme();
  return (
    <Row gap={10} justify="flex-start">
      <Check size={18} color={theme.semaphore.ok} strokeWidth={2.4} />
      <Text variant="bodySmall" style={{ flex: 1 }}>
        {texto}
      </Text>
    </Row>
  );
}

function Beneficio({
  icono: Icono,
  titulo,
  cuerpo,
}: {
  readonly icono: LucideIcon;
  readonly titulo: string;
  readonly cuerpo: string;
}) {
  const theme = useTheme();
  return (
    <Row gap={12} align="flex-start" justify="flex-start">
      <Icono size={20} color={theme.colors.textStrong} style={{ marginTop: 1 }} />
      <Stack gap={3} style={{ flex: 1 }}>
        <Text variant="bodySmall" weight="semibold">
          {titulo}
        </Text>
        <Text variant="caption" color={theme.colors.textTertiary}>
          {cuerpo}
        </Text>
      </Stack>
    </Row>
  );
}

/** Una pastilla por escalón. Cuatro en fila, cada una con los 44px de alto. */
function Pastilla({
  tier,
  elegido,
  onPress,
}: {
  readonly tier: SaasTier;
  readonly elegido: boolean;
  readonly onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: elegido }}
      accessibilityLabel={SAAS_TIER_LABELS[tier]}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        height: 44,
        borderRadius: theme.radii.pill,
        backgroundColor: elegido ? theme.colors.actionPrimary : theme.colors.surfaceRaised,
        borderWidth: elegido ? 0 : 1,
        borderColor: theme.colors.border,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <Text
        variant="caption"
        weight="semibold"
        color={elegido ? theme.colors.actionPrimaryInk : theme.colors.textStrong}
      >
        {PASTILLA[tier]}
      </Text>
    </Pressable>
  );
}
