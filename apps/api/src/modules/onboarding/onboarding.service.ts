/**
 * Alta de un gimnasio desde la app.
 *
 * Hasta aqui un gimnasio solo podia nacer de un script que corriamos nosotros
 * (`db:seed:kaizen`). Eso servia para los tres primeros clientes y no escala a
 * la oferta del mes gratis: quien la escucha en un dojo el martes tiene que
 * poder empezar el martes.
 *
 * Es una ruta PUBLICA que crea filas permanentes, asi que la friccion no es
 * burocracia, es lo unico que separa un padron real de una tabla llena de
 * pruebas:
 *
 *  · **cuenta de Google verificada**, igual que para reservar una clase gratis;
 *  · **RUC con digito verificador**, comprobado de verdad (`checkRuc`). La
 *    columna es NOT NULL y lo que entre ahi sale despues en las boletas;
 *  · **hasta cinco locales por persona**. El profesor que lleva la escuela de
 *    una universidad y ademas cobra sus clases aparte son DOS padrones, y el
 *    alta lo permite; el tope existe solo porque cada local nuevo estrena su
 *    mes gratis (ver `assertLocalesDisponibles`).
 *
 * El codigo de promocion es lo ULTIMO y no puede tumbar el alta: si esta mal
 * escrito, el gimnasio queda creado igual y la app dice por que no se aplico.
 * Perder un alta por un tipeo en un codigo opcional seria absurdo.
 */
import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import {
  checkRuc,
  formatPlainDate,
  freeUntilFrom,
  normalizeRuc,
  plainDateInZone,
  rucDenialMessage,
  TZ_LIMA,
  type PromoDenial,
  type SaasTier,
} from '@sinchi/shared';
import { InjectDb } from '../../db/db.module';
import { Clock } from '../../common/clock';
import {
  adoptTenant,
  schema,
  withUser,
  withoutTenantIsolation,
  type Database,
  type Tx,
} from '../../db/client';
import { AuthService, type IssuedSession } from '../../auth/auth.service';
import { AccountLinkService } from '../../auth/account-link.service';
import { SaasService } from '../saas/saas.service';

/**
 * Tope de locales por persona. Ver `assertLocalesDisponibles`.
 *
 * Es un tope de ABUSO, no un escalon comercial: lo que se cobra sigue saliendo
 * del padron de cada local, uno por uno.
 */
const MAX_LOCALES_POR_PERSONA = 5;

/**
 * Con que tarifas nace un gimnasio.
 *
 * Sin esto el alta dejaba el local INUTILIZABLE: `plans` quedaba vacia y el alta
 * de un alumno exige `plan_id`, asi que el dueno que se registraba un martes no
 * podia inscribir a nadie hasta que alguien de aqui le sembrara una tarifa a
 * mano. Nadie descubria el producto; descubria una pantalla que no dejaba pasar.
 *
 * Son una PROPUESTA, no una decision nuestra: se crean editables y el dueno las
 * cambia, las archiva o las borra desde su pantalla de planes. Empezar con tres
 * precios que hay que corregir es infinitamente mejor que empezar con cero, que
 * es lo que hay que inventar.
 *
 * Los importes son los corrientes de un dojo de barrio en Lima (2026). La clase
 * suelta va incluida a proposito: es la unica forma de cobrarle al que aparece
 * un sabado sin querer amarrarse a un mes, y hasta ahora no se podia ni
 * escribir.
 */
const PLANES_DE_ARRANQUE = [
  {
    name: '2 veces por semana',
    type: 'sessions_per_week' as const,
    sessionsPerWeek: 2,
    allowedDays: null,
    priceCents: 12_000,
    active: true,
  },
  {
    name: '3 veces por semana',
    type: 'sessions_per_week' as const,
    sessionsPerWeek: 3,
    allowedDays: null,
    priceCents: 15_000,
    active: true,
  },
  {
    name: 'Ilimitado',
    type: 'unlimited' as const,
    sessionsPerWeek: null,
    allowedDays: null,
    priceCents: 18_000,
    active: true,
  },
  {
    name: 'Clase suelta',
    type: 'drop_in' as const,
    sessionsPerWeek: null,
    allowedDays: null,
    // De UNA clase, no de un mes.
    priceCents: 2_500,
    active: true,
  },
];

