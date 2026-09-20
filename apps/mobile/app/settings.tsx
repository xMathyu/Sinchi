/**
 * Mi cuenta.
 *
 * Era Ajustes. El avatar de arriba a la derecha lleva aquí desde cualquier
 * cuenta —sin gimnasio, alumno o staff—, y arriba van sus datos para corregirlos
 * (decisiones §15). Debajo van los dos interruptores que hacen falta:
 *
 *  - la apariencia. La app sigue al teléfono por defecto, y aquí se le
 *    contradice (decisiones §17). Es lo único de esta pantalla que no viaja al
 *    servidor: es de este teléfono, no de la persona;
 *  - el cambio de rol. El mismo binario sirve al alumno, a recepción y al dueño
 *    (MD 4.6). En producción el rol viene de la sesión; hasta que exista la api,
 *    este es el único camino para recorrer el modo staff.
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable } from 'react-native';
import { router } from 'expo-router';
import type { AppRole } from '@sinchi/shared';
import type { AppearancePreference } from '../src/data/appearance';
import {
  accountDetailsDenialMessage,
  checkAccountDetails,
  normalizePhoneNumber,
} from '@sinchi/shared';
import {
  Button,
  Card,
  Dot,
  Eyebrow,
  Field,
  Logo,
  Row,
  SegmentedControl,
  Stack,
  Text,
} from '../src/design/primitives';
import { Screen } from '../src/design/screen';
import { PhoneField } from '../src/design/phone-field';
import { useTheme, useThemeContext } from '../src/design/theme';
import { useStore } from '../src/data/hooks';
import { switchGym, switchMode, signOut } from '../src/data/auth';
import { fetchMe, fetchModes, type AvailableModesDto } from '../src/data/api';
import { saveMyDetails } from '../src/data/actions';
import { useSession } from '../src/data/session-hooks';
import { loadDemo, resetState, setRole } from '../src/data/store';

/**
 * El orden importa: «Automático» primero porque es lo que trae puesto, y claro
 * antes que oscuro porque así está en iOS y en Android — la lista que la
 * persona ya vio en los ajustes del teléfono hace diez segundos.
 */
const APPEARANCES: readonly { readonly value: AppearancePreference; readonly label: string }[] = [
  { value: 'system', label: 'Automático' },
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Oscuro' },
];

const ROLES: readonly { readonly value: AppRole; readonly label: string; readonly hint: string }[] =
  [
    { value: 'student', label: 'Alumno', hint: 'Su plan, su QR, su historial' },
    { value: 'front_desk', label: 'Recepción', hint: 'Escanear, marcar manual, cobrar' },
    { value: 'owner', label: 'Dueño', hint: 'Todo lo anterior más reportes' },
  ];

