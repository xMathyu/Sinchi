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
 * cuenta se crea recien al tocar «Empezar gratis», porque `registerGym`
 * necesita una credencial de Firebase para firmar el alta.
 *
 * El escalon se ELIGE aqui solo para que sepa cuanto le va a costar. Lo que se
 * le cobre sale del padron real, asi que equivocarse eligiendo no le cuesta
 * dinero — y por eso el texto no lo trata como una decision grave.
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import * as Google from 'expo-auth-session/providers/google';
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
import { registerGym } from '../src/data/actions';
import { completeEmailSignIn, completeGoogleSignIn } from '../src/data/auth';
import { firebaseConfigured, googleAuthReady, googleClientIds } from '../src/data/firebase';
import { currentAccountDetails, currentFirebaseToken } from '../src/data/session';
import { aCentimos } from '../src/lib/format';
import { useDebounced } from '../src/lib/debounce';
import { GpsButton, MapPicker, type MapPoint } from '../src/design/map-picker';
import { fetchPlaceDetail, suggestPlaces, type PlaceSuggestionDto } from '../src/data/api';
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
 * `account` solo aparece para quien llega sin sesion. Por eso no entra en el
 * contador: los pasos del ALTA son dos, y crear la cuenta es el peaje de
 * entrada, no una parte del alta.
 */
type Step = 'oferta' | 'cuenta' | 'plan' | 'datos';

/** Los campos del ultimo paso que pueden estar mal, para marcarlos uno a uno. */
type SignUpField = 'name' | 'taxId' | 'documentId' | 'monthlyPrice' | 'address';

/** Lo mínimo que se acepta como dirección. «Lima» son cuatro y no lleva a nadie. */
const ADDRESS_MIN = 10;

/** Los de la cuenta, que es otro formulario y falla por otras razones. */
type AccountField = 'ownerName' | 'email' | 'password' | 'phone';

