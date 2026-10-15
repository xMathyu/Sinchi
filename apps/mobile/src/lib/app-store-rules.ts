import { Platform } from 'react-native';

/**
 * Si esta app puede dar de alta un gimnasio. En iOS, no.
 *
 * Apple rechazó la 1.0.0 dos veces por la 3.1.1 (2026-09-29 y 2026-10-07, build
 * 17): para App Review, registrar una empresa desde la app es abrirle la puerta
 * a una compra hecha fuera de ella —la suscripción de Sinchi—, y pidió quitarlo.
 * Se defendió por la 3.1.3(c), servicios para empresas, con la promesa escrita
 * en las notas de que si insistía se quitaba; insistió.
 *
 * Por plataforma y no por versión ni por bandera de la api: lo que molesta es
 * la App Store, y Google Play no lo objeta. En Android el alta sigue entera.
 *
 * En iOS no se sustituye por un «regístralo en la web»: un texto que manda a
 * comprar fuera es justo lo que la 3.1.1 prohíbe, y además desmiente lo que se
 * le dijo a Apple. El dueño que ya existe entra y administra igual; lo que
 * desaparece es solo el nacimiento de una organización.
 */
export const GYM_SIGNUP_IN_APP = Platform.OS !== 'ios';

/**
 * Si esta app puede hablarle al dueño de la suscripción de Sinchi como algo que
 * se paga: precio, cuenta atrás del mes gratis, «regulariza el pago» y el canje
 * de códigos de promoción. En iOS, no.
 *
 * Es la misma 3.1.1 que se llevó el alta, mirada desde el padrón del dueño: el
 * revisor entra con una cuenta de dueño y lo ve. El canje es lo más claro de
 * todo —la 3.1.1 nombra los códigos de promoción entre los mecanismos propios
 * con los que una app no puede desbloquear funciones—. En iOS el aviso queda en
 * el estado y nada más (`saasStatusNotice` de `shared`).
 */
export const SAAS_SALES_IN_APP = Platform.OS !== 'ios';
