/**
 * A2 · Mi QR.
 *
 * El codigo se genera en el dispositivo y rota cada 30 segundos (MD 4.6). Lo
 * que la pantalla dice del estado no lo decide la pantalla: sale de
 * `validateCheckIn`, la misma funcion que correra el escaner del staff. Si el
 * alumno lee "puedes entrar" aqui, en la puerta va a pasar.
 */
import { useMemo, useState } from 'react';
import { Pressable, useWindowDimensions, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import Svg, { Circle, Path } from 'react-native-svg';
import { LOGO_BAR_PATH, LOGO_BAR_WIDTH, LOGO_OUTLINE_PATH, LOGO_VIEWBOX } from '@sinchi/ui';
import { semaphoreStyle } from '@sinchi/ui';
import { Dot, Row, Stack, Text } from '../../src/design/primitives';
import { PhotoCircle } from '../../src/design/photo';
import { Screen, TintedScreen } from '../../src/design/screen';
import { EstadoSinConexion, EstadoVacio } from '../../src/design/empty';
import { useTheme } from '../../src/design/theme';
import {
  useAccessCode,
  useCheckInPreview,
  useErrorDeCarga,
  useStore,
  useWallet,
} from '../../src/data/hooks';
import { setActiveTenant } from '../../src/data/store';
import { initials, splitGymName } from '../../src/lib/format';

export default function QrScreen() {
  const theme = useTheme();
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
          <EstadoSinConexion error={errorDeCarga} onReintentar={reintentar} />
        </Screen>
      );
    }
    return (
      <Screen>
        <EstadoVacio
          titulo="Todavía no tienes un código"
          cuerpo="Tu código aparece aquí en cuanto un gimnasio te agregue a su padrón. Es lo que el recepcionista escanea en la puerta."
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
        <View style={{ width: qr, height: qr, alignItems: 'center', justifyContent: 'center' }}>
          {code.ready ? (
            <QRCode
              value={code.payload}
              size={qr}
              backgroundColor="#FFFFFF"
              color={theme.colors.inkOnLight}
              // Nivel Q: la etiqueta central tapa parte de la matriz y aun asi
              // tiene que leerse a la primera con la camara de un celular viejo.
              ecl="Q"
            />
          ) : (
            <Text variant="caption" color="#7A7A83">
              Preparando tu código…
            </Text>
          )}
          <View
            style={{
              position: 'absolute',
              width: 52,
              height: 52,
              borderRadius: theme.radii.md,
              backgroundColor: '#FFFFFF',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Svg width={30} height={30} viewBox={LOGO_VIEWBOX}>
              <Path d={LOGO_OUTLINE_PATH} fill={theme.colors.inkOnLight} />
              <Path d={LOGO_BAR_PATH} stroke="#FFFFFF" strokeWidth={LOGO_BAR_WIDTH} />
            </Svg>
          </View>
        </View>

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
