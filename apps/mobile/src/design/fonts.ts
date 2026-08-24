/**
 * Carga de la familia display.
 *
 * En React Native las fuentes personalizadas no se seleccionan por
 * `fontWeight`: cada peso es una familia distinta. Por eso el mapa explicito —
 * sin el, Android cae al peso regular y los titulares pierden todo su caracter.
 */
import {
  Archivo_600SemiBold,
  Archivo_700Bold,
  Archivo_800ExtraBold,
  Archivo_900Black,
} from '@expo-google-fonts/archivo';

export const DISPLAY_FONTS = {
  Archivo_600SemiBold,
  Archivo_700Bold,
  Archivo_800ExtraBold,
  Archivo_900Black,
} as const;

export type DisplayWeight = 'semibold' | 'bold' | 'extrabold' | 'black';

const FAMILY_BY_WEIGHT: Readonly<Record<DisplayWeight, string>> = {
  semibold: 'Archivo_600SemiBold',
  bold: 'Archivo_700Bold',
  extrabold: 'Archivo_800ExtraBold',
  black: 'Archivo_900Black',
};

/** Familia concreta para un peso. Los pesos livianos caen al semibold. */
export function displayFamily(weight: string | undefined): string {
  switch (weight) {
    case 'bold':
      return FAMILY_BY_WEIGHT.bold;
    case 'extrabold':
      return FAMILY_BY_WEIGHT.extrabold;
    case 'black':
      return FAMILY_BY_WEIGHT.black;
    case undefined:
      return FAMILY_BY_WEIGHT.black;
    default:
      return FAMILY_BY_WEIGHT.semibold;
  }
}
