import { Phone } from './Brand';

/**
 * Las cuatro pantallas de la app. Son CAPTURAS, y hasta hace poco no lo eran.
 *
 * Estaban redibujadas con los tokens de `@sinchi/ui`, y el argumento era bueno:
 * un dibujo no envejece con la app y no puede filtrar el nombre de nadie. Lo
 * que lo tumbó es que un dibujo de la app no es la app. Quien mira la landing
 * no está viendo el producto, está viendo lo que la landing dice que el
 * producto parece — y la diferencia vive justo en lo que nadie se acuerda de
 * redibujar: la barra de estado del teléfono, la barra de pestañas, el ancho
 * real al que se parte un nombre largo, el aire que de verdad tiene una ficha.
 *
 * Las dos objeciones de entonces siguen siendo ciertas y se responden así:
 *
 *  - **Datos de una persona de verdad.** No los hay. Salen de la siembra local
 *    (`npm run db:seed`) contra la base de Docker, más treinta alumnos
 *    inventados: ni un nombre, ni un documento ni un celular de esta página
 *    pertenece a nadie.
 *  - **Envejecen.** Sí. Por eso el modo de rehacerlas está escrito y no hay que
 *    reconstruirlo: [`docs/capturas.md`](../../../docs/capturas.md). Cuando una
 *    pantalla cambie, se vuelven a sacar en un rato de simulador.
 *
 * Van en las DOS caras porque la página también las tiene: quien entra con el
 * teléfono en claro y ve capturas negras entiende, con razón, que la app solo
 * es oscura. El intercambio lo hace CSS (`.shot-light` / `.shot-dark` en
 * `globals.css`) con la misma cascada que los tokens, para que el interruptor
 * de la barra las cambie a la vez que la página.
 */

/** Lo que mide una captura del iPhone 17 Pro reducida a 500 px de ancho. */
const SHOT_WIDTH = 500;
const SHOT_HEIGHT = 1087;

const TEMAS = ['dark', 'light'] as const;

/** Lo que las cuatro pantallas aceptan: cómo se mueve el marco donde se coloca. */
type ScreenProps = { readonly className?: string };

function Shot({
  name, alt, className, eager = false,
}: {
  readonly name: string;
  readonly alt: string;
  readonly className?: string;
  /**
   * Las de la portada se piden ya; las de más abajo, cuando se llega. Sin esto
   * la portada compite por el ancho de banda con tres teléfonos que todavía no
   * se ven.
   */
  readonly eager?: boolean;
}) {
  return (
    <Phone {...(className === undefined ? {} : { className })}>
      {TEMAS.map((tema) => (
        /* AVIF primero y JPEG debajo: un Safari anterior al 16.4 no entiende el
           primero, y en una página que existe para convencer, un hueco donde va
           el producto es peor que 80 kB de más. Solo se descarga uno. */
        <picture key={tema} className={`shot-${tema}`}>
          <source srcSet={`/screenshots/${name}-${tema}.avif`} type="image/avif" />
          <img
            src={`/screenshots/${name}-${tema}.jpg`}
            alt={alt}
            width={SHOT_WIDTH}
            height={SHOT_HEIGHT}
            loading={eager ? 'eager' : 'lazy'}
            decoding="async"
          />
        </picture>
      ))}
    </Phone>
  );
}

export const RosterScreen = ({ className }: ScreenProps) => (
  <Shot
    name="roster"
    alt="El padrón en la app: 30 alumnos, 7 con deuda y S/ 950 por cobrar, con los morosos arriba."
    eager
    {...(className === undefined ? {} : { className })}
  />
);

export const PlanScreen = ({ className }: ScreenProps) => (
  <Shot
    name="plan"
    alt="El plan del alumno: 2 por semana por S/ 120 al mes, 1 de 2 sesiones usadas y el próximo cobro el 3 de octubre."
    eager
    {...(className === undefined ? {} : { className })}
  />
);

export const QrScreen = ({ className }: ScreenProps) => (
  <Shot
    name="qr"
    alt="Mi QR: el código del alumno, que se renueva cada 30 segundos y funciona sin internet."
    {...(className === undefined ? {} : { className })}
  />
);

export const DeniedScreen = ({ className }: ScreenProps) => (
  <Shot
    name="denied"
    alt="Acceso denegado en la puerta: mora de 16 días, deuda de S/ 180 y el botón para cobrar en el mostrador."
    {...(className === undefined ? {} : { className })}
  />
);
