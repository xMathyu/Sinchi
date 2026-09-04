/**
 * Subir un video: lo que se acepta y donde se guarda.
 *
 * Vive en el dominio y no en la api por lo de siempre: el telefono tiene que
 * poder decir "ese archivo no cabe" ANTES de gastar diez minutos de datos
 * subiendolo, y la api tiene que decidir lo mismo sin fiarse de que el telefono
 * lo hizo.
 */

/**
 * 300 MB por video.
 *
 * No es un numero redondo elegido al azar: es lo que ocupa mas o menos un
 * cuarto de hora grabado con un celular a 1080p, y ninguna tecnica necesita
 * mas. El tope importa por el lado que no se ve — **lo que cuesta servir el
 * video, no guardarlo**. Guardar un GB cuesta centavos al mes; que cien alumnos
 * lo miren tres veces son 300 GB de salida, y eso ya es dinero de verdad. El dia
 * que apriete, este numero y el numero de videos por gimnasio son las dos
 * palancas, y estan aqui las dos.
 */
export const VIDEO_MAX_BYTES = 300 * 1024 * 1024;

/**
 * Lo que un celular graba y un reproductor sabe abrir, y nada mas.
 *
 * La lista es corta a proposito: aceptar `application/octet-stream` —que es lo
 * que manda medio mundo cuando no sabe— convierte el bucket del gimnasio en un
 * sitio donde subir cualquier cosa.
 */
export const VIDEO_CONTENT_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/x-m4v',
  'video/webm',
] as const;

export type VideoContentType = (typeof VIDEO_CONTENT_TYPES)[number];

const EXTENSION: Record<VideoContentType, string> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/x-m4v': 'm4v',
  'video/webm': 'webm',
};

export type VideoUploadDenialCode =
  | 'unsupported_type'
  | 'too_large'
  | 'empty';

export interface VideoUploadDenial {
  readonly code: VideoUploadDenialCode;
}

export const isVideoContentType = (value: string): value is VideoContentType =>
  (VIDEO_CONTENT_TYPES as readonly string[]).includes(value);

/**
 * El motivo, o `null` si se puede subir.
 *
 * `sizeBytes` es opcional porque no siempre se sabe antes de empezar; cuando se
 * sabe, se comprueba aqui y se ahorra la subida entera.
 */
export function checkVideoUpload(input: {
  readonly contentType: string;
  readonly sizeBytes?: number | undefined;
}): VideoUploadDenial | null {
  if (!isVideoContentType(input.contentType)) return { code: 'unsupported_type' };
  if (input.sizeBytes !== undefined) {
    if (input.sizeBytes <= 0) return { code: 'empty' };
    if (input.sizeBytes > VIDEO_MAX_BYTES) return { code: 'too_large' };
  }
  return null;
}

export function videoUploadDenialMessage(denial: VideoUploadDenial): string {
  switch (denial.code) {
    case 'unsupported_type':
      return 'Ese archivo no es un video que la app sepa reproducir. Sube un MP4 o un video grabado con el celular.';
    case 'too_large':
      return `El video no puede pasar de ${Math.round(VIDEO_MAX_BYTES / 1024 / 1024)} MB. Si es más largo, córtalo o súbelo a YouTube y pega el enlace.`;
    case 'empty':
      return 'Ese archivo está vacío.';
  }
}

/**
 * Donde vive el objeto dentro del bucket.
 *
 * Se DERIVA del gimnasio y del id del video, y nunca del nombre que traia el
 * archivo: "../../otro-gimnasio/kata.mp4" es un nombre perfectamente valido y
 * escribiria encima del video de otro local. Aqui no hay nada que sanear porque
 * no entra nada del cliente.
 *
 * El gimnasio va delante para que borrar un local sea borrar un prefijo, que es
 * la unica forma barata de cumplir un "borren mis datos".
 */
export const videoObjectPath = (
  tenantId: string,
  videoId: string,
  contentType: VideoContentType,
): string => `gyms/${tenantId}/routines/${videoId}.${EXTENSION[contentType]}`;

/** MB con un decimal, para decirle al dueño cuánto pesa lo que subió. */
export const formatMegabytes = (bytes: number): string =>
  `${(bytes / 1024 / 1024).toFixed(1)} MB`;
