/**
 * Pestanas del modo staff (MD fase 3).
 *
 * Va antes que el modo alumno en el orden de construccion: sin ella el gimnasio
 * no puede operar la puerta, y es lo que el cliente que paga necesita desde el
 * dia uno.
 */
import { TabList, TabSlot, TabTrigger, Tabs } from 'expo-router/ui';
import { TabBarShell, TabButton, TabContent } from '../../src/design/tab-bar';

export default function StaffLayout() {
  return (
    <Tabs>
      <TabContent>
        <TabSlot />
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
