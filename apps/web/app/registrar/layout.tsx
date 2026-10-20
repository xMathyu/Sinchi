import type { Metadata } from 'next';
import '../panel/panel.css';
import './signup.css';

/**
 * El alta de un gimnasio.
 *
 * Carga la hoja del panel por lo mismo que `/admin`: los campos, los botones y
 * los avisos son los del panel, y copiarlos para una página de tres
 * formularios es cómo acaban dos verdes distintos en el mismo producto. Lo
 * propio del alta —la rejilla de dos columnas y las tarjetas del plan— va en su
 * hoja.
 *
 * SÍ se indexa, al revés que el panel: esta es una página de venta. Es a donde
 * llega quien busca «software para gimnasio» y a donde apunta la portada.
 */
export const metadata: Metadata = {
  title: 'Registra tu gimnasio · Sinchi',
  description:
    'Da de alta tu gimnasio o escuela de artes marciales en Sinchi. Hasta 10 alumnos es gratis para siempre, y el primer mes de cualquier plan también.',
};

export default function SignupLayout({ children }: { readonly children: React.ReactNode }) {
  return children;
}
