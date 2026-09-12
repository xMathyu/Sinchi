/**
 * Bienvenida: lo primero que ve quien abre Sinchi por primera vez.
 *
 * Tres pantallas y una salida. Le habla al ALUMNO, que es la mayoría —en un
 * dojo de sesenta hay sesenta que entran con Google y un dueño—; a quien viene
 * a evaluar Sinchi para su gimnasio le habla la tarjeta verde del login, una
 * pantalla más adelante.
 *
 * Lo que cuenta sale de decisiones que ya están tomadas en el producto, no de
 * frases de folleto: la identidad es global y por eso las membresías de varios
 * gimnasios caben en una sola app; el código lo genera el teléfono y por eso
 * funciona sin datos; y el directorio deja reservar una clase de prueba.
 *
 * Se enseña UNA vez. El interruptor vive en `src/data/welcome.ts` y quien
 * decide enseñarla es `SessionRouter`, no esta pantalla: si cada pantalla
 * decidiera por su cuenta cuándo mostrarse, la que se olvide queda inalcanzable
 * y no se ve en una revisión de código.
 */
import { useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useRouter } from 'expo-router';
import Svg, { Path, Rect } from 'react-native-svg';
import { screenPadding, withAlpha } from '@sinchi/ui';
import { Button, Card, Eyebrow, Logo, Row, Stack, Text } from '../src/design/primitives';
import { Screen } from '../src/design/screen';
import { useTheme } from '../src/design/theme';
import { markWelcomeSeen } from '../src/data/welcome';

/**
 * Alto reservado al texto de cada lámina.
 *
 * Fijo y anclado abajo: los tres titulares ocupan dos líneas hoy, pero uno que
 * baje a una movería el botón 36 px al pasar de lámina, y eso se lee como un
 * salto. Con el bloque anclado, un titular corto deja aire arriba y el pie no
 * se entera.
 */
const TEXT_BLOCK_HEIGHT = 210;

/** Alto de la cabecera. Fijo para que el logo no salte cuando «Saltar» se va. */
const HEADER_HEIGHT = 56;

interface Slide {
  readonly eyebrow: string;
  readonly title: string;
  readonly body: string;
}

const SLIDES: readonly Slide[] = [
  {
    eyebrow: 'Tus gimnasios',
    title: 'Todos en una sola app',
    body:
      'Tu plan, tu cupo de la semana y lo que debes, gimnasio por gimnasio. Y si entrenas en más de uno, todos viven aquí.',
  },
  {
    eyebrow: 'Tu entrada',
    title: 'Tu QR abre la puerta',
    body:
      'Se genera en tu teléfono y cambia cada 30 segundos. En el sótano del gimnasio, sin datos, sigue funcionando.',
  },
  {
    eyebrow: 'Gimnasios cerca',
    title: 'Prueba antes de pagar',
    body:
      'Busca gimnasios cerca de ti, mira sus horarios y reserva una clase de prueba desde aquí. Sin llamar a nadie.',
  },
];

/**
 * Silueta de un QR, para la segunda lámina.
 *
 * Es decorativa: no codifica nada y no puede hacerlo —aquí todavía no hay
 * sesión, y el código de verdad lo genera el llavero del alumno—. Se dibuja
 * con una semilla fija para que sea la MISMA silueta en cada arranque: un
 * patrón que cambia solo, en la pantalla que explica que el código cambia
 * cada 30 segundos, confunde en vez de ilustrar.
 *
 * Sale como una sola `Path` y no como 250 `Rect` por lo que cuesta cada nodo
 * de svg en una lista de ese tamaño.
 */
const QR_MODULES = ((): string => {
  const LADO = 25;
  const enMarca = (x: number, y: number): boolean =>
    (x < 8 && y < 8) || (x > 16 && y < 8) || (x < 8 && y > 16);

  let semilla = 20260908;
  const azar = (): number => {
    semilla = (semilla * 1103515245 + 12345) & 0x7fffffff;
    return semilla / 0x7fffffff;
  };

  const trozos: string[] = [];
  for (let y = 0; y < LADO; y += 1) {
    for (let x = 0; x < LADO; x += 1) {
      if (enMarca(x, y)) continue;
      // Las dos líneas de sincronía de un QR real, que son las que hacen que
      // la silueta se lea como un QR y no como ruido.
      if (y === 6 || x === 6) {
        if ((y === 6 ? x : y) % 2 === 0) trozos.push(`M${x} ${y}h1v1h-1z`);
        continue;
      }
      if (azar() < 0.44) trozos.push(`M${x} ${y}h1v1h-1z`);
    }
  }
  return trozos.join('');
})();

