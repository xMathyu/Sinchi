/**
 * Escribir una rutina.
 *
 * `nueva` como id es la pantalla de creación: una ruta aparte obligaría a
 * mantener dos formularios iguales y el segundo siempre se queda atrás. Mismo
 * criterio que el editor de eventos.
 *
 * Dos cosas mandan en el diseño de esta pantalla:
 *
 *  1. **quién la ve va arriba del todo, no en los ajustes finales.** Es la
 *     decisión comercial entera —regalar para atraer, o guardar para retener— y
 *     tomada al final se toma sin pensar. Va con las dos frases dichas enteras,
 *     no con un interruptor que diga «pública»;
 *
 *  2. **los pasos son opcionales.** Una técnica de judo es un video y una
 *     explicación; obligar a crear un paso llamado igual que la rutina sería
 *     papeleo. El «día de pecho» sí los usa, y se añaden de uno en uno.
 */
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, Switch, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import Trash from 'lucide-react-native/icons/trash-2';
import Video from 'lucide-react-native/icons/video';
import * as ImagePicker from 'expo-image-picker';
import {
  checkRoutineDraft,
  checkVideoUpload,
  parseVideoLink,
  routineDenialMessage,
  videoUploadDenialMessage,
  type RoutineItemDraft,
} from '@sinchi/shared';
import { withAlpha } from '@sinchi/ui';
import {
  Button,
  Card,
  Eyebrow,
  Field,
  Row,
  SegmentedControl,
  Stack,
  Text,
} from '../../../src/design/primitives';
import { Screen } from '../../../src/design/screen';
import { useTheme } from '../../../src/design/theme';
import { useRutina } from '../../../src/data/hooks';
import { eliminarRutina, guardarRutina, subirVideoDeRutina } from '../../../src/data/actions';

/** Un paso mientras se escribe. Lleva llave propia para no reordenarse solo. */
interface PasoEnEdicion extends RoutineItemDraft {
  readonly key: string;
}

const pasoVacio = (): PasoEnEdicion => ({
  key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  title: '',
  instructions: null,
  videoUrl: null,
  videoAssetId: null,
  prescription: null,
});

const NIVELES = [
  { value: 'ninguno', label: 'Todos' },
  { value: 'beginner', label: 'Básico' },
  { value: 'intermediate', label: 'Intermedio' },
  { value: 'advanced', label: 'Avanzado' },
] as const;

type NivelElegido = (typeof NIVELES)[number]['value'];

