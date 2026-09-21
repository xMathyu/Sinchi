import type { Metadata } from 'next';
import '../panel/panel.css';
import './admin.css';

/**
 * La carcasa del panel de Sinchi.
 *
 * Reusa `panel.css` en vez de copiarlo, y eso es deliberado: las dos son la
 * misma herramienta —tablas densas, cifras, formularios— para dos personas
 * distintas. Con dos hojas, el día que se afine el contraste de una tabla habría
 * que acordarse de la otra, y la que se olvide es esta, que la mira una sola
 * persona. `admin.css` solo agrega lo que aquí existe y allí no: la marca de
 * «interno» y la zona roja del borrado.
 *
 * NO comprueba la sesión, igual que el layout del panel del dueño: envuelve
 * también a `/admin/entrar`, así que un guard aquí mandaría al login desde el
 * login. Cada página llama a `requireAdmin()`, que es además donde tiene
 * sentido — es la que sabe qué datos va a pedir.
 */
export const metadata: Metadata = {
  title: 'Sinchi · interno',
  description: 'La red entera: gimnasios, suscripciones y códigos.',
  // Fuera de Google, y con más razón que el panel del dueño: esto no es una
  // página de producto, es la sala de máquinas.
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { readonly children: React.ReactNode }) {
  return children;
}