export default function WelcomeScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const scroller = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);

  const last = index === SLIDES.length - 1;

  const leave = (): void => {
    // No se espera al llavero: `markWelcomeSeen` emite el estado antes de
    // escribir, así que el enrutado ya sabe que no tiene que volver aquí.
    void markWelcomeSeen();
    router.replace('/login');
  };

  const avanzar = (): void => {
    if (last) {
      leave();
      return;
    }
    scroller.current?.scrollTo({ x: width * (index + 1), animated: true });
  };

  const goTo = (n: number): void => {
    scroller.current?.scrollTo({ x: width * n, animated: true });
  };

  // El índice sale del scroll y no del botón: se puede llegar deslizando, y dos
  // fuentes de verdad para «en cuál estoy» se separan en cuanto alguien desliza
  // a medias.
  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>): void => {
    const n = Math.round(e.nativeEvent.contentOffset.x / width);
    setIndex(Math.min(Math.max(n, 0), SLIDES.length - 1));
  };

  const ilustraciones = [
    <MyGyms key="gimnasios" />,
    <EntryCode key="codigo" />,
    <GymToDiscover key="directorio" />,
  ];

  return (
    <Screen padded={false}>
      <Row style={{ height: HEADER_HEIGHT, paddingHorizontal: screenPadding }}>
        <Logo size={22} />
        {last ? null : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Saltar la bienvenida"
            onPress={leave}
            // El relleno llega hasta el margen de la pantalla: es donde cae el
            // pulgar, y sin él el área tocable termina en la última letra.
            style={{
              minHeight: 44,
              justifyContent: 'center',
              paddingLeft: 16,
              paddingRight: screenPadding,
              marginRight: -screenPadding,
            }}
          >
            <Text variant="caption" color={theme.colors.textSecondary}>
              Saltar
            </Text>
          </Pressable>
        )}
      </Row>

      <ScrollView
        ref={scroller}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScrollEnd}
        style={{ flex: 1 }}
      >
        {SLIDES.map((slide, n) => (
          <View key={slide.title} style={{ width, paddingHorizontal: screenPadding }}>
            <View style={{ flex: 1, justifyContent: 'center' }}>{ilustraciones[n]}</View>
            <View style={{ height: TEXT_BLOCK_HEIGHT, justifyContent: 'flex-end' }}>
              <Stack gap={12}>
                <Eyebrow color={theme.semaphore.ok}>{slide.eyebrow}</Eyebrow>
                <Text variant="hero" weight="black">
                  {slide.title}
                </Text>
                <Text variant="body" color={theme.colors.textSecondary}>
                  {slide.body}
                </Text>
              </Stack>
            </View>
          </View>
        ))}
      </ScrollView>

      <Stack gap={22} style={{ paddingHorizontal: screenPadding, paddingTop: 8 }}>
        <Row justify="flex-start" style={{ marginLeft: -8 }}>
          {SLIDES.map((slide, n) => (
            <Pressable
              key={slide.title}
              accessibilityRole="button"
              accessibilityLabel={`Ir a la lámina ${n + 1} de ${SLIDES.length}`}
              accessibilityState={{ selected: n === index }}
              onPress={() => goTo(n)}
              // El alto tocable va en el envoltorio y no en el punto: el punto
              // mide 7 px, que es una sexta parte del mínimo alcanzable.
              style={{ height: 44, justifyContent: 'center', paddingHorizontal: 8 }}
            >
              <View
                style={{
                  width: n === index ? 22 : 7,
                  height: 7,
                  borderRadius: theme.radii.pill,
                  backgroundColor:
                    n === index ? theme.semaphore.ok : withAlpha(theme.colors.ink, 0.14),
                }}
              />
            </Pressable>
          ))}
        </Row>
        <Button label={last ? 'Empezar' : 'Siguiente'} onPress={avanzar} />
      </Stack>
    </Screen>
  );
}

/**
 * Primera lámina: la billetera.
 *
 * Tres membresías con tres estados distintos —al día, por vencer y clase
 * suelta— porque es lo que hace la pantalla que promete: el semáforo diciendo
 * algo diferente en cada fila.
 */
function MyGyms() {
  const theme = useTheme();
  const samples = [
    { name: 'Nova BJJ Surco', detail: 'Al día · te quedan 2 sesiones', color: theme.semaphore.ok },
    {
      name: 'Iron Muay Thai Lince',
      detail: 'Vence en 3 días · S/ 120',
      color: theme.semaphore.warn,
    },
    {
      name: 'Ronin Judo Magdalena',
      detail: 'Clase suelta · pagas al entrar',
      color: theme.semaphore.ok,
    },
  ];

  return (
    <Stack gap={12}>
      {samples.map((gym) => (
        <Card key={gym.name} radius={theme.radii.xl}>
          <Row gap={12}>
            <Stack gap={4} style={{ flex: 1 }}>
              <Text variant="heading" weight="semibold" numberOfLines={1}>
                {gym.name}
              </Text>
              <Text variant="caption" color={theme.colors.textSecondary}>
                {gym.detail}
              </Text>
            </Stack>
            <View
              style={{
                width: 10,
                height: 10,
                borderRadius: theme.radii.pill,
                backgroundColor: gym.color,
              }}
            />
          </Row>
        </Card>
      ))}
    </Stack>
  );
}

