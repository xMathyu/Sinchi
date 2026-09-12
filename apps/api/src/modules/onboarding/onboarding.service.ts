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
  checkPlanDraft,
  checkRuc,
  formatPlainDate,
  freeUntilFrom,
  normalizeRuc,
  planDenialMessage,
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
const MAX_GYMS_PER_PERSON = 5;

/**
 * Como se llama la tarifa con la que nace el gimnasio.
 *
 * Se escribe aqui y no la pide el formulario porque no es una decision: es el
 * nombre corriente de lo que todo gimnasio cobra, y el dueno lo cambia de un
 * toque desde su pantalla de planes. Pedirselo en el alta seria un campo mas
 * para escribir la palabra que ya estaba puesta.
 */
const FIRST_RATE_NAME = 'Mensualidad';

/**
 * Lo minimo que se acepta como direccion: diez caracteres.
 *
 * No comprueba que exista —eso no se puede saber desde aqui— sino que alguien
 * escribio algo. «Lima» son cuatro y no lleva a nadie a ninguna puerta.
 */
const ADDRESS_MIN = 10;

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
  /**
   * Lo que el gimnasio le cobra al mes a un alumno.
   *
   * Es OBLIGATORIO y por eso vive en el alta: `plans` vacia deja el local
   * inutilizable —dar de alta a un alumno exige `plan_id`— y lo que se hacia
   * antes, sembrarle cuatro tarifas de ejemplo, era peor que no tener ninguna.
   * El local se registraba sin escribir un precio y el directorio lo anunciaba
   * «desde S/ 120 al mes», que es una cifra que nadie de ese gimnasio decidio,
   * puesta en la pantalla donde la gente compara dojos. Un precio inventado no
   * es un punto de partida: es una mentira con nuestra letra.
   */
  readonly monthlyPriceCents: number;
  /**
   * Donde queda el local, escrito como se lo dirias a un taxista.
   *
   * Obligatoria en el alta por lo mismo que la mensualidad: el directorio la
   * ensena, y un gimnasio sin direccion es un nombre en una lista. La columna es
   * nullable para los locales que ya existen —no se les puede inventar una— pero
   * los nuevos nacen con ella.
   */
  readonly address: string;
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
const PHONE_TAKEN =
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
    const taxIdDenial = checkRuc(taxId);
    if (taxIdDenial !== null) throw new BadRequestException(rucDenialMessage(taxIdDenial));

    const gymName = input.gymName.trim();
    if (gymName.length < 3) {
      throw new BadRequestException('El nombre del gimnasio es demasiado corto.');
    }

    const base = slugify(gymName);
    if (base.length === 0) {
      throw new BadRequestException('Ese nombre no da una dirección válida. Usa letras y números.');
    }

    // La misma funcion que corre el formulario, para que el boton se apague por
    // el motivo exacto por el que este POST responderia 400.
    const rateDenial = checkPlanDraft({
      name: FIRST_RATE_NAME,
      type: 'unlimited',
      sessionsPerWeek: null,
      allowedDays: null,
      priceCents: input.monthlyPriceCents,
    });
    if (rateDenial !== null) throw new BadRequestException(planDenialMessage(rateDenial));

    const address = input.address.trim();
    if (address.length < ADDRESS_MIN) {
      throw new BadRequestException(
        'Escribe dónde queda tu gimnasio: calle, número y distrito. Es lo primero que mira quien busca dónde entrenar.',
      );
    }

    const persona = await this.resolveOwner(input);

    await this.assertGymsAvailable(persona.userId);

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
          address,
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
      const signUp = plainDateInZone(this.clock.now(), TZ_LIMA);
      const freeUntil = freeUntilFrom(signUp);
      await tx.insert(schema.saasSubscriptions).values({
        tenantId,
        // El escalon que DECLARO. El trabajo diario lo corrige contra el padron
        // real: quien dice «hasta 60» y termina con cuatro alumnos amanece en el
        // plan gratis, no pagando de mas.
        tier: input.saasTier,
        freeUntil: formatPlainDate(freeUntil),
        periodStart: formatPlainDate(signUp),
        nextBillingDate: formatPlainDate(freeUntil),
      });

      /**
       * UNA tarifa, la que el dueno acaba de escribir.
       *
       * `unlimited` y no un cupo semanal porque es lo unico que no hay que
       * preguntarle: sin limite de sesiones la puerta nunca le corta a un alumno
       * al dia, y el cupo es una decision que se toma despues, con el tatami
       * lleno. Las demas tarifas —dos veces por semana, la clase suelta— las
       * escribe el mismo desde Padron -> Planes, ya sabiendo lo que cobra.
       */
      await tx.insert(schema.plans).values({
        tenantId,
        name: FIRST_RATE_NAME,
        type: 'unlimited',
        sessionsPerWeek: null,
        allowedDays: null,
        priceCents: input.monthlyPriceCents,
        active: true,
      });

      return { tenantId, slug };
    });

    /**
     * El codigo va DESPUES y fuera de la transaccion, a proposito: si falla, el
     * gimnasio ya existe. Un tipeo en un campo opcional no puede costar un alta.
     */
    let promo: SignUpGymResult['promo'] = null;
    if (input.promoCode !== undefined && input.promoCode.trim().length > 0) {
      const redemption = await this.saas.redeemPromo(tenantId, input.promoCode);
      promo = redemption.redeemed
        ? { applied: true, freeMonths: redemption.freeMonths }
        : { applied: false, reason: redemption.reason };
    }

    const summary = await this.saas.summaryFor(tenantId);
    this.logger.log(`Gimnasio nuevo: ${gymName} (${slug}), gratis hasta ${formatPlainDate(summary.freeUntil)}`);

    return {
      tenantId,
      slug,
      name: gymName,
      freeUntil: formatPlainDate(summary.freeUntil),
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

    const registro = await this.accountLink.signUpDetails(input.firebaseUid);
    const fullName = (input.ownerName ?? registro?.fullName ?? input.displayName ?? '').trim();
    const phone = normalizePhone(input.phone ?? registro?.phone ?? '');

    return withoutTenantIsolation(this.db, async (tx) => {
      const [byAccount] = await tx
        .select({ id: schema.users.id, name: schema.users.name })
        .from(schema.users)
        .where(eq(schema.users.firebaseUid, input.firebaseUid))
        .limit(1);
      if (byAccount !== undefined) return { userId: byAccount.id, fullName: byAccount.name };

      const [byDocument] = await tx
        .select({ id: schema.users.id, name: schema.users.name })
        .from(schema.users)
        .where(eq(schema.users.documentId, documentId))
        .limit(1);
      if (byDocument !== undefined) {
        // Ya tenia ficha en algun gimnasio y ahora abre el suyo: se le engancha
        // la cuenta de Google a la identidad que ya existe, no se duplica.
        await tx
          .update(schema.users)
          .set({ firebaseUid: input.firebaseUid })
          .where(eq(schema.users.id, byDocument.id));
        return { userId: byDocument.id, fullName: byDocument.name };
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
      const [withThatPhone] = await tx
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.phone, phone))
        .limit(1);
      if (withThatPhone !== undefined) {
        throw new ConflictException(PHONE_TAKEN);
      }

      const [created] = await tx
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
            throw new ConflictException(PHONE_TAKEN);
          }
          throw causa;
        });

      return { userId: created!.id, fullName };
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
  private async assertGymsAvailable(userId: string): Promise<void> {
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

    if (suyos.length >= MAX_GYMS_PER_PERSON) {
      throw new ConflictException(
        `Ya llevas ${MAX_GYMS_PER_PERSON} locales en Sinchi, que es el máximo por cuenta. ` +
          'Si necesitas más, escríbenos.',
      );
    }
  }

  /** Dos «Dojo Kaizen» en la red no pueden compartir dirección. */
  private async freeSlug(tx: Tx, base: string): Promise<string> {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
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
