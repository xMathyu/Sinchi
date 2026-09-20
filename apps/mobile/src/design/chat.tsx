/**
 * Las piezas del chat: el hilo, el campo para escribir y la fila de una lista.
 *
 * Las comparten las dos puntas —quien le escribe al gimnasio y el mostrador que
 * contesta— porque es la MISMA conversación vista desde cada lado. Lo único que
 * cambia es cuál de los dos es «yo»: lo propio a la derecha y lo del otro a la
 * izquierda, como en cualquier chat que ya conocen. Copiar la forma de WhatsApp
 * no es falta de ideas: es lo que hace que nadie tenga que aprender a usarlo.
 */
import { useMemo, type ReactNode } from 'react';
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';
import Send from 'lucide-react-native/icons/send-horizontal';
import {
  MESSAGE_MAX_LENGTH,
  TZ_LIMA,
  messageDenialText,
  plainDateInZone,
  type Message,
  type MessageDenial,
  type MessageSender,
} from '@sinchi/shared';
import { withAlpha } from '@sinchi/ui';
import { Text } from './primitives';
import { useTheme } from './theme';
import { formatClock, formatShortDate, formatWeekdayAndDay } from '../lib/format';

const DAY_MS = 86_400_000;

function sameDay(a: Date, b: Date): boolean {
  const x = plainDateInZone(a, TZ_LIMA);
  const y = plainDateInZone(b, TZ_LIMA);
  return x.year === y.year && x.month === y.month && x.day === y.day;
}

/** «Hoy», «Ayer», el día de la semana si fue esta semana, y la fecha si no. */
function dayLabel(instant: Date): string {
  const now = new Date();
  if (sameDay(instant, now)) return 'Hoy';
  if (sameDay(instant, new Date(now.getTime() - DAY_MS))) return 'Ayer';
  const date = plainDateInZone(instant, TZ_LIMA);
  return now.getTime() - instant.getTime() < 6 * DAY_MS
    ? formatWeekdayAndDay(date)
    : formatShortDate(date);
}

/** Cuándo, en una línea de lista: la hora si fue hoy, el día si no. */
function listMoment(instant: Date): string {
  return sameDay(instant, new Date())
    ? formatClock(instant)
    : formatShortDate(plainDateInZone(instant, TZ_LIMA));
}