/** Segunda lámina: el código de la puerta. */
function EntryCode() {
  const theme = useTheme();
  const LADO = 196;

  return (
    <Stack gap={22} style={{ alignItems: 'center' }}>
      <View
        style={{
          width: LADO,
          height: LADO,
          borderRadius: theme.radii.xxl,
          backgroundColor: theme.colors.ink,
          padding: 15,
        }}
      >
        <Svg width="100%" height="100%" viewBox="0 0 25 25">
          {/* Las tres marcas de posición, que es lo que hace que se lea como
              un QR desde lejos. */}
          {[
            { x: 0, y: 0 },
            { x: 18, y: 0 },
            { x: 0, y: 18 },
          ].map((marca) => (
            <Rect
              key={`${marca.x}-${marca.y}`}
              x={marca.x}
              y={marca.y}
              width={7}
              height={7}
              fill={theme.colors.canvas}
            />
          ))}
          {[
            { x: 1, y: 1 },
            { x: 19, y: 1 },
            { x: 1, y: 19 },
          ].map((hueco) => (
            <Rect
              key={`h-${hueco.x}-${hueco.y}`}
              x={hueco.x}
              y={hueco.y}
              width={5}
              height={5}
              fill={theme.colors.ink}
            />
          ))}
          {[
            { x: 2, y: 2 },
            { x: 20, y: 2 },
            { x: 2, y: 20 },
          ].map((center) => (
            <Rect
              key={`c-${center.x}-${center.y}`}
              x={center.x}
              y={center.y}
              width={3}
              height={3}
              fill={theme.colors.canvas}
            />
          ))}
          <Path d={QR_MODULES} fill={theme.colors.canvas} />
        </Svg>
      </View>

      <Row
        gap={9}
        justify="flex-start"
        style={{
          paddingVertical: 8,
          paddingHorizontal: 14,
          borderRadius: theme.radii.pill,
          backgroundColor: withAlpha(theme.colors.ink, 0.05),
          borderWidth: 1,
          borderColor: theme.colors.hairline,
        }}
      >
        <Svg width={14} height={14} viewBox="0 0 24 24">
          <Path
            d="M12 3a9 9 0 1 1-8.49 6"
            stroke={withAlpha(theme.colors.ink, 0.14)}
            strokeWidth={2.5}
            strokeLinecap="round"
            fill="none"
          />
          <Path
            d="M12 3a9 9 0 0 1 8.49 6"
            stroke={theme.semaphore.ok}
            strokeWidth={2.5}
            strokeLinecap="round"
            fill="none"
          />
        </Svg>
        <Text variant="captionSmall" color={theme.colors.textSecondary}>
          Se renueva en 24 s
        </Text>
      </Row>
    </Stack>
  );
}

/** Tercera lámina: la ficha de un gimnasio del directorio. */
function GymToDiscover() {
  const theme = useTheme();

  return (
    <Card radius={theme.radii.xl} padded={false} style={{ overflow: 'hidden' }}>
      <View
        style={{
          height: 116,
          backgroundColor: theme.colors.surfaceMuted,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* Marcador de sitio, no un intento de foto: la ficha real lleva la
            del gimnasio, y aquí todavía no hay ninguna que enseñar. */}
        <View style={{ opacity: 0.13 }}>
          <Logo size={46} barColor={theme.colors.surfaceMuted} />
        </View>
      </View>
      <Stack gap={12} style={{ padding: 16 }}>
        <Row gap={12} align="flex-start">
          <Stack gap={4} style={{ flex: 1 }}>
            <Text variant="heading" weight="semibold" numberOfLines={1}>
              Dojo Shotokan Miraflores
            </Text>
            <Text variant="caption" color={theme.colors.textSecondary}>
              Karate shotokan
            </Text>
          </Stack>
          <View
            style={{
              paddingVertical: 6,
              paddingHorizontal: 12,
              borderRadius: theme.radii.pill,
              backgroundColor: withAlpha(theme.semaphore.ok, 0.12),
              borderWidth: 1,
              borderColor: withAlpha(theme.semaphore.ok, 0.28),
            }}
          >
            <Text variant="captionSmall" weight="semibold" color={theme.semaphore.ok}>
              1 clase gratis
            </Text>
          </View>
        </Row>
        <View style={{ height: 1, backgroundColor: theme.colors.hairline }} />
        <Text variant="caption" color={theme.colors.textSecondary}>
          Lun, Mié y Vie · 7:00 p. m.
        </Text>
      </Stack>
    </Card>
  );
}
