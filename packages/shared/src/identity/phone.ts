/**
 * El celular: de qué país es y cuándo está bien escrito.
 *
 * La app lo pide en dos partes —la bandera con su código, y el número— y se
 * guarda en una sola: `+51987654321` (E.164). Separarlo en la pantalla es lo que
 * impide mandar un número sin país; guardarlo junto es lo que deja compararlo con
 * un `=` y que el índice único de `users.phone` signifique algo.
 *
 * Hacía falta por un hueco concreto (decisiones §16): el campo era texto libre que
 * arrancaba con «+51», y la api solo contaba seis caracteres. Quien borraba el
 * prefijo y escribía `987654321` pasaba, y ese número y `+51987654321` eran dos
 * personas distintas: se esquivaba «una clase gratis por celular» y el vínculo
 * por celular no encontraba a nadie.
 */

export interface PhoneCountry {
  /** ISO 3166-1 alfa-2. De aquí sale la bandera. */
  readonly iso: string;
  readonly name: string;
  /** Sin el `+`. */
  readonly dialCode: string;
  /**
   * Con qué empieza el número nacional, para los códigos que comparten varios
   * países: +1 es Estados Unidos, Canadá y medio Caribe, y lo que los distingue
   * es el código de área. Sin esto, el celular de alguien de República
   * Dominicana se abriría con la bandera de Estados Unidos.
   */
  readonly leadingDigits?: readonly string[];
}

type Row = readonly [iso: string, name: string, dialCode: string, leadingDigits?: readonly string[]];

/**
 * Perú primero y el resto por nombre.
 *
 * Primero porque es de donde son los gimnasios y casi todos sus alumnos: es el
 * país con el que arranca el campo. El orden alfabético lo vigila una prueba, que
 * es la única forma de que un país añadido a mano no quede fuera de sitio.
 *
 * La lista va escrita y no sale de `Intl.DisplayNames`: Hermes no lo trae, y un
 * selector de países que en el teléfono enseña códigos ISO no sirve de nada.
 */
