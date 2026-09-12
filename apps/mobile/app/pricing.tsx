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
import { useGymPricing } from '../src/data/hooks';
import { useRole } from '../src/data/session-hooks';
import { saveGymPricing } from '../src/data/actions';

/** Soles escritos a mano → céntimos enteros. Vacío es `null`, que es "no se ofrece". */
function aCentimos(text: string): number | null {
  const trimmed = text.trim().replace(',', '.');
  if (trimmed.length === 0) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

const enSoles = (centimos: number | null): string =>
  centimos === null ? '' : String(centimos / 100);

export default function PricingScreen() {
  const theme = useTheme();
  // De la sesión: el del store llega con el padrón, y estas pantallas se
  // abren solas desde un enlace.
  const isOwner = useRole() === 'owner';
  const { pricing, reload } = useGymPricing();

  const [enrollmentFee, setEnrollmentFee] = useState('');
  const [dropInPrice, setDropInPrice] = useState('');
  const [allowOverflow, setAllowOverflow] = useState(false);
  const [pruebaActiva, setPruebaActiva] = useState(true);
  const [trialPrice, setTrialPrice] = useState('');
  const [saving, setSaving] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (pricing === null) return;
    setEnrollmentFee(enSoles(pricing.enrollmentFeeCents));
    setDropInPrice(enSoles(pricing.dropInPriceCents));
    setAllowOverflow(pricing.quotaOverflowPolicy === 'offer_drop_in');
    setPruebaActiva(pricing.trialClassEnabled);
    setTrialPrice(enSoles(pricing.trialClassPriceCents));
  }, [pricing]);

  const dropInCents = aCentimos(dropInPrice);

  /**
   * Dejar pasar sin precio es el defecto que el QA visual encuentra siempre: la
   * puerta le diría al mostrador "cobrar clase suelta" sin cantidad, con el
   * alumno delante. Se apaga aquí y la api lo rechaza igual.
   */
  const priceMissing = allowOverflow && dropInCents === null;

  async function save(): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      await saveGymPricing({
        enrollmentFeeCents: aCentimos(enrollmentFee) ?? 0,
        dropInPriceCents: dropInCents,
        quotaOverflowPolicy: allowOverflow ? 'offer_drop_in' : 'block',
        trialClassEnabled: pruebaActiva,
        trialClassPriceCents: aCentimos(trialPrice) ?? 0,
      });
      reload();
      router.back();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar.');
    } finally {
      setSaving(false);
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

      {!isOwner ? (
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
            value={enrollmentFee}
            onChangeText={setEnrollmentFee}
            placeholder="0"
            keyboardType="decimal-pad"
            editable={isOwner}
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
                value={allowOverflow}
                onValueChange={setAllowOverflow}
                disabled={!isOwner}
                accessibilityLabel="Dejar entrar pagando clase suelta"
                trackColor={{ true: theme.semaphore.ok, false: theme.colors.surfaceHigh }}
                thumbColor={theme.colors.ink}
              />
            </Row>

            <Divider />

            <Field
              label="Precio de esa clase, en soles"
              value={dropInPrice}
              onChangeText={setDropInPrice}
              placeholder="25"
              keyboardType="decimal-pad"
              editable={isOwner}
              optional={!allowOverflow}
              error={priceMissing ? 'Ponle precio: la puerta se lo va a pedir al mostrador.' : undefined}
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
                disabled={!isOwner}
                accessibilityLabel="Ofrecer clase de prueba"
                trackColor={{ true: theme.semaphore.ok, false: theme.colors.surfaceHigh }}
                thumbColor={theme.colors.ink}
              />
            </Row>

            <Divider />

            <Field
              label="Precio de la primera clase, en soles"
              value={trialPrice}
              onChangeText={setTrialPrice}
              placeholder="0"
              keyboardType="decimal-pad"
              editable={isOwner && pruebaActiva}
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

      {isOwner && (
        <>
          <Button
            label={saving ? 'Guardando…' : 'Guardar'}
            disabled={saving || priceMissing}
            style={{ marginTop: 20 }}
            onPress={() => void save()}
            onBlockedPress={saving ? undefined : () => setAttempted(true)}
          />
          {/* El campo que falta ya está en rojo, pero a media pantalla de
              distancia: quien llega hasta aquí abajo y toca «Guardar» ve un
              botón que no hace nada y no tiene por qué saber que la razón está
              arriba. */}
          {attempted && priceMissing ? (
            <Text
              variant="caption"
              color={theme.semaphore.bad}
              align="center"
              style={{ marginTop: 10 }}
            >
              Falta el precio de la clase suelta, marcado arriba en rojo.
            </Text>
          ) : null}
        </>
      )}

      <View style={{ height: 32 }} />
    </Screen>
  );
}
