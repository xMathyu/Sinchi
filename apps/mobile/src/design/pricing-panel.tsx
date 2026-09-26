/**
 * Lo que el local cobra aparte de los planes. Es la tercera pestaña de «Clases
 * y precios» (`app/offering.tsx`).
 *
 * Son cuatro números que hasta ahora solo existían en el seed y que deciden
 * plata todos los días. Van juntos porque se leen juntos: son la respuesta a
 * "¿cuánto cuesta entrar aquí?" que no cabe en un plan.
 *
 * El quinto, los días de gracia, no es un precio pero es la misma decisión vista
 * desde el otro lado: cuánto le aguanta el gimnasio a quien no pagó. Solo lo
 * cambiaba el panel de Sinchi, y un gimnasio lo pidió.
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
import { useEffect, useMemo, useState } from 'react';
import { Switch, View } from 'react-native';
import { GRACE_DAYS_MAX, graceChangeImpact } from '@sinchi/shared';
import { Button, Card, Divider, Eyebrow, Field, Row, Stack, Text } from './primitives';
import { useTheme } from './theme';
import { useGymPricing, useRoster } from '../data/hooks';
import { refreshDetails, saveGymPricing } from '../data/actions';

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

/** Días escritos a mano → entero dentro del rango, o `null` si no lo es. */
function aDias(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,2}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value <= GRACE_DAYS_MAX ? value : null;
}

/** Lo que el cambio de gracia hace hoy, en dos frases que pueden no hacer falta. */
function graceImpactText(impact: { readonly suspended: number; readonly reactivated: number }): {
  readonly suspended: string | null;
  readonly reactivated: string | null;
} {
  const { suspended: s, reactivated: r } = impact;
  return {
    suspended:
      s === 0
        ? null
        : s === 1
          ? 'Al guardar, 1 alumno que hoy entra en gracia dejará de poder entrar.'
          : `Al guardar, ${s} alumnos que hoy entran en gracia dejarán de poder entrar.`,
    reactivated:
      r === 0
        ? null
        : r === 1
          ? 'Al guardar, 1 alumno suspendido vuelve a estar en gracia y puede entrar.'
          : `Al guardar, ${r} alumnos suspendidos vuelven a estar en gracia y pueden entrar.`,
  };
}

