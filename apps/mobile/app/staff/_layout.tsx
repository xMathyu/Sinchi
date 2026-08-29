/**
 * Pestanas del modo staff (MD fase 3).
 *
 * Va antes que el modo alumno en el orden de construccion: sin ella el gimnasio
 * no puede operar la puerta, y es lo que el cliente que paga necesita desde el
 * dia uno.
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
          <TabTrigger name="manual" href="/staff/manual" asChild>
            <TabButton icon="search" label="Buscar" />
          </TabTrigger>
          <TabTrigger name="device" href="/staff/device" asChild>
            <TabButton icon="circle" label="Dispositivo" />
          </TabTrigger>
        </TabBarShell>
      </TabList>
    </Tabs>
  );
}
