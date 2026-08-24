/**
 * S5 · Registrar pago en mostrador.
 *
 * En la versión 1 es el único camino por el que entra dinero, así que es la
 * pantalla que sostiene el negocio del gimnasio.
 *
 * Lo importante es lo que dice el recuadro de abajo antes de confirmar: un pago
 * manual crea un cargo en el ledger y activa el MISMO ciclo que un cobro con
 * tarjeta — extiende la renovación, reactiva la suscripción y libera el
 * check-in (MD 4.5). Que el dinero haya entrado en efectivo no lo convierte en
 * un caso aparte, y el recepcionista tiene que ver esa consecuencia.
 */
import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import {
  ZERO,
  advanceBillingDate,
  cents,
  formatPEN,
  type ChargeType,
  type PaymentRail,
} from '@sinchi/shared';
import { semaphoreStyle, withAlpha } from '@sinchi/ui';
import {
  Avatar,
  Button,
  Card,
  Chip,
  Eyebrow,
  Row,
  Stack,
  Text,
} from '../../src/design/primitives';
import { Screen } from '../../src/design/screen';
import { useTheme } from '../../src/design/theme';
import { useMembership, useStore, useToday } from '../../src/data/hooks';
import { railLabel, recordManualPayment } from '../../src/data/store';
import { formatLongDate, initials } from '../../src/lib/format';

const CONCEPTS: readonly { readonly value: ChargeType; readonly label: string }[] = [
  { value: 'renewal', label: 'Mensualidad' },
  { value: 'enrollment', label: 'Matrícula' },
  { value: 'drop_in', label: 'Clase suelta' },
];

const RAILS: readonly PaymentRail[] = ['cash', 'yape', 'bank_transfer'];

