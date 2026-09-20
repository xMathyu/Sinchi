/**
 * Hablar con un gimnasio.
 *
 * La abren tres personas distintas por la misma ruta: el alumno con una duda de
 * su mensualidad o de su clase suelta, quien reservó su clase de prueba, y quien
 * solo está mirando el directorio y quiere preguntar sin inscribirse a nada. Va
 * por SLUG y no por id de conversación porque hay un hilo por persona y gimnasio,
 * exista o no todavía: la primera vez se abre vacío.
 *
 * Es lo que reemplaza al enlace de WhatsApp (decisiones §12): lo que se habla
 * aquí se queda en Sinchi.
 *
 * `?topic=` dice desde dónde se tocó —la ficha del gimnasio, el plan, la
 * reserva—. Solo cuenta para abrir el hilo: congela por dónde empezó, y deja
 * escrita una primera línea para que el campo vacío no sea lo que frene.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import {
  checkMessageDraft,
  conversationOpener,
  isValidPhoneNumber,
  unansweredStreak,
  type ConversationTopic,
  type Message,
} from '@sinchi/shared';
import { Button, Card, Stack, Text } from '../../src/design/primitives';
import { Screen } from '../../src/design/screen';
import { PhoneField } from '../../src/design/phone-field';
import { OfflineState } from '../../src/design/empty';
import { SectionLoader } from '../../src/design/loading';
import { useTheme } from '../../src/design/theme';
import { ChatHeader, Composer, MessageList } from '../../src/design/chat';
import { refreshUnreadBadge, usePolling, useThread } from '../../src/data/hooks';
import { mergeMessages, writeToGym } from '../../src/data/chat';
import { askForDetails, bookingCredential } from '../../src/data/trials';

const TOPICS: readonly ConversationTopic[] = ['general', 'trial', 'drop_in', 'membership', 'event'];

const asTopic = (raw: string | undefined): ConversationTopic =>
  TOPICS.find((topic) => topic === raw) ?? 'general';

/**
 * Cada cuánto se vuelve a preguntar con el hilo abierto.
 *
 * Ocho segundos: una respuesta del mostrador aparece mientras la persona todavía
 * mira la pantalla, y son unas pocas peticiones por minuto de conversación.
 */
const POLL_MS = 8_000;

const goBack = (): void => {
  if (router.canGoBack()) router.back();
  else router.replace('/');
};

