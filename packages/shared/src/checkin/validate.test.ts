import { describe, expect, it } from 'vitest';
import { validateCheckIn, type CheckInContext, type CheckInResult } from './validate.js';
import { accessMessage } from './messages.js';
import { computeQuota, weeklyLimit } from './quota.js';
import { fromSoles } from '../money/cents.js';
import { plainDate } from '../time/plain-date.js';
import {
  makeAttendances,
  makeDropInPlan,
  makeFixedDaysPlan,
  makeSchedule,
  makeSubscription,
  makeUnlimitedPlan,
  makeWeeklyPlan,
} from '../testing/fixtures.js';

// 2026-08-20 es jueves; 2026-08-22, sabado.
const JUEVES = plainDate(2026, 8, 20);
const SABADO = plainDate(2026, 8, 22);

function contexto(overrides: Partial<CheckInContext> = {}): CheckInContext {
  return {
    subscription: makeSubscription(),
    plan: makeWeeklyPlan(3),
    attendances: [],
    schedules: [],
    today: JUEVES,
    time: '19:00',
    graceDays: 5,
    quotaOverflowPolicy: 'block',
    ...overrides,
  };
}

describe('suscripcion al dia', () => {
  it('deja pasar con plan ilimitado', () => {
    const r = validateCheckIn(contexto({ plan: makeUnlimitedPlan() }));
    expect(r.allowed).toBe(true);
    expect(r.level).toBe('ok');
  });

  it('bloquea sin suscripcion', () => {
    const r = validateCheckIn(contexto({ subscription: null, plan: null }));
    expect(r.allowed).toBe(false);
    if (r.allowed) return;
    expect(r.reason.code).toBe('no_subscription');
    expect(r.level).toBe('blocked');
  });

  it('bloquea una suscripcion cancelada', () => {
    const r = validateCheckIn(
      contexto({ subscription: makeSubscription({ status: 'canceled' }) }),
    );
    expect(r.allowed).toBe(false);
  });

  it('bloquea por mora y explica cuanto debe', () => {
    const r = validateCheckIn(
      contexto({
        subscription: makeSubscription({ status: 'suspended' }),
        daysPastDue: 12,
        debtCents: fromSoles(120),
      }),
    );
    expect(r.allowed).toBe(false);
    if (r.allowed) return;
    expect(r.reason).toMatchObject({ code: 'delinquent', daysPastDue: 12 });

    const mensaje = accessMessage(r);
    expect(mensaje.title).toBe('Mora de 12 días');
    expect(mensaje.action).toBe('Cobrar S/ 120 en mostrador');
  });

  it('en gracia SI puede entrenar, con aviso', () => {
    const r = validateCheckIn(
      contexto({
        subscription: makeSubscription({ status: 'in_grace' }),
        daysPastDue: 2,
        graceDays: 5,
      }),
    );
    expect(r.allowed).toBe(true);
    expect(r.level).toBe('warn');
    if (!r.allowed) return;
    expect(r.warning).toEqual({ code: 'in_grace', graceDaysLeft: 3 });
  });
});

describe('dia permitido', () => {
  it('rechaza el sabado en un plan de lunes a viernes', () => {
    const r = validateCheckIn(
      contexto({
        plan: makeWeeklyPlan(2, { allowedDays: [1, 2, 3, 4, 5] }),
        today: SABADO,
      }),
    );
    expect(r.allowed).toBe(false);
    if (r.allowed) return;
    expect(r.reason.code).toBe('day_not_allowed');
    expect(r.level).toBe('alert');
    expect(accessMessage(r).reason).toBe('Sus días son lunes, martes, miércoles, jueves y viernes.');
  });

  it('acepta el dia fijo asignado', () => {
    // Jueves = 4.
    const r = validateCheckIn(contexto({ plan: makeFixedDaysPlan([2, 4]) }));
    expect(r.allowed).toBe(true);
  });

  it('rechaza un dia que no es el fijo', () => {
    const r = validateCheckIn(contexto({ plan: makeFixedDaysPlan([1, 3]) }));
    expect(r.allowed).toBe(false);
    if (r.allowed) return;
    expect(r.reason.code).toBe('day_not_allowed');
  });
});

