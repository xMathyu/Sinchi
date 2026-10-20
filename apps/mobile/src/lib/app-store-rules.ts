import { Platform } from 'react-native';

/** Dónde se da de alta un gimnasio: en la web, desde cualquier plataforma. */
export const GYM_SIGNUP_URL = 'https://sinchi.fit/registrar';

/**
 * Si esta app puede MANDAR a registrar un gimnasio. En iOS, no.
 *
 * El alta vivía en la app y Apple rechazó la 1.0.0 cuatro veces por la 3.1.1
 * (del 2026-09-29 al 2026-10-18): para App Review, registrar una empresa desde
 * la app es abrirle la puerta a una compra hecha fuera de ella. Se quitó de
 * iOS, se defendió por la 3.1.3(c), se quitó también su anuncio en la portada
 * del login… y al final el alta entera se mudó a la web para todo el mundo
 * (decisiones, «El alta de gimnasios se muda a la web»). Lo que queda en la
 * app es una TARJETA que abre `GYM_SIGNUP_URL` en el navegador.
 *
 * Esa tarjeta tampoco puede estar en iOS: la 3.1.1 prohíbe igual el botón que
 * enlaza a comprar fuera, y además desmentiría lo que se le dijo a Apple. En
 * Android se queda: Google Play no lo objeta y es una puerta real de venta.
 */
export const GYM_SIGNUP_LINK_IN_APP = Platform.OS !== 'ios';

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
