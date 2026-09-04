/**
 * La rutina tal como la escribe el gimnasio, antes de existir.
 *
 * Misma forma que `checkPlanDraft` y `checkEventDraft`: devuelve el MOTIVO o
 * `null`, y la corren los dos lados. El formulario apaga el boton por la razon
 * exacta por la que la api habria respondido 400, en vez de dejar al dueno
 * grabar seis ejercicios para que le digan que no al final.
 *
 * Una rutina cubre DOS cosas que parecen distintas y son la misma: el "dia de
 * pecho", que son seis ejercicios con sus series, y el "uchimata", que es una
 * tecnica con un video y una explicacion. Por eso los pasos son opcionales: una
 * tecnica suelta se escribe con el video de la rutina y nada mas, y obligar a
 * crear un paso llamado igual que la rutina seria papeleo.
 */
import { parseVideoLink } from './video.js';

export const ROUTINE_TITLE_MIN = 3;
export const ROUTINE_TITLE_MAX = 80;
export const ROUTINE_SUMMARY_MAX = 400;
export const ROUTINE_ITEM_TITLE_MIN = 2;
export const ROUTINE_ITEM_TITLE_MAX = 80;
export const ROUTINE_INSTRUCTIONS_MAX = 2000;
/** "4 series de 12", "5 minutos de uchikomi". Cabe de sobra. */
export const ROUTINE_PRESCRIPTION_MAX = 60;
/** Cuarenta ejercicios no son una rutina, son un temario. */
export const ROUTINE_MAX_ITEMS = 40;

export type RoutineVisibilityDraft = 'public' | 'members';
export type RoutineLevelDraft = 'beginner' | 'intermediate' | 'advanced' | null;

/** Un ejercicio o una tecnica dentro de la rutina. */
export interface RoutineItemDraft {
  readonly title: string;
  readonly instructions: string | null;
  readonly videoUrl: string | null;
  /** El video SUBIDO de este paso. Nunca junto con `videoUrl`. */
  readonly videoAssetId: string | null;
  /**
   * Cuanto hay que hacer, en texto libre.
   *
   * No son campos `sets` y `reps` a proposito: "4 series de 12" y "5 minutos de
   * uchikomi con el companero" son la misma casilla para quien la escribe, y
   * modelar solo la primera deja al judoca rellenando repeticiones que no
   * significan nada en su deporte. Sinchi no cuenta series; las dice.
   */
  readonly prescription: string | null;
}

export interface RoutineDraft {
  readonly title: string;
  readonly summary: string | null;
  /** El video de la rutina entera, como ENLACE. */
  readonly videoUrl: string | null;
  /**
   * El video de la rutina entera, SUBIDO.
   *
   * Es lo mismo para todo lo que decide esta funcion —hay video o no lo hay— y
   * por eso vale igual contra `nothing_to_show`. La diferencia entre uno y otro
   * la nota quien lo mira: el subido es privado y se sirve firmado, el enlace no.
   */
  readonly videoAssetId: string | null;
  readonly level: RoutineLevelDraft;
  readonly visibility: RoutineVisibilityDraft;
  readonly items: readonly RoutineItemDraft[];
}

export type RoutineDenialCode =
  | 'both_video_sources'
  | 'title_too_short'
  | 'title_too_long'
  | 'summary_too_long'
  | 'bad_video_link'
  | 'nothing_to_show'
  | 'too_many_items'
  | 'item_title_too_short'
  | 'item_title_too_long'
  | 'item_instructions_too_long'
  | 'item_prescription_too_long'
  | 'item_bad_video_link';

/**
 * El motivo, con el numero del paso cuando el problema esta en uno.
 *
 * Sin `itemIndex`, "el enlace del video no se entiende" en una rutina de ocho
 * ejercicios manda al dueno a revisarlos todos.
 */
export interface RoutineDenial {
  readonly code: RoutineDenialCode;
  /** Base 0. Solo en los motivos que empiezan por `item_`. */
  readonly itemIndex?: number;
}

const vacio = (texto: string | null): boolean => texto === null || texto.trim().length === 0;

