/**
 * Lo que el local cobra aparte de los planes.
 *
 * Son cuatro números que hasta ahora solo existían en el seed y que deciden
 * plata todos los días. Van juntos porque se leen juntos: son la respuesta a
 * "¿cuánto cuesta entrar aquí?" que no cabe en un plan.
 *
 * La confusión que esta pantalla tiene que deshacer —y que ya se coló una vez en
 * el código— es que hay DOS clases sueltas y no son la misma:
 *
 *   · la de aquí la paga el alumno CON PLAN que agota su cupo de la semana;
 *   · la del que nunca tuvo cupo es un plan de tipo "clase suelta", con su
 *     propio precio, y vive en la pantalla de planes.
 *
 * Por eso el texto dice "el que se pasa de su cupo" y no "clase suelta" a secas.
 */
import { useEffect, useState } from 'react';
import { Pressable, Switch, View } from 'react-native';
import { router } from 'expo-router';
import { Button, Card, Divider, Eyebrow, Field, Row, Stack, Text } from '../src/design/primitives';
import { Screen } from '../src/design/screen';
import { useTheme } from '../src/design/theme';
import { usePreciosDelLocal, useStore } from '../src/data/hooks';
import { guardarPreciosDelLocal } from '../src/data/actions';

/** Soles escritos a mano → céntimos enteros. Vacío es `null`, que es "no se ofrece". */
function aCentimos(texto: string): number | null {
  const limpio = texto.trim().replace(',', '.');
  if (limpio.length === 0) return null;
  const valor = Number(limpio);
  if (!Number.isFinite(valor) || valor < 0) return null;
  return Math.round(valor * 100);
}

const enSoles = (centimos: number | null): string =>
  centimos === null ? '' : String(centimos / 100);

