import type { Metadata } from 'next';
import './panel.css';

/**
 * La carcasa del panel.
 *
 * NO comprueba la sesión, y es deliberado: un layout envuelve también a
 * `/panel/entrar`, así que un guard aquí mandaría al login desde el login. Cada
 * página protegida llama a `requireOwner()`, que es además donde tiene sentido
 * —es la que sabe qué datos va a pedir— y lo que hace que añadir una página
 * nueva sin guard no compile: sin la sesión no hay `tenantId` con el que pedir
 * nada.
 *
 * El menú vive en `PanelShell`, que sí es cliente (necesita `usePathname` para
 * marcar la sección activa), y solo lo montan las páginas con sesión.
 */
export const metadata: Metadata = {
  title: 'Panel · Sinchi',
  description: 'El padrón, los ingresos y los materiales de tu gimnasio.',
  // El panel no es una página de venta: que no aparezca en Google, y que no
  // gaste el presupuesto de rastreo de un sitio que sí quiere aparecer.
  robots: { index: false, follow: false },
};

export default function PanelLayout({ children }: { readonly children: React.ReactNode }) {
  return children;
}