const ROWS: readonly Row[] = [
  ['PE', 'Perú', '51'],
  ['AF', 'Afganistán', '93'],
  ['AL', 'Albania', '355'],
  ['DE', 'Alemania', '49'],
  ['AD', 'Andorra', '376'],
  ['AO', 'Angola', '244'],
  ['AI', 'Anguila', '1', ['264']],
  ['AG', 'Antigua y Barbuda', '1', ['268']],
  ['SA', 'Arabia Saudita', '966'],
  ['DZ', 'Argelia', '213'],
  ['AR', 'Argentina', '54'],
  ['AM', 'Armenia', '374'],
  ['AW', 'Aruba', '297'],
  ['AU', 'Australia', '61'],
  ['AT', 'Austria', '43'],
  ['AZ', 'Azerbaiyán', '994'],
  ['BS', 'Bahamas', '1', ['242']],
  ['BD', 'Bangladés', '880'],
  ['BB', 'Barbados', '1', ['246']],
  ['BH', 'Baréin', '973'],
  ['BE', 'Bélgica', '32'],
  ['BZ', 'Belice', '501'],
  ['BJ', 'Benín', '229'],
  ['BM', 'Bermudas', '1', ['441']],
  ['BY', 'Bielorrusia', '375'],
  ['BO', 'Bolivia', '591'],
  ['BA', 'Bosnia y Herzegovina', '387'],
  ['BW', 'Botsuana', '267'],
  ['BR', 'Brasil', '55'],
  ['BN', 'Brunéi', '673'],
  ['BG', 'Bulgaria', '359'],
  ['BF', 'Burkina Faso', '226'],
  ['BI', 'Burundi', '257'],
  ['BT', 'Bután', '975'],
  ['CV', 'Cabo Verde', '238'],
  ['KH', 'Camboya', '855'],
  ['CM', 'Camerún', '237'],
  ['CA', 'Canadá', '1'],
  ['BQ', 'Caribe Neerlandés', '599', ['3', '4', '7']],
  ['QA', 'Catar', '974'],
  ['TD', 'Chad', '235'],
  ['CL', 'Chile', '56'],
  ['CN', 'China', '86'],
  ['CY', 'Chipre', '357'],
  ['CO', 'Colombia', '57'],
  ['KM', 'Comoras', '269'],
  ['CG', 'Congo', '242'],
  ['KP', 'Corea del Norte', '850'],
  ['KR', 'Corea del Sur', '82'],
  ['CI', 'Costa de Marfil', '225'],
  ['CR', 'Costa Rica', '506'],
  ['HR', 'Croacia', '385'],
  ['CU', 'Cuba', '53'],
  ['CW', 'Curazao', '599'],
  ['DK', 'Dinamarca', '45'],
  ['DM', 'Dominica', '1', ['767']],
  ['EC', 'Ecuador', '593'],
  ['EG', 'Egipto', '20'],
  ['SV', 'El Salvador', '503'],
  ['AE', 'Emiratos Árabes Unidos', '971'],
  ['ER', 'Eritrea', '291'],
  ['SK', 'Eslovaquia', '421'],
  ['SI', 'Eslovenia', '386'],
  ['ES', 'España', '34'],
  ['US', 'Estados Unidos', '1'],
  ['EE', 'Estonia', '372'],
  ['SZ', 'Esuatini', '268'],
  ['ET', 'Etiopía', '251'],
  ['PH', 'Filipinas', '63'],
  ['FI', 'Finlandia', '358'],
  ['FJ', 'Fiyi', '679'],
  ['FR', 'Francia', '33'],
  ['GA', 'Gabón', '241'],
  ['GM', 'Gambia', '220'],
  ['GE', 'Georgia', '995'],
  ['GH', 'Ghana', '233'],
  ['GI', 'Gibraltar', '350'],
  ['GD', 'Granada', '1', ['473']],
  ['GR', 'Grecia', '30'],
  ['GL', 'Groenlandia', '299'],
  ['GP', 'Guadalupe', '590'],
  ['GU', 'Guam', '1', ['671']],
  ['GT', 'Guatemala', '502'],
  ['GF', 'Guayana Francesa', '594'],
  ['GN', 'Guinea', '224'],
  ['GQ', 'Guinea Ecuatorial', '240'],
  ['GW', 'Guinea-Bisáu', '245'],
  ['GY', 'Guyana', '592'],
  ['HT', 'Haití', '509'],
  ['HN', 'Honduras', '504'],
  ['HK', 'Hong Kong', '852'],
  ['HU', 'Hungría', '36'],
  ['IN', 'India', '91'],
  ['ID', 'Indonesia', '62'],
  ['IQ', 'Irak', '964'],
  ['IR', 'Irán', '98'],
  ['IE', 'Irlanda', '353'],
  ['IS', 'Islandia', '354'],
  ['KY', 'Islas Caimán', '1', ['345']],
  ['CK', 'Islas Cook', '682'],
  ['FO', 'Islas Feroe', '298'],
  ['FK', 'Islas Malvinas', '500'],
  ['MP', 'Islas Marianas del Norte', '1', ['670']],
  ['MH', 'Islas Marshall', '692'],
  ['SB', 'Islas Salomón', '677'],
  ['TC', 'Islas Turcas y Caicos', '1', ['649']],
  ['VG', 'Islas Vírgenes Británicas', '1', ['284']],
  ['VI', 'Islas Vírgenes de EE. UU.', '1', ['340']],
  ['IL', 'Israel', '972'],
  ['IT', 'Italia', '39'],
  ['JM', 'Jamaica', '1', ['876', '658']],
  ['JP', 'Japón', '81'],
  ['JO', 'Jordania', '962'],
  ['KZ', 'Kazajistán', '7', ['6', '7']],
  ['KE', 'Kenia', '254'],
  ['KG', 'Kirguistán', '996'],
  ['KI', 'Kiribati', '686'],
  ['XK', 'Kosovo', '383'],
  ['KW', 'Kuwait', '965'],
  ['LA', 'Laos', '856'],
  ['LS', 'Lesoto', '266'],
  ['LV', 'Letonia', '371'],
  ['LB', 'Líbano', '961'],
  ['LR', 'Liberia', '231'],
  ['LY', 'Libia', '218'],
  ['LI', 'Liechtenstein', '423'],
  ['LT', 'Lituania', '370'],
  ['LU', 'Luxemburgo', '352'],
  ['MO', 'Macao', '853'],
  ['MK', 'Macedonia del Norte', '389'],
  ['MG', 'Madagascar', '261'],
  ['MY', 'Malasia', '60'],
  ['MW', 'Malaui', '265'],
  ['MV', 'Maldivas', '960'],
  ['ML', 'Malí', '223'],
  ['MT', 'Malta', '356'],
  ['MA', 'Marruecos', '212'],
  ['MQ', 'Martinica', '596'],
  ['MU', 'Mauricio', '230'],
  ['MR', 'Mauritania', '222'],
  ['YT', 'Mayotte', '262', ['269', '639']],
  ['MX', 'México', '52'],
  ['FM', 'Micronesia', '691'],
  ['MD', 'Moldavia', '373'],
  ['MC', 'Mónaco', '377'],
  ['MN', 'Mongolia', '976'],
  ['ME', 'Montenegro', '382'],
  ['MS', 'Montserrat', '1', ['664']],
  ['MZ', 'Mozambique', '258'],
  ['MM', 'Myanmar', '95'],
  ['NA', 'Namibia', '264'],
  ['NR', 'Nauru', '674'],
  ['NP', 'Nepal', '977'],
  ['NI', 'Nicaragua', '505'],
  ['NE', 'Níger', '227'],
  ['NG', 'Nigeria', '234'],
  ['NU', 'Niue', '683'],
  ['NO', 'Noruega', '47'],
  ['NC', 'Nueva Caledonia', '687'],
  ['NZ', 'Nueva Zelanda', '64'],
  ['OM', 'Omán', '968'],
  ['NL', 'Países Bajos', '31'],
  ['PK', 'Pakistán', '92'],
  ['PW', 'Palaos', '680'],
  ['PS', 'Palestina', '970'],
  ['PA', 'Panamá', '507'],
  ['PG', 'Papúa Nueva Guinea', '675'],
  ['PY', 'Paraguay', '595'],
  ['PF', 'Polinesia Francesa', '689'],
  ['PL', 'Polonia', '48'],
  ['PT', 'Portugal', '351'],
  ['PR', 'Puerto Rico', '1', ['787', '939']],
  ['GB', 'Reino Unido', '44'],
  ['CF', 'República Centroafricana', '236'],
  ['CZ', 'República Checa', '420'],
  ['CD', 'República Democrática del Congo', '243'],
  ['DO', 'República Dominicana', '1', ['809', '829', '849']],
  ['RE', 'Reunión', '262'],
  ['RW', 'Ruanda', '250'],
  ['RO', 'Rumania', '40'],
  ['RU', 'Rusia', '7'],
  ['WS', 'Samoa', '685'],
  ['AS', 'Samoa Americana', '1', ['684']],
  ['BL', 'San Bartolomé', '590'],
  ['KN', 'San Cristóbal y Nieves', '1', ['869']],
  ['SM', 'San Marino', '378'],
  ['MF', 'San Martín', '590'],
  ['PM', 'San Pedro y Miquelón', '508'],
  ['VC', 'San Vicente y las Granadinas', '1', ['784']],
  ['LC', 'Santa Lucía', '1', ['758']],
  ['ST', 'Santo Tomé y Príncipe', '239'],
  ['SN', 'Senegal', '221'],
  ['RS', 'Serbia', '381'],
  ['SC', 'Seychelles', '248'],
  ['SL', 'Sierra Leona', '232'],
  ['SG', 'Singapur', '65'],
  ['SX', 'Sint Maarten', '1', ['721']],
  ['SY', 'Siria', '963'],
  ['SO', 'Somalia', '252'],
  ['LK', 'Sri Lanka', '94'],
  ['ZA', 'Sudáfrica', '27'],
  ['SD', 'Sudán', '249'],
  ['SS', 'Sudán del Sur', '211'],
  ['SE', 'Suecia', '46'],
  ['CH', 'Suiza', '41'],
  ['SR', 'Surinam', '597'],
  ['TH', 'Tailandia', '66'],
  ['TW', 'Taiwán', '886'],
  ['TZ', 'Tanzania', '255'],
  ['TJ', 'Tayikistán', '992'],
  ['TL', 'Timor Oriental', '670'],
  ['TG', 'Togo', '228'],
  ['TO', 'Tonga', '676'],
  ['TT', 'Trinidad y Tobago', '1', ['868']],
  ['TN', 'Túnez', '216'],
  ['TM', 'Turkmenistán', '993'],
  ['TR', 'Turquía', '90'],
  ['TV', 'Tuvalu', '688'],
  ['UA', 'Ucrania', '380'],
  ['UG', 'Uganda', '256'],
  ['UY', 'Uruguay', '598'],
  ['UZ', 'Uzbekistán', '998'],
  ['VU', 'Vanuatu', '678'],
  ['VE', 'Venezuela', '58'],
  ['VN', 'Vietnam', '84'],
  ['WF', 'Wallis y Futuna', '681'],
  ['YE', 'Yemen', '967'],
  ['DJ', 'Yibuti', '253'],
  ['ZM', 'Zambia', '260'],
  ['ZW', 'Zimbabue', '263'],
];