export default function ChatScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ slug: string; topic?: string }>();
  const slug = params.slug ?? '';
  const topic = asTopic(params.topic);
  const thread = useThread(slug);
  usePolling(thread.reload, POLL_MS);

  const credential = bookingCredential();
  const [draft, setDraft] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [sent, setSent] = useState<readonly Message[]>([]);

  const details = thread.details;
  const messages = useMemo(() => mergeMessages(details?.messages ?? [], sent), [details, sent]);

  /**
   * La primera línea, escrita por la app. Una sola vez y solo en un hilo que no
   * existe: a quien ya habló con el gimnasio no se le rellena nada, y volver a
   * escribirla en cada recarga le borraría lo que esté tecleando.
   */
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current || details === null) return;
    prefilled.current = true;
    if (details.conversation === null) setDraft(conversationOpener(topic));
  }, [details, topic]);

  // Abrir el hilo lo marca leído en el servidor: la insignia tiene que enterarse.
  const messageCount = details?.messages.length ?? 0;
  useEffect(() => {
    if (messageCount > 0) refreshUnreadBadge();
  }, [messageCount]);

  /**
   * Nombre y celular, solo si hacen falta: sin ficha, sin lo que escribió al
   * registrarse, y abriendo el hilo. Son lo que el gimnasio necesita para saber
   * con quién habla — y a quien ya los dio no se le vuelven a pedir.
   */
  const needsDetails = details !== null && details.conversation === null && askForDetails();
  const missingDetails = needsDetails && (name.trim().length < 2 || !isValidPhoneNumber(phone));

  const denial =
    details === null
      ? 'empty'
      : checkMessageDraft({
          sender: 'person',
          body: draft,
          gymOpen: details.gymOpen,
          alreadyMember: details.alreadyMember,
          unanswered: unansweredStreak(messages),
        });

  const send = (): void => {
    if (denial !== null || missingDetails || sending) return;
    setSending(true);
    setFailure(null);

    void writeToGym({
      slug,
      body: draft,
      topic,
      ...(needsDetails ? { fullName: name, phone } : {}),
    })
      .then((out) => {
        setDraft('');
        setSent((previous) => [...previous, out.message]);
        thread.reload();
      })
      .catch((causa: unknown) => {
        // Lo escrito se queda en el campo: perder un párrafo por un fallo de red
        // es la forma más rápida de que no lo vuelva a escribir.
        setFailure(causa instanceof Error ? causa.message : 'No se pudo enviar. Intenta de nuevo.');
      })
      .finally(() => setSending(false));
  };

  const title = details?.gymName ?? 'Escríbele al gimnasio';
  const subtitle =
    details === null
      ? undefined
      : details.alreadyMember
        ? 'Tu gimnasio · te responden aquí mismo'
        : 'Te responden aquí mismo';

  return (
    <Screen>
      <ChatHeader title={title} {...(subtitle === undefined ? {} : { subtitle })} onBack={goBack} />

      {credential.kind === 'none' ? (
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <Stack gap={12}>
            <Card tone="sunken" radius={theme.radii.lg}>
              <Text variant="captionSmall" color={theme.colors.textSecondary}>
                Entra con tu correo o con Google para escribirle al gimnasio. Hace falta para que
                sepan quién pregunta y puedan responderte.
              </Text>
            </Card>
            <Button label="Entrar y escribirles" onPress={() => router.push('/login')} />
          </Stack>
        </View>
      ) : details === null && thread.loading ? (
        <View style={{ flex: 1 }}>
          <SectionLoader text="Abriendo la conversación…" />
        </View>
      ) : details === null ? (
        <View style={{ flex: 1 }}>
          <OfflineState
            title="No se pudo abrir la conversación"
            body="No llegamos al servidor. Tus mensajes siguen ahí; es la conexión la que falló."
            error={thread.error ?? 'No se pudo abrir la conversación.'}
            onReintentar={thread.reload}
          />
        </View>
      ) : (
        <>
          <View style={{ flex: 1 }}>
            {messages.length === 0 ? (
              <View style={{ flex: 1, justifyContent: 'center' }}>
                <Card tone="sunken" radius={theme.radii.xl}>
                  <Stack gap={6}>
                    <Text variant="bodySmall" weight="semibold">
                      Pregúntale a {details.gymName} lo que quieras
                    </Text>
                    <Text variant="captionSmall" color={theme.colors.textSecondary}>
                      Horarios, precios, cómo es la primera clase. Te responden aquí mismo, y si tu
                      cuenta tiene correo te avisamos por ahí cuando lo hagan.
                    </Text>
                  </Stack>
                </Card>
              </View>
            ) : (
              <MessageList messages={messages} me="person" />
            )}
          </View>

          {needsDetails ? (
            <Card radius={theme.radii.lg} style={{ marginBottom: 10 }}>
              <Stack gap={12}>
                <DetailInput
                  label="Tu nombre"
                  value={name}
                  onChange={setName}
                  placeholder="Nombre y apellido"
                />
                <PhoneField label="Tu celular" value={phone} onChange={setPhone} look="line" />
              </Stack>
            </Card>
          ) : null}

          <Composer
            value={draft}
            onChange={setDraft}
            onSend={send}
            sending={sending}
            denial={denial}
            blocked={missingDetails}
            failure={failure}
            placeholder="Escribe tu mensaje"
          />
        </>
      )}
    </Screen>
  );
}

function DetailInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (text: string) => void;
  readonly placeholder: string;
}) {
  const theme = useTheme();
  return (
    <Stack gap={3}>
      <Text variant="micro" color={theme.colors.textTertiary}>
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.textPlaceholder}
        keyboardAppearance={theme.scheme}
        autoCapitalize="words"
        style={{
          color: theme.colors.ink,
          fontSize: 16,
          paddingVertical: 6,
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.hairline,
        }}
      />
    </Stack>
  );
}