export function ChatHeader({
  title,
  subtitle,
  onBack,
  action,
}: {
  readonly title: string;
  readonly subtitle?: string;
  readonly onBack: () => void;
  readonly action?: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.header, { borderBottomColor: theme.colors.hairline }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Volver"
        hitSlop={16}
        onPress={onBack}
      >
        <Text variant="title" color={theme.colors.textSecondary}>
          ‹
        </Text>
      </Pressable>
      <View style={{ flex: 1, gap: 1 }}>
        <Text variant="heading" weight="bold" numberOfLines={1}>
          {title}
        </Text>
        {subtitle === undefined ? null : (
          <Text variant="micro" color={theme.colors.textTertiary} numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </View>
      {action}
    </View>
  );
}

/**
 * El hilo, de lo más viejo arriba a lo último abajo.
 *
 * La lista va INVERTIDA: empieza pegada al final, que es donde está lo que se
 * vino a leer, y el teclado la empuja desde ahí. Una lista normal abre arriba
 * del todo y obliga a bajar hasta la respuesta cada vez que se entra.
 */
export function MessageList({
  messages,
  me,
}: {
  readonly messages: readonly Message[];
  readonly me: MessageSender;
}) {
  const theme = useTheme();
  const data = useMemo(() => [...messages].reverse(), [messages]);

  return (
    <FlatList
      inverted
      data={data}
      keyExtractor={(message) => message.id}
      renderItem={({ item, index }) => {
        const older = data[index + 1];
        const newDay = older === undefined || !sameDay(item.sentAt, older.sentAt);
        return (
          <View style={{ paddingVertical: 3 }}>
            {newDay ? (
              <Text
                variant="micro"
                color={theme.colors.textFaint}
                align="center"
                style={{ marginVertical: 10 }}
              >
                {dayLabel(item.sentAt)}
              </Text>
            ) : null}
            <Bubble message={item} mine={item.sender === me} />
          </View>
        );
      }}
      contentContainerStyle={{ paddingVertical: 12 }}
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    />
  );
}

function Bubble({ message, mine }: { readonly message: Message; readonly mine: boolean }) {
  const theme = useTheme();
  const ink = mine ? theme.colors.actionPrimaryInk : theme.colors.ink;

  return (
    <View style={{ alignItems: mine ? 'flex-end' : 'flex-start' }}>
      <View
        style={{
          maxWidth: '82%',
          backgroundColor: mine ? theme.colors.actionPrimary : theme.colors.surfaceRaised,
          borderRadius: 18,
          borderBottomRightRadius: mine ? 6 : 18,
          borderBottomLeftRadius: mine ? 18 : 6,
          paddingHorizontal: 14,
          paddingVertical: 9,
          gap: 2,
        }}
      >
        {/* Quién del mostrador contestó. En un dojo con dos profesores, «el
            martes sí hay clase» vale distinto según quién lo dijo. */}
        {message.sender === 'gym' && message.staffName !== null ? (
          <Text
            variant="micro"
            weight="semibold"
            color={mine ? withAlpha(ink, 0.6) : theme.colors.textTertiary}
          >
            {message.staffName}
          </Text>
        ) : null}
        <Text variant="body" color={ink}>
          {message.body}
        </Text>
        <Text
          variant="micro"
          color={mine ? withAlpha(ink, 0.5) : theme.colors.textFaint}
          align="right"
        >
          {formatClock(message.sentAt)}
        </Text>
      </View>
    </View>
  );
}

/**
 * El campo para escribir y el botón de enviar.
 *
 * El motivo por el que no se puede enviar sale ENCIMA del campo, con la frase de
 * `messageDenialText`, salvo el de campo vacío: con el campo vacío delante,
 * «escribe tu mensaje» es ruido, y el botón apagado ya lo dice.
 */
export function Composer({
  value,
  onChange,
  onSend,
  sending,
  denial,
  blocked = false,
  failure,
  placeholder,
}: {
  readonly value: string;
  readonly onChange: (text: string) => void;
  readonly onSend: () => void;
  readonly sending: boolean;
  /** Lo que dice `checkMessageDraft` del texto de ahora. */
  readonly denial: MessageDenial | null;
  /** Otra razón de la pantalla para no dejar enviar todavía (faltan datos). */
  readonly blocked?: boolean;
  /** Lo que respondió la api al último intento, si falló. */
  readonly failure: string | null;
  readonly placeholder: string;
}) {
  const theme = useTheme();
  const canSend = denial === null && !blocked && !sending;
  const reason = denial !== null && denial !== 'empty' ? messageDenialText(denial) : failure;
  const length = value.trim().length;

  return (
    <View style={[styles.composer, { borderTopColor: theme.colors.hairline }]}>
      {reason === null ? null : (
        <Text variant="micro" color={theme.semaphore.alert}>
          {reason}
        </Text>
      )}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10 }}>
        <TextInput
          value={value}
          // Un margen por encima del tope y no el tope: cortar en seco a mitad de
          // palabra se siente como un fallo; pasarse un poco y leer la frase que
          // explica el límite, no.
          onChangeText={(text) => onChange(text.slice(0, MESSAGE_MAX_LENGTH + 200))}
          placeholder={placeholder}
          placeholderTextColor={theme.colors.textPlaceholder}
          keyboardAppearance={theme.scheme}
          multiline
          accessibilityLabel="Mensaje"
          style={{
            flex: 1,
            color: theme.colors.ink,
            fontSize: 16,
            maxHeight: 120,
            backgroundColor: theme.colors.surface,
            borderRadius: 20,
            borderWidth: StyleSheet.hairlineWidth * 2,
            borderColor: theme.colors.hairline,
            paddingHorizontal: 14,
            paddingTop: 10,
            paddingBottom: 10,
          }}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Enviar"
          accessibilityState={{ disabled: !canSend }}
          disabled={!canSend}
          onPress={onSend}
          style={({ pressed }) => ({
            width: 42,
            height: 42,
            borderRadius: 21,
            backgroundColor: canSend ? theme.colors.actionPrimary : theme.colors.surfaceHigh,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.8 : 1,
          })}
        >
          <Send
            size={19}
            color={canSend ? theme.colors.actionPrimaryInk : theme.colors.textDisabled}
            strokeWidth={2.2}
          />
        </Pressable>
      </View>
      {length > MESSAGE_MAX_LENGTH - 100 ? (
        <Text
          variant="micro"
          color={length > MESSAGE_MAX_LENGTH ? theme.semaphore.alert : theme.colors.textFaint}
          align="right"
        >
          {length}/{MESSAGE_MAX_LENGTH}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * Un hilo en una lista: con quién, por dónde empezó y lo último que se dijo.
 *
 * Lo no leído se pinta en negrita y con su número, y la hora en verde: es lo que
 * se busca de reojo al abrir la bandeja.
 */
export function ConversationRow({
  title,
  detail,
  lastMessage,
  me,
  unread,
  onPress,
}: {
  readonly title: string;
  readonly detail: string;
  readonly lastMessage: Message;
  readonly me: MessageSender;
  readonly unread: number;
  readonly onPress: () => void;
}) {
  const theme = useTheme();
  const pending = unread > 0;
  const author =
    lastMessage.sender !== me
      ? ''
      : me === 'gym' && lastMessage.staffName !== null
        ? `${lastMessage.staffName}: `
        : 'Tú: ';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}${pending ? `, ${unread} sin leer` : ''}`}
      onPress={onPress}
      style={({ pressed }) => ({ paddingVertical: 12, opacity: pressed ? 0.7 : 1 })}
    >
      <View style={{ gap: 3 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Text
            variant="bodySmall"
            weight={pending ? 'bold' : 'semibold'}
            numberOfLines={1}
            style={{ flex: 1 }}
          >
            {title}
          </Text>
          <Text variant="micro" color={pending ? theme.semaphore.ok : theme.colors.textFaint}>
            {listMoment(lastMessage.sentAt)}
          </Text>
        </View>
        <Text variant="micro" color={theme.colors.textTertiary} numberOfLines={1}>
          {detail}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Text
            variant="captionSmall"
            color={pending ? theme.colors.ink : theme.colors.textSecondary}
            numberOfLines={1}
            style={{ flex: 1 }}
          >
            {author}
            {lastMessage.body}
          </Text>
          {pending ? (
            <View
              style={{
                minWidth: 20,
                height: 20,
                borderRadius: 10,
                paddingHorizontal: 6,
                backgroundColor: theme.semaphore.ok,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text variant="micro" weight="bold" color={theme.semaphoreInk.ok}>
                {unread > 9 ? '9+' : unread}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingTop: 8,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  composer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 10,
    gap: 6,
  },
});