describe('cupo semanal', () => {
  it('avisa en la ultima sesion', () => {
    const r = validateCheckIn(
      contexto({ plan: makeWeeklyPlan(3), attendances: makeAttendances(JUEVES, 2) }),
    );
    expect(r.allowed).toBe(true);
    expect(r.level).toBe('warn');
    if (!r.allowed) return;
    expect(r.warning).toEqual({ code: 'last_session', remaining: 1 });
    expect(accessMessage(r).title).toBe('Le queda 1 sesión');
  });

  it('rechaza cuando se agota', () => {
    const r = validateCheckIn(
      contexto({ plan: makeWeeklyPlan(3), attendances: makeAttendances(JUEVES, 3) }),
    );
    expect(r.allowed).toBe(false);
    if (r.allowed) return;
    expect(r.reason).toMatchObject({ code: 'quota_exhausted', limit: 3, used: 3 });
    expect(r.level).toBe('alert');
  });

  it('las sesiones de la semana anterior no cuentan', () => {
    // Semana pasada: el cupo NO se acumula ni se arrastra.
    const semanaPasada = plainDate(2026, 8, 13);
    const r = validateCheckIn(
      contexto({ plan: makeWeeklyPlan(2), attendances: makeAttendances(semanaPasada, 2) }),
    );
    expect(r.allowed).toBe(true);
  });

  it('ofrece clase suelta cuando el gimnasio lo permite', () => {
    const r = validateCheckIn(
      contexto({
        plan: makeWeeklyPlan(2),
        attendances: makeAttendances(JUEVES, 2),
        quotaOverflowPolicy: 'offer_drop_in',
        dropInPriceCents: fromSoles(25),
      }),
    );
    expect(r.allowed).toBe(false);
    if (r.allowed) return;
    expect(r.reason).toMatchObject({ code: 'quota_exhausted', offerDropIn: true });
    expect(accessMessage(r).action).toBe('Cobrar clase suelta S/ 25');
  });

  it('el plan ilimitado nunca agota', () => {
    const r = validateCheckIn(
      contexto({ plan: makeUnlimitedPlan(), attendances: makeAttendances(JUEVES, 12) }),
    );
    expect(r.allowed).toBe(true);
    expect(r.level).toBe('ok');
  });

  it('el plan de dias fijos deriva su limite de la cantidad de dias', () => {
    expect(weeklyLimit(makeFixedDaysPlan([2, 4]))).toBe(2);
    const cupo = computeQuota(makeFixedDaysPlan([2, 4]), makeAttendances(JUEVES, 2), JUEVES);
    expect(cupo.exhausted).toBe(true);
  });
});

describe('horario de clase', () => {
  const horarios = [makeSchedule(4, '19:00', '20:30'), makeSchedule(4, '07:00', '08:30')];

  it('deja pasar dentro de la clase', () => {
    const r = validateCheckIn(contexto({ schedules: horarios, time: '19:15' }));
    expect(r.allowed).toBe(true);
    if (!r.allowed) return;
    expect(r.classScheduleId).toBe(horarios[0]?.id);
  });

  it('acepta llegar dentro de la tolerancia', () => {
    const r = validateCheckIn(
      contexto({ schedules: horarios, time: '18:40', toleranceMinutes: 30 }),
    );
    expect(r.allowed).toBe(true);
  });

  it('rechaza fuera de horario e informa la proxima clase', () => {
    const r = validateCheckIn(contexto({ schedules: horarios, time: '15:00' }));
    expect(r.allowed).toBe(false);
    if (r.allowed) return;
    expect(r.reason).toMatchObject({ code: 'outside_schedule' });
    expect(accessMessage(r).reason).toContain('19:00');
  });

  it('sin horarios cargados no bloquea a nadie', () => {
    const r = validateCheckIn(contexto({ schedules: [], time: '03:00' }));
    expect(r.allowed).toBe(true);
  });
});

