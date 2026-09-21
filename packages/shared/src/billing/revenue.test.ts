import { describe, expect, it } from 'vitest';
import {
  compareRevenue,
  computeRevenue,
  previousRange,
  type RevenueEntry,
} from './revenue.js';
import { cents } from '../money/cents.js';
import { plainDate } from '../time/plain-date.js';
import { TZ_LIMA } from '../time/zone.js';

/** Un cobro. Por defecto cobrado en efectivo: el caso del mostrador. */
const charge = (
  iso: string,
  amount: number,
  overrides: Partial<RevenueEntry> = {},
): RevenueEntry => ({
  at: new Date(iso),
  type: 'renewal',
  rail: 'cash',
  amountCents: cents(amount),
  status: 'succeeded',
  ...overrides,
});

const RANGE = {
  from: plainDate(2026, 9, 1),
  through: plainDate(2026, 9, 30),
  bucket: 'day' as const,
  timezone: TZ_LIMA,
};

describe('que cuenta como ingreso', () => {
  it('solo suma lo cobrado: pendiente y fallido no son plata', () => {
    const report = computeRevenue({
      ...RANGE,
      entries: [
        charge('2026-09-10T15:00:00Z', 15000),
        charge('2026-09-10T16:00:00Z', 9900, { status: 'pending' }),
        charge('2026-09-10T17:00:00Z', 20000, { status: 'failed' }),
      ],
    });

    expect(report.totalCents).toBe(15000);
    expect(report.count).toBe(1);
  });

  it('descarta lo que cae fuera del rango, aunque venga en la lista', () => {
    // La regla vive aqui y no en el `where` de la consulta: asi una consulta
    // que se olvide del rango no puede inventar ingresos.
    const report = computeRevenue({
      ...RANGE,
      entries: [
        charge('2026-08-31T20:00:00Z', 10000),
        charge('2026-09-15T15:00:00Z', 15000),
        charge('2026-10-01T15:00:00Z', 30000),
      ],
    });

    expect(report.totalCents).toBe(15000);
  });
});

describe('el dia es el del gimnasio, no el de UTC', () => {
  it('el cobro de las 8 de la noche del 30 no se va al mes siguiente', () => {
    // 2026-09-30 20:00 en Lima son las 01:00 UTC del 1 de octubre. Agrupando
    // por UTC, la caja de la noche —que es cuando el dojo cobra— se sale del mes.
    const report = computeRevenue({
      ...RANGE,
      entries: [charge('2026-10-01T01:00:00Z', 15000)],
    });

    expect(report.totalCents).toBe(15000);
    const last = report.series.at(-1);
    expect(last?.date).toEqual(plainDate(2026, 9, 30));
    expect(last?.amountCents).toBe(15000);
  });
});

describe('la serie', () => {
  it('trae un punto por dia, tambien los que no facturaron', () => {
    // El hueco ES el dato: sin los ceros, tres cobros salteados dibujan una
    // semana constante y esconden los dias muertos.
    const report = computeRevenue({
      ...RANGE,
      entries: [charge('2026-09-01T15:00:00Z', 10000), charge('2026-09-03T15:00:00Z', 20000)],
    });

    expect(report.series).toHaveLength(30);
    expect(report.series[0]?.amountCents).toBe(10000);
    expect(report.series[1]?.amountCents).toBe(0);
    expect(report.series[1]?.count).toBe(0);
    expect(report.series[2]?.amountCents).toBe(20000);
  });

  it('por mes agrupa en el dia 1 y cubre el ano entero', () => {
    const report = computeRevenue({
      entries: [charge('2026-02-14T15:00:00Z', 50000), charge('2026-02-20T15:00:00Z', 10000)],
      from: plainDate(2026, 1, 1),
      through: plainDate(2026, 12, 31),
      bucket: 'month',
      timezone: TZ_LIMA,
    });

    expect(report.series).toHaveLength(12);
    expect(report.series[1]).toEqual({
      date: plainDate(2026, 2, 1),
      amountCents: 60000,
      count: 2,
    });
  });

  it('un rango que empieza a mitad de mes cuenta ese mes entero', () => {
    const report = computeRevenue({
      entries: [],
      from: plainDate(2026, 3, 17),
      through: plainDate(2026, 5, 2),
      bucket: 'month',
      timezone: TZ_LIMA,
    });

    expect(report.series.map((point) => point.date)).toEqual([
      plainDate(2026, 3, 1),
      plainDate(2026, 4, 1),
      plainDate(2026, 5, 1),
    ]);
  });

  it('senala el mejor dia, y es null cuando no entro nada', () => {
    const vacio = computeRevenue({ ...RANGE, entries: [] });
    expect(vacio.best).toBeNull();
    expect(vacio.series).toHaveLength(30);

    const report = computeRevenue({
      ...RANGE,
      entries: [charge('2026-09-04T15:00:00Z', 10000), charge('2026-09-09T15:00:00Z', 30000)],
    });
    expect(report.best?.date).toEqual(plainDate(2026, 9, 9));
  });
});

