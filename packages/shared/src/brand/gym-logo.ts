/**
 * El logo del gimnasio: qué se acepta, a qué tamaño y dónde se sirve.
 *
 * Vive en el dominio por lo de siempre: el teléfono tiene que poder decir «esa
 * imagen no sirve» antes de subirla, y la api tiene que decidir lo mismo sin
 * fiarse de que el teléfono lo hizo.
 *
 * Es OPCIONAL de punta a punta. No todo dojo tiene logo —el que arranca con doce
 * alumnos tiene un nombre y un tatami—, y un gimnasio sin logo se ve con sus
 * iniciales, igual que un alumno sin foto.
 */

/**
 * 512 píxeles por lado, como mucho.
 *
 * El tope que importa es este y no el de bytes, porque lo caro de una imagen no
 * es bajarla sino ABRIRLA. Un PNG de un solo color comprime casi a nada:
 * 20.000 × 20.000 píxeles caben en menos de un mega y, al decodificarlos, son
 * 1,6 GB de memoria. Un solo archivo así en el directorio cerraría la app de
 * todo el que lo abra, y el tope de bytes lo dejaría pasar. Por eso la api lee
 * las dimensiones de la cabecera antes de guardar nada.
 *
 * 512 sobra: el logo más grande de la app se pinta a 88 puntos, que en la
 * pantalla más densa son 264 píxeles.
 */
export const GYM_LOGO_MAX_SIDE = 512;

/**
 * Un mega. A 512 por lado, un JPEG pesa unos 60 KB y un PNG con transparencia
 * rara vez pasa de 300: el tope está para la red de quien lo baja, no es la
 * meta.
 */
export const GYM_LOGO_MAX_BYTES = 1024 * 1024;

/**
 * PNG y JPEG, y nada más.
 *
 * PNG porque un logo suele tener fondo transparente y JPEG no lo guarda; JPEG
 * porque es lo que sale de la foto del letrero. WebP pesaría menos, pero el logo
 * es candidato a salir en un correo, y Outlook todavía no lo pinta.
 */
export const GYM_LOGO_CONTENT_TYPES = ['image/png', 'image/jpeg'] as const;

export type GymLogoContentType = (typeof GYM_LOGO_CONTENT_TYPES)[number];

export type GymLogoDenialCode = 'unsupported_type' | 'empty' | 'too_large' | 'too_many_pixels';

export interface GymLogoDenial {
  readonly code: GymLogoDenialCode;
}

export const isGymLogoContentType = (value: string): value is GymLogoContentType =>
  (GYM_LOGO_CONTENT_TYPES as readonly string[]).includes(value);

/**
 * El motivo, o `null` si la imagen sirve.
 *
 * Todo lo que recibe es de la imagen YA preparada: el teléfono la achica antes
 * de preguntar, y la api pregunta con lo que leyó de los bytes, no con lo que el
 * cliente declaró.
 */
export function checkGymLogo(input: {
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly width: number;
  readonly height: number;
}): GymLogoDenial | null {
  if (!isGymLogoContentType(input.contentType)) return { code: 'unsupported_type' };
  if (input.sizeBytes <= 0 || input.width <= 0 || input.height <= 0) return { code: 'empty' };
  if (input.sizeBytes > GYM_LOGO_MAX_BYTES) return { code: 'too_large' };
  if (input.width > GYM_LOGO_MAX_SIDE || input.height > GYM_LOGO_MAX_SIDE) {
    return { code: 'too_many_pixels' };
  }
  return null;
}

export function gymLogoDenialMessage(denial: GymLogoDenial): string {
  switch (denial.code) {
    case 'unsupported_type':
      return 'Esa imagen no la podemos usar. Elige un PNG o un JPG.';
    case 'empty':
      return 'Esa imagen está vacía.';
    case 'too_large':
      return `El logo no puede pasar de ${Math.round(GYM_LOGO_MAX_BYTES / 1024 / 1024)} MB. Prueba con otra imagen.`;
    case 'too_many_pixels':
      return `El logo no puede pasar de ${GYM_LOGO_MAX_SIDE} × ${GYM_LOGO_MAX_SIDE} píxeles.`;
  }
}

/**
 * A qué tamaño dejar la imagen elegida, o `null` si ya cabe.
 *
 * El lado largo baja a `GYM_LOGO_MAX_SIDE` y el otro lo sigue, así que un logo
 * apaisado sigue apaisado: recortarlo a un cuadrado le cortaría las letras a
 * cualquier logo que sea un nombre escrito. Nunca agranda: estirar una imagen de
 * 200 píxeles no le añade detalle, solo peso.
 */
export function gymLogoTargetSize(
  width: number,
  height: number,
): { readonly width: number; readonly height: number } | null {
  const longest = Math.max(width, height);
  if (longest <= GYM_LOGO_MAX_SIDE) return null;
  const scale = GYM_LOGO_MAX_SIDE / longest;
  return {
    width: Math.max(1, Math.min(GYM_LOGO_MAX_SIDE, Math.round(width * scale))),
    height: Math.max(1, Math.min(GYM_LOGO_MAX_SIDE, Math.round(height * scale))),
  };
}

/**
 * Dónde se sirve un logo, relativo a la base de la api (la que ya lleva `/v1`).
 *
 * Relativa y no absoluta a propósito: cada cliente la resuelve contra la api con
 * la que ya habla. Si la api la devolviera entera tendría que saber su propia
 * dirección pública, y en local esa dirección apunta al servicio desplegado, que
 * no tiene los logos de la base de pruebas.
 *
 * El id cambia con cada imagen nueva, así que la dirección de un logo no cambia
 * nunca de contenido y se puede guardar en caché para siempre.
 */
export const gymLogoPath = (logoId: string): string => `/gyms/logos/${logoId}`;
