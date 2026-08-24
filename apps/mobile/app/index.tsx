/**
 * Entrada de la app.
 *
 * El rol decide que ve la persona al abrirla (MD 4.6): el mismo binario sirve
 * al alumno, a recepcion y al dueno. En produccion el rol viene de la sesion;
 * aqui viene del store para poder recorrer los dos modos.
 */
import { Redirect } from 'expo-router';
import { useStore } from '../src/data/hooks';

export default function Index() {
  const role = useStore((state) => state.role);
  return <Redirect href={role === 'student' ? '/student' : '/staff'} />;
}