describe('orden de validacion', () => {
  it('la mora manda sobre el dia y sobre el cupo', () => {
    // Al moroso hay que decirle que debe plata, no que hoy no es su dia.
    const r = validateCheckIn(
      contexto({
        subscription: makeSubscription({ status: 'suspended' }),
        plan: makeFixedDaysPlan([1, 3]),
        attendances: makeAttendances(JUEVES, 5),
        today: SABADO,
      }),
    );
    expect(r.allowed).toBe(false);
    if (r.allowed) return;
    expect(r.reason.code).toBe('delinquent');
  });

  it('el dia no permitido manda sobre el cupo agotado', () => {
    const r = validateCheckIn(
      contexto({
        plan: makeWeeklyPlan(2, { allowedDays: [1, 3] }),
        attendances: makeAttendances(JUEVES, 5),
      }),
    );
    expect(r.allowed).toBe(false);
    if (r.allowed) return;
    expect(r.reason.code).toBe('day_not_allowed');
  });

  it('el cupo manda sobre el horario', () => {
    const r = validateCheckIn(
      contexto({
        plan: makeWeeklyPlan(2),
        attendances: makeAttendances(JUEVES, 2),
        schedules: [makeSchedule(4, '19:00', '20:30')],
        time: '03:00',
      }),
    );
    expect(r.allowed).toBe(false);
    if (r.allowed) return;
    expect(r.reason.code).toBe('quota_exhausted');
  });
});

describe('mensajes de acceso', () => {
  it('todo resultado tiene titulo y motivo legibles', () => {
    const casos = [
      contexto(),
      contexto({ subscription: makeSubscription({ status: 'suspended' }) }),
      contexto({ plan: makeFixedDaysPlan([1, 3]) }),
      contexto({ attendances: makeAttendances(JUEVES, 3) }),
      contexto({ schedules: [makeSchedule(4, '19:00', '20:30')], time: '03:00' }),
      contexto({ subscription: null, plan: null }),
    ];

    for (const caso of casos) {
      const mensaje = accessMessage(validateCheckIn(caso));
      expect(mensaje.title.length).toBeGreaterThan(0);
      expect(mensaje.reason.length).toBeGreaterThan(0);
      expect(['ok', 'warn', 'alert', 'blocked']).toContain(mensaje.level);
    }
  });
});

describe('cupo precalculado', () => {
  it('respeta el cupo que le pasa el llamador por encima de la lista', () => {
    // El servidor cuenta el consumo en SQL; la lista de asistencias llega vacia
    // a proposito. Sin `quotaOverride`, la validacion concluiria que nadie
    // entreno esta semana y dejaria pasar a un alumno con el cupo agotado.
    const plan = makeWeeklyPlan(2);
    const r = validateCheckIn(
      contexto({
        plan,
        attendances: [],
        quotaOverride: {
          limit: 2,
          used: 2,
          remaining: 0,
          exhausted: true,
          isLastSession: false,
          isoWeek: '2026-W34',
        },
      }),
    );
    expect(r.allowed).toBe(false);
    if (r.allowed) return;
    expect(r.reason).toMatchObject({ code: 'quota_exhausted', limit: 2, used: 2 });
  });

  it('sin cupo precalculado sigue contando las asistencias', () => {
    const r = validateCheckIn(
      contexto({ plan: makeWeeklyPlan(2), attendances: makeAttendances(JUEVES, 2) }),
    );
    expect(r.allowed).toBe(false);
  });
});

