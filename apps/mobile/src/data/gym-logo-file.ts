/**
 * Elegir el logo de la galería y dejarlo listo para subir.
 *
 * Aparte de `actions.ts` porque aquí vive lo NATIVO —la galería y el editor de
 * imágenes— y lo usan dos pantallas: el alta, donde el gimnasio todavía no
 * existe y el logo espera en el teléfono, y «Tu logo», donde se sube al
 * momento.
 *
 * La imagen se ACHICA aquí y no en la api. Una foto del letrero sale del
 * celular con 12 megapíxeles y cuatro megas; a 512 píxeles son decenas de KB.
 * Achicarla en el servidor era subir los cuatro megas por datos móviles para
 * tirar el 99 %, y además exigía una librería nativa en la imagen de la api.
 */
import * as ImagePicker from 'expo-image-picker';
import { requireOptionalNativeModule } from 'expo';
import {
  checkGymLogo,
  gymLogoDenialMessage,
  gymLogoTargetSize,
  type GymLogoContentType,
} from '@sinchi/shared';

/** Un logo en el teléfono, ya achicado y comprobado. */
export interface PickedGymLogo {
  /** `file://` del cache de la app. */
  readonly uri: string;
  readonly contentType: GymLogoContentType;
  readonly width: number;
  readonly height: number;
}

/**
 * Tipos que se pasan a JPEG. El resto va a PNG.
 *
 * Un logo suele tener fondo transparente, y JPEG lo pinta de negro: por eso el
 * PNG es lo que se hace cuando no se sabe. Lo que sale de la cámara —JPEG o el
 * HEIC del iPhone— no tiene transparencia que guardar, y en PNG pesaría cinco
 * veces más.
 */
const PHOTO_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/heic', 'image/heif']);

/**
 * Abre la galería y devuelve el logo listo, o `null` si cerró sin elegir.
 *
 * Sin recorte a propósito: el editor de iOS solo recorta en cuadrado, y un logo
 * que es un nombre escrito perdería las letras de los costados. Se guarda con
 * su forma y cada pantalla lo encaja entero en su baldosa.
 *
 * Lanza un `Error` con la frase para el dueño si falta el permiso o si la imagen
 * no pasa `checkGymLogo` — la misma regla con la que la api la va a juzgar.
 */
export async function pickGymLogo(): Promise<PickedGymLogo | null> {
  const permit = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permit.granted) {
    throw new Error('Hace falta permiso para entrar a tus fotos. Dalo en los ajustes del teléfono.');
  }

  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: false,
    quality: 1,
  });
  if (picked.canceled) return null;
  const asset = picked.assets[0];
  if (asset === undefined) return null;

  return await prepareGymLogo(asset.uri, asset.mimeType);
}

/**
 * Achica y recodifica una imagen del teléfono, y la juzga con `checkGymLogo`.
 *
 * Separada de la galería porque es lo que puede fallar de verdad —memoria,
 * formato, el módulo nativo— y así se prueba con cualquier archivo, sin tener
 * que elegirlo a mano.
 */
export async function prepareGymLogo(
  uri: string,
  mimeType: string | undefined,
): Promise<PickedGymLogo> {
  /**
   * Se PREGUNTA si el módulo nativo está antes de cargarlo, y no con un
   * `try` alrededor del `require`.
   *
   * Un binario que no lo trae —el cliente de desarrollo de antes de este cambio—
   * revienta al importarlo. Y el `try` no lo ataja: cuando un `require` falla en
   * tiempo de ejecución, Metro no le pasa la excepción a quien lo llamó, la
   * reporta como error FATAL y devuelve `undefined`. Se vio en el simulador:
   * pantalla roja, y la frase de abajo nunca salía. `requireOptionalNativeModule`
   * devuelve `null` sin lanzar nada.
   */
  if (requireOptionalNativeModule('ExpoImageManipulator') === null) {
    throw new Error('Esta versión de la app no puede preparar imágenes. Actualízala para subir tu logo.');
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { ImageManipulator, SaveFormat } = require('expo-image-manipulator') as typeof import('expo-image-manipulator');

  const asPhoto = mimeType !== undefined && PHOTO_TYPES.has(mimeType);
  const contentType: GymLogoContentType = asPhoto ? 'image/jpeg' : 'image/png';

  /**
   * El tamaño se toma de la imagen DECODIFICADA y no de lo que dice la galería:
   * una foto vertical puede venir con el ancho y el alto cambiados por la
   * orientación del EXIF, y achicarla por el lado equivocado deja uno de los
   * lados por encima del tope. Ya decodificada, la orientación está aplicada.
   */
  const original = await ImageManipulator.manipulate(uri).renderAsync();
  const target = gymLogoTargetSize(original.width, original.height);
  // Se achica la imagen ya abierta y no la ruta: abrir dos veces una foto de 12
  // megapíxeles son dos veces 48 MB de memoria en un teléfono de gama baja.
  const image =
    target === null
      ? original
      : await ImageManipulator.manipulate(original).resize(target).renderAsync();

  // Volver a codificarla también es lo que le quita el EXIF: una foto tomada en
  // el local lleva dentro las coordenadas de dónde se tomó.
  const saved = await image.saveAsync({
    format: asPhoto ? SaveFormat.JPEG : SaveFormat.PNG,
    compress: asPhoto ? 0.85 : 1,
    base64: true,
  });

  const denial = checkGymLogo({
    contentType,
    sizeBytes: base64Bytes(saved.base64 ?? ''),
    width: saved.width,
    height: saved.height,
  });
  if (denial !== null) throw new Error(gymLogoDenialMessage(denial));

  return { uri: saved.uri, contentType, width: saved.width, height: saved.height };
}

/** Cuántos bytes hay detrás de un base64, sin decodificarlo. */
function base64Bytes(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}