export default function EditorDeRutinaScreen() {
  const theme = useTheme();
  const { routineId } = useLocalSearchParams<{ routineId: string }>();
  const esNueva = routineId === 'nueva';

  const { rutina } = useRutina(esNueva ? '' : routineId);

  const [titulo, setTitulo] = useState('');
  const [resumen, setResumen] = useState('');
  const [video, setVideo] = useState('');
  const [videoSubido, setVideoSubido] = useState<string | null>(null);
  const [nivel, setNivel] = useState<NivelElegido>('ninguno');
  const [publica, setPublica] = useState(false);
  const [publicada, setPublicada] = useState(true);
  const [pasos, setPasos] = useState<readonly PasoEnEdicion[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (esNueva || rutina === null || !rutina.unlocked) return;
    const { routine } = rutina.card;
    setTitulo(routine.title);
    setResumen(routine.summary ?? '');
    setVideo(routine.videoAssetId === null ? (routine.videoUrl ?? '') : '');
    setVideoSubido(routine.videoAssetId);
    setNivel(routine.level ?? 'ninguno');
    setPublica(routine.visibility === 'public');
    setPublicada(routine.status === 'published');
    setPasos(
      rutina.items.map((item) => ({
        key: item.id,
        title: item.title,
        // Un video subido llega con su URL firmada en `videoUrl`, y esa URL
        // caduca: guardarla en el formulario y volver a mandarla convertiría el
        // archivo en un enlace muerto. Del subido solo viaja su id.
        instructions: item.instructions,
        videoUrl: item.videoAssetId === null ? item.videoUrl : null,
        videoAssetId: item.videoAssetId,
        prescription: item.prescription,
      })),
    );
  }, [rutina, esNueva]);

  const borrador = useMemo(
    () => ({
      title: titulo,
      summary: resumen.trim().length === 0 ? null : resumen,
      videoUrl: video.trim().length === 0 ? null : video,
      videoAssetId: videoSubido,
      level: nivel === 'ninguno' ? null : nivel,
      visibility: (publica ? 'public' : 'members') as 'public' | 'members',
      items: pasos.map((paso) => ({
        title: paso.title,
        instructions: paso.instructions,
        videoUrl: paso.videoUrl,
        videoAssetId: paso.videoAssetId,
        prescription: paso.prescription,
      })),
    }),
    [titulo, resumen, video, videoSubido, nivel, publica, pasos],
  );

  // La MISMA función que la api va a correr: el botón se apaga por el motivo
  // exacto por el que habría respondido 400.
  const motivo = useMemo(() => checkRoutineDraft(borrador), [borrador]);
  const listo = motivo === null && !guardando;

  async function guardar(): Promise<void> {
    if (!listo) return;
    setGuardando(true);
    setError(null);
    try {
      await guardarRutina(esNueva ? null : routineId, {
        ...borrador,
        published: publicada,
      });
      router.back();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar la rutina.');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Screen scroll>
      <Row style={{ paddingTop: 8 }}>
        <Text variant="titleSmall" weight="bold">
          {esNueva ? 'Nueva rutina' : 'Editar rutina'}
        </Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={16}>
          <Text variant="body" color={theme.colors.textSecondary}>
            Cancelar
          </Text>
        </Pressable>
      </Row>

      {/* Quién la ve, arriba del todo. Es la decisión que vale plata: tomada al
          final se toma sin pensar. */}
      <Stack gap={10} style={{ marginTop: 20 }}>
        <Eyebrow>Quién la ve</Eyebrow>
        <Card radius={theme.radii.xl}>
          <Stack gap={14}>
            <Row>
              <Stack gap={2} style={{ flex: 1, paddingRight: 12 }}>
                <Text variant="bodySmall" weight="semibold">
                  {publica ? 'Cualquiera' : 'Solo tus alumnos'}
                </Text>
                <Text variant="captionSmall" color={theme.colors.textSecondary}>
                  {publica
                    ? 'Sale en tu ficha del directorio y la abre gente que todavía no entrena en ningún sitio. Es lo que hace que te elijan a ti.'
                    : 'No sale fuera. Solo la ven quienes están en tu padrón, y es media razón para seguir pagando la mensualidad.'}
                </Text>
              </Stack>
              <Switch
                value={publica}
                onValueChange={setPublica}
                accessibilityLabel="Hacerla pública"
                trackColor={{ true: theme.semaphore.ok, false: theme.colors.surfaceHigh }}
                thumbColor={theme.colors.ink}
              />
            </Row>
            <Text variant="micro" color={theme.colors.textFaint}>
              Puedes cambiarlo cuando quieras desde la lista, sin volver aquí.
            </Text>
          </Stack>
        </Card>
      </Stack>

      <Stack gap={10} style={{ marginTop: 20 }}>
        <Eyebrow>Qué es</Eyebrow>
        <Card radius={theme.radii.xl}>
          <Stack gap={16}>
            <Field
              label="Título"
              value={titulo}
              onChangeText={setTitulo}
              placeholder="Uchimata, o Día de pecho"
              hint="Es lo que se lee en la lista."
            />
            <Field
              label="De qué va"
              value={resumen}
              onChangeText={setResumen}
              placeholder="La entrada, el desequilibrio y la caída."
              optional
              multiline
            />
            <CampoDeVideo
              etiqueta="Video de la rutina"
              enlace={video}
              onEnlace={setVideo}
              assetId={videoSubido}
              onAsset={setVideoSubido}
            />
            {/* El nivel importa mas en un dojo que en un gimnasio: un cinturon
                blanco no empieza por tomoe nage. «Todos» es la ausencia de
                nivel, no un cuarto nivel. */}
            <SegmentedControl options={NIVELES} value={nivel} onChange={setNivel} />
          </Stack>
        </Card>
      </Stack>

      <Stack gap={10} style={{ marginTop: 20 }}>
        <Eyebrow>Paso a paso</Eyebrow>
        <Text variant="micro" color={theme.colors.textFaint}>
          Los ejercicios del día, o las partes de la técnica. Déjalo vacío si con el video de
          arriba está dicho todo.
        </Text>

        {pasos.map((paso, indice) => (
          <PasoEditable
            key={paso.key}
            paso={paso}
            numero={indice + 1}
            onCambio={(cambios) =>
              setPasos((previos) =>
                previos.map((p) => (p.key === paso.key ? { ...p, ...cambios } : p)),
              )
            }
            onQuitar={() =>
              setPasos((previos) => previos.filter((p) => p.key !== paso.key))
            }
          />
        ))}

        <Button
          label="+ Añadir un paso"
          variant="secondary"
          onPress={() => setPasos((previos) => [...previos, pasoVacio()])}
        />
      </Stack>

      <Stack gap={10} style={{ marginTop: 20 }}>
        <Card radius={theme.radii.xl}>
          <Row>
            <Stack gap={2} style={{ flex: 1, paddingRight: 12 }}>
              <Text variant="bodySmall" weight="semibold">
                Publicarla
              </Text>
              <Text variant="captionSmall" color={theme.colors.textSecondary}>
                Apagado se queda como borrador y no la ve nadie más que tú, para grabar hoy y
                escribir las instrucciones mañana.
              </Text>
            </Stack>
            <Switch
              value={publicada}
              onValueChange={setPublicada}
              accessibilityLabel="Publicar la rutina"
              trackColor={{ true: theme.semaphore.ok, false: theme.colors.surfaceHigh }}
              thumbColor={theme.colors.ink}
            />
          </Row>
        </Card>
      </Stack>

      {(error !== null || (motivo !== null && titulo.trim().length > 0)) && (
        <Card tone="sunken" borderColor={theme.semaphore.bad} style={{ marginTop: 16 }}>
          <Text variant="bodySmall" color={theme.semaphore.bad}>
            {error ?? (motivo === null ? '' : routineDenialMessage(motivo))}
          </Text>
        </Card>
      )}

      <Button
        label={guardando ? 'Guardando…' : esNueva ? 'Crear rutina' : 'Guardar cambios'}
        disabled={!listo}
        style={{ marginTop: 20 }}
        onPress={() => void guardar()}
      />

      {!esNueva && rutina?.unlocked === true && (
        <Stack gap={10} style={{ marginTop: 26 }}>
          <Eyebrow>Si ya no la quieres</Eyebrow>
          <Text variant="micro" color={theme.colors.textFaint}>
            {rutina.card.routine.status === 'published'
              ? 'Está publicada. Apaga «Publicarla» y guarda antes de borrarla: así no desaparece de golpe de la app de quien la estaba usando.'
              : 'Está sin publicar, así que puedes borrarla del todo.'}
          </Text>
          {rutina.card.routine.status === 'draft' && (
            <Button
              label="Borrar"
              variant="ghost"
              onPress={() => {
                Alert.alert(`Borrar "${rutina.card.routine.title}"`, 'No se puede deshacer.', [
                  { text: 'Volver', style: 'cancel' },
                  {
                    text: 'Borrar',
                    style: 'destructive',
                    onPress: () => {
                      void eliminarRutina(routineId)
                        .then(() => router.back())
                        .catch((e: unknown) =>
                          setError(e instanceof Error ? e.message : 'No se pudo borrar.'),
                        );
                    },
                  },
                ]);
              }}
            />
          )}
        </Stack>
      )}

      <View style={{ height: 32 }} />
    </Screen>
  );
}


