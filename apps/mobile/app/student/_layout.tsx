/**
 * Pestanas del modo alumno (MD fase 4).
 *
 * Cuatro destinos y nada mas: su billetera, su QR, su plan y su historial. Todo
 * lo demas se presenta encima como pantalla de detalle.
 */
import { TabList, TabSlot, TabTrigger, Tabs } from 'expo-router/ui';
import { TabBarShell, TabButton, TabContent } from '../../src/design/tab-bar';
import { CargandoSeccion } from '../../src/design/loading';
import { useStore } from '../../src/data/hooks';
import { useSession } from '../../src/data/session-hooks';

export default function StudentLayout() {
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
        {esperando ? <CargandoSeccion texto="Trayendo tu billetera…" /> : <TabSlot />}
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