describe('las dos voces del mismo veredicto', () => {
  // El punto de que las dos vivan aqui: si cada pantalla escribiera la suya, el
  // alumno leeria una cosa y el recepcionista otra del MISMO check-in, y el que
  // discute en la puerta es el recepcionista.
  const conCupoAgotado = (): CheckInResult => ({
    allowed: false,
    level: 'alert',
    reason: {
      code: 'quota_exhausted',
      level: 'alert',
      limit: 2,
      used: 2,
      offerDropIn: false,
      dropInPriceCents: null,
    },
    quota: null,
  });

  it('describe al alumno para el staff y le habla a el en su app', () => {
    const paraElStaff = accessMessage(conCupoAgotado());
    const paraElAlumno = accessMessage(conCupoAgotado(), 'student');

    // El hecho es el mismo: mismo nivel, mismo titular.
    expect(paraElAlumno.level).toBe(paraElStaff.level);
    expect(paraElAlumno.title).toBe(paraElStaff.title);

    expect(paraElStaff.detail).toContain('no le quedan sesiones');
    expect(paraElAlumno.detail).toContain('no te quedan sesiones');
  });

  it('no le ofrece al alumno acciones que solo hace el mostrador', () => {
    const permitido: CheckInResult = {
      allowed: true,
      level: 'ok',
      warning: null,
      quota: { limit: null, used: 0, remaining: null, exhausted: false, isLastSession: false, isoWeek: '2026-W01' },
      classScheduleId: null,
    };

    // "Confirmar ingreso" lo pulsa quien esta en la puerta, no quien entra.
    expect(accessMessage(permitido).action).toBe('Confirmar ingreso');
    expect(accessMessage(permitido, 'student').action).toBeNull();

    expect(accessMessage(permitido).title).toBe('Puede pasar');
    expect(accessMessage(permitido, 'student').title).toBe('Puedes entrar');
  });
});

describe('clase suelta', () => {
  const plan = makeDropInPlan();

  it('no pasa sin haber pagado la clase de hoy', () => {
    const r = validateCheckIn(contexto({ plan }));
    expect(r.allowed).toBe(false);
    if (r.allowed) return;
    expect(r.reason.code).toBe('drop_in_unpaid');
    // `alert`, no `blocked`: no debe nada, le falta pagar lo de hoy.
    expect(r.level).toBe('alert');
  });

  it('pasa con la clase de hoy pagada', () => {
    const r = validateCheckIn(contexto({ plan, dropInPaidToday: true }));
    expect(r.allowed).toBe(true);
    expect(r.level).toBe('ok');
  });

  it('el motivo lleva el precio de UNA clase, que es lo que va a cobrar el mostrador', () => {
    const r = validateCheckIn(contexto({ plan: makeDropInPlan({ priceCents: fromSoles(30) }) }));
    if (r.allowed) throw new Error('debia rechazar');
    if (r.reason.code !== 'drop_in_unpaid') throw new Error('motivo equivocado');
    expect(r.reason.priceCents).toBe(fromSoles(30));
    expect(accessMessage(r).action).toContain('30');
  });

  it('sin el dato se asume NO pagada: la puerta no se abre por omision', () => {
    const ctx = contexto({ plan });
    expect(ctx.dropInPaidToday).toBeUndefined();
    expect(validateCheckIn(ctx).allowed).toBe(false);
  });

  it('no tiene cupo semanal: cuatro clases pagadas en la semana entran las cuatro', () => {
    expect(weeklyLimit(plan)).toBeNull();
    const r = validateCheckIn(
      contexto({
        plan,
        dropInPaidToday: true,
        attendances: makeAttendances(JUEVES, 3),
      }),
    );
    expect(r.allowed).toBe(true);
    expect(r.quota?.exhausted).toBe(false);
  });

  it('el dia no permitido gana al pago: primero se le dice que hoy no abre para el', () => {
    const soloFinde = makeDropInPlan({ allowedDays: [6, 7] });
    const r = validateCheckIn(contexto({ plan: soloFinde, dropInPaidToday: false }));
    if (r.allowed) throw new Error('debia rechazar');
    expect(r.reason.code).toBe('day_not_allowed');
  });

  it('la mora no le aplica, pero una suspension escrita a mano sigue mandando', () => {
    // El estado nunca deberia llegar a `suspended` con este plan —`computeReceivable`
    // corta antes—, y si llegara, la puerta obedece al estado. Es la garantia de
    // que ningun camino raro deja entrar a alguien suspendido.
    const r = validateCheckIn(
      contexto({
        plan,
        dropInPaidToday: true,
        subscription: makeSubscription({ status: 'suspended' }),
      }),
    );
    expect(r.allowed).toBe(false);
  });
});