export default function ChargeScreen() {
  const theme = useTheme();
  const today = useToday();
  const params = useLocalSearchParams<{ membershipId: string; type?: string }>();
  const entry = useMembership(params.membershipId);
  const staff = useStore((state) => state.staff);

  const [concept, setConcept] = useState<ChargeType>(
    params.type === 'drop_in' || params.type === 'enrollment' ? params.type : 'renewal',
  );
  const [rail, setRail] = useState<PaymentRail>('cash');
  const [periods, setPeriods] = useState(Math.max(1, entry.receivable.periodsOwed));
  const [customSoles, setCustomSoles] = useState(
    String((entry.tenant.dropInPriceCents ?? 0) / 100),
  );

  const semaphore = semaphoreStyle(theme, entry.level);
  const parsedCustom = Number(customSoles.replace(',', '.'));
  const customValid = Number.isFinite(parsedCustom) && parsedCustom > 0;

  // Aritmetica entera de punta a punta: el monto nunca pasa por soles decimales.
  // Lo unico que se convierte es lo que el recepcionista escribe.
  const amount =
    concept === 'renewal'
      ? cents(entry.plan.priceCents * periods)
      : customValid
        ? cents(Math.round(parsedCustom * 100))
        : ZERO;

  const nextBilling = (() => {
    let cursor = entry.subscription.nextBillingDate;
    for (let i = 0; i < periods; i += 1) {
      cursor = advanceBillingDate(cursor, entry.tenant.billingDatePolicy);
    }
    return cursor;
  })();

  const canConfirm = concept === 'renewal' ? true : customValid;

  return (
    <Screen scroll>
      <Row style={{ paddingTop: 8 }}>
        <Text variant="titleSmall" weight="bold">
          Registrar pago
        </Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()}>
          <Text variant="body" color={theme.colors.textSecondary}>
            Cancelar
          </Text>
        </Pressable>
      </Row>

      <Card radius={theme.radii.xl} style={{ marginTop: 16 }}>
        <Row gap={12} justify="flex-start">
          <Avatar initials={initials(nameOfMember(entry))} size={44} />
          <Stack gap={1} style={{ flex: 1 }}>
            <Text variant="heading" weight="semibold">
              {nameOfMember(entry)}
            </Text>
            <Text variant="captionSmall" color={semaphore.color}>
              {statusLine(entry)}
            </Text>
          </Stack>
        </Row>
      </Card>

      <Stack gap={10} style={{ marginTop: 18 }}>
        <Eyebrow>Concepto</Eyebrow>
        <Row gap={8} justify="flex-start" style={{ flexWrap: 'wrap' }}>
          {CONCEPTS.map((option) => (
            <Chip
              key={option.value}
              label={option.label}
              selected={concept === option.value}
              onPress={() => setConcept(option.value)}
            />
          ))}
        </Row>
      </Stack>

      <Card radius={theme.radii.xxl} style={{ marginTop: 18 }}>
        <Stack gap={6} style={{ alignItems: 'center' }}>
          <Eyebrow>Monto</Eyebrow>
          {concept === 'renewal' ? (
            <>
              <Text variant="hero" weight="black" style={{ fontSize: 52, lineHeight: 54 }}>
                {formatPEN(amount, { withDecimals: false })}
              </Text>
              <Text variant="captionSmall" color={theme.colors.textSecondary}>
                Periodo {formatLongDate(entry.subscription.nextBillingDate)} —{' '}
                {formatLongDate(nextBilling)}
              </Text>
              {entry.receivable.periodsOwed > 1 || periods > 1 ? (
                <Row gap={8} justify="center" style={{ marginTop: 8 }}>
                  <Chip
                    label="− mes"
                    onPress={() => setPeriods((value) => Math.max(1, value - 1))}
                  />
                  <Text variant="caption" color={theme.colors.textSecondary}>
                    {periods} {periods === 1 ? 'mes' : 'meses'}
                  </Text>
                  <Chip label="+ mes" onPress={() => setPeriods((value) => value + 1)} />
                </Row>
              ) : null}
            </>
          ) : (
            <>
              <Row gap={6} justify="center">
                <Text variant="hero" weight="black" style={{ fontSize: 44, lineHeight: 46 }}>
                  S/
                </Text>
                <TextInput
                  value={customSoles}
                  onChangeText={setCustomSoles}
                  keyboardType="decimal-pad"
                  accessibilityLabel="Monto en soles"
                  style={{
                    color: theme.colors.ink,
                    fontSize: 52,
                    fontWeight: '900',
                    minWidth: 120,
                    textAlign: 'center',
                  }}
                />
              </Row>
              <Text variant="captionSmall" color={theme.colors.textSecondary}>
                {concept === 'drop_in'
                  ? 'No extiende la mensualidad: habilita una sola sesión.'
                  : 'Cobro único de inscripción. No extiende la mensualidad.'}
              </Text>
            </>
          )}
        </Stack>
      </Card>

      <Stack gap={10} style={{ marginTop: 18 }}>
        <Eyebrow>Método</Eyebrow>
        <Row gap={8}>
          {RAILS.map((option) => {
            const active = rail === option;
            return (
              <Pressable
                key={option}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                onPress={() => setRail(option)}
                style={{
                  flex: 1,
                  alignItems: 'center',
                  paddingVertical: 14,
                  borderRadius: theme.radii.md,
                  backgroundColor: active ? theme.colors.surfaceHigh : theme.colors.surface,
                  borderWidth: active ? 1.5 : 1,
                  borderColor: active ? theme.semaphore.ok : theme.colors.border,
                }}
              >
                <Text
                  variant="caption"
                  weight={active ? 'semibold' : 'medium'}
                  color={active ? theme.colors.ink : theme.colors.textStrong}
                >
                  {railLabel(option) === 'transferencia' ? 'Transf.' : capitalize(railLabel(option))}
                </Text>
              </Pressable>
            );
          })}
        </Row>
      </Stack>

      <View
        style={{
          marginTop: 18,
          backgroundColor: withAlpha(theme.semaphore.ok, 0.07),
          borderWidth: 1,
          borderColor: withAlpha(theme.semaphore.ok, 0.2),
          borderRadius: theme.radii.lg,
          padding: 14,
        }}
      >
        <Text variant="captionSmall" color="#A9C9B4">
          {concept === 'renewal'
            ? `Al confirmar: se crea el cargo en el ledger, la renovación se extiende al ${formatLongDate(nextBilling)} y el QR de ${firstName(nameOfMember(entry))} vuelve a validar de inmediato.`
            : 'Al confirmar: se crea el cargo en el ledger a tu nombre. No cambia la fecha de renovación.'}
        </Text>
      </View>

      <Stack gap={8} style={{ marginTop: 20 }}>
        <Button
          label={`Confirmar ${formatPEN(amount, { withDecimals: false })} en ${railLabel(rail)}`}
          variant="accent"
          accentColor={theme.semaphore.ok}
          accentInk={theme.semaphoreInk.ok}
          disabled={!canConfirm}
          onPress={() => {
            recordManualPayment(
              {
                membershipId: entry.membership.id,
                type: concept,
                rail,
                periods: concept === 'renewal' ? periods : undefined,
                amountCents: concept === 'renewal' ? undefined : amount,
              },
              today,
            );
            router.back();
          }}
        />
        <Text variant="micro" color={theme.colors.textFaint} align="center">
          Queda registrado a nombre de {staff.displayName}.
        </Text>
      </Stack>
    </Screen>
  );
}

type Entry = ReturnType<typeof useMembership>;

const nameOfMember = (entry: Entry): string => entry.user.name;

function statusLine(entry: Entry): string {
  if (entry.delinquency.status === 'suspended') {
    return `Suspendido · mora de ${entry.delinquency.daysPastDue} días`;
  }
  if (entry.receivable.due) {
    return `En gracia · le quedan ${entry.delinquency.graceDaysLeft} días`;
  }
  return 'Al día';
}

const firstName = (name: string): string => name.trim().split(/\s+/)[0] ?? name;
const capitalize = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);