export const PHONE_COUNTRIES: readonly PhoneCountry[] = ROWS.map(
  ([iso, name, dialCode, leadingDigits]) =>
    leadingDigits === undefined ? { iso, name, dialCode } : { iso, name, dialCode, leadingDigits },
);

/** Con el que arranca el campo. */
export const DEFAULT_PHONE_COUNTRY: PhoneCountry = PHONE_COUNTRIES[0]!;

/**
 * Quién se queda un código compartido cuando el número no dice más.
 *
 * Canadá y Estados Unidos no se distinguen por un puñado de códigos de área
 * —Canadá tiene decenas—, y Guadalupe, San Bartolomé y San Martín comparten
 * numeración. Si la persona ya eligió uno de ellos se respeta su elección; esto
 * solo decide al abrir un número guardado.
 */
const SHARED_CODE_OWNER: Readonly<Record<string, string>> = { '1': 'US', '590': 'GP' };

export function phoneCountryByIso(iso: string): PhoneCountry | null {
  return PHONE_COUNTRIES.find((country) => country.iso === iso) ?? null;
}

/**
 * La bandera, como emoji: dos letras regionales que el teléfono dibuja.
 *
 * Emoji y no imágenes: 230 banderas en PNG pesan más que toda la app, y el
 * sistema ya las trae dibujadas a su estilo.
 */