export default function PreciosScreen() {
  const theme = useTheme();
  const esDueno = useStore((s) => s.staff.role) === 'owner';
  const { precios, recargar } = usePreciosDelLocal();

  const [matricula, setMatricula] = useState('');
  const [claseSuelta, setClaseSuelta] = useState('');
  const [dejaPasar, setDejaPasar] = useState(false);
  const [pruebaActiva, setPruebaActiva] = useState(true);
  const [precioPrueba, setPrecioPrueba] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (precios === null) return;
    setMatricula(enSoles(precios.enrollmentFeeCents));
    setClaseSuelta(enSoles(precios.dropInPriceCents));
    setDejaPasar(precios.quotaOverflowPolicy === 'offer_drop_in');
    setPruebaActiva(precios.trialClassEnabled);
    setPrecioPrueba(enSoles(precios.trialClassPriceCents));
  }, [precios]);

  const centimosClaseSuelta = aCentimos(claseSuelta);

  /**
   * Dejar pasar sin precio es el defecto que el QA visual encuentra siempre: la
   * puerta le diría al mostrador "cobrar clase suelta" sin cantidad, con el
   * alumno delante. Se apaga aquí y la api lo rechaza igual.
   */
  const faltaPrecio = dejaPasar && centimosClaseSuelta === null;

  async function guardar(): Promise<void> {
    setGuardando(true);
    setError(null);
    try {
      await guardarPreciosDelLocal({
        enrollmentFeeCents: aCentimos(matricula) ?? 0,
        dropInPriceCents: centimosClaseSuelta,
        quotaOverflowPolicy: dejaPasar ? 'offer_drop_in' : 'block',
        trialClassEnabled: pruebaActiva,
        trialClassPriceCents: aCentimos(precioPrueba) ?? 0,
      });
      recargar();
      router.back();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar.');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Screen scroll>
      <Row style={{ paddingTop: 8 }}>
        <Text variant="titleSmall" weight="bold">
          Lo que cobras aparte
        </Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={16}>
          <Text variant="body" color={theme.colors.textSecondary}>
            Cerrar
          </Text>
        </Pressable>
      </Row>

      {!esDueno ? (
        <Card tone="sunken" style={{ marginTop: 20 }}>
          <Text variant="bodySmall" color={theme.colors.textSecondary}>
            Estos precios los decide el dueño. Aquí puedes verlos, que es lo que hace falta para
            cobrarlos.
          </Text>
        </Card>
      ) : null}

      <Stack gap={10} style={{ marginTop: 20 }}>
        <Eyebrow>Al inscribirse</Eyebrow>
        <Card radius={theme.radii.xl}>
          <Field
            label="Matrícula en soles"
            value={matricula}
            onChangeText={setMatricula}
            placeholder="0"
            keyboardType="decimal-pad"
            editable={esDueno}
            hint="Se cobra una sola vez, al dar de alta al alumno. Déjalo en 0 si no cobras."
          />
        </Card>
      </Stack>

      <Stack gap={10} style={{ marginTop: 20 }}>
        <Eyebrow>El que se pasa de su cupo</Eyebrow>
        <Card radius={theme.radii.xl}>
          <Stack gap={16}>
            <Row>
              <Stack gap={2} style={{ flex: 1, paddingRight: 12 }}>
                <Text variant="bodySmall" weight="semibold">
                  Dejarlo entrar pagando
                </Text>
                <Text variant="captionSmall" color={theme.colors.textSecondary}>
                  El alumno al día que ya usó sus sesiones de la semana. Apagado, la puerta le dice
                  que vuelva el lunes.
                </Text>
              </Stack>
              <Switch
                value={dejaPasar}
                onValueChange={setDejaPasar}
                disabled={!esDueno}
                accessibilityLabel="Dejar entrar pagando clase suelta"
                trackColor={{ true: theme.semaphore.ok, false: theme.colors.surfaceHigh }}
                thumbColor={theme.colors.ink}
              />
            </Row>

            <Divider />

            <Field
              label="Precio de esa clase, en soles"
              value={claseSuelta}
              onChangeText={setClaseSuelta}
              placeholder="25"
              keyboardType="decimal-pad"
              editable={esDueno}
              optional={!dejaPasar}
              error={faltaPrecio ? 'Ponle precio: la puerta se lo va a pedir al mostrador.' : undefined}
              hint="No es lo mismo que un plan de clase suelta. Ese es para quien no tiene mensualidad, y su precio va en el plan."
            />
          </Stack>
        </Card>
      </Stack>

      <Stack gap={10} style={{ marginTop: 20 }}>
        <Eyebrow>El que viene a conocer</Eyebrow>
        <Card radius={theme.radii.xl}>
          <Stack gap={16}>
            <Row>
              <Stack gap={2} style={{ flex: 1, paddingRight: 12 }}>
                <Text variant="bodySmall" weight="semibold">
                  Ofrecer clase de prueba
                </Text>
                <Text variant="captionSmall" color={theme.colors.textSecondary}>
                  Quien te encuentra en el directorio puede reservar una hora. Apagarla no cancela
                  lo ya reservado.
                </Text>
              </Stack>
              <Switch
                value={pruebaActiva}
                onValueChange={setPruebaActiva}
                disabled={!esDueno}
                accessibilityLabel="Ofrecer clase de prueba"
                trackColor={{ true: theme.semaphore.ok, false: theme.colors.surfaceHigh }}
                thumbColor={theme.colors.ink}
              />
            </Row>

            <Divider />

            <Field
              label="Precio de la primera clase, en soles"
              value={precioPrueba}
              onChangeText={setPrecioPrueba}
              placeholder="0"
              keyboardType="decimal-pad"
              editable={esDueno && pruebaActiva}
              optional
              hint="0 es gratis, que es lo normal: regalar la primera y cobrar las siguientes."
            />
          </Stack>
        </Card>
      </Stack>

      {error !== null && (
        <Card tone="sunken" borderColor={theme.semaphore.bad} style={{ marginTop: 16 }}>
          <Text variant="bodySmall" color={theme.semaphore.bad}>
            {error}
          </Text>
        </Card>
      )}

      {esDueno && (
        <Button
          label={guardando ? 'Guardando…' : 'Guardar'}
          disabled={guardando || faltaPrecio}
          style={{ marginTop: 20 }}
          onPress={() => void guardar()}
        />
      )}

      <View style={{ height: 32 }} />
    </Screen>
  );
}
