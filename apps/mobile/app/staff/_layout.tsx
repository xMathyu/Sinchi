/**
 * Pestanas del modo staff (MD fase 3).
 *
 * Va antes que el modo alumno en el orden de construccion: sin ella el gimnasio
 * no puede operar la puerta, y es lo que el cliente que paga necesita desde el
 * dia uno.
 *
 * El padron es pestana y el marcado manual no. Estuvo al reves y no funcionaba:
 * la lista con TODOS los alumnos —su estado, su deuda, su ficha— vivia detras de
 * un boton dentro de la pantalla del escaner, mientras una pestana entera
 * llevaba a buscar a alguien para marcarlo a mano. Quien entraba al modo staff
 * no encontraba a sus alumnos.
 *
 * Marcar manual no pierde nada: sigue a un toque desde la puerta, que es donde
 * se usa, y la ficha de cada alumno tambien lo ofrece.
 *
 * AQUI SOLO VIVEN LAS PESTANAS. `TabSlot` pinta la pestana enfocada, y una ruta
 * bajo `app/staff/` sin su `TabTrigger` no puede enfocarse: `router.push` navega
 * y no se ve absolutamente nada. Falla en silencio —sin error, sin ruta
 * desconocida, sin nada en el log— y ese silencio se cobro cuatro pantallas
 * (inscribir, vincular, marcar manual y abrir turno) mas el viejo boton "Padron
 * y cobros", que nunca funciono. Todas viven ahora en el Stack raiz.
 */
import { TabList, TabSlot, TabTrigger, Tabs } from 'expo-router/ui';
import { TabBarShell, TabButton, TabContent } from '../../src/design/tab-bar';
import { CargandoSeccion } from '../../src/design/loading';
import { useStore } from '../../src/data/hooks';
import { useSession } from '../../src/data/session-hooks';

export default function StaffLayout() {
  const sesion = useSession();
  const cargado = useStore((estado) => estado.cargado);
  // Solo con sesión real: en demostración el store ya viene lleno, y sin sesión
  // no hay nada que esperar.
  const esperando = sesion.status === 'signed_in' && !cargado;

  return (
    <Tabs>
      <TabContent>
        {/* La barra de pestañas se queda puesta: la espera es del contenido,
            no de la app. Tapar la pantalla entera hacía que dos segundos
            parecieran un arranque fallido. */}
        {esperando ? <CargandoSeccion texto="Trayendo el padrón…" /> : <TabSlot />}
      </TabContent>
      <TabList asChild>
        <TabBarShell>
          <TabTrigger name="door" href="/staff" asChild>
            <TabButton icon="viewfinder" label="Puerta" />
          </TabTrigger>
          <TabTrigger name="padron" href="/staff/padron" asChild>
            <TabButton icon="lines" label="Padrón" />
          </TabTrigger>
          <TabTrigger name="device" href="/staff/device" asChild>
            <TabButton icon="circle" label="Dispositivo" />
          </TabTrigger>
        </TabBarShell>
      </TabList>
    </Tabs>
  );
}
