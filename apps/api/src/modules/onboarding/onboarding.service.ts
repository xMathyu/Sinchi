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
 *  · **un gimnasio por persona**. Quien ya trabaja en un local no puede crear
 *    otro desde aqui. Multi-sede es el escalon de S/499 y una conversacion, no
 *    un boton.
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

    await this.assertNotStaffYet(persona.userId);

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

      const [creada] = await tx
        .insert(schema.users)
        .values({
          name: fullName,
          documentId,
          phone,
          email: input.email?.toLowerCase() ?? null,
          firebaseUid: input.firebaseUid,
        })
        .returning({ id: schema.users.id });

      return { userId: creada!.id, fullName };
    });
  }

  /**
   * Multi-sede es el escalon de S/499 y una conversacion, no un boton.
   *
   * Va con CONTEXTO DE USUARIO y no sin contexto: `staff` esta bajo RLS forzado
   * y su politica es `tenant_id = app_current_tenant() OR user_id =
   * app_current_user()`. Sin ninguno de los dos puestos no devuelve ni una fila
   * — la primera version preguntaba en SQL crudo creyendo que eso esquivaba las
   * politicas, y la comprobacion no se disparaba NUNCA: la misma persona podia
   * crear gimnasios sin limite y nada fallaba. Lo encontro el e2e, no el
   * typecheck.
   */
  private async assertNotStaffYet(userId: string): Promise<void> {
    const [existente] = await withUser(this.db, userId, (tx) =>
      tx
        .select({ tenantId: schema.staff.tenantId })
        .from(schema.staff)
        .where(eq(schema.staff.userId, userId))
        .limit(1),
    );

    if (existente !== undefined) {
      throw new ConflictException(
        'Ya trabajas en un gimnasio de Sinchi. Para abrir un segundo local, escríbenos.',
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
