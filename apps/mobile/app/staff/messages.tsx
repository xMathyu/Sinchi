/**
 * S5 · Mensajes.
 *
 * La bandeja del local: las preguntas de sus alumnos y de quien lo encontró en
 * la app. Lo último hablado arriba y lo que espera respuesta en negrita.
 *
 * Es lo que reemplaza al WhatsApp del mostrador (decisiones §12). Lo resuelto se
 * archiva para que la bandeja siga sirviendo al tercer mes, y cualquier mensaje
 * nuevo lo devuelve arriba.
 */
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { conversationTopicLabel, type ConversationStatus } from '@sinchi/shared';
import { Card, Divider, SegmentedControl } from '../../src/design/primitives';
import { Screen } from '../../src/design/screen';
import { EmptyState, OfflineState } from '../../src/design/empty';
import { SectionLoader } from '../../src/design/loading';
import { useTheme } from '../../src/design/theme';
import { TabHeader } from '../../src/design/account-avatar';
import { ConversationRow } from '../../src/design/chat';
import { refreshUnreadBadge, useInbox, usePolling } from '../../src/data/hooks';

export default function StaffMessagesScreen() {
  const theme = useTheme();
  const [tray, setTray] = useState<ConversationStatus>('open');
  const { details: entries, loading, error, reload } = useInbox(tray);
  usePolling(reload, 20_000);

  useEffect(() => {
    refreshUnreadBadge();
  }, [entries]);

  return (
    <Screen scroll>
      <TabHeader
        title="Mensajes"
        subtitle="Lo que te preguntan tus alumnos y quien te encuentra en la app."
      />

      <View style={{ marginTop: 18 }}>
        <SegmentedControl<ConversationStatus>
          options={[
            { value: 'open', label: 'Bandeja' },
            { value: 'closed', label: 'Archivadas' },
          ]}
          value={tray}
          onChange={setTray}
        />
      </View>

      {loading && entries.length === 0 ? (
        <View style={{ minHeight: 320 }}>
          <SectionLoader text="Trayendo la bandeja…" />
        </View>
      ) : error !== null && entries.length === 0 ? (
        <View style={{ minHeight: 320 }}>
          <OfflineState error={error} onReintentar={reload} />
        </View>
      ) : entries.length === 0 ? (
        <View style={{ minHeight: 320 }}>
          <EmptyState
            title={tray === 'open' ? 'Nadie te ha escrito todavía' : 'Nada archivado'}
            body={
              tray === 'open'
                ? 'Aquí llegan las preguntas de tus alumnos y de quien ve tu gimnasio en la app. Contesta desde aquí: la conversación se queda en Sinchi.'
                : 'Lo que archives de la bandeja queda aquí. Si esa persona vuelve a escribir, la conversación sube sola.'
            }
            {...(tray === 'open'
              ? { pie: 'Del primer mensaje de cada tanda te avisamos también por correo.' }
              : {})}
          />
        </View>
      ) : (
        <Card radius={theme.radii.xl} style={{ marginTop: 18, paddingVertical: 2 }}>
          {entries.map((entry, index) => (
            <View key={entry.id}>
              {index > 0 ? <Divider /> : null}
              <ConversationRow
                title={entry.fullName}
                detail={`${conversationTopicLabel(entry.topic)} · ${
                  entry.membershipId === null ? 'todavía no es alumno' : 'alumno'
                }`}
                lastMessage={entry.lastMessage}
                me="gym"
                unread={entry.unread}
                onPress={() =>
                  router.push({
                    pathname: '/inbox/[conversationId]',
                    params: { conversationId: entry.id },
                  })
                }
              />
            </View>
          ))}
        </Card>
      )}
    </Screen>
  );
}
