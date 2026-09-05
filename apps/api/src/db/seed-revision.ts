/**
 * El gimnasio de demostracion que revisa Google Play.
 *
 * Play exige credenciales para «acceder a las partes restringidas de la app», y
 * la app entera esta detras del login. Sin esto, quien la revisa se queda en la
 * pantalla de entrar y la version se rechaza sin haberla visto.
 *
 * La cuenta es dueña **y** alumna del mismo local, que es justo el caso que el
 * cambio de modo hizo posible: con un solo correo el revisor recorre el padron,
 * los planes y los reportes, y con un toque en ajustes ve la billetera, el QR y
 * el historial. Dos lados del producto sin dos cuentas que mantener.
 *
 *   npm run db:seed:revision -w @sinchi/api
 *
 * Es idempotente por slug, igual que el alta de un gimnasio real: correrlo dos
 * veces no toca nada. Para retirarlo:
 *
 *   npm run db:purge -w @sinchi/api -- sinchi-demo --yes
 *
 * ## Por que va por script y no por el alta publica de la app
 *
 * `POST /gyms/signup` comprueba el RUC de verdad —modulo 11 con los pesos de
 * SUNAT— y ahi esta el problema: **cualquier numero de once digitos que pase ese
 * check es, con casi total seguridad, el de un contribuyente real**, y con
 * prefijo 10 lleva dentro el DNI de una persona. Inventar uno para un gimnasio
 * que no existe seria escribir el identificador tributario de un tercero en
 * produccion.
 *
 * Asi que el RUC queda en un placeholder que NO pasa el check y por eso mismo no
 * puede confundirse con el de nadie. Es la misma decision que Kaizen, que vive
 * con `taxId: 'PENDIENTE'` hasta que el club de el suyo. El DNI y el celular van
 * por lo mismo: ceros, que ninguna persona tiene.
 *
 * ## Y por que el `firebase_uid` se ata aqui
 *
 * El auto-vinculo del dueño por correo exige `email_verified`, y una cuenta de
 * correo/contraseña nace sin verificar — el buzon de sinchi.fit ni siquiera
 * existe, el dominio no tiene MX. Sin atarlo, entrar con ese correo devolveria
 * el codigo de 6 digitos y mandaria al revisor a un mostrador que no hay.
 *
 * Atarlo aqui no abre ninguna puerta nueva: es exactamente lo que hace la
 * recepcionista al confirmar el codigo, escrito de antemano porque en este local
 * no hay recepcionista.
 */
import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { createDatabase, createPool, schema, withoutTenantIsolation } from './client';
import { LUN, MAR, MIE, JUE, VIE, SAB, seedGym, seedOwner, type GimnasioSpec } from './seed-gym';

/** La cuenta que se escribe en el formulario de Play. */
const REVISOR = {
  email: 'revisor@sinchi.fit',
  name: 'Cuenta de demostración',
  /** Ceros: ninguna persona tiene este DNI, y la api solo exige 6 caracteres. */
  documentId: '00000000',
  /** Ceros por lo mismo. `users.phone` es unico, asi que no puede repetirse. */
  phone: '+51900000000',
} as const;

const DEMO: GimnasioSpec = {
  slug: 'sinchi-demo',
  // Que el nombre lo diga. Sale en el directorio publico junto a los gimnasios
  // de verdad, y quien lo vea tiene que entender de una que no es uno de ellos.
  name: 'Sinchi Demo (gimnasio de demostración)',
  // No pasa el digito verificador de SUNAT, a proposito. Ver la cabecera.
  taxId: '20000000000',
  enrollmentSoles: 0,
  planes: [
    { name: '2 veces por semana', type: 'sessions_per_week', sessionsPerWeek: 2, soles: 120 },
    { name: '3 veces por semana', type: 'sessions_per_week', sessionsPerWeek: 3, soles: 150 },
    { name: 'Cualquier día', type: 'unlimited', sessionsPerWeek: null, soles: 180 },
  ],
  // Sin horarios el directorio enseña «0 clases por semana» y la clase de prueba
  // no tiene nada que reservar: la tarjeta del local sale vacia.
  horarios: [
    { name: 'Clase general', weekday: LUN, startTime: '19:00', endTime: '20:00' },
    { name: 'Clase general', weekday: MAR, startTime: '19:00', endTime: '20:00' },
    { name: 'Clase general', weekday: MIE, startTime: '19:00', endTime: '20:00' },
    { name: 'Clase general', weekday: JUE, startTime: '19:00', endTime: '20:00' },
    { name: 'Clase general', weekday: VIE, startTime: '19:00', endTime: '20:00' },
    { name: 'Clase general', weekday: SAB, startTime: '10:00', endTime: '11:00' },
  ],
};

/**
 * Ata la cuenta de Firebase a la identidad del dueño.
 *
 * Idempotente y **no pisa**: si ya hay un uid puesto y es otro, se queja en vez
 * de reemplazarlo. Sobrescribirlo en silencio es como se le roba la cuenta a
 * alguien, y un script que corre contra produccion no puede hacer eso por
 * descuido.
 */
async function linkFirebaseUid(email: string, uid: string): Promise<void> {
  const pool = createPool(process.env.DATABASE_URL!);
  const db = createDatabase(pool);

  try {
    await withoutTenantIsolation(db, async (tx) => {
      const [user] = await tx
        .select({ id: schema.users.id, firebaseUid: schema.users.firebaseUid })
        .from(schema.users)
        .where(eq(schema.users.email, email))
        .limit(1);

      if (user === undefined) throw new Error(`No hay ninguna identidad con ${email}.`);

      if (user.firebaseUid === uid) {
        console.log('[revision] la cuenta de Firebase ya estaba atada');
        return;
      }

      if (user.firebaseUid !== null) {
        throw new Error(
          `${email} ya está atado a otra cuenta de Firebase (${user.firebaseUid}). ` +
            'No se pisa: desvincúlalo desde la app si de verdad quieres cambiarlo.',
        );
      }

      await tx.update(schema.users).set({ firebaseUid: uid }).where(eq(schema.users.id, user.id));
      console.log(`[revision] cuenta de Firebase atada: ${uid}`);
    });
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const uid = process.argv[2];
  if (uid === undefined) {
    console.error(
      'Falta el uid de Firebase de la cuenta del revisor.\n\n' +
        '  npm run db:seed:revision -w @sinchi/api -- <uid>\n\n' +
        'Se obtiene al crear la cuenta con `accounts:signUp` de Identity Toolkit,\n' +
        'o en la consola de Firebase > Authentication.',
    );
    process.exit(1);
  }

  const { tenantId, created } = await seedGym(DEMO);
  await seedOwner({ tenantId, ...REVISOR });
  await linkFirebaseUid(REVISOR.email, uid);

  console.log(`\n[revision] ${created ? 'gimnasio creado' : 'gimnasio ya existía'}: ${tenantId}`);
  console.log(`[revision] entra con ${REVISOR.email}`);
  console.log(
    '[revision] falta inscribirlo como alumno de su propio local: se hace desde la app,\n' +
      `           padrón > + Alumno, con el documento ${REVISOR.documentId}.`,
  );
}

void main().then(
  () => process.exit(0),
  (e: unknown) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  },
);