export function checkRoutineDraft(draft: RoutineDraft): RoutineDenial | null {
  const title = draft.title.trim();
  if (title.length < ROUTINE_TITLE_MIN) return { code: 'title_too_short' };
  if (title.length > ROUTINE_TITLE_MAX) return { code: 'title_too_long' };

  if (!vacio(draft.summary) && draft.summary!.trim().length > ROUTINE_SUMMARY_MAX) {
    return { code: 'summary_too_long' };
  }

  if (!vacio(draft.videoUrl) && draft.videoAssetId !== null) {
    return { code: 'both_video_sources' };
  }
  if (!vacio(draft.videoUrl) && parseVideoLink(draft.videoUrl!) === null) {
    return { code: 'bad_video_link' };
  }

  if (draft.items.length > ROUTINE_MAX_ITEMS) return { code: 'too_many_items' };

  /**
   * Un titulo suelto no es contenido.
   *
   * Sin video, sin explicacion y sin pasos, lo que se publica es la palabra
   * "Uchimata" en una lista — y quien la toque desde el directorio se lleva la
   * impresion de que el gimnasio esta vacio, que es lo contrario de lo que la
   * biblioteca viene a hacer.
   */
  if (
    vacio(draft.videoUrl) &&
    draft.videoAssetId === null &&
    vacio(draft.summary) &&
    draft.items.length === 0
  ) {
    return { code: 'nothing_to_show' };
  }

  for (const [index, item] of draft.items.entries()) {
    const nombre = item.title.trim();
    if (nombre.length < ROUTINE_ITEM_TITLE_MIN) {
      return { code: 'item_title_too_short', itemIndex: index };
    }
    if (nombre.length > ROUTINE_ITEM_TITLE_MAX) {
      return { code: 'item_title_too_long', itemIndex: index };
    }
    if (!vacio(item.instructions) && item.instructions!.trim().length > ROUTINE_INSTRUCTIONS_MAX) {
      return { code: 'item_instructions_too_long', itemIndex: index };
    }
    if (!vacio(item.prescription) && item.prescription!.trim().length > ROUTINE_PRESCRIPTION_MAX) {
      return { code: 'item_prescription_too_long', itemIndex: index };
    }
    if (!vacio(item.videoUrl) && item.videoAssetId !== null) {
      return { code: 'both_video_sources', itemIndex: index };
    }
    if (!vacio(item.videoUrl) && parseVideoLink(item.videoUrl!) === null) {
      return { code: 'item_bad_video_link', itemIndex: index };
    }
  }

  return null;
}

export const isValidRoutineDraft = (draft: RoutineDraft): boolean =>
  checkRoutineDraft(draft) === null;

export function routineDenialMessage(denial: RoutineDenial): string {
  const paso = denial.itemIndex === undefined ? '' : `Paso ${denial.itemIndex + 1}: `;

  switch (denial.code) {
    case 'title_too_short':
      return `Ponle un título de al menos ${ROUTINE_TITLE_MIN} letras: «Día de pecho», «Uchimata».`;
    case 'title_too_long':
      return `El título no puede pasar de ${ROUTINE_TITLE_MAX} caracteres.`;
    case 'summary_too_long':
      return `La descripción no puede pasar de ${ROUTINE_SUMMARY_MAX} caracteres.`;
    case 'both_video_sources':
      return `${paso}tiene un video subido y un enlace a la vez. Deja uno de los dos: con los dos puestos, nadie sabe cuál se ve.`;
    case 'bad_video_link':
      return 'Ese enlace de video no se entiende. Pega la dirección de YouTube o Vimeo, o cualquier enlace que empiece por https.';
    case 'nothing_to_show':
      return 'Añade un video, una explicación o al menos un paso: un título solo no le sirve a nadie.';
    case 'too_many_items':
      return `Una rutina admite hasta ${ROUTINE_MAX_ITEMS} pasos. Si son más, pártela en dos.`;
    case 'item_title_too_short':
      return `${paso}ponle nombre al ejercicio o a la técnica.`;
    case 'item_title_too_long':
      return `${paso}el nombre no puede pasar de ${ROUTINE_ITEM_TITLE_MAX} caracteres.`;
    case 'item_instructions_too_long':
      return `${paso}las instrucciones no pueden pasar de ${ROUTINE_INSTRUCTIONS_MAX} caracteres.`;
    case 'item_prescription_too_long':
      return `${paso}las series no pueden pasar de ${ROUTINE_PRESCRIPTION_MAX} caracteres.`;
    case 'item_bad_video_link':
      return `${paso}ese enlace de video no se entiende. Pega la dirección de YouTube o Vimeo.`;
  }
}
