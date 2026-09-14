/**
 * El celular que entra por cualquier ruta.
 *
 * Antes cada esquema decía `z.string().min(6).max(20)` y nada más: contaba
 * caracteres, así que `987654321` pasaba y se guardaba como una persona distinta
 * de `+51987654321` (decisiones §16). La regla es `checkPhoneNumber`, la misma que
 * apaga el botón en la app, y el valor sale ya normalizado: los servicios reciben
 * lo que se guarda, y el mostrador que teclea con espacios no deja una fila que
 * el índice único no reconoce como repetida.
 */
import { z } from 'zod';
import {
  checkPhoneNumber,
  isValidPhoneNumber,
  normalizePhoneNumber,
  phoneDenialMessage,
} from '@sinchi/shared';

/** El tope solo corta lo absurdo: con espacios y guiones, un número real no llega. */
const RAW_MAX = 40;

export const phoneSchema = z
  .string()
  .max(RAW_MAX)
  .superRefine((raw, ctx) => {
    const denial = checkPhoneNumber(raw);
    if (denial !== null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: phoneDenialMessage(denial) });
    }
  })
  .transform(normalizePhoneNumber);

/**
 * El celular que acompaña a un inicio de sesión, que no puede tumbarlo.
 *
 * `/auth/google` lo recibe como dato suelto del registro, no como credencial, y
 * un 400 ahí deja la app colgada en el splash (la guarda de `auth.ts` de la app lo
 * cuenta). Uno que no sirve se descarta: la persona entra igual, y la primera
 * reserva se lo vuelve a pedir porque de verdad falta.
 */
export const signUpPhoneSchema = z
  .string()
  .max(RAW_MAX)
  .optional()
  .transform((raw) =>
    raw !== undefined && isValidPhoneNumber(raw) ? normalizePhoneNumber(raw) : undefined,
  );
