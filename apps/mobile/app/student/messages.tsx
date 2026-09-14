/**
 * A5 · Mensajes.
 *
 * Sus conversaciones con gimnasios: el suyo y los que está mirando. Una por
 * gimnasio, lo último hablado arriba.
 *
 * Debajo van los gimnasios de su billetera con los que todavía no ha hablado. Sin
 * eso, quien abre la pestaña PARA escribirle a su dojo encuentra una lista vacía
 * y ningún camino, y el camino que le queda es el WhatsApp del profesor — que es
 * justo lo que esta pestaña viene a reemplazar (decisiones §12).
 */
import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { conversationTopicLabel, isDropInPlan } from '@sinchi/shared';
import { Button, Card, Divider, Eyebrow, Row, Stack, Text } from '../../src/design/primitives';
import { Screen } from '../../src/design/screen';
import { EmptyState, OfflineState } from '../../src/design/empty';
import { SectionLoader } from '../../src/design/loading';
import { useTheme } from '../../src/design/theme';
import { TabHeader } from '../../src/design/account-avatar';
import { ConversationRow } from '../../src/design/chat';
import {
  refreshUnreadBadge,
  useMyConversations,
  usePolling,
  useWallet,
} from '../../src/data/hooks';

export default function StudentMessagesScreen() {
  const theme = useTheme();
  const { details: conversations, loading, error, reload } = useMyConversations();
  usePolling(reload, 30_000);
  const wallet = useWallet();

  useEffect(() => {
    refreshUnreadBadge();
  }, [conversations]);

  const talked = new Set(conversations.map((conversation) => conversation.gymSlug));
  const quiet = wallet.filter(
    (entry) => entry.subscription.status !== 'canceled' && !talked.has(entry.tenant.slug),
  );

  return (
    <Screen scroll>
      <TabHeader
        title="Mensajes"
        subtitle="Tus conversaciones con los gimnasios: donde entrenas y los que estás mirando."
      />

      {loading && conversations.length === 0 ? (
        <View style={{ minHeight: 280 }}>
          <SectionLoader text="Trayendo tus mensajes…" />
        </View>
      ) : error !== null && conversations.length === 0 ? (
        <View style={{ minHeight: 280 }}>
          <OfflineState error={error} onReintentar={reload} />
        </View>
      ) : conversations.length > 0 ? (
        <Card radius={theme.radii.xl} style={{ marginTop: 18, paddingVertical: 2 }}>
          {conversations.map((conversation, index) => (
            <View key={conversation.id}>
              {index > 0 ? <Divider /> : null}
              <ConversationRow
                title={conversation.gymName}
                detail={conversationTopicLabel(conversation.topic)}
                lastMessage={conversation.lastMessage}
                me="person"
                unread={conversation.unread}
                onPress={() =>
                  router.push({ pathname: '/chat/[slug]', params: { slug: conversation.gymSlug } })
                }
              />
            </View>
          ))}
        </Card>
      ) : quiet.length === 0 ? (
        <View style={{ minHeight: 320 }}>
          <EmptyState
            title="Todavía no le has escrito a ningún gimnasio"
            body="Desde la página de cualquier gimnasio puedes preguntarles lo que quieras: horarios, precios, cómo es la primera clase."
            accion={<Button label="Explorar gimnasios" onPress={() => router.push('/explore')} />}
          />
        </View>
      ) : null}

      {quiet.length > 0 ? (
        <Stack gap={10} style={{ marginTop: 22 }}>
          <Eyebrow>Escríbele a tu gimnasio</Eyebrow>
          {quiet.map((entry) => (
            <Pressable
              key={entry.membership.id}
              accessibilityRole="button"
              accessibilityLabel={`Escribirle a ${entry.tenant.name}`}
              onPress={() =>
                router.push({
                  pathname: '/chat/[slug]',
                  params: {
                    slug: entry.tenant.slug,
                    topic: isDropInPlan(entry.plan) ? 'drop_in' : 'membership',
                  },
                })
              }
            >
              <Card radius={theme.radii.lg} tone="sunken">
                <Row style={{ gap: 12 }}>
                  <Stack gap={2} style={{ flex: 1 }}>
                    <Text variant="bodySmall" weight="semibold" numberOfLines={1}>
                      {entry.tenant.name}
                    </Text>
                    <Text variant="captionSmall" color={theme.colors.textSecondary}>
                      Tu plan, tus clases o tus pagos, directo al gimnasio.
                    </Text>
                  </Stack>
                  <Text variant="captionSmall" weight="semibold" color={theme.semaphore.ok}>
                    Escribir
                  </Text>
                </Row>
              </Card>
            </Pressable>
          ))}
        </Stack>
      ) : null}
    </Screen>
  );
}
