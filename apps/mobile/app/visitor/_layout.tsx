/**
 * Pestañas de quien todavía no tiene ficha en ningún gimnasio.
 *
 * Antes esa cuenta vivía en una sola pantalla —el directorio—, sin barra, y lo
 * que necesitaba estaba escondido dentro de ella: su código, sus mensajes,
 * cerrar sesión. Son tres cosas las que hace alguien que todavía no entrena en
 * ningún sitio: buscar dónde, preguntarle a un gimnasio, y dejarse inscribir
 * mostrando su QR en el mostrador. Cada una es una pestaña.
 *
 * Mismo cascarón que las del alumno (`TabBarShell`), para que el día que acepte
 * su primera solicitud la barra cambie de pestañas y no de forma.
 */
import { TabList, TabSlot, TabTrigger, Tabs } from 'expo-router/ui';
import { TabBarShell, TabButton, TabContent } from '../../src/design/tab-bar';

export default function VisitorLayout() {
  return (
    <Tabs>
      <TabContent>
        <TabSlot />
      </TabContent>
      <TabList asChild>
        <TabBarShell>
          <TabTrigger name="gyms" href="/visitor" asChild>
            <TabButton icon="gyms" label="Gimnasios" />
          </TabTrigger>
          <TabTrigger name="qr" href="/visitor/qr" asChild>
            <TabButton icon="qr" label="Mi QR" />
          </TabTrigger>
          <TabTrigger name="messages" href="/visitor/messages" asChild>
            <TabButton icon="messages" label="Mensajes" />
          </TabTrigger>
        </TabBarShell>
      </TabList>
    </Tabs>
  );
}