export interface SignUpGymInput {
  readonly firebaseUid: string;
  readonly email: string | null;
  readonly displayName: string | null;
  /** Del gimnasio. */
  readonly gymName: string;
  readonly taxId: string;
  /**
   * Escalon que el dueno declara al darse de alta.
   *
   * Sirve para que sepa cuanto le va a costar, no para cobrarle: el escalon de
   * verdad lo deriva del padron el trabajo diario. Declarar de mas no le cuesta
   * dinero y declarar de menos no se lo ahorra.
   */
  readonly saasTier: SaasTier;
  /** Del dueno. */
  readonly ownerName?: string | undefined;
  readonly documentId: string;
  readonly phone?: string | undefined;
  readonly promoCode?: string | undefined;
}

export interface SignUpGymResult {
  readonly tenantId: string;
  readonly slug: string;
  readonly name: string;
  /** Hasta cuando es gratis, ya con el codigo aplicado si lo hubo. */
  readonly freeUntil: string;
  readonly promo:
    | { readonly applied: true; readonly freeMonths: number }
    | { readonly applied: false; readonly reason: PromoDenial }
    | null;
  /** Sesion de dueno: la app entra al modo staff sin volver a pedir nada. */
  readonly session: IssuedSession;
}

const normalizePhone = (raw: string): string => raw.replace(/[^\d+]/g, '');

/**
 * Lo que se le dice a quien choca con el indice del celular.
 *
 * Un solo texto para las dos puertas —la comprobacion previa y la carrera— para
 * que el mismo problema no se lea de dos maneras.
 */
const CELULAR_OCUPADO =
  'Ese celular ya está registrado en Sinchi con otro documento. Si es tuyo, revisa el documento que escribiste; si lo compartes con alguien, usa otro número.';

/**
 * `23505` es la violacion de un indice unico en Postgres.
 *
 * Se mira tambien en `cause` porque drizzle envuelve el error de `pg`: el codigo
 * viaja dentro, y comprobar solo el de fuera no encuentra nunca ninguno.
 */
function isUniqueViolation(error: unknown): boolean {
  const code = (candidate: unknown): unknown =>
    typeof candidate === 'object' && candidate !== null && 'code' in candidate
      ? (candidate as { code: unknown }).code
      : undefined;

  if (code(error) === '23505') return true;

  const cause =
    typeof error === 'object' && error !== null
      ? (error as { cause?: unknown }).cause
      : undefined;
  return code(cause) === '23505';
}

