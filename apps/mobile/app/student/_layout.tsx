/**
 * Pestanas del modo alumno (MD fase 4).
 *
 * Cuatro destinos y nada mas: su billetera, su QR, su plan y su historial. Todo
 * lo demas se presenta encima como pantalla de detalle.
 */
import { TabList, TabSlot, TabTrigger, Tabs } from 'expo-router/ui';
import { TabBarShell, TabButton, TabContent } from '../../src/design/tab-bar';

export default function StudentLayout() {
  return (
    <Tabs>
      <TabContent>
        <TabSlot />
      </TabContent>
      <TabList asChild>
        <TabBarShell>
          <TabTrigger name="wallet" href="/student" asChild>
            <TabButton icon="card" label="Billetera" />
          </TabTrigger>
          <TabTrigger name="qr" href="/student/qr" asChild>
            <TabButton icon="qr" label="Mi QR" />
          </TabTrigger>
          <TabTrigger name="plan" href="/student/plan" asChild>
            <TabButton icon="circle" label="Plan" />
          </TabTrigger>
          <TabTrigger name="history" href="/student/history" asChild>
            <TabButton icon="lines" label="Historial" />
          </TabTrigger>
        </TabBarShell>
      </TabList>
    </Tabs>
  );
}