describe('los desgloses', () => {
  const report = computeRevenue({
    ...RANGE,
    entries: [
      charge('2026-09-02T15:00:00Z', 15000, { type: 'renewal', rail: 'yape' }),
      charge('2026-09-03T15:00:00Z', 15000, { type: 'renewal', rail: 'cash' }),
      charge('2026-09-04T15:00:00Z', 5000, { type: 'enrollment', rail: 'cash' }),
      charge('2026-09-05T15:00:00Z', 2000, { type: 'drop_in', rail: 'yape' }),
    ],
  });

  it('ordena de mas a menos: lo primero es por donde entra la plata', () => {
    expect(report.byType.map((slice) => slice.key)).toEqual(['renewal', 'enrollment', 'drop_in']);
    expect(report.byType[0]?.amountCents).toBe(30000);
    expect(report.byType[0]?.count).toBe(2);
  });

  it('los dos desgloses miden el mismo dinero sobre la misma base', () => {
    const porTipo = report.byType.reduce((acc, slice) => acc + slice.amountCents, 0);
    const porMedio = report.byRail.reduce((acc, slice) => acc + slice.amountCents, 0);

    expect(porTipo).toBe(report.totalCents);
    expect(porMedio).toBe(report.totalCents);
  });

  it('no inventa filas en cero para lo que el gimnasio no cobra', () => {
    // Este dojo no acepta tarjeta ni transferencia: no tiene por que leerlas.
    expect(report.byRail.map((slice) => slice.key)).toEqual(['cash', 'yape']);
  });

  it('el porcentaje va sobre el total', () => {
    const yape = report.byRail.find((slice) => slice.key === 'yape');
    // 17000 de 37000 = 45.9% -> 46
    expect(yape?.share).toBe(46);
  });
});

describe('comparar con el periodo anterior', () => {
  it('sin periodo anterior el porcentaje es null, no 0 ni 100', () => {
    // Son dos mentiras distintas sobre lo mismo: que no se sabe.
    expect(compareRevenue(cents(50000), cents(0))).toEqual({
      deltaCents: 50000,
      percent: null,
    });
  });

  it('una caida sale negativa', () => {
    expect(compareRevenue(cents(30000), cents(60000))).toEqual({
      deltaCents: -30000,
      percent: -50,
    });
  });

  it('el rango anterior es del mismo tamano y va pegado', () => {
    // Septiembre entero (30 dias) -> los 30 dias anteriores, no «agosto».
    expect(previousRange(plainDate(2026, 9, 1), plainDate(2026, 9, 30))).toEqual({
      from: plainDate(2026, 8, 2),
      through: plainDate(2026, 8, 31),
    });
  });

  it('un solo dia se compara con el dia anterior', () => {
    expect(previousRange(plainDate(2026, 9, 10), plainDate(2026, 9, 10))).toEqual({
      from: plainDate(2026, 9, 9),
      through: plainDate(2026, 9, 9),
    });
  });
});