/** `Asociación Deportiva Club Kaizen` → `asociacion-deportiva-club-kaizen`. */
export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    @InjectDb() private readonly db: Database,
    private readonly clock: Clock,
    private readonly auth: AuthService,
    private readonly accountLink: AccountLinkService,
    private readonly saas: SaasService,
  ) {}

  async signUpGym(input: SignUpGymInput): Promise<SignUpGymResult> {
    const taxId = normalizeRuc(input.taxId);
    const rucFalla = checkRuc(taxId);
    if (rucFalla !== null) throw new BadRequestException(rucDenialMessage(rucFalla));

    const gymName = input.gymName.trim();
    if (gymName.length < 3) {
      throw new BadRequestException('El nombre del gimnasio es demasiado corto.');
    }

    const base = slugify(gymName);
    if (base.length === 0) {
      throw new BadRequestException('Ese nombre no da una dirección válida. Usa letras y números.');
    }

    const persona = await this.resolveOwner(input);

    await this.assertLocalesDisponibles(persona.userId);

    const { tenantId, slug } = await withoutTenantIsolation(this.db, async (tx) => {
      const slug = await this.freeSlug(tx, base);
      const [tenant] = await tx
        .insert(schema.tenants)
        .values({
          name: gymName,
          taxId,
          slug,
          timezone: TZ_LIMA,
          saasTier: input.saasTier,
        })
        .returning({ id: schema.tenants.id });

      const tenantId = tenant!.id;

      // `staff` va bajo RLS: sin adoptar el gimnasio, el INSERT falla su WITH CHECK.
      await adoptTenant(tx, tenantId);
      await tx.insert(schema.staff).values({
        tenantId,
        userId: persona.userId,
        role: 'owner',
        displayName: persona.fullName,
      });

      // El mes gratis empieza HOY, que es cuando el gimnasio empieza a existir.
      const alta = plainDateInZone(this.clock.now(), TZ_LIMA);
      const freeUntil = freeUntilFrom(alta);
      await tx.insert(schema.saasSubscriptions).values({
        tenantId,
        // El escalon que DECLARO. El trabajo diario lo corrige contra el padron
        // real: quien dice «hasta 60» y termina con cuatro alumnos amanece en el
        // plan gratis, no pagando de mas.
        tier: input.saasTier,
        freeUntil: formatPlainDate(freeUntil),
        periodStart: formatPlainDate(alta),
        nextBillingDate: formatPlainDate(freeUntil),
      });

      await tx.insert(schema.plans).values(
        PLANES_DE_ARRANQUE.map((plan) => ({ ...plan, tenantId })),
      );

      return { tenantId, slug };
    });

    /**
     * El codigo va DESPUES y fuera de la transaccion, a proposito: si falla, el
     * gimnasio ya existe. Un tipeo en un campo opcional no puede costar un alta.
     */
    let promo: SignUpGymResult['promo'] = null;
    if (input.promoCode !== undefined && input.promoCode.trim().length > 0) {
      const canje = await this.saas.redeemPromo(tenantId, input.promoCode);
      promo = canje.redeemed
        ? { applied: true, freeMonths: canje.freeMonths }
        : { applied: false, reason: canje.reason };
    }

    const resumen = await this.saas.summaryFor(tenantId);
    this.logger.log(`Gimnasio nuevo: ${gymName} (${slug}), gratis hasta ${formatPlainDate(resumen.freeUntil)}`);

    return {
      tenantId,
      slug,
      name: gymName,
      freeUntil: formatPlainDate(resumen.freeUntil),
      promo,
      session: await this.auth.issueForUser(persona.userId),
    };
  }

  /**
   * La identidad de quien da de alta, reutilizada si ya existe.
   *
   * Misma regla que en el resto del producto: la persona es global y no nace
   * dentro del gimnasio. Quien ya entrena en otro local y ahora abre el suyo es
   * la MISMA fila de `users`.
   */
  private async resolveOwner(
    input: SignUpGymInput,
  ): Promise<{ readonly userId: string; readonly fullName: string }> {
    const documentId = input.documentId.trim();
    if (documentId.length < 6) {
      throw new BadRequestException('Falta tu documento: es lo que te identifica en la red.');
    }

    const registro = await this.accountLink.datosDeRegistro(input.firebaseUid);
    const fullName = (input.ownerName ?? registro?.fullName ?? input.displayName ?? '').trim();
    const phone = normalizePhone(input.phone ?? registro?.phone ?? '');

    return withoutTenantIsolation(this.db, async (tx) => {
      const [porCuenta] = await tx
        .select({ id: schema.users.id, name: schema.users.name })
        .from(schema.users)
        .where(eq(schema.users.firebaseUid, input.firebaseUid))
        .limit(1);
      if (porCuenta !== undefined) return { userId: porCuenta.id, fullName: porCuenta.name };

      const [porDocumento] = await tx
        .select({ id: schema.users.id, name: schema.users.name })
        .from(schema.users)
        .where(eq(schema.users.documentId, documentId))
        .limit(1);
      if (porDocumento !== undefined) {
        // Ya tenia ficha en algun gimnasio y ahora abre el suyo: se le engancha
        // la cuenta de Google a la identidad que ya existe, no se duplica.
        await tx
          .update(schema.users)
          .set({ firebaseUid: input.firebaseUid })
          .where(eq(schema.users.id, porDocumento.id));
        return { userId: porDocumento.id, fullName: porDocumento.name };
      }

      if (fullName.length < 2 || phone.length < 6) {
        throw new BadRequestException('Faltan tu nombre y tu celular.');
      }

      /**
       * El celular es UNICO en toda la red, y aqui es donde eso se nota.
       *
       * Sin esta comprobacion el alta reventaba con un 500 y «Internal server
       * error» —el indice `users_phone_key` hablando por si solo— en un caso que
       * no es raro: quien ya entrena en otro local esta en `users` con ese
       * celular, y si teclea su documento con un digito cambiado no lo encuentra
       * la busqueda de arriba. Tambien le pasa a la pareja que comparte numero.
       *
       * Es una RUTA PUBLICA: un 500 ahi no le dice al dueno que corregir, y lo
       * que estamos perdiendo es un alta. El documento no necesita el mismo
       * cuidado porque su choque ya se resuelve arriba adoptando la identidad.
       */
      const [conEseCelular] = await tx
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.phone, phone))
        .limit(1);
      if (conEseCelular !== undefined) {
        throw new ConflictException(CELULAR_OCUPADO);
      }

      const [creada] = await tx
        .insert(schema.users)
        .values({
          name: fullName,
          documentId,
          phone,
          email: input.email?.toLowerCase() ?? null,
          firebaseUid: input.firebaseUid,
        })
        .returning({ id: schema.users.id })
        // Dos altas con el mismo celular a la vez pasan la comprobacion de
        // arriba las dos y solo una entra. Sin esto, la que pierde vuelve a ser
        // el 500 que acabamos de quitar.
        .catch((causa: unknown) => {
          if (isUniqueViolation(causa)) {
            throw new ConflictException(CELULAR_OCUPADO);
          }
          throw causa;
        });

      return { userId: creada!.id, fullName };
    });
  }

  /**
   * Cuantos locales puede abrir una persona.
   *
   * Antes era UNO, y la puerta decia "para abrir un segundo local, escribenos".
   * Se abrio porque el caso que bloqueaba es real y comun: el profesor que lleva
   * la escuela de una universidad —alumnos becados, nadie paga— y ademas cobra
   * sus clases por su cuenta el fin de semana. Son dos padrones, dos tarifarios
   * y dos cajas; meterlos en un solo local obliga a leer el dinero de los dos
   * sumado, que es justo lo que no sirve.
   *
   * Y no se pierde plata: el escalon lo calcula `tierFor` POR LOCAL contra su
   * padron real, asi que dos locales pagan dos escalones. Una seleccion de diez
   * becados cae en el plan gratis, que es lo correcto — no es un cliente que se
   * escapa, es un local que no factura.
   *
   * El tope se queda por lo unico que si se regala: cada local nuevo estrena su
   * mes gratis. Cinco es holgado para cualquier escuela de verdad y cierra la
   * puerta a granjear meses abriendo locales de mentira.
   */
  private async assertLocalesDisponibles(userId: string): Promise<void> {
    /**
     * Va con CONTEXTO DE USUARIO y no sin contexto: `staff` esta bajo RLS
     * forzado y su politica es `tenant_id = app_current_tenant() OR user_id =
     * app_current_user()`. Sin ninguno de los dos puestos no devuelve ni una
     * fila — la primera version preguntaba en SQL crudo creyendo que eso
     * esquivaba las politicas, y la comprobacion no se disparaba NUNCA: la misma
     * persona podia crear gimnasios sin limite y nada fallaba. Lo encontro el
     * e2e, no el typecheck.
     */
    const suyos = await withUser(this.db, userId, (tx) =>
      tx
        .select({ tenantId: schema.staff.tenantId })
        .from(schema.staff)
        .where(eq(schema.staff.userId, userId)),
    );

    if (suyos.length >= MAX_LOCALES_POR_PERSONA) {
      throw new ConflictException(
        `Ya llevas ${MAX_LOCALES_POR_PERSONA} locales en Sinchi, que es el máximo por cuenta. ` +
          'Si necesitas más, escríbenos.',
      );
    }
  }

  /** Dos «Dojo Kaizen» en la red no pueden compartir dirección. */
  private async freeSlug(tx: Tx, base: string): Promise<string> {
    for (let intento = 0; intento < 50; intento += 1) {
      const slug = intento === 0 ? base : `${base}-${intento + 1}`;
      const [tomado] = await tx
        .select({ id: schema.tenants.id })
        .from(schema.tenants)
        .where(eq(schema.tenants.slug, slug))
        .limit(1);
      if (tomado === undefined) return slug;
    }
    throw new ConflictException('Ya hay demasiados gimnasios con ese nombre.');
  }
}