/**
 * El video de una rutina o de un paso: subirlo, o pegar un enlace.
 *
 * Las dos formas conviven porque los dos gimnasios existen. El dojo con canal de
 * YouTube ya tiene su material subido y obligarlo a repetirlo sería trabajo por
 * nada; el profesor que graba en el tatami con el celular no tiene canal ni
 * ganas de abrirlo, y hasta ahora no tenía forma de publicar nada.
 *
 * Lo que se ofrece PRIMERO es subir, y es deliberado: es lo que más gente puede
 * hacer, y además es lo único que hace que el contenido de alumnos sea exclusivo
 * de verdad — un enlace de YouTube oculto lo ve cualquiera que lo tenga.
 *
 * Nunca los dos a la vez: elegir uno borra el otro. Con los dos puestos hay dos
 * videos para el mismo sitio y quien lee decide cuál gana, que es como el alumno
 * y el dueño acaban mirando cosas distintas.
 */
function CampoDeVideo({
  etiqueta,
  enlace,
  onEnlace,
  assetId,
  onAsset,
}: {
  readonly etiqueta: string;
  readonly enlace: string;
  readonly onEnlace: (texto: string) => void;
  readonly assetId: string | null;
  readonly onAsset: (id: string | null) => void;
}) {
  const theme = useTheme();
  const [subiendo, setSubiendo] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const enlaceMalo = enlace.trim().length > 0 && parseVideoLink(enlace) === null;

  async function elegir(): Promise<void> {
    setError(null);
    const permiso = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permiso.granted) {
      setError('Hace falta permiso para entrar a tus videos.');
      return;
    }

    const elegido = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      // Sin recomprimir: el reencodeo de Expo tarda minutos con un video largo y
      // deja peor calidad que la del celular, que ya graba en h.264.
      allowsEditing: false,
      quality: 1,
    });
    if (elegido.canceled) return;

    const archivo = elegido.assets[0];
    if (archivo === undefined) return;

    // El tipo se comprueba ANTES de subir: descubrirlo al final es gastar
    // cuatro minutos de datos de alguien para decirle que no.
    const contentType = archivo.mimeType ?? 'video/mp4';
    const denial = checkVideoUpload({
      contentType,
      ...(archivo.fileSize === undefined ? {} : { sizeBytes: archivo.fileSize }),
    });
    if (denial !== null) {
      setError(videoUploadDenialMessage(denial));
      return;
    }

    setSubiendo(0);
    try {
      const nuevo = await subirVideoDeRutina({
        fileUri: archivo.uri,
        contentType,
        ...(archivo.fileSize === undefined ? {} : { sizeBytes: archivo.fileSize }),
        ...(archivo.fileName == null ? {} : { originalName: archivo.fileName }),
        onProgreso: setSubiendo,
      });
      // Uno u otro, nunca los dos.
      onEnlace('');
      onAsset(nuevo);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'No se pudo subir el video.');
    } finally {
      setSubiendo(null);
    }
  }

  if (subiendo !== null) {
    return (
      <Stack gap={8}>
        <Text variant="captionSmall" color={theme.colors.textSecondary}>
          {etiqueta}
        </Text>
        {/* La barra existe porque una espera muda de cuatro minutos con un video
            de 200 MB es indistinguible de una app colgada, y quien lo cree
            cancela y vuelve a empezar. */}
        <View
          style={{
            height: 8,
            borderRadius: 4,
            backgroundColor: theme.colors.surfaceHigh,
            overflow: 'hidden',
          }}
        >
          <View
            style={{
              width: `${Math.round(subiendo * 100)}%`,
              height: '100%',
              backgroundColor: theme.semaphore.ok,
            }}
          />
        </View>
        <Text variant="micro" color={theme.colors.textFaint}>
          Subiendo… {Math.round(subiendo * 100)}%. No cierres la app.
        </Text>
      </Stack>
    );
  }

  if (assetId !== null) {
    return (
      <Stack gap={8}>
        <Text variant="captionSmall" color={theme.colors.textSecondary}>
          {etiqueta}
        </Text>
        <Row
          style={{
            paddingHorizontal: 14,
            paddingVertical: 12,
            borderRadius: theme.radii.md,
            backgroundColor: theme.colors.surfaceSunken,
            borderWidth: 1,
            borderColor: withAlpha(theme.semaphore.ok, 0.4),
          }}
        >
          <Row gap={9} justify="flex-start" style={{ flex: 1 }}>
            <Video size={15} color={theme.semaphore.ok} />
            <Text variant="bodySmall">Video subido</Text>
          </Row>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Quitar el video subido"
            onPress={() => onAsset(null)}
            hitSlop={12}
          >
            <Text variant="captionSmall" color={theme.colors.textSecondary}>
              Quitar
            </Text>
          </Pressable>
        </Row>
        <Text variant="micro" color={theme.colors.textFaint}>
          Guardado en Sinchi. Si la rutina es de alumnos, solo ellos pueden verlo.
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap={10}>
      <Button label="Subir un video" variant="secondary" onPress={() => void elegir()} />
      <Field
        label={`${etiqueta} — o pega un enlace`}
        value={enlace}
        onChangeText={onEnlace}
        placeholder="https://youtu.be/…"
        optional
        autoCapitalize="none"
        keyboardType="url"
        error={
          error ??
          (enlaceMalo
            ? 'Ese enlace no se entiende. Pega la dirección de YouTube o Vimeo.'
            : undefined)
        }
        hint="Un enlace de YouTube lo ve cualquiera que lo tenga. Un video subido solo lo ve quien tú decidas."
      />
    </Stack>
  );
}