export default function GymSignUpScreen() {
  const theme = useTheme();
  const session = useSession();

  const [step, setStep] = useState<Step>('oferta');

  const [name, setName] = useState('');
  const [ruc, setRuc] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [documentId, setDocumentId] = useState('');
  const [phone, setPhone] = useState('+51');
  const [escalon, setEscalon] = useState<SaasTier>('free');
  const [code, setCode] = useState('');
  const [monthlyPrice, setMonthlyPrice] = useState('');
  const [address, setAddress] = useState('');
  /**
   * El punto del local. Opcional, y por eso `null` no bloquea el alta.
   *
   * Sin pin, «como llegar» busca la direccion escrita en el mapa de quien la
   * lee. Con pin, lleva a la puerta. Lo segundo es mejor y lo primero basta, asi
   * que no se exige — lo que se hace es ponerlo facil.
   */
  const [pin, setPin] = useState<MapPoint | null>(null);
  /**
   * El punto al que llevar la cámara, cuando no lo puso el dedo.
   *
   * Separado de `pin` a propósito: si la cámara siguiera cualquier cambio del
   * pin, tocar o arrastrar el mapa le arrancaría la vista al dueño en medio del
   * gesto. Se llena al elegir una sugerencia o al usar el GPS, que es cuando no
   * está mirando el mapa. Ver `focus` en `MapPicker`.
   */
  const [focus, setFocus] = useState<MapPoint | null>(null);
  /** Si el dueno ya eligio de la lista, no se le vuelve a ofrecer. */
  const [addressPicked, setAddressPicked] = useState(false);
  const [suggestions, setSuggestions] = useState<readonly PlaceSuggestionDto[]>([]);
  /**
   * Por que no hay sugerencias, cuando no las hay.
   *
   * Nace de un fallo propio: las tres vias por las que el buscador no puede
   * trabajar —sin credencial de Firebase, sin clave configurada en el servidor,
   * y la red caida— hacian las tres `setSuggestions([])` y ni una palabra. El
   * dueno escribe su direccion entera, no aparece nada, y no tiene forma de
   * saber si el buscador esta roto, si su calle no existe o si debe seguir. Es
   * el mismo boton mudo que este producto ya se comio una vez.
   */
  const [searchDenial, setSearchDenial] = useState<string | null>(null);

  /**
   * La direccion, esperando a que deje de teclear.
   *
   * Cada busqueda es una llamada a Places, y Places se factura: sin el debounce,
   * escribir «Av. Primavera 120» son diecinueve busquedas para una direccion.
   */
  const debouncedAddress = useDebounced(address);

  useEffect(() => {
    // Ya eligio de la lista: seguir sugiriendo sobre su propia eleccion es
    // ofrecerle corregir lo que acaba de confirmar.
    if (addressPicked) return;

    const query = debouncedAddress.trim();
    if (query.length < 3) {
      setSuggestions([]);
      setSearchDenial(null);
      return;
    }

    /**
     * El buscador exige la credencial de Firebase, y ahi estaba el fallo.
     *
     * `currentFirebaseToken()` solo devuelve algo con la sesion en `unlinked`, y
     * ese estado nace UNICAMENTE al crear la cuenta. Quien llega al paso de
     * datos por otro camino no la tiene, asi que el buscador no podia trabajar —
     * y se callaba, que es lo que lo hizo indiagnosticable.
     */
    const idToken = currentFirebaseToken();
    if (idToken === null) {
      setSuggestions([]);
      setSearchDenial(
        'El buscador necesita tu cuenta. Escribe la dirección y marca tu puerta en el mapa: funciona igual.',
      );
      return;
    }

    let cancelled = false;
    void suggestPlaces({ idToken, query })
      .then((found) => {
        if (cancelled) return;
        setSuggestions(found);
        // Cero resultados NO es un fallo: en Lima el pasaje sin nombre no lo
        // encuentra ningun buscador, y por eso existe el pin a mano.
        setSearchDenial(
          found.length === 0
            ? 'No encontramos esa dirección. Déjala escrita y marca tu puerta en el mapa.'
            : null,
        );
      })
      .catch(() => {
        // El buscador es una AYUDA: si se cae, se escribe a mano y se mueve el
        // pin. Pero se DICE, que es lo que faltaba.
        if (cancelled) return;
        setSuggestions([]);
        setSearchDenial(
          'No se pudo buscar ahora. Escribe la dirección y marca tu puerta en el mapa.',
        );
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedAddress, addressPicked]);

  /** Toca una sugerencia: se rellena la direccion y el pin se va a su sitio. */
  const pickSuggestion = (suggestion: PlaceSuggestionDto): void => {
    const idToken = currentFirebaseToken();
    setSuggestions([]);
    setSearchDenial(null);
    setAddressPicked(true);
    // Se escribe ya lo que se ve, sin esperar al detalle: el campo no puede
    // quedarse con el texto a medias mientras viaja una peticion.
    setAddress(
      suggestion.secondaryText === null
        ? suggestion.mainText
        : `${suggestion.mainText}, ${suggestion.secondaryText}`,
    );
    if (idToken === null) return;

    void fetchPlaceDetail({ idToken, placeId: suggestion.placeId })
      .then((detail) => {
        setAddress(detail.address);
        const point = { lat: detail.latitude, lng: detail.longitude };
        setPin(point);
        // Sin esto el marcador aparecía y la cámara se quedaba mirando Lima
        // entera: el mapa dejaba de servir para corroborar nada.
        setFocus(point);
      })
      .catch(() => {
        // Se queda lo que ya se escribio y el pin a mano. Ver `places.service`.
      });
  };

  // Solo para crear la cuenta, cuando hace falta. El nombre y el celular NO se
  // repiten aqui: son los mismos campos que pide el ultimo paso.
  const [correo, setCorreo] = useState('');
  const [password, setPassword] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Quien llega ya vinculado a un padron no puede registrar un gimnasio.
   *
   * `currentFirebaseToken` —lo que firma el alta— solo existe en el estado
   * `unlinked`. No se arregla aqui; se avisa antes de que llene cinco campos
   * para nada.
   */
  const needsAccount = session.status === 'signed_out';
  /**
   * Solo `signed_in` es el callejon: una cuenta con ficha en un padron. Ni
   * `loading` ni `demo` lo son, y tratarlos como tal pintaba el aviso durante el
   * arranque y en el modo de demostracion, donde no significa nada.
   */
  const alreadyStudent = session.status === 'signed_in';

  /**
   * Entrar con Google, que es exactamente el mismo camino y dos campos menos.
   *
   * El alta necesita UNA credencial de Firebase para firmarse, y da igual de
   * donde salga: `completeGoogleSignIn` y `completeEmailSignIn` comparten
   * `exchangeForSinchiSession`, así que de aquí para adelante no hay ninguna
   * diferencia. Pedirle correo y contraseña a alguien que ya tiene cuenta de
   * Google era inventarse una credencial nueva para el mismo fin — y encima la
   * que va a usar después, cuando entre como alumno a otro gimnasio, es la de
   * Google.
   *
   * `useIdTokenAuthRequest` y no el flujo de código, por lo mismo que en el
   * login: el de código exige un secreto de cliente, y un secreto dentro de una
   * app móvil no es un secreto.
   */
  const [googleRequest, googleResponse, promptGoogle] = Google.useIdTokenAuthRequest({
    clientId: googleClientIds.web ?? '',
    iosClientId: googleClientIds.ios,
    androidClientId: googleClientIds.android,
  });

  useEffect(() => {
    if (googleResponse === null) return;

    if (googleResponse.type === 'dismiss' || googleResponse.type === 'cancel') {
      // Cancelar no es un error y no merece un mensaje en rojo.
      setSaving(false);
      return;
    }
    if (googleResponse.type !== 'success') {
      setSaving(false);
      setError('No se pudo completar el acceso con Google.');
      return;
    }

    const idToken = googleResponse.params.id_token;
    if (typeof idToken !== 'string') {
      setSaving(false);
      setError('Google no devolvió un token válido.');
      return;
    }

    let cancelled = false;
    // El nombre y el celular se mandan solo si ya los escribió: con Google casi
    // nunca los ha escrito todavía, y mandarlos vacíos tapa lo que la api puede
    // sacar de la propia cuenta.
    void completeGoogleSignIn(idToken, {
      ...(ownerName.trim().length >= 2 ? { fullName: ownerName.trim() } : {}),
      ...(phone.trim().length >= 8 ? { phone: phone.trim() } : {}),
    }).then((outcome) => {
      if (cancelled) return;
      setSaving(false);

      if (outcome.kind === 'error') {
        setError(outcome.message);
        return;
      }
      /**
       * `signed_in` es el callejón, y hay que decirlo en vez de avanzar.
       *
       * Significa que esa cuenta de Google YA tiene ficha en un padrón, y
       * `registerGym` firma con `currentFirebaseToken()`, que solo existe en el
       * estado `unlinked`. Dejarla pasar al paso siguiente la llevaría a llenar
       * cinco campos para que el alta fallara al final.
       */
      if (outcome.kind === 'signed_in') {
        setError(
          'Esa cuenta de Google ya está vinculada a un gimnasio como alumno. Para registrar el tuyo, entra con otra cuenta.',
        );
        return;
      }
      // `needs_link` es el resultado ESPERADO, igual que por correo.
      setStep('plan');
    });

    return () => {
      cancelled = true;
    };
    // Solo reacciona a la respuesta de Google. El nombre y el celular se leen en
    // ese instante a propósito: meterlos en las dependencias relanzaría el
    // intercambio con cada letra que se teclee.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [googleResponse]);

  // Si llego con la cuenta ya hecha, lo que dio al registrarse se reusa. Volver
  // a preguntar el nombre y el celular a quien acaba de escribirlos es la queja
  // que este producto ya se comio una vez.
  useEffect(() => {
    if (step !== 'datos') return;
    const details = currentAccountDetails();
    if (details === null) return;
    setOwnerName((previo) => (previo.trim().length > 0 ? previo : (details.fullName ?? '')));
    setPhone((previo) => (previo.trim().length > 3 ? previo : (details.phone ?? '+51')));
  }, [step]);

  /**
   * Que le falta a cada campo, por su nombre.
   *
   * Antes esto era un solo booleano —`ready`— y por eso el boton se apagaba sin
   * decir nada: la pantalla sabia que el formulario no valia pero no por cual de
   * los cinco campos, asi que no tenia como pintar ninguno en rojo. Un mapa por
   * campo cuesta lo mismo de calcular y es lo que deja marcar el que falla.
   */
  const taxIdDigits = ruc.replace(/\D/g, '').length;
  const taxIdDenial = taxIdDigits >= 11 ? checkRuc(ruc) : null;

  /**
   * La mensualidad, comprobada con la MISMA funcion que la api.
   *
   * `checkPlanDraft` es lo que corre `POST /gyms/signup` antes de escribir la
   * tarifa, asi que el campo se pone rojo por el motivo exacto por el que el
   * alta habria respondido 400 — y no despues de haber llenado seis campos.
   */
  const monthlyCents = aCentimos(monthlyPrice);
  const planDenial =
    monthlyCents === null
      ? null
      : checkPlanDraft({
          name: 'Mensualidad',
          type: 'unlimited',
          sessionsPerWeek: null,
          allowedDays: null,
          priceCents: monthlyCents,
        });

  /**
   * Se construye con `complain` y no con spreads condicionales, y la diferencia
   * no es de estilo: un spread NO comprueba las claves contra el tipo. Escrito
   * con spreads, `{ ruc: … }` dentro de un `Partial<Record<SignUpField, …>>`
   * compilaba aunque el campo se llamara `taxId`, y el efecto era que el RUC
   * nunca se ponía en rojo — el bug que esto mismo venía a arreglar. Un
   * parámetro sí se comprueba.
   */
  const problems: Partial<Record<SignUpField, string>> = {};
  const complain = (field: SignUpField, message: string | null): void => {
    if (message !== null) problems[field] = message;
  };

  complain(
    'name',
    name.trim().length === 0
      ? 'Escribe el nombre de tu gimnasio.'
      : name.trim().length < 3
        ? 'Al menos 3 letras: es el nombre que van a buscar tus alumnos.'
        : null,
  );
  /**
   * El RUC es OPCIONAL, asi que vacio NO es un problema.
   *
   * Lo pedia obligatorio y eso dejaba fuera a quien este producto mas quiere: el
   * profesor que arranca con doce alumnos y saca el RUC cuando empieza a
   * facturar. Se le exigia un tramite de SUNAT antes de dejarle apuntar a su
   * primer alumno, por un dato que ese dia no usa nadie.
   *
   * Lo que SI se sigue comprobando es lo que escribe: un RUC a medias o con el
   * verificador mal se guardaria en los comprobantes que le da a sus alumnos.
   * Opcional no es "vale cualquier cosa".
   */
  complain(
    'taxId',
    ruc.trim().length === 0
      ? null
      : taxIdDigits < 11
        ? 'El RUC tiene 11 dígitos. Si todavía no lo tienes, deja el campo vacío.'
        : taxIdDenial !== null
          ? rucDenialMessage(taxIdDenial)
          : null,
  );
  complain(
    'documentId',
    documentId.trim().length === 0
      ? 'Falta tu documento: es lo que te identifica en la red.'
      : documentId.trim().length < 6
        ? 'Un DNI tiene 8 dígitos; un carné de extranjería, 9.'
        : null,
  );
  complain(
    'address',
    address.trim().length === 0
      ? 'Escribe dónde queda tu gimnasio. Es lo primero que mira quien te busca.'
      : address.trim().length < ADDRESS_MIN
        ? 'Un poco más: calle, número y distrito.'
        : null,
  );
  complain(
    'monthlyPrice',
    monthlyPrice.trim().length === 0
      ? 'Escribe cuánto cobras al mes: sin una tarifa no puedes inscribir a nadie.'
      : monthlyCents === null
        ? 'Escríbelo en soles, con números: 120 o 120.50.'
        : planDenial !== null
          ? planDenialMessage(planDenial)
          : null,
  );
  const ready = Object.keys(problems).length === 0;

  /**
   * Si ya intento guardar.
   *
   * Los errores no se pintan mientras escribe —marcar en rojo un campo vacio que
   * todavia no ha tocado es reganarle por ir en orden— sino cuando toca el boton
   * y el boton no hace nada. Ese es justo el momento en que necesita saber por
   * que.
   */
  const [attempted, setAttempted] = useState(false);

  /**
   * Lo que SI se dice mientras escribe: un dato completo y equivocado.
   *
   * Un RUC de once digitos con el verificador mal no esta a medias, esta mal, y
   * callarlo hasta el boton obliga a volver a un campo que ya se dio por hecho.
   * Vacio es otra cosa: eso es ir en orden.
   */
  const liveDenial = (field: SignUpField): boolean => field === 'taxId' && taxIdDigits >= 11;

  const denial = (field: SignUpField): string | undefined =>
    attempted || liveDenial(field) ? problems[field] : undefined;

  /** Lo mismo para el formulario de la cuenta, que falla por otras razones. */
  const accountProblems: Partial<Record<AccountField, string>> = {};
  const complainAccount = (field: AccountField, message: string | null): void => {
    if (message !== null) accountProblems[field] = message;
  };

  complainAccount('ownerName', ownerName.trim().length < 2 ? 'Escribe tu nombre.' : null);
  complainAccount(
    'email',
    correo.trim().length === 0
      ? 'Falta tu correo.'
      : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo.trim())
        ? 'Ese correo no tiene forma de correo. Revisa la arroba y el punto.'
        : null,
  );
  complainAccount(
    'password',
    password.length === 0
      ? 'Falta la contraseña.'
      : password.length < 6
        ? 'La contraseña va de 6 caracteres para arriba.'
        : null,
  );
  complainAccount(
    'phone',
    phone.trim().length < 8
      ? 'Falta tu celular, con el código del país: +51987654321.'
      : null,
  );
  const accountReady = Object.keys(accountProblems).length === 0;
  const accountDenialFor = (field: AccountField): string | undefined =>
    attempted ? accountProblems[field] : undefined;

  // Cada paso es un formulario distinto: entrar al siguiente con los rojos del
  // anterior ya puestos marca campos que esta persona no ha llegado a tocar.
  useEffect(() => {
    setAttempted(false);
  }, [step]);

  const goToDetails = (): void => {
    setError(null);
    setStep('datos');
  };

  const createAccount = (): void => {
    setError(null);
    setSaving(true);
    void completeEmailSignIn(correo, password, 'signUp', {
      fullName: ownerName.trim(),
      phone: phone.trim(),
    }).then((outcome) => {
      setSaving(false);
      if (outcome.kind === 'error') {
        setError(outcome.message);
        return;
      }
      // `needs_link` es el resultado ESPERADO: quien registra un gimnasio no
      // tiene ficha en ningun padron, y ese es justo el estado que deja la
      // credencial con la que se firma el alta.
      setStep('plan');
    });
  };

  const create = async (): Promise<void> => {
    setError(null);
    setSaving(true);
    try {
      const signUp = await registerGym({
        gymName: name.trim(),
        // Vacio se manda como ausente y no como '': la columna guarda NULL, que
        // es "no tiene". Una cadena vacia seria "tiene uno que es nada".
        taxId: ruc.trim().length > 0 ? ruc.trim() : undefined,
        saasTier: escalon,
        monthlyPriceCents: monthlyCents ?? 0,
        address: address.trim(),
        ...(pin === null ? {} : { latitude: pin.lat, longitude: pin.lng }),
        ownerName: ownerName.trim().length >= 2 ? ownerName.trim() : undefined,
        documentId: documentId.trim(),
        phone: phone.trim().length >= 6 ? phone.trim() : undefined,
        promoCode: code.trim().length > 0 ? code.trim() : undefined,
      });

      /**
       * El alta deja la sesión de dueño puesta, así que se entra directo al
       * padrón: es donde está la cuenta atrás del mes gratis y el botón de
       * inscribir, que es lo único que un gimnasio recién creado puede hacer.
       * La puerta, vacía, no le dice nada todavía.
       */
      void signUp;
      router.replace('/staff/roster');
    } catch (causa: unknown) {
      setError(causa instanceof Error ? causa.message : 'No se pudo crear el gimnasio.');
    } finally {
      setSaving(false);
    }
  };

  const errorNotice =
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

  if (step === 'oferta') {
    return (
      <Screen scroll style={{ flexGrow: 1 }}>
        <Stack gap={0} style={{ flex: 1, paddingBottom: 8 }}>
          <BackRow label="Entrar" onPress={() => router.back()} />

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
              <Promesa text={`Hasta ${SAAS_FREE_TIER_LIMIT} alumnos, gratis para siempre`} />
              <Promesa text="Primer mes gratis cuando pases a pagar" />
              <Promesa text="Sin tarjeta para empezar" />
            </Stack>
          </Card>

          <Eyebrow style={{ marginTop: 28 }}>Todo esto entra en cualquier escalón</Eyebrow>

          <Stack gap={14} style={{ marginTop: 14 }}>
            <Beneficio
              icon={Users}
              title="Padrón con semáforo"
              body="Quién está al día y quién debe."
            />
            <Beneficio
              icon={QrCode}
              title="Puerta con QR"
              body="El alumno muestra su código; ves verde o rojo."
            />
            <Beneficio
              icon={CreditCard}
              title="Cobro por adelantado"
              body="Se cobra solo y avisa si alguien se atrasa."
            />
            <Beneficio
              icon={CalendarDays}
              title="Clases de prueba"
              body="Sales en el directorio de la red."
            />
          </Stack>

          {alreadyStudent ? (
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
              onPress={() => setStep(needsAccount ? 'cuenta' : 'plan')}
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

  if (step === 'cuenta') {
    return (
      <Screen scroll style={{ flexGrow: 1 }}>
        <Stack gap={0} style={{ flex: 1, paddingBottom: 8 }}>
          <BackRow label="Atrás" onPress={() => setStep('oferta')} />

          <Text variant="title" weight="bold" style={{ marginTop: 22 }}>
            Crea tu cuenta
          </Text>
          <Text variant="bodySmall" color={theme.colors.textSecondary} style={{ marginTop: 8 }}>
            Es la cuenta con la que vas a entrar a administrar tu gimnasio, y con la
            que el alta queda a tu nombre.
          </Text>

          {errorNotice}

          {firebaseConfigured() ? (
            <>
              {/* Google PRIMERO: es la cuenta que esta persona ya tiene, y la
                  misma con la que entrará como alumno a otros gimnasios. El
                  correo y la contraseña se quedan debajo porque siempre
                  funcionan — Google depende de un cliente OAuth que puede no
                  estar configurado en este build. */}
              {googleAuthReady() ? (
                <Stack gap={12} style={{ marginTop: 24 }}>
                  <Button
                    label="Continuar con Google"
                    variant="secondary"
                    disabled={googleRequest === null || saving}
                    onPress={() => {
                      setError(null);
                      setSaving(true);
                      void promptGoogle();
                    }}
                  />
                  <Text variant="captionSmall" color={theme.colors.textFaint} align="center">
                    La misma cuenta te sirve como dueño y como alumno.
                  </Text>
                  <Row align="center" gap={10}>
                    <View style={{ flex: 1, height: 1, backgroundColor: theme.colors.hairline }} />
                    <Text variant="captionSmall" color={theme.colors.textFaint}>
                      o con tu correo
                    </Text>
                    <View style={{ flex: 1, height: 1, backgroundColor: theme.colors.hairline }} />
                  </Row>
                </Stack>
              ) : null}

              <Stack gap={14} style={{ marginTop: 24 }}>
                <Field
                  label="Tu nombre"
                  value={ownerName}
                  onChangeText={setOwnerName}
                  placeholder="Nombre y apellido"
                  autoCapitalize="words"
                  autoComplete="name"
                  editable={!saving}
                  error={accountDenialFor('ownerName')}
                />
                <Field
                  label="Correo"
                  value={correo}
                  onChangeText={setCorreo}
                  placeholder="tucorreo@ejemplo.com"
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  editable={!saving}
                  error={accountDenialFor('email')}
                />
                <Field
                  label="Contraseña"
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Al menos 6 caracteres"
                  secureTextEntry
                  autoCapitalize="none"
                  autoComplete="new-password"
                  editable={!saving}
                  error={accountDenialFor('password')}
                />
                <Field
                  label="Tu celular"
                  value={phone}
                  onChangeText={setPhone}
                  placeholder="+51987654321"
                  keyboardType="phone-pad"
                  autoComplete="tel"
                  editable={!saving}
                  hint="Es con lo que te ubicamos si algo pasa con tu cuenta."
                  error={accountDenialFor('phone')}
                />
              </Stack>

              <View style={{ marginTop: 'auto', paddingTop: 26 }}>
                <Button
                  label={saving ? 'Creando…' : 'Crear cuenta y seguir'}
                  disabled={!accountReady || saving}
                  onPress={createAccount}
                  onBlockedPress={saving ? undefined : () => setAttempted(true)}
                />
                {attempted && !accountReady ? (
                  <Text
                    variant="caption"
                    color={theme.semaphore.bad}
                    align="center"
                    style={{ marginTop: 10 }}
                  >
                    {missingFieldsSummary(accountProblems)}
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

          {saving && <ActivityIndicator color={theme.colors.ink} style={{ marginTop: 16 }} />}
        </Stack>
      </Screen>
    );
  }

  // -------------------------------------------------------------------------
  // Paso 1 de 2 — el plan
  // -------------------------------------------------------------------------

  if (step === 'plan') {
    const price = SAAS_TIER_PRICES[escalon];
    const free = isFreeTier(escalon);
    const note = free
      ? `Con ${SAAS_FREE_TIER_LIMIT} alumnos o menos no se te cobra. Ni ahora ni en un año.`
      : 'Arrancas sin pagar: el primer cobro te llega recién al mes.';

    return (
      <Screen scroll style={{ flexGrow: 1 }}>
        <Stack gap={0} style={{ flex: 1, paddingBottom: 8 }}>
          <BackRow
            label="Atrás"
            onPress={() => setStep(needsAccount ? 'cuenta' : 'oferta')}
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
                picked={escalon === tier}
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
                  color={free ? theme.semaphore.ok : theme.colors.ink}
                >
                  {free ? 'Gratis' : formatPEN(price, { withDecimals: false })}
                </Text>
                <Text variant="bodySmall" color={theme.colors.textFaint}>
                  {free ? 'para siempre' : 'al mes'}
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
                  {free ? 'No pagas nunca' : '1er mes gratis'}
                </Eyebrow>
              </View>
              <Text variant="caption" color={theme.colors.textSecondary}>
                {note}
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
              value={code}
              onChangeText={setCode}
              placeholder="Si tienes uno, suma meses gratis"
              autoCapitalize="none"
              optional
            />
          </View>

          <View style={{ marginTop: 'auto', paddingTop: 26 }}>
            <Button label="Continuar" onPress={goToDetails} />
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
        <BackRow label="Tu plan" onPress={() => setStep('plan')} />

        <Progreso hechos={2} />

        <Text variant="titleSmall" weight="bold" style={{ marginTop: 14 }}>
          Últimos datos
        </Text>

        {errorNotice}

        <Eyebrow style={{ marginTop: 20 }}>Tu gimnasio</Eyebrow>

        <Stack gap={14} style={{ marginTop: 10 }}>
          <Field
            label="Nombre del gimnasio"
            value={name}
            onChangeText={setName}
            placeholder="Dojo Shotokan Miraflores"
            autoCapitalize="words"
            editable={!saving}
            error={denial('name')}
          />
          {/* Opcional, y el rotulo lo dice antes de que lo intente: el que
              arranca saca el RUC cuando empieza a facturar, y un campo que
              parece obligatorio lo manda a SUNAT o a inventarse once digitos. */}
          <Field
            label="RUC (opcional)"
            value={ruc}
            onChangeText={setRuc}
            placeholder="20100070970"
            keyboardType="number-pad"
            editable={!saving}
            hint="Si ya lo tienes, va en las boletas de tus alumnos. Si no, déjalo vacío y lo pones después."
            error={denial('taxId')}
          />
        </Stack>

        {/* Antes el directorio listaba dojos sin decir DONDE estan, que es la
            primera pregunta de quien busca donde entrenar: nadie cruza Lima
            para una clase de prueba. Se pide aqui porque un local sin direccion
            es un nombre en una lista, y porque el dueno no la va a ir a poner
            despues a una pantalla que no sabe que existe. */}
        <Stack gap={14} style={{ marginTop: 14 }}>
          <Field
            label="Dirección del local"
            value={address}
            onChangeText={(text) => {
              setAddress(text);
              // Volver a escribir descarta la eleccion anterior: el pin dejaria
              // de corresponder al texto, y un pin que no es la direccion es
              // peor que ninguno.
              setAddressPicked(false);
            }}
            placeholder="Av. Primavera 120, Surco"
            autoCapitalize="words"
            editable={!saving}
            hint="Escribe y elige de la lista. Si no aparece, escríbela igual y mueve el pin."
            error={denial('address')}
          />

          {/* Por que no hay lista, cuando no hay. Sin esto el dueno no puede
              distinguir «tu calle no aparece» de «el buscador esta roto», y las
              dos piden lo mismo: seguir a mano. */}
          {searchDenial === null ? null : (
            <Text variant="micro" color={theme.colors.textFaint}>
              {searchDenial}
            </Text>
          )}

          {/* Las sugerencias, si hay. Van pegadas al campo y no en un modal: lo
              que se compara es lo escrito con lo ofrecido, y un modal tapa
              justo el texto que hay que comparar. */}
          {suggestions.length > 0 ? (
            <Card padded={false} radius={theme.radii.md}>
              {suggestions.map((suggestion, index) => (
                <Pressable
                  key={suggestion.placeId}
                  accessibilityRole="button"
                  accessibilityLabel={suggestion.mainText}
                  onPress={() => pickSuggestion(suggestion)}
                  style={{
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                    borderTopWidth: index === 0 ? 0 : 1,
                    borderTopColor: theme.colors.hairline,
                  }}
                >
                  <Text variant="bodySmall" weight="semibold" numberOfLines={1}>
                    {suggestion.mainText}
                  </Text>
                  {suggestion.secondaryText === null ? null : (
                    <Text
                      variant="captionSmall"
                      color={theme.colors.textSecondary}
                      numberOfLines={1}
                    >
                      {suggestion.secondaryText}
                    </Text>
                  )}
                </Pressable>
              ))}
            </Card>
          ) : null}

          {/* El mapa para CORROBORAR, que es lo que no hacia el campo de texto:
              se ve si lo escrito cae donde el dueno cree. Y se toca para
              corregirlo, porque en Lima el pasaje sin nombre y la cuadra sin
              numero no los encuentra ningun buscador. */}
          <MapPicker pin={pin} onPick={setPin} focus={focus} />

          {/* El atajo, y aquí casi obligatorio: el mapa abre a escala de ciudad,
              así que sin esto la única forma de apuntar a una puerta es hacer
              pinch-zoom desde una vista de Lima entera. Quien se registra suele
              estar dentro de su local. */}
          <Row gap={10} align="stretch">
            <GpsButton
              onReady={(point) => {
                setPin(point);
                setFocus(point);
              }}
            />
          </Row>
          <Text variant="micro" color={theme.colors.textFaint}>
            {pin === null
              ? 'Toca el mapa para marcar tu puerta. Es opcional: sin punto, «cómo llegar» busca tu dirección.'
              : 'Ese es el punto que abrirá el navegador de tus alumnos. Tócalo o arrástralo para corregirlo.'}
          </Text>
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
            value={monthlyPrice}
            onChangeText={setMonthlyPrice}
            placeholder="120"
            keyboardType="decimal-pad"
            editable={!saving}
            hint="Se crea como «Mensualidad», sin límite de sesiones. Puedes cambiarla y añadir más tarifas —dos veces por semana, clase suelta— desde Padrón → Planes."
            error={denial('monthlyPrice')}
          />
        </Stack>

        <Eyebrow style={{ marginTop: 20 }}>Sobre ti</Eyebrow>

        <Stack gap={14} style={{ marginTop: 10 }}>
          <Field
            label="Tu nombre"
            value={ownerName}
            onChangeText={setOwnerName}
            placeholder="Como quieres que te vean tus alumnos"
            autoCapitalize="words"
            editable={!saving}
          />
          <Field
            label="Tu documento"
            value={documentId}
            onChangeText={setDocumentId}
            placeholder="DNI o carné de extranjería"
            keyboardType="number-pad"
            editable={!saving}
            error={denial('documentId')}
          />
          <Field
            label="Tu celular"
            value={phone}
            onChangeText={setPhone}
            placeholder="+51987654321"
            keyboardType="phone-pad"
            editable={!saving}
          />
        </Stack>

        <Stack gap={12} style={{ marginTop: 'auto', paddingTop: 26 }}>
          <Button
            label={saving ? 'Creando…' : 'Crear mi gimnasio'}
            onPress={() => void create()}
            disabled={!ready || saving}
            onBlockedPress={saving ? undefined : () => setAttempted(true)}
          />
          {attempted && !ready ? (
            <Text variant="caption" color={theme.semaphore.bad} align="center">
              {missingFieldsSummary(problems)}
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
function missingFieldsSummary(problems: Readonly<Record<string, string | undefined>>): string {
  const denials = Object.values(problems).filter(
    (denial): denial is string => denial !== undefined,
  );
  if (denials.length === 1) return denials[0]!;
  return `Faltan ${denials.length} campos, marcados arriba en rojo.`;
}

/** Fila de vuelta, con los 44px que exige un objetivo tactil. */
function BackRow({
  label,
  onPress,
}: {
  readonly label: string;
  readonly onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Volver a ${label}`}
      onPress={onPress}
      style={{ height: 44, marginLeft: -8, paddingHorizontal: 8, justifyContent: 'center' }}
    >
      <Row gap={6} justify="flex-start">
        <ChevronLeft size={16} color={theme.colors.textSecondary} />
        <Text variant="bodySmall" color={theme.colors.textSecondary}>
          {label}
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
        <Tramo full />
        <Tramo full={hechos === 2} />
      </Row>
      <Eyebrow>Paso {hechos} de 2</Eyebrow>
    </Row>
  );
}

function Tramo({ full = false }: { readonly full?: boolean }) {
  const theme = useTheme();
  return (
    <View
      style={{
        width: 28,
        height: 4,
        borderRadius: theme.radii.pill,
        backgroundColor: full ? theme.colors.ink : theme.colors.chipActive,
      }}
    />
  );
}

function Promesa({ text }: { readonly text: string }) {
  const theme = useTheme();
  return (
    <Row gap={10} justify="flex-start">
      <Check size={18} color={theme.semaphore.ok} strokeWidth={2.4} />
      <Text variant="bodySmall" style={{ flex: 1 }}>
        {text}
      </Text>
    </Row>
  );
}

function Beneficio({
  icon: Icon,
  title,
  body,
}: {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly body: string;
}) {
  const theme = useTheme();
  return (
    <Row gap={12} align="flex-start" justify="flex-start">
      <Icon size={20} color={theme.colors.textStrong} style={{ marginTop: 1 }} />
      <Stack gap={3} style={{ flex: 1 }}>
        <Text variant="bodySmall" weight="semibold">
          {title}
        </Text>
        <Text variant="caption" color={theme.colors.textTertiary}>
          {body}
        </Text>
      </Stack>
    </Row>
  );
}

/** Una pastilla por escalón. Cuatro en fila, cada una con los 44px de alto. */
function Pastilla({
  tier,
  picked,
  onPress,
}: {
  readonly tier: SaasTier;
  readonly picked: boolean;
  readonly onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: picked }}
      accessibilityLabel={SAAS_TIER_LABELS[tier]}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        height: 44,
        borderRadius: theme.radii.pill,
        backgroundColor: picked ? theme.colors.actionPrimary : theme.colors.surfaceRaised,
        borderWidth: picked ? 0 : 1,
        borderColor: theme.colors.border,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <Text
        variant="caption"
        weight="semibold"
        color={picked ? theme.colors.actionPrimaryInk : theme.colors.textStrong}
      >
        {PASTILLA[tier]}
      </Text>
    </Pressable>
  );
}
