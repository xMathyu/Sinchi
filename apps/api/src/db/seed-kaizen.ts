/**
 * Alta de la Asociacion Deportiva Club Kaizen.
 *
 * Es un gimnasio real, no datos de demostracion: planes, precios y horarios
 * salen de sus propios flyers. Corre contra la base de produccion y **no borra
 * nada** — el como vive en `seed-gym.ts`, que es el mismo alta para cualquier
 * gimnasio; aqui solo estan sus datos.
 *
 *   npm run db:seed:kaizen -w @sinchi/api
 */
import 'dotenv/config';
import { JUE, LUN, MAR, MIE, SAB, VIE, seedGym, seedOwner, type GimnasioSpec } from './seed-gym';

const KAIZEN: GimnasioSpec = {
  slug: 'kaizen',
  name: 'Asociación Deportiva Club Kaizen',
  // PENDIENTE: el RUC real lo tiene que dar el club. Se marca en vez de
  // inventarlo porque va en los comprobantes.
  taxId: 'PENDIENTE',
  // La matricula es del gimnasio, no del plan: se cobra una vez al entrar y no
  // cambia segun cuantas veces por semana venga la persona.
  enrollmentSoles: 50,
  planes: [
    { name: '1 vez por semana', type: 'sessions_per_week', sessionsPerWeek: 1, soles: 120 },
    { name: '2 veces por semana', type: 'sessions_per_week', sessionsPerWeek: 2, soles: 150 },
    { name: '3 veces por semana', type: 'sessions_per_week', sessionsPerWeek: 3, soles: 180 },
    { name: 'Cualquier día', type: 'unlimited', sessionsPerWeek: null, soles: 200 },
  ],
  horarios: [
    // Judo Kids 4 a 7
    { name: 'Judo Kids (4 a 7 años)', weekday: MAR, startTime: '17:00', endTime: '18:00' },
    { name: 'Judo Kids (4 a 7 años)', weekday: JUE, startTime: '17:00', endTime: '18:00' },
    { name: 'Judo Kids (4 a 7 años)', weekday: SAB, startTime: '09:00', endTime: '10:00' },

    // Judo Kids 8 a 13
    { name: 'Judo Kids (8 a 13 años)', weekday: MAR, startTime: '18:00', endTime: '19:00' },
    { name: 'Judo Kids (8 a 13 años)', weekday: JUE, startTime: '18:00', endTime: '19:00' },
    { name: 'Judo Kids (8 a 13 años)', weekday: SAB, startTime: '10:00', endTime: '11:00' },

    // Judo adultos
    { name: 'Judo Adultos', weekday: LUN, startTime: '09:00', endTime: '10:00' },
    { name: 'Judo Adultos', weekday: MIE, startTime: '09:00', endTime: '10:00' },
    { name: 'Judo Adultos', weekday: VIE, startTime: '09:00', endTime: '10:00' },
    { name: 'Judo Adultos', weekday: SAB, startTime: '11:00', endTime: '13:00' },
    { name: 'Judo Adultos', weekday: MAR, startTime: '20:00', endTime: '21:00' },
    { name: 'Judo Adultos', weekday: JUE, startTime: '20:00', endTime: '21:00' },

    // Preparacion fisica
    { name: 'Preparación física', weekday: MAR, startTime: '08:00', endTime: '09:00' },
    { name: 'Preparación física', weekday: JUE, startTime: '08:00', endTime: '09:00' },
  ],
};

export const seedKaizen = (): Promise<{ tenantId: string; created: boolean }> =>
  seedGym(KAIZEN);

/** Registra al dueno para que pueda invitar. Idempotente. */
export const seedKaizenOwner = (input: {
  readonly tenantId: string;
  readonly name: string;
  readonly documentId: string;
  readonly phone: string;
  readonly email: string;
}): Promise<string> => seedOwner(input);

if (process.argv[1]?.includes('seed-kaizen')) {
  void seedKaizen().then(() => process.exit(0));
}

export { KAIZEN };