function PasoEditable({
  paso,
  numero,
  onCambio,
  onQuitar,
}: {
  readonly paso: PasoEnEdicion;
  readonly numero: number;
  readonly onCambio: (cambios: Partial<RoutineItemDraft>) => void;
  readonly onQuitar: () => void;
}) {
  const theme = useTheme();

  return (
    <Card radius={theme.radii.xl} tone="sunken">
      <Stack gap={14}>
        <Row>
          <Text variant="captionSmall" weight="semibold" color={theme.colors.textSecondary}>
            Paso {numero}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Quitar el paso ${numero}`}
            onPress={onQuitar}
            hitSlop={14}
            style={{
              padding: 6,
              borderRadius: theme.radii.pill,
              backgroundColor: withAlpha(theme.semaphore.bad, 0.12),
            }}
          >
            <Trash size={14} color={theme.semaphore.bad} />
          </Pressable>
        </Row>

        <Field
          label="Ejercicio o técnica"
          value={paso.title}
          onChangeText={(texto) => onCambio({ title: texto })}
          placeholder="Kumi kata"
        />
        <Field
          label="Series"
          value={paso.prescription ?? ''}
          onChangeText={(texto) => onCambio({ prescription: texto.length === 0 ? null : texto })}
          placeholder="4 series de 12, o 5 minutos"
          optional
          hint="Como lo digas en clase. No hay casillas de series y repeticiones a propósito: en judo no significan nada."
        />
        <Field
          label="Cómo se hace"
          value={paso.instructions ?? ''}
          onChangeText={(texto) => onCambio({ instructions: texto.length === 0 ? null : texto })}
          placeholder="Agarra la solapa, controla la manga y entra girando."
          optional
          multiline
        />
        <CampoDeVideo
          etiqueta="Video de este paso"
          enlace={paso.videoUrl ?? ''}
          onEnlace={(texto) => onCambio({ videoUrl: texto.length === 0 ? null : texto })}
          assetId={paso.videoAssetId}
          onAsset={(id) => onCambio({ videoAssetId: id })}
        />
      </Stack>
    </Card>
  );
}
