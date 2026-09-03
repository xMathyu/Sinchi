/**
 * `@sinchi/shared` — tipos y reglas puras del dominio.
 *
 * Lo que vive aqui lo consumen las tres superficies (app, panel web, api).
 * Escribir el prorrateo o el cupo semanal dos veces es el bug que se descubre
 * en el estado de cuenta de un cliente tres meses despues (MD 9).
 */

// Tiempo
export * from './time/zone.js';
export * from './time/plain-date.js';
export * from './time/iso-week.js';

// Dinero
export * from './money/cents.js';

// Dominio
export * from './domain/types.js';
export * from './domain/membership-status.js';

// Cobro
export * from './billing/cycle.js';
export * from './billing/proration.js';
export * from './billing/plan-change.js';
export * from './billing/dunning.js';
export * from './billing/receivable.js';

// Check-in
export * from './checkin/quota.js';
export * from './checkin/validate.js';
export * from './checkin/messages.js';

// Clase gratis
export * from './trial/slots.js';
export * from './trial/validate.js';

// Seguridad
export * from './security/totp.js';

// Suscripcion del gimnasio a Sinchi
export * from './saas/subscription.js';
export * from './saas/promo.js';

// Identidad tributaria
export * from './identity/ruc.js';
