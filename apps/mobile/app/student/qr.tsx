/**
 * A2 · Mi QR.
 *
 * El codigo se genera en el dispositivo y rota cada 30 segundos (MD 4.6). Lo
 * que la pantalla dice del estado no lo decide la pantalla: sale de
 * `validateCheckIn`, la misma funcion que correra el escaner del staff. Si el
 * alumno lee "puedes entrar" aqui, en la puerta va a pasar.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, useWindowDimensions, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { semaphoreStyle } from '@sinchi/ui';
import { encodeAccountQrPayload } from '@sinchi/shared';
import { Card, Dot, Eyebrow, Row, Stack, Text } from '../../src/design/primitives';
import { LinkRequestList } from '../../src/design/link-requests';
import { PhotoCircle } from '../../src/design/photo';
import { SinchiQrCode } from '../../src/design/sinchi-qr';
import { Screen, TintedScreen } from '../../src/design/screen';
import { OfflineState, EmptyState } from '../../src/design/empty';
import { useTheme } from '../../src/design/theme';
import {
  useAccessCode,
  useCheckInPreview,
  useErrorDeCarga,
  useLinkRequests,
  usePolling,
  useStore,
  useWallet,
} from '../../src/data/hooks';
import { useSession } from '../../src/data/session-hooks';
import { restoreFirebaseAccount } from '../../src/data/auth';
import { acceptLinkRequest, rejectLinkRequest } from '../../src/data/link-requests';
import { setActiveTenant } from '../../src/data/store';
import { initials, splitGymName } from '../../src/lib/format';

export default function QrScreen() {
  const theme = useTheme();
  const session = useSession();
  const user = useStore((state) => state.user);
  const activeTenantId = useStore((state) => state.activeTenantId);
  const wallet = useWallet();

  const selected = useMemo(
    () => wallet.find((entry) => entry.tenant.id === activeTenantId) ?? wallet[0],
    [wallet, activeTenantId],
  );

  const { error: errorDeCarga, reintentar } = useErrorDeCarga();
  const [pickerOpen, setPickerOpen] = useState(false);
  // El QR se mide contra la pantalla, no en duro. A 212 fijos se salia en un
  // iPhone con barra de pestanas —la tarjeta de abajo quedaba pegada a ella— y
  // en un telefono pequeno el codigo quedaba mas grande que el hueco.
  const { width, height } = useWindowDimensions();
  const qr = Math.round(Math.max(180, Math.min(width - 84, height * 0.30)));
  const code = useAccessCode();
  const preview = useCheckInPreview(selected?.membership.id ?? null);

  if (selected === undefined || preview === null) {
    // Fondo normal, no el ámbar del semáforo: no tener membresías no es una
    // advertencia sobre tu acceso, es que todavía no hay nada que enseñar. Pintar
    // media pantalla de ámbar decía que algo iba mal.
    if (errorDeCarga !== null) {
      return (
        <Screen>
          <OfflineState error={errorDeCarga} onReintentar={reintentar} />
        </Screen>
      );
    }
    // Sin membresía, Mi QR es con lo que la inscriben. Antes decía «todavía no
    // tienes un código» y mandaba al mostrador con el DNI en la mano, justo a
    // quien el mostrador ya podía encontrar escaneando algo.
    if (selected === undefined && session.status === 'unlinked') return <AccountRegisterQr />;
    if (selected === undefined && session.status === 'signed_in') {
      return <MemberRegisterQr code={code} name={user.name} />;
    }
    return (
      <Screen>
        <EmptyState
          title="Todavía no tienes un código"
          body="Tu código aparece aquí en cuanto un gimnasio te agregue a su padrón. Es lo que el recepcionista escanea en la puerta."
          pie="Acércate al mostrador con tu DNI: te dan de alta en un minuto."
        />
      </Screen>
    );
  }

  const semaphore = semaphoreStyle(theme, preview.message.level);
  const ink = semaphore.ink;
  const { brand } = splitGymName(selected.tenant.name);

  return (
    <TintedScreen gradient={semaphore.gradient} ink={ink} watermark="SINCHI" watermarkOpacity={0.045}>
      <Row>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Gimnasio: ${selected.tenant.name}. Toca para cambiar.`}
          onPress={() => setPickerOpen((open) => !open)}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 9,
            backgroundColor: 'rgba(10,10,11,0.10)',
            paddingLeft: 8,
            paddingRight: 12,
            paddingVertical: 7,
            borderRadius: theme.radii.pill,
          }}
        >
          <View
            style={{
              width: 22,
              height: 22,
              borderRadius: 7,
              backgroundColor: 'rgba(10,10,11,0.75)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text variant="eyebrow" weight="extrabold" color="#FFFFFF" style={{ letterSpacing: 0 }}>
              {initials(selected.tenant.name)}
            </Text>
          </View>
          <Text variant="caption" weight="semibold" color={ink}>
            {brand}
          </Text>
          <Text variant="eyebrow" color={ink} style={{ opacity: 0.55, letterSpacing: 0 }}>
            ▾
          </Text>
        </Pressable>
        <Text variant="eyebrow" weight="bold" color={ink} style={{ opacity: 0.5 }}>
          Mi QR
        </Text>
      </Row>

      {pickerOpen ? (
        <Stack gap={6} style={{ marginTop: 10 }}>
          {wallet.map((entry) => (
            <Pressable
              key={entry.membership.id}
              accessibilityRole="button"
              onPress={() => {
                setActiveTenant(entry.tenant.id);
                setPickerOpen(false);
              }}
              style={{
                backgroundColor: 'rgba(10,10,11,0.10)',
                borderRadius: theme.radii.md,
                paddingHorizontal: 14,
                paddingVertical: 11,
              }}
            >
              <Text variant="bodySmall" weight="semibold" color={ink}>
                {entry.tenant.name}
              </Text>
            </Pressable>
          ))}
        </Stack>
      ) : null}

      {/* La identidad va en una fila, no en una columna centrada. Ocupaba 264px
          —foto de 112, el nombre en tipografia de titular y la insignia— en una
          pantalla que no hace scroll, y eso dejaba al QR sin sitio: lo que el
          recepcionista tiene que escanear salia comprimido para que cupiera el
          nombre en grande. La foto sigue estando porque es lo unico que impide
          prestar el telefono (MD 4.6), pero al lado del nombre, no encima. */}
      <Row gap={14} justify="flex-start" style={{ marginTop: 20 }}>
        <PhotoCircle
          name={user.name}
          photoUrl={user.photoUrl}
          size={64}
          ringColor="rgba(255,255,255,0.55)"
          ringWidth={3}
        />
        <Stack gap={3} style={{ flex: 1 }}>
          <Text variant="titleSmall" weight="bold" color={ink} numberOfLines={1}>
            {user.name}
          </Text>
          <Text variant="captionSmall" weight="semibold" color={ink} style={{ opacity: 0.62 }}>
            {selected.plan.name} · {brand}
          </Text>
        </Stack>
      </Row>

      <View
        style={{
          marginTop: 18,
          backgroundColor: '#FFFFFF',
          borderRadius: theme.radii.xxxl,
          padding: 18,
          alignItems: 'center',
          gap: 12,
        }}
      >
        <SinchiQrCode value={code.ready ? code.payload : null} size={qr} />

        <Row gap={12} justify="center">
          <CountdownRing
            secondsLeft={code.secondsLeft}
            periodSeconds={code.periodSeconds}
            color={semaphore.color}
          />
          <Stack gap={1}>
            <Text variant="caption" weight="semibold" color={theme.colors.inkOnLight}>
              Se renueva en {code.secondsLeft} s
            </Text>
            <Text variant="micro" color="#7A7A83">
              Código firmado · funciona sin internet
            </Text>
          </Stack>
        </Row>
      </View>

      {/* El veredicto estaba dos veces: una pastilla arriba con "Puedes entrar" y
          una tarjeta abajo con "Suscripcion al dia". Es el mismo hecho dicho
          dos veces, y entre las dos se comian el aire que le falta al QR. */}
      <Stack gap={8} style={{ marginTop: 'auto', paddingTop: 18, alignItems: 'center' }}>
        <Row
          gap={9}
          justify="center"
          style={{
            backgroundColor: 'rgba(10,10,11,0.92)',
            paddingHorizontal: 18,
            paddingVertical: 9,
            borderRadius: theme.radii.pill,
          }}
        >
          <Dot color={semaphore.color} size={9} />
          <Text variant="bodySmall" weight="bold" color="#FFFFFF">
            {preview.message.title}
          </Text>
        </Row>
        <Text variant="captionSmall" color={ink} align="center" style={{ opacity: 0.72 }}>
          {preview.message.reason}
          {preview.message.detail === null ? '' : ` ${preview.message.detail}`}
        </Text>
      </Stack>
    </TintedScreen>
  );
}

