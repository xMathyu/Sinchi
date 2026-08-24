/**
 * Entrada de la app.
 *
 * El rol decide que ve la persona al abrirla (MD 4.6): el mismo binario sirve al
 * alumno, a recepcion y al dueno.
 *
 * Con sesion real el rol viene del token y lo enruta `SessionRouter`. Esta
 * pantalla solo se alcanza en modo demostracion, donde el rol lo elige
 * `settings.tsx` para poder recorrer los dos modos en un telefono.
 */
import { Redirect } from 'expo-router';
import { useStore } from '../src/data/hooks';
import { useSession } from '../src/data/session-hooks';

export default function Index() {
  const state = useSession();
  const demoRole = useStore((s) => s.role);

  const role = state.status === 'signed_in' ? state.session.role : demoRole;
  return <Redirect href={role === 'student' ? '/student' : '/staff'} />;
}
