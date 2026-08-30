/**
 * Alta de Fa Meng Chuen.
 *
 * Gimnasio real, no datos de demostracion: planes, precios y horarios salen de
 * sus propios flyers. Corre contra la base de produccion y **no borra nada**
 * (ver `seed-gym.ts`).
 *
 *   npm run db:seed:fa-meng-chuen -w @sinchi/api
 */
import 'dotenv/config';
import { DOM, SAB, seedGym, type GimnasioSpec } from './seed-gym';

/**
 * Vende de las dos formas, y en el modelo son dos cosas distintas:
 *
 *  · las DOS MODALIDADES son mensualidades, cada una con su precio;
 *  · la «clase libre» de S/40 NO es un plan sino el precio de la clase suelta
 *    del local (`drop_in`). Un plan crea suscripcion y fecha de cobro; una clase
 *    suelta es un cargo y se acaba ahi, que es exactamente lo que el flyer
 *    vende: "toma una clase suelta y vive el entrenamiento por un dia".
 *
 * Por eso tampoco ofrece la clase GRATIS de la app: su prueba ya tiene precio, y
 * regalarla seria vender por debajo de su propia lista. El dueno puede
 * encenderla cuando quiera desde «Clases gratis» en la app.
 */
const FA_MENG_CHUEN: GimnasioSpec = {
  slug: 'fa-meng-chuen',
  name: 'Fa Meng Chuen',
  // PENDIENTE: el RUC real lo tiene que dar el club. Se marca en vez de
  // inventarlo porque va en los comprobantes.
  taxId: 'PENDIENTE',
  dropInSoles: 40,
  // "Sin matrícula sorpresa", dice su propio flyer.
  enrollmentSoles: 0,
  trialClassEnabled: false,
  planes: [
    { name: 'Sanda', type: 'unlimited', sessionsPerWeek: null, soles: 240 },
    { name: 'Tai Chi', type: 'unlimited', sessionsPerWeek: null, soles: 220 },
  ],
  // Lo unico que el flyer publica: fin de semana. Si abren entre semana, se
  // agrega — un horario inventado hace que el escaner rechace a alumnos reales
  // por "fuera de horario".
  horarios: [
    { name: 'Tai Chi', weekday: SAB, startTime: '07:00', endTime: '08:00' },
    { name: 'Sanda', weekday: SAB, startTime: '08:15', endTime: '09:30' },
    { name: 'Tai Chi', weekday: DOM, startTime: '07:00', endTime: '08:00' },
    { name: 'Sanda', weekday: DOM, startTime: '08:15', endTime: '09:30' },
  ],
};

if (process.argv[1]?.includes('seed-fa-meng-chuen')) {
  void seedGym(FA_MENG_CHUEN).then(() => process.exit(0));
}

export { FA_MENG_CHUEN };