export function PricingPanel({ isOwner }: { readonly isOwner: boolean }) {
  const theme = useTheme();
  const { pricing, reload } = useGymPricing();

  const [enrollmentFee, setEnrollmentFee] = useState('');
  const [dropInPrice, setDropInPrice] = useState('');
  const [allowOverflow, setAllowOverflow] = useState(false);
  const [pruebaActiva, setPruebaActiva] = useState(true);
  const [trialPrice, setTrialPrice] = useState('');
  const [graceDays, setGraceDays] = useState('');
  const [saving, setSaving] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (pricing === null) return;
    setEnrollmentFee(enSoles(pricing.enrollmentFeeCents));
    setDropInPrice(enSoles(pricing.dropInPriceCents));
    setAllowOverflow(pricing.quotaOverflowPolicy === 'offer_drop_in');
    setPruebaActiva(pricing.trialClassEnabled);
    setTrialPrice(enSoles(pricing.trialClassPriceCents));
    setGraceDays(pricing.graceDays === undefined ? '' : String(pricing.graceDays));
  }, [pricing]);

  /** Tocar cualquier campo después de guardar borra el «Guardado»: ya no es cierto. */
  const edit =
    <T,>(set: (value: T) => void) =>
    (value: T): void => {
      setSaved(false);
      set(value);
    };

  const dropInCents = aCentimos(dropInPrice);

  /**
   * Dejar pasar sin precio es el defecto que el QA visual encuentra siempre: la
   * puerta le diría al mostrador "cobrar clase suelta" sin cantidad, con el
   * alumno delante. Se apaga aquí y la api lo rechaza igual.
   */
  const priceMissing = allowOverflow && dropInCents === null;

  /**
   * La gracia solo se edita si la api la devolvió: contra una anterior no hay
   * número que enseñar, y mandar uno inventado cambiaría la puerta a ciegas.
   */
  const knowsGrace = pricing?.graceDays !== undefined;
  const graceValue = aDias(graceDays);
  const graceInvalid = knowsGrace && graceValue === null;
  const graceChanged = knowsGrace && graceValue !== null && graceValue !== pricing?.graceDays;

  /**
   * Lo que el cambio hace HOY en la puerta, antes de guardarlo.
   *
   * No espera al día siguiente: la gracia se aplica al leer cada ficha. Bajarla
   * deja fuera en ese instante a quien ayer entraba, y el dueño tiene que
   * enterarse aquí y no por el alumno en el mostrador.
   */
  const roster = useRoster();
  const impact = useMemo(
    () =>
      graceChanged && graceValue !== null
        ? graceImpactText(
            graceChangeImpact(
              roster.map((entry) => ({
                status: entry.view.delinquency.status,
                daysPastDue: entry.view.delinquency.daysPastDue,
              })),
              graceValue,
            ),
          )
        : null,
    [roster, graceChanged, graceValue],
  );

  async function save(): Promise<void> {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await saveGymPricing({
        enrollmentFeeCents: aCentimos(enrollmentFee) ?? 0,
        dropInPriceCents: dropInCents,
        quotaOverflowPolicy: allowOverflow ? 'offer_drop_in' : 'block',
        trialClassEnabled: pruebaActiva,
        trialClassPriceCents: aCentimos(trialPrice) ?? 0,
        ...(knowsGrace && graceValue !== null ? { graceDays: graceValue } : {}),
      });
      reload();
      // El padrón trae el semáforo que calculó el servidor con la gracia
      // anterior: sin volver a pedirlo, la puerta de ESTE equipo seguiría
      // dejando pasar a quien acaba de quedar fuera.
      if (graceChanged) void refreshDetails().catch(() => {});
      // Se queda en la pestaña y lo DICE. Antes esto era una pantalla y cerrarla
      // era la confirmación; dentro de «Clases y precios» cerrar se llevaría
      // también los planes y los horarios de delante.
      setSaved(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <View>
      <Text variant="captionSmall" color={theme.colors.textSecondary} style={{ marginTop: 6 }}>
        Lo que se cobra fuera de los planes —al inscribirse, al pasarse del cupo y al venir a
        conocer— y cuánto esperas a quien se atrasa.
      </Text>

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
            onChangeText={edit(setEnrollmentFee)}
            placeholder="0"
            keyboardType="decimal-pad"
            editable={isOwner}
            hint="Se cobra una sola vez, al dar de alta al alumno. Déjalo en 0 si no cobras."
          />
        </Card>
      </Stack>

      {knowsGrace ? (
        <Stack gap={10} style={{ marginTop: 20 }}>
          <Eyebrow>El que se atrasa con su mensualidad</Eyebrow>
          <Card radius={theme.radii.xl}>
            <Stack gap={10}>
              <Field
                label="Días de gracia"
                value={graceDays}
                onChangeText={edit(setGraceDays)}
                placeholder="5"
                keyboardType="number-pad"
                editable={isOwner}
                error={
                  graceInvalid ? `Escribe un número de días, de 0 a ${GRACE_DAYS_MAX}.` : undefined
                }
                hint="Los días que sigue entrando después de vencer su mensualidad. Pasados, la puerta deja de validarlo hasta que pague. 0 es cerrarle la puerta el mismo día."
              />
              {impact?.suspended != null ? (
                <Text variant="captionSmall" weight="semibold" color={theme.semaphore.warn}>
                  {impact.suspended}
                </Text>
              ) : null}
              {impact?.reactivated != null ? (
                <Text variant="captionSmall" weight="semibold" color={theme.semaphore.ok}>
                  {impact.reactivated}
                </Text>
              ) : null}
            </Stack>
          </Card>
        </Stack>
      ) : null}

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
                onValueChange={edit(setAllowOverflow)}
                disabled={!isOwner}
                accessibilityLabel="Dejar entrar pagando clase suelta"
                trackColor={{ true: theme.semaphore.ok, false: theme.colors.surfaceHigh }}
                thumbColor={theme.colors.controlThumb}
              />
            </Row>

            <Divider />

            <Field
              label="Precio de esa clase, en soles"
              value={dropInPrice}
              onChangeText={edit(setDropInPrice)}
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
                onValueChange={edit(setPruebaActiva)}
                disabled={!isOwner}
                accessibilityLabel="Ofrecer clase de prueba"
                trackColor={{ true: theme.semaphore.ok, false: theme.colors.surfaceHigh }}
                thumbColor={theme.colors.controlThumb}
              />
            </Row>

            <Divider />

            <Field
              label="Precio de la primera clase, en soles"
              value={trialPrice}
              onChangeText={edit(setTrialPrice)}
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
            disabled={saving || priceMissing || graceInvalid}
            style={{ marginTop: 20 }}
            onPress={() => void save()}
            onBlockedPress={saving ? undefined : () => setAttempted(true)}
          />
          {/* El campo que falta ya está en rojo, pero a media pantalla de
              distancia: quien llega hasta aquí abajo y toca «Guardar» ve un
              botón que no hace nada y no tiene por qué saber que la razón está
              arriba. */}
          {attempted && (priceMissing || graceInvalid) ? (
            <Text
              variant="caption"
              color={theme.semaphore.bad}
              align="center"
              style={{ marginTop: 10 }}
            >
              {priceMissing
                ? 'Falta el precio de la clase suelta, marcado arriba en rojo.'
                : 'Los días de gracia, marcados arriba en rojo, no son un número válido.'}
            </Text>
          ) : saved ? (
            <Text
              variant="caption"
              color={theme.semaphore.ok}
              align="center"
              style={{ marginTop: 10 }}
            >
              Guardado. Vale para los cobros de aquí en adelante.
            </Text>
          ) : null}
        </>
      )}

      <View style={{ height: 32 }} />
    </View>
  );
}
