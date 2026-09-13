/**
 * Pestanas del modo alumno (MD fase 4).
 *
 * Cinco destinos: su billetera, su QR, su plan, sus mensajes y su historial.
 * Todo lo demas se presenta encima como pantalla de detalle.
 *
 * Mensajes es pestana y no un boton dentro del plan porque la conversacion no es
 * con UN gimnasio: tambien es con los que esta mirando y todavia no pisa. Y una
 * respuesta sin leer tiene que verse desde cualquier pantalla, que es lo que da
 * la insignia de la barra — sin push, es el unico aviso que hay.
 */
import { TabList, TabSlot, TabTrigger, Tabs } from 'expo-router/ui';
import { TabBarShell, TabButton, TabContent } from '../../src/design/tab-bar';
import { SectionLoader } from '../../src/design/loading';
import { useStore, useUnreadConversations } from '../../src/data/hooks';
import { useSession } from '../../src/data/session-hooks';

export default function StudentLayout() {
  const session = useSession();
  const cargado = useStore((state) => state.cargado);
  const unread = useUnreadConversations('student');
  // Solo con sesión real: en demostración el store ya viene lleno, y sin sesión
  // no hay nada que esperar.
  const esperando = session.status === 'signed_in' && !cargado;

  return (
    <Tabs>
      <TabContent>
        {/* La barra de pestañas se queda puesta: la espera es del contenido,
            no de la app. Tapar la pantalla entera hacía que dos segundos
            parecieran un arranque fallido. */}
        {esperando ? <SectionLoader text="Trayendo tu billetera…" /> : <TabSlot />}
      </TabContent>
      <TabList asChild>
        <TabBarShell>
          <TabTrigger name="wallet" href="/student" asChild>
            <TabButton icon="wallet" label="Billetera" />
          </TabTrigger>
          <TabTrigger name="qr" href="/student/qr" asChild>
            <TabButton icon="qr" label="Mi QR" />
          </TabTrigger>
          <TabTrigger name="plan" href="/student/plan" asChild>
            <TabButton icon="plan" label="Plan" />
          </TabTrigger>
          <TabTrigger name="messages" href="/student/messages" asChild>
            <TabButton icon="messages" label="Mensajes" badge={unread} />
          </TabTrigger>
          <TabTrigger name="history" href="/student/history" asChild>
            <TabButton icon="history" label="Historial" />
          </TabTrigger>
        </TabBarShell>
      </TabList>
    </Tabs>
  );
}