export function flagEmoji(iso: string): string {
  return String.fromCodePoint(
    ...iso
      .toUpperCase()
      .split('')
      .map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65),
  );
}

/**
 * El celular con solo dígitos y el `+`.
 *
 * Es como se compara y como se guarda: «+51 987 654 321» y «+51987654321» son el
 * mismo número, y tratarlos como dos deja pasar el celular de otra persona.
 */
export function normalizePhoneNumber(raw: string): string {
  return raw.replace(/[^\d+]/g, '');
}

export interface SplitPhoneNumber {
  /** `null` si el código no es de ningún país de la lista. */
  readonly country: PhoneCountry | null;
  /** Solo dígitos, sin el código del país. */
  readonly national: string;
}

/**
 * Separa un número guardado en país y número nacional.
 *
 * `preferred` es el país que la persona tiene elegido en la pantalla: con un
 * código compartido, se queda con él salvo que el código de área diga lo
 * contrario. Sin `+` no hay nada que separar y todo es número nacional — es lo
 * que pasa al pegar «987 654 321».
 */
export function splitPhoneNumber(raw: string, preferred?: PhoneCountry): SplitPhoneNumber {
  const phone = normalizePhoneNumber(raw);
  if (!phone.startsWith('+')) {
    return { country: preferred ?? DEFAULT_PHONE_COUNTRY, national: phone.replace(/\D/g, '') };
  }

  const digits = phone.slice(1).replace(/\D/g, '');
  // Los códigos de E.164 son libres de prefijo —ninguno empieza como otro—, así
  // que de uno a tres dígitos solo uno puede coincidir.
  for (const length of [1, 2, 3]) {
    const dialCode = digits.slice(0, length);
    const candidates = PHONE_COUNTRIES.filter((country) => country.dialCode === dialCode);
    if (candidates.length === 0) continue;

    const national = digits.slice(length);
    const byArea = candidates.find(
      (country) => country.leadingDigits?.some((prefix) => national.startsWith(prefix)) === true,
    );
    const country =
      byArea ??
      (preferred !== undefined && candidates.includes(preferred) ? preferred : undefined) ??
      candidates.find((candidate) => candidate.iso === SHARED_CODE_OWNER[dialCode]) ??
      candidates.find((candidate) => candidate.leadingDigits === undefined) ??
      candidates[0]!;
    return { country, national };
  }

  return { country: null, national: digits };
}

