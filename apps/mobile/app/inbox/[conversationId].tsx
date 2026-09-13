/**
 * Un hilo, visto desde el mostrador.
 *
 * Quien contesta firma con su nombre —lo pone la api— y ve con quién habla antes
 * de escribir: por dónde empezó la conversación, si hoy es alumno y su celular.
 * Lo último es un dato de la persona, no un enlace: la respuesta se escribe aquí
 * (decisiones §12).
 */
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { checkMessageDraft, conversationTopicLabel, type Message } from '@sinchi/shared';
import { Text } from '../../src/design/primitives';
import { Screen } from '../../src/design/screen';
import { OfflineState } from '../../src/design/empty';
import { SectionLoader } from '../../src/design/loading';
import { useTheme } from '../../src/design/theme';
import { ChatHeader, Composer, MessageList } from '../../src/design/chat';
import { refreshUnreadBadge, useGymThread, usePolling } from '../../src/data/hooks';
import { replyToConversation, setConversationStatus } from '../../src/data/api';
import { mergeMessages } from '../../src/data/chat';

/** Como en el lado de la persona: sin push, esto es lo que trae su respuesta. */
const POLL_MS = 8_000;

const goBack = (): void => {
  if (router.canGoBack()) router.back();
  else router.replace('/staff/messages');
};

export default function InboxThreadScreen() {
  const theme = useTheme();
  const { conversationId = '' } = useLocalSearchParams<{ conversationId: string }>();
  const thread = useGymThread(conversationId);
  usePolling(thread.reload, POLL_MS);

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [sent, setSent] = useState<readonly Message[]>([]);
  const [archiving, setArchiving] = useState(false);

  const details = thread.details;
  const messages = useMemo(() => mergeMessages(details?.messages ?? [], sent), [details, sent]);

  const messageCount = details?.messages.length ?? 0;
  useEffect(() => {
    if (messageCount > 0) refreshUnreadBadge();
  }, [messageCount]);

  // El gimnasio contesta siempre: la racha y el directorio son frenos para quien
  // escribe desde fuera, y la regla los ignora de este lado. Solo cuenta el texto.
  const denial = checkMessageDraft({
    sender: 'gym',
    body: draft,
    gymOpen: true,
    alreadyMember: true,
    unanswered: 0,
  });

  const send = (): void => {
    if (denial !== null || sending) return;
    setSending(true);
    setFailure(null);
    void replyToConversation(conversationId, draft)
      .then((out) => {
        setDraft('');
        setSent((previous) => [...previous, out.message]);
        thread.reload();
      })
      .catch((causa: unknown) =>
        setFailure(causa instanceof Error ? causa.message : 'No se pudo enviar. Intenta de nuevo.'),
      )
      .finally(() => setSending(false));
  };

  const closed = details?.conversation.status === 'closed';

  const toggleArchive = (): void => {
    if (details === null || archiving) return;
    setArchiving(true);
    void setConversationStatus(conversationId, closed ? 'open' : 'closed')
      .then(() => thread.reload())
      .catch((causa: unknown) =>
        Alert.alert(
          'No se pudo cambiar',
          causa instanceof Error ? causa.message : 'Intenta de nuevo.',
        ),
      )
      .finally(() => setArchiving(false));
  };

  const subtitle =
    details === null
      ? undefined
      : `${conversationTopicLabel(details.conversation.topic)} · ${
          details.membershipId === null ? 'todavía no es alumno' : 'alumno'
        } · ${details.conversation.phone}`;

  return (
    <Screen>
      <ChatHeader
        title={details?.conversation.fullName ?? 'Conversación'}
        {...(subtitle === undefined ? {} : { subtitle })}
        onBack={goBack}
        // Sin mensajes no se ofrece archivar: un hilo en el que nadie ha escrito no
        // está en la bandeja, y archivarlo no saca nada de ningún sitio.
        action={
          details === null || messages.length === 0 ? undefined : (
            <Pressable
              accessibilityRole="button"
              hitSlop={10}
              onPress={toggleArchive}
              disabled={archiving}
            >
              <Text variant="captionSmall" weight="semibold" color={theme.colors.textSecondary}>
                {closed ? 'Recuperar' : 'Archivar'}
              </Text>
            </Pressable>
          )
        }
      />

      {details !== null && (details.membershipId !== null || closed) ? (
        <View style={{ flexDirection: 'row', gap: 14, paddingTop: 10 }}>
          {details.membershipId === null ? null : (
            <Pressable
              accessibilityRole="button"
              hitSlop={8}
              onPress={() =>
                router.push({
                  pathname: '/member/[membershipId]',
                  params: { membershipId: details.membershipId ?? '' },
                })
              }
            >
              <Text variant="captionSmall" weight="semibold" color={theme.semaphore.ok}>
                Ver su ficha
              </Text>
            </Pressable>
          )}
          {closed ? (
            <Text variant="captionSmall" color={theme.colors.textFaint}>
              Archivada: el próximo mensaje la devuelve a la bandeja.
            </Text>
          ) : null}
        </View>
      ) : null}

      {details === null && thread.loading ? (
        <View style={{ flex: 1 }}>
          <SectionLoader text="Abriendo la conversación…" />
        </View>
      ) : details === null ? (
        <View style={{ flex: 1 }}>
          <OfflineState
            title="No se pudo abrir la conversación"
            error={thread.error ?? 'No se pudo abrir la conversación.'}
            onReintentar={thread.reload}
          />
        </View>
      ) : (
        <>
          <View style={{ flex: 1 }}>
            {messages.length === 0 ? (
              <View style={{ flex: 1, justifyContent: 'center' }}>
                <Text variant="captionSmall" color={theme.colors.textSecondary} align="center">
                  Todavía no se han escrito. Lo que le mandes le llega a su app, y a su correo si lo
                  tiene.
                </Text>
              </View>
            ) : (
              <MessageList messages={messages} me="gym" />
            )}
          </View>
          <Composer
            value={draft}
            onChange={setDraft}
            onSend={send}
            sending={sending}
            denial={denial}
            failure={failure}
            placeholder={`Escríbele a ${details.conversation.fullName.split(/\s+/)[0] ?? ''}`}
          />
        </>
      )}
    </Screen>
  );
}