export default function SettingsScreen() {
  const theme = useTheme();
  const { preference, setPreference } = useThemeContext();
  const role = useStore((state) => state.role);
  const user = useStore((state) => state.user);
  const staff = useStore((state) => state.staff);
  const tenants = useStore((state) => state.tenants);
  const session = useSession();

  // Con sesion de staff el store NO tiene la billetera de nadie: `/me` es del
  // alumno y un recepcionista no tiene membresia donde trabaja. `state.user`
  // sigue siendo el de demostracion, asi que mostrarlo aqui le ponia a la
  // recepcionista el nombre de Mathyu Quispe.
  const isStaffSession = session.status === 'signed_in' && session.session.role !== 'student';
  const onShift = tenants.find((t) => t.id === staff.tenantId);

  /**
   * Los dos lados de esta persona.
   *
   * No sale de la sesion: el rol firmado dice con QUE entro, no que mas es. Un
   * dueno con ficha en su propio dojo y uno sin ella llevan tokens identicos, y
   * la diferencia es justo lo que decide si este bloque se ensena.
   *
   * Se pregunta al abrir ajustes y no al arrancar la app: es una pantalla que se
   * visita poco, y el dato caduca —el dueno puede inscribirse hoy— asi que
   * guardarlo costaria mas que volver a pedirlo.
   */
  const [modes, setModes] = useState<AvailableModesDto | null>(null);
  const [switching, setSwitching] = useState(false);
  const [modeError, setModeError] = useState<string | null>(null);

  useEffect(() => {
    if (session.status !== 'signed_in') return;

    let vivo = true;
    void fetchModes().then(
      (m) => {
        if (vivo) setModes(m);
      },
      () => {
        // Sin respuesta no se ensena nada. Un boton que lleva a una ruta que no
        // se pudo consultar es peor que la ausencia del boton.
      },
    );
    return () => {
      vivo = false;
    };
  }, [session.status]);

  /**
   * El otro lado de esta persona, que siempre es el contrario del que trae.
   *
   * De staff a alumno se ofrece SIN CONDICIONES, y esa es la corrección: antes
   * hacía falta `modos.student` —tener ficha activa en algún padrón— y el dueño
   * que acaba de registrar su gimnasio no la tiene. Nadie tiene ficha en su
   * propio dojo el primer día, así que el único camino de vuelta a su billetera
   * era cerrar sesión y volver a entrar.
   *
   * El argumento para exigirla era que sin ficha llega a una billetera vacía. Ya
   * no lo es: esa billetera vacía lleva al directorio y a reservar una clase de
   * prueba, que es exactamente lo que un dueño querría mirar desde el otro lado.
   * Lo que cambia con la ficha es el TEXTO, no si se ofrece.
   *
   * La vuelta sí depende de los hechos: `switch-to-staff` relee `staff` y
   * rechaza a quien no trabaja en ningún gimnasio, así que ofrecérselo sería
   * ofrecer un botón que la api contesta que no.
   */
  const otherMode: 'student' | 'staff' | null =
    modes === null ? null : isStaffSession ? 'student' : modes.staff.length > 0 ? 'staff' : null;

  /** El puesto al que lleva «volver»: el de siempre, como hace la api. */
  const defaultPost = modes?.staff[0] ?? null;

  /**
   * Los OTROS locales de esta persona.
   *
   * Solo tiene sentido enseñarlos en modo staff: desde la billetera el botón de
   * arriba ya la devuelve a su puesto, y ofrecerle además elegir local sería
   * hacerle tomar dos decisiones para volver de una.
   */
  const tenantActual = session.status === 'signed_in' ? session.session.tenantId : null;
  const otherGyms =
    modes === null || !isStaffSession
      ? []
      : modes.staff.filter((post) => post.tenantId !== tenantActual);

  return (
    <Screen scroll>
      <Row style={{ paddingTop: 8 }}>
        <Text variant="titleSmall" weight="bold">
          Mi cuenta
        </Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={16}>
          <Text variant="body" color={theme.colors.textSecondary}>
            Cerrar
          </Text>
        </Pressable>
      </Row>

      {/* Quién es y dónde trabaja, solo cuando no lo dicen ya los datos de abajo:
          con sesión de staff dice el puesto, y en demostración es lo único que
          identifica a la persona inventada. */}
      {isStaffSession || session.status === 'demo' ? (
      <Card radius={theme.radii.xl} style={{ marginTop: 16 }}>
        <Row gap={12} justify="flex-start">
          <Logo size={28} />
          <Stack gap={1} style={{ flex: 1 }}>
            <Text variant="heading" weight="semibold">
              {isStaffSession ? staff.displayName : user.name}
            </Text>
            <Text variant="captionSmall" color={theme.colors.textSecondary}>
              {isStaffSession
                ? `${staff.role === 'owner' ? 'Dueño' : 'Recepción'}${onShift === undefined ? '' : ` · ${onShift.name}`}`
                : `${user.phone} · identidad Sinchi`}
            </Text>
          </Stack>
        </Row>
      </Card>
      ) : null}

      <AccountDetails />


      {/* Las dos caras de la misma persona, a un toque.
          La api sabía hacerlo desde el principio —`switch-to-student`— pero
          nadie lo llamaba, y el rol lo decide la api al mirar si esa persona
          tiene fila en `staff`: quien la tenía no veía nunca su propia
          billetera. Ver `otherMode` para por qué la ida no pide condiciones y
          la vuelta sí. */}
      {otherMode !== null && (
        <Stack gap={10} style={{ marginTop: 20 }}>
          <Eyebrow>Modo</Eyebrow>
          <Pressable
            accessibilityRole="button"
            disabled={switching}
            onPress={() => {
              setSwitching(true);
              setModeError(null);
              void switchMode(otherMode).then(
                () => {
                  // Sin `replace` explícito: `SessionRouter` reacciona al cambio
                  // de sesión y lleva a la zona que toca. Cerrar ajustes deja
                  // atrás una pantalla que ya no es de este rol.
                  setSwitching(false);
                  router.back();
                },
                (error: unknown) => {
                  setSwitching(false);
                  setModeError(
                    error instanceof Error ? error.message : 'No se pudo cambiar de modo.',
                  );
                },
              );
            }}
          >
            <Card radius={theme.radii.xl}>
              <Row gap={12}>
                <Stack gap={2} style={{ flex: 1 }}>
                  <Text variant="bodySmall" weight="semibold">
                    {otherMode === 'student'
                      ? 'Ver como alumno'
                      : `Volver a ${defaultPost?.tenantName ?? 'tu gimnasio'}`}
                  </Text>
                  <Text variant="captionSmall" color={theme.colors.textSecondary}>
                    {otherMode === 'student'
                      ? // Sin ficha la billetera está vacía, y decir «tu plan y
                        // tu QR» prometería algo que esa pantalla no tiene.
                        (modes?.student ?? false)
                        ? 'Tu plan, tu QR y tu historial en este gimnasio'
                        : 'Tu billetera y el directorio de gimnasios de la red'
                      : defaultPost?.role === 'owner'
                        ? 'El padrón, los planes y los reportes del local'
                        : 'Escanear, marcar manual y cobrar'}
                  </Text>
                </Stack>
                {switching ? (
                  <ActivityIndicator color={theme.colors.textSecondary} />
                ) : (
                  <Text variant="body" color={theme.colors.textSecondary}>
                    ›
                  </Text>
                )}
              </Row>
            </Card>
          </Pressable>
          {modeError !== null && (
            <Text variant="captionSmall" color={theme.semaphore.bad}>
              {modeError}
            </Text>
          )}
          <Text variant="micro" color={theme.colors.textFaint}>
            Es la misma sesión con otra etiqueta: cambiar de modo no la alarga ni la renueva.
          </Text>
        </Stack>
      )}

      {/* Los otros locales de esta persona.
          El caso que lo pide: el profesor que lleva la escuela de una
          universidad —alumnos becados, nadie paga— y aparte cobra sus clases
          por su cuenta. Son dos padrones y dos cajas, y hasta ahora la sesión
          solo sabía llevarlo a uno: el `tenantId` va firmado en el token, así
          que cambiar de local es pedir un token nuevo. Solo aparece si de
          verdad tiene otro. */}
      {otherGyms.length > 0 && (
        <Stack gap={10} style={{ marginTop: 20 }}>
          <Eyebrow>Tus locales</Eyebrow>
          {otherGyms.map((local) => (
            <Pressable
              key={local.tenantId}
              accessibilityRole="button"
              accessibilityLabel={`Cambiar a ${local.tenantName ?? 'el otro local'}`}
              disabled={switching}
              onPress={() => {
                setSwitching(true);
                setModeError(null);
                void switchGym(local.tenantId).then(
                  () => {
                    setSwitching(false);
                    router.back();
                  },
                  (error: unknown) => {
                    setSwitching(false);
                    setModeError(
                      error instanceof Error ? error.message : 'No se pudo cambiar de local.',
                    );
                  },
                );
              }}
            >
              <Card radius={theme.radii.xl}>
                <Row gap={12}>
                  <Stack gap={2} style={{ flex: 1 }}>
                    <Text variant="bodySmall" weight="semibold">
                      {local.tenantName ?? 'Otro local'}
                    </Text>
                    <Text variant="captionSmall" color={theme.colors.textSecondary}>
                      {local.role === 'owner' ? 'Dueño' : 'Recepción'}
                    </Text>
                  </Stack>
                  {switching ? (
                    <ActivityIndicator color={theme.colors.textSecondary} />
                  ) : (
                    <Text variant="body" color={theme.colors.textSecondary}>
                      ›
                    </Text>
                  )}
                </Row>
              </Card>
            </Pressable>
          ))}
          <Text variant="micro" color={theme.colors.textFaint}>
            Cada local lleva su propio padrón, sus planes y su caja. Cambiar tampoco alarga la
            sesión.
          </Text>
        </Stack>
      )}

      <Stack gap={10} style={{ marginTop: 20 }}>
        <Eyebrow>Apariencia</Eyebrow>
        <Card radius={theme.radii.xl}>
          <Stack gap={12}>
            <SegmentedControl<AppearancePreference>
              options={APPEARANCES}
              value={preference}
              onChange={setPreference}
            />
            <Text variant="captionSmall" color={theme.colors.textSecondary}>
              «Automático» sigue al tema del teléfono y cambia con él. Las otras dos lo
              contradicen y se quedan puestas.
            </Text>
            <Text variant="micro" color={theme.colors.textFaint}>
              Es de este teléfono, no de tu cuenta: entrar desde otro no se lo lleva.
            </Text>
          </Stack>
        </Card>
      </Stack>

      {/* Con sesion real el rol lo firma el token: cambiarlo aqui solo dejaria la
          app pintando una zona para la que la api va a devolver 403. El selector
          es lo que sostiene el recorrido en modo demostracion, y ahi se queda. */}
      {session.status !== 'demo' ? null : (
      <Stack gap={10} style={{ marginTop: 20 }}>
        <Eyebrow>Rol de la sesión</Eyebrow>
        {ROLES.map((option) => (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: role === option.value }}
            onPress={() => {
              setRole(option.value);
              router.replace(option.value === 'student' ? '/student' : '/staff');
            }}
          >
            <Card
              radius={theme.radii.lg}
              borderColor={role === option.value ? theme.semaphore.ok : theme.colors.hairline}
            >
              <Row>
                <Stack gap={1} style={{ flex: 1 }}>
                  <Text variant="heading" weight="semibold">
                    {option.label}
                  </Text>
                  <Text variant="captionSmall" color={theme.colors.textSecondary}>
                    {option.hint}
                  </Text>
                </Stack>
                {role === option.value ? <Dot color={theme.semaphore.ok} size={10} /> : null}
              </Row>
            </Card>
          </Pressable>
        ))}
        <Text variant="micro" color={theme.colors.textFaint}>
          En producción el rol lo define la sesión, no la persona. Este selector existe mientras no
          hay api.
        </Text>
      </Stack>
      )}

        {/* La sesion de demostracion no tenia salida: se entraba desde la
            puerta de desarrollo y no habia forma de volver. Los datos falsos
            —Mathyu Quispe y sus tres gimnasios— se veian como si vinieran del
            servidor, que es exactamente la confusion que provocaba. */}
        {session.status === 'demo' && (
          <Stack gap={10} style={{ marginTop: 24 }}>
            <Eyebrow color={theme.semaphore.warn}>Estás en modo demostración</Eyebrow>
            <Text variant="captionSmall" color={theme.colors.textSecondary}>
              Los datos que ves son inventados y viven dentro de la app. Sal para
              entrar con tu cuenta real.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                void signOut({ forgetTotpSecret: false }).then(() => {
                  resetState();
                  router.replace('/login');
                });
              }}
            >
              <Card radius={theme.radii.lg} borderColor={theme.semaphore.warn}>
                <Text variant="bodySmall" weight="semibold" color={theme.semaphore.warn}>
                  Salir del modo demostración
                </Text>
              </Card>
            </Pressable>
          </Stack>
        )}

        {/* El modo staff no tenia salida: las pantallas de la puerta no llevaban
            a ajustes, y con sesion de staff el enrutado ademas rebotaba
            `/settings` a `/staff`. Cerrar sesion era imposible sin desinstalar. */}
        {(session.status === 'signed_in' || session.status === 'unlinked') && (
          <Stack gap={10} style={{ marginTop: 24 }}>
            <Eyebrow>Sesión</Eyebrow>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                // El secreto del QR se olvida al salir el ALUMNO: si presta el
                // telefono, el siguiente no debe poder generar su codigo. Con
                // sesion de staff no se toca: el secreto es del dueño de este
                // telefono como alumno, y cerrar su sesion de trabajo no tiene
                // por que borrarselo.
                void signOut({ forgetTotpSecret: !isStaffSession }).then(() => {
                  resetState();
                  router.replace('/login');
                });
              }}
            >
              <Card radius={theme.radii.lg}>
                <Text variant="bodySmall" weight="semibold" color={theme.semaphore.bad}>
                  Cerrar sesión
                </Text>
              </Card>
            </Pressable>

            {/* El camino de baja DENTRO de la app que exige Google Play. Va aquí
                y no en un menú aparte porque es donde se busca: quien quiere
                irse abre ajustes y mira debajo de «cerrar sesión». Discreto a
                propósito —sin recuadro y en texto terciario— para no ofrecer la
                baja a quien solo venía a cambiar el tema. */}
            {/* Solo con sesión: la baja la pide `/me`, y la cuenta sin ficha
                todavía no tiene cómo pedirla desde aquí. */}
            {session.status === 'signed_in' ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/delete-account')}
              hitSlop={8}
              style={{ paddingVertical: 6, alignSelf: 'flex-start' }}
            >
              <Text variant="captionSmall" color={theme.colors.textTertiary}>
                Eliminar mi cuenta
              </Text>
            </Pressable>
            ) : null}
          </Stack>
        )}

      {/* Reinicia el store a `demo.ts`. Con sesion real solo consigue pintar
          datos inventados encima de los del gimnasio hasta la siguiente carga. */}
      {session.status === 'demo' && (
        <Stack gap={10} style={{ marginTop: 24 }}>
          <Eyebrow>Datos de demostración</Eyebrow>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              // Recarga la demostracion, no vacia el store: quien toca esto
              // esta DENTRO del modo demostracion y quiere empezarlo de nuevo.
              loadDemo();
              router.replace('/');
            }}
          >
            <Card radius={theme.radii.lg}>
              <Text variant="bodySmall" weight="semibold" color={theme.semaphore.bad}>
                Reiniciar datos
              </Text>
            </Card>
          </Pressable>
        </Stack>
      )}
    </Screen>
  );
}