/*
 * `studentTitle` vivia aqui traduciendo "Puede pasar" a "Puedes entrar" con una
 * tabla, y solo cubria el titular: el motivo y el detalle seguian en tercera
 * persona —"ya no LE quedan sesiones"— en la pantalla del propio alumno. Ahora
 * las dos voces salen del dominio, que es donde tienen que estar para que digan
 * lo mismo del mismo hecho.
 */

/** Anillo de cuenta regresiva de la ventana TOTP. */
function CountdownRing({
  secondsLeft,
  periodSeconds,
  color,
}: {
  readonly secondsLeft: number;
  readonly periodSeconds: number;
  readonly color: string;
}) {
  const theme = useTheme();
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const consumed = 1 - secondsLeft / periodSeconds;

  return (
    <View style={{ width: 38, height: 38, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={38} height={38} viewBox="0 0 80 80" style={{ transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={40} cy={40} r={radius} fill="none" stroke="rgba(10,10,11,0.12)" strokeWidth={7} />
        <Circle
          cx={40}
          cy={40}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={7}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * consumed}
        />
      </Svg>
      <View style={{ position: 'absolute' }}>
        <Text variant="caption" weight="extrabold" color={theme.colors.inkOnLight}>
          {secondsLeft}
        </Text>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Sin membresía: el QR para que te inscriban
// ---------------------------------------------------------------------------

/** Cada cuánto se reintenta renovar un QR de cuenta vencido si la red no respondió. */
const RENEW_RETRY_MS = 15_000;

/**
 * La cuenta sin ficha: su QR de cuenta (`SINCHI1:a:<token>`).
 *
 * No abre ninguna puerta: recepción lo escanea y el alta se abre con su nombre y
 * su celular, y a ella le llega la solicitud aquí mismo (decisiones §14). Vence a
 * los diez minutos y se renueva solo, volviendo a entrar con la credencial
 * guardada; con candado de tiempo, porque sin red reintentar en cada segundo del
 * reloj sería una petición por segundo que nadie ve fallar.
 */
function AccountRegisterQr() {
  const session = useSession();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const expiresAt = session.status === 'unlinked' ? session.expiresAt : 0;
  const expired = expiresAt > 0 && expiresAt <= now;
  const lastRenewal = useRef(0);
  useEffect(() => {
    if (!expired || now - lastRenewal.current < RENEW_RETRY_MS) return;
    lastRenewal.current = now;
    void restoreFirebaseAccount();
  }, [expired, now]);

  if (session.status !== 'unlinked') return null;
  const secondsLeft = Math.max(0, Math.round((expiresAt - now) / 1000));

  return (
    <RegisterPanel
      value={encodeAccountQrPayload(session.qrToken)}
      dimmed={expired}
      name={session.fullName}
      intro="Muéstraselo a recepción para que te inscriban. Todavía no abre la puerta: eso llega con tu primera membresía."
      footnote={expired ? 'Renovando tu QR…' : `Vence en ${formatCountdown(secondsLeft)} · se renueva solo`}
      steps={[
        'Recepción escanea tu QR y lee tu DNI.',
        'Te llega aquí la solicitud del gimnasio.',
        'La aceptas, y tu membresía aparece en tu billetera.',
      ]}
    />
  );
}

/**
 * Quien ya tiene ficha y ninguna membresía: su QR de siempre.
 *
 * Es el mismo que abre la puerta, y la billetera promete que funciona en
 * cualquier local de la red. El mostrador de un gimnasio donde no está lo canjea
 * por sus datos —con la firma verificada— y la inscribe sin pedirle el carné.
 */
function MemberRegisterQr({
  code,
  name,
}: {
  readonly code: ReturnType<typeof useAccessCode>;
  readonly name: string;
}) {
  return (
    <RegisterPanel
      value={code.ready ? code.payload : null}
      dimmed={false}
      name={name}
      intro="Todavía no estás en ningún gimnasio. Muéstraselo a recepción para que te inscriban: cuando tengas membresía, este mismo QR abre la puerta."
      footnote={code.ready ? `Se renueva en ${code.secondsLeft} s` : 'Preparando tu código…'}
      steps={[
        'Recepción escanea tu QR: tus datos ya están en Sinchi.',
        'Te llega aquí la solicitud del gimnasio.',
        'La aceptas, y tu membresía aparece en tu billetera.',
      ]}
    />
  );
}

/**
 * La pantalla de las dos de arriba.
 *
 * Las solicitudes van arriba y se piden cada pocos segundos mientras está abierta:
 * es la pantalla que se tiene en la mano en el mostrador, y la del gimnasio llega
 * mientras recepción termina el alta. Sin esto había que salir y volver para verla.
 */
function RegisterPanel({
  value,
  dimmed,
  name,
  intro,
  footnote,
  steps,
}: {
  readonly value: string | null;
  readonly dimmed: boolean;
  readonly name: string | null;
  readonly intro: string;
  readonly footnote: string;
  readonly steps: readonly string[];
}): ReactNode {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const requests = useLinkRequests();
  usePolling(requests.reload, 6_000);
  const side = Math.min(width - 120, 260);

  return (
    <Screen scroll>
      <Stack gap={3} style={{ paddingTop: 8 }}>
        <Text variant="titleSmall" weight="bold">
          Mi QR
        </Text>
        <Text variant="captionSmall" color={theme.colors.textSecondary}>
          {intro}
        </Text>
      </Stack>

      {requests.details.length > 0 ? (
        <Stack gap={10} style={{ marginTop: 20 }}>
          <Eyebrow>Te agregaron</Eyebrow>
          <LinkRequestList
            requests={requests.details}
            onAccept={acceptLinkRequest}
            onReject={rejectLinkRequest}
            onAnswered={requests.reload}
          />
        </Stack>
      ) : null}

      <Stack gap={14} style={{ marginTop: 26, alignItems: 'center' }}>
        {/* Blanco y con margen propio aunque el tema sea oscuro: una cámara de
            mostrador lee mal un QR invertido, y peor todavía sin borde. Vencido
            se apaga en vez de desaparecer, para que no parezca que se rompió. */}
        <View
          style={{
            padding: 18,
            borderRadius: theme.radii.xxl,
            backgroundColor: '#FFFFFF',
            opacity: dimmed ? 0.2 : 1,
          }}
        >
          <SinchiQrCode value={value} size={side} />
        </View>
        {name === null || name.length === 0 ? null : (
          <Text variant="heading" weight="semibold">
            {name}
          </Text>
        )}
        <Text variant="caption" color={theme.colors.textSecondary}>
          {footnote}
        </Text>
      </Stack>

      <Card tone="sunken" style={{ marginTop: 26 }}>
        <Stack gap={10}>
          <Eyebrow>Cómo te inscriben</Eyebrow>
          {steps.map((step, index) => (
            <Row key={step} gap={10} align="flex-start" justify="flex-start">
              <Text variant="captionSmall" weight="bold" color={theme.semaphore.ok}>
                {index + 1}
              </Text>
              <Text variant="captionSmall" color={theme.colors.textSecondary} style={{ flex: 1 }}>
                {step}
              </Text>
            </Row>
          ))}
        </Stack>
      </Card>
    </Screen>
  );
}

function formatCountdown(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes === 0 ? `${rest} s` : `${minutes}:${String(rest).padStart(2, '0')}`;
}
