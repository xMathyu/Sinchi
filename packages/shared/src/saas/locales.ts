/**
 * Cuantos locales puede abrir una persona.
 *
 * Vivia como una constante privada de la api, y eso bastaba mientras el alta
 * solo se alcanzaba desde el directorio: quien llegaba ahi no tenia cuenta, asi
 * que nunca podia estar en el tope. Desde que «Registrar mi gimnasio» sale
 * tambien en Mi cuenta, la app tiene delante a alguien que SI puede estar en el
 * tope — y entonces necesita la misma regla para no ofrecerle un boton que la
 * api va a rechazar con 409. Es el defecto que este producto ya se conoce y que
 * ha mordido dos veces.
 *
 * Asi que baja a `@sinchi/shared`, que es donde el CLAUDE.md manda que vivan las
 * reglas: la corren los dos lados, la app para no ofrecer lo que va a fallar y
 * la api para no confiar en que la app lo hizo.
 *
 * Devuelve el MOTIVO y no un booleano, como el resto del dominio: «no se pudo»
 * deja a quien lo lee sin saber que hacer, y aqui lo que hay que hacer es
 * escribirnos.
 */

/**
 * Tope de locales por persona.
 *
 * Es un tope de ABUSO, no un escalon comercial: lo que se cobra sigue saliendo
 * del padron de cada local, uno por uno. Un dueno con tres dojos paga tres
 * escalones, y si los tres son pequenos paga cero.
 */
export const MAX_GYMS_PER_PERSON = 5;

export type NewGymDenialCode = 'at_cap';

export interface NewGymDecision {
  readonly allowed: boolean;
  /** Cuantos le quedan. Nunca negativo. */
  readonly remaining: number;
  /** `true` cuando ya lleva alguno: cambia el texto de «registrar» a «abrir otro». */
  readonly hasGyms: boolean;
  readonly reason: { readonly code: NewGymDenialCode; readonly message: string } | null;
}

/**
 * Si esta persona puede abrir un local mas.
 *
 * `gymsOwned` son sus filas en `staff`, TODAS, no solo las de dueno. Es lo que
 * cuenta la api (`assertGymsAvailable`), y las dos tienen que contar igual o la
 * app habilitaria un boton que el servidor niega. Que un recepcionista de cinco
 * locales no pueda abrir el suyo es una consecuencia rara del tope; se deja
 * documentada aqui en vez de arreglarla a medias en un solo lado.
 */
export function checkNewGym(gymsOwned: number): NewGymDecision {
  const usados = Math.max(0, Math.trunc(gymsOwned));
  const remaining = Math.max(0, MAX_GYMS_PER_PERSON - usados);

  if (remaining === 0) {
    return {
      allowed: false,
      remaining: 0,
      hasGyms: true,
      reason: {
        code: 'at_cap',
        message:
          `Ya llevas ${MAX_GYMS_PER_PERSON} locales en Sinchi, que es el máximo por cuenta. ` +
          'Si necesitas más, escríbenos.',
      },
    };
  }

  return { allowed: true, remaining, hasGyms: usados > 0, reason: null };
}