/**
 * Une país y número en lo que se guarda.
 *
 * Sin número devuelve la cadena vacía, no «+51»: un prefijo solo no es un celular
 * a medias sino ningún celular, y los formularios lo trataban como un dato y lo
 * guardaban encima del bueno.
 */
export function joinPhoneNumber(country: PhoneCountry, national: string): string {
  const digits = national.replace(/\D/g, '');
  return digits.length === 0 ? '' : `+${country.dialCode}${digits}`;
}

export type PhoneDenial = 'missing' | 'no_country_code' | 'unknown_country' | 'peru_mobile' | 'length';

/**
 * Los celulares de Perú: nueve dígitos, empezando por 9.
 *
 * Es la única regla por país, y a propósito. Perú es de donde son los gimnasios,
 * y un dígito de menos es el tipeo que de verdad pasa en el mostrador; con él, el
 * número parece bueno y no llama a nadie. Para el resto basta E.164: el largo de
 * cada numeración del mundo es lo que hace pesar a libphonenumber cientos de KB.
 */
const PERU_MOBILE = /^9\d{8}$/;

/**
 * `null` si el celular sirve; el motivo si no.
 *
 * Motivo y no booleano, como `checkRuc`: la misma frase sale debajo del campo en
 * la app y en el 400 de la api.
 */
export function checkPhoneNumber(raw: string): PhoneDenial | null {
  const phone = normalizePhoneNumber(raw);
  if (phone.replace(/\+/g, '').length === 0) return 'missing';
  if (!phone.startsWith('+')) return 'no_country_code';
  // Hasta 15 dígitos, el tope de E.164. Un `+` a mitad del número no es de nadie.
  if (!/^\+\d{8,15}$/.test(phone)) {
    const { country, national } = splitPhoneNumber(phone);
    if (country?.iso === 'PE' && !PERU_MOBILE.test(national)) return 'peru_mobile';
    return 'length';
  }

  const { country, national } = splitPhoneNumber(phone);
  if (country === null) return 'unknown_country';
  if (country.iso === 'PE' && !PERU_MOBILE.test(national)) return 'peru_mobile';
  return null;
}

export const isValidPhoneNumber = (raw: string): boolean => checkPhoneNumber(raw) === null;

export function phoneDenialMessage(denial: PhoneDenial): string {
  switch (denial) {
    case 'missing':
      return 'Falta el celular.';
    case 'no_country_code':
      return 'El celular va con el código del país, como +51 987 654 321.';
    case 'unknown_country':
      return 'Ese código de país no existe: elige el país de la lista.';
    case 'peru_mobile':
      return 'Un celular de Perú tiene 9 dígitos y empieza con 9.';
    case 'length':
      return 'A ese número le sobran o le faltan dígitos.';
  }
}

/**
 * Sin tildes y en minúsculas, para buscar «peru» y encontrar «Perú».
 *
 * A mano y no con `normalize('NFD')`: la lista es en español y estas son todas las
 * letras que trae, y así no depende de lo que implemente el motor de la app.
 */
function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/[áàäâå]/g, 'a')
    .replace(/[éèëê]/g, 'e')
    .replace(/[íìïî]/g, 'i')
    .replace(/[óòöô]/g, 'o')
    .replace(/[úùüû]/g, 'u')
    .replace(/ñ/g, 'n');
}

/**
 * Los países que coinciden con lo que se escribe en el buscador.
 *
 * Por nombre, o por código si lo que se escribe son dígitos: quien sabe que su
 * país es el +58 no tiene por qué saber cómo lo llamamos.
 */
export function searchPhoneCountries(query: string): readonly PhoneCountry[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) return PHONE_COUNTRIES;

  if (/^\+?\d+$/.test(trimmed)) {
    const digits = trimmed.replace('+', '');
    return PHONE_COUNTRIES.filter((country) => country.dialCode.startsWith(digits));
  }

  const needle = fold(trimmed);
  return PHONE_COUNTRIES.filter((country) => fold(country.name).includes(needle));
}
