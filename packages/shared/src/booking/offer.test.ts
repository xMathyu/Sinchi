import { describe, expect, it } from 'vitest';
import { bookingOffer, dropInClassPrice, offersAnything, type BookingOfferInput } from './offer.js';
import { makeDropInPlan, makeUnlimitedPlan, makeWeeklyPlan } from '../testing/fixtures.js';
import { cents } from '../money/cents.js';

const MENSUAL = makeUnlimitedPlan({ priceCents: cents(18_000) });
const DOS_VECES = makeWeeklyPlan(2, { priceCents: cents(12_000) });
const POR_CLASE = makeDropInPlan({ priceCents: cents(2_000) });

function input(overrides: Partial<BookingOfferInput> = {}): BookingOfferInput {
  return {
    trialClassEnabled: true,
    trialClassPriceCents: 0,
    dropInPriceCents: 2_500,
    enrollmentFeeCents: 5_000,
    plans: [MENSUAL, DOS_VECES],
    ...overrides,
  };
}

describe('lo que un gimnasio deja reservar desde el directorio', () => {
  it('la prueba sale de su interruptor y conserva su precio', () => {
    expect(bookingOffer(input({ trialClassEnabled: false })).trial).toBeNull();
    expect(bookingOffer(input({ trialClassPriceCents: 3_000 })).trial?.priceCents).toBe(3_000);
  });

  it('la prueba apagada no apaga lo demas', () => {
    // Era el hueco: un gimnasio sin prueba no dejaba hacer NADA desde su ficha.
    const offer = bookingOffer(input({ trialClassEnabled: false }));
    expect(offer.dropIn).not.toBeNull();
    expect(offer.enrollment).not.toBeNull();
    expect(offersAnything(offer)).toBe(true);
  });

  it('el plan por clase manda sobre el precio suelto del local', () => {
    // El del plan es el de quien no tiene mensualidad, que es quien reserva aqui.
    expect(dropInClassPrice([MENSUAL, POR_CLASE], 2_500)).toBe(2_000);
  });

  it('sin plan por clase se usa el precio del local', () => {
    expect(dropInClassPrice([MENSUAL], 2_500)).toBe(2_500);
  });

  it('una clase suelta a cero no se vende: eso es una prueba', () => {
    expect(dropInClassPrice([MENSUAL], 0)).toBeNull();
    expect(dropInClassPrice([MENSUAL], null)).toBeNull();
  });

  it('la inscripcion ofrece solo mensualidades activas, con la matricula', () => {
    const archivado = makeWeeklyPlan(3, { priceCents: cents(15_000), active: false });
    const offer = bookingOffer(input({ plans: [MENSUAL, POR_CLASE, archivado] }));

    expect(offer.enrollment?.plans).toEqual([MENSUAL]);
    expect(offer.enrollment?.enrollmentFeeCents).toBe(5_000);
  });

  it('un gimnasio que solo vende por clase no inscribe desde la app', () => {
    const offer = bookingOffer(input({ plans: [POR_CLASE] }));
    expect(offer.enrollment).toBeNull();
    expect(offer.dropIn?.priceCents).toBe(2_000);
  });

  it('sin nada que vender no hay horas que ofrecer', () => {
    const offer = bookingOffer(
      input({ trialClassEnabled: false, dropInPriceCents: null, plans: [] }),
    );
    expect(offersAnything(offer)).toBe(false);
  });
});