/**
 * Tus datos: el nombre y el celular, para corregirlos.
 *
 * Cualquier cuenta los edita, porque son de la persona y no del local. La
 * identidad es una sola para toda la red: lo que corrige aquí es lo que ven los
 * gimnasios en su padrón. El documento se muestra y no se toca —lo lee el
 * gimnasio del carné, y es lo que ancla quién es quién—.
 *
 * Los datos se piden a `/me` y no al store: con sesión de staff el store no
 * tiene la billetera de nadie, y enseñaría el nombre de la demostración.
 */
function AccountDetails() {
  const theme = useTheme();
  const session = useSession();
  const [saved, setSaved] = useState<{
    readonly name: string;
    readonly phone: string;
    readonly documentId: string | null;
  } | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [notice, setNotice] = useState<{ readonly ok: boolean; readonly text: string } | null>(
    null,
  );

  const show = (current: NonNullable<typeof saved>): void => {
    setSaved(current);
    setName(current.name);
    setPhone(current.phone);
  };

  useEffect(() => {
    if (session.status === 'unlinked') {
      show({ name: session.fullName ?? '', phone: session.phone ?? '', documentId: null });
      return;
    }
    if (session.status !== 'signed_in') return;

    let vivo = true;
    void fetchMe().then(
      (me) => {
        if (vivo) show({ name: me.user.name, phone: me.user.phone, documentId: me.user.documentId });
      },
      () => {
        // Sin respuesta no se ofrece editar: un formulario vacío invitaría a
        // guardar un nombre en blanco encima del de verdad.
      },
    );
    return () => {
      vivo = false;
    };
    // Solo al cambiar de estado: los datos de la sesión sin ficha cambian al
    // guardar, y volver a copiarlos pisaría lo que se está escribiendo.
  }, [session.status]);

  if (saved === null) return null;

  const denial = checkAccountDetails({ name, phone });
  const changed =
    name.trim() !== saved.name.trim() ||
    normalizePhoneNumber(phone) !== normalizePhoneNumber(saved.phone);
  const message = denial === null ? undefined : accountDetailsDenialMessage(denial);

  const save = (): void => {
    setSaving(true);
    setNotice(null);
    void saveMyDetails({ name, phone })
      .then(() => {
        show({ ...saved, name: name.trim(), phone: normalizePhoneNumber(phone) });
        setAttempted(false);
        setNotice({
          ok: true,
          text:
            session.status === 'unlinked'
              ? 'Guardado.'
              : 'Guardado: tus gimnasios ya ven estos datos.',
        });
      })
      .catch((causa: unknown) =>
        setNotice({ ok: false, text: causa instanceof Error ? causa.message : 'No se pudo guardar.' }),
      )
      .finally(() => setSaving(false));
  };

  return (
    <Stack gap={10} style={{ marginTop: 16 }}>
      <Eyebrow>Tus datos</Eyebrow>
      <Card radius={theme.radii.xl}>
        <Stack gap={14}>
          <Field
            label="Tu nombre"
            value={name}
            onChangeText={(text) => {
              setName(text);
              setNotice(null);
            }}
            placeholder="Nombre y apellido"
            autoComplete="name"
            error={attempted && denial?.startsWith('name') === true ? message : undefined}
          />
          <PhoneField
            label="Tu celular"
            value={phone}
            onChange={(next) => {
              setPhone(next);
              setNotice(null);
            }}
            hint="Es con lo que los gimnasios te reconocen."
            error={attempted && denial !== null && !denial.startsWith('name') ? message : undefined}
          />
          {saved.documentId === null ? null : (
            <Row>
              <Stack gap={2} style={{ flex: 1 }}>
                <Text variant="captionSmall" color={theme.colors.textSecondary}>
                  Documento
                </Text>
                <Text variant="micro" color={theme.colors.textFaint}>
                  Lo corrige tu gimnasio: lo lee de tu carné.
                </Text>
              </Stack>
              <Text variant="bodySmall" weight="semibold">
                {saved.documentId}
              </Text>
            </Row>
          )}
          <Button
            label={saving ? 'Guardando…' : 'Guardar cambios'}
            disabled={!changed || denial !== null || saving}
            onBlockedPress={changed && !saving ? () => setAttempted(true) : undefined}
            onPress={save}
          />
          {notice === null ? null : (
            <Text
              variant="captionSmall"
              color={notice.ok ? theme.semaphore.ok : theme.semaphore.bad}
              align="center"
            >
              {notice.text}
            </Text>
          )}
        </Stack>
      </Card>
    </Stack>
  );
}
