/**
 * Lo que el gimnasio cobra aparte de los planes.
 *
 * Son cuatro numeros que hasta ahora solo existian en el seed y que deciden
 * plata de verdad todos los dias: la matricula, la clase suelta del que agota su
 * cupo, que hacer con ese alumno, y cuanto cuesta la clase de prueba de quien
 * viene a conocer el local.
 *
 * Van juntos y no repartidos por la app porque se leen juntos: son la respuesta
 * a "¿cuanto cuesta entrar aqui?" que no cabe en un plan.
 *
 * Ojo con no confundir las dos clases sueltas, que ya se confundieron una vez:
 *
 *   · `drop_in_price_cents` — lo paga el ALUMNO CON PLAN que agota su cupo
 *     semanal. Es del gimnasio, no del plan;
 *   · un plan de tipo `drop_in` — es el plan entero de quien nunca tuvo cupo, y
 *     su precio vive en `plans.price_cents`;
 *   · `trial_class_price_cents` — lo paga quien VIENE A CONOCER el local. Tiene
 *     columna propia justamente porque regalar la primera y cobrar las
 *     siguientes es el caso mas comun, y con una sola columna no se puede ni
 *     escribir.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { PLAN_PRICE_MAX_CENTS, type QuotaOverflowPolicy } from '@sinchi/shared';
import { InjectDb } from '../../db/db.module';
import { schema, withTenant, type Database } from '../../db/client';

export interface GymPricing {
  /** Se cobra una vez al inscribirse. 0 = el gimnasio no cobra matricula. */
  readonly enrollmentFeeCents: number;
  /** Lo que paga el alumno con plan que agota su cupo. `null` = no se ofrece. */
  readonly dropInPriceCents: number | null;
  readonly quotaOverflowPolicy: QuotaOverflowPolicy;
  readonly trialClassEnabled: boolean;
  /** 0 = la primera clase es gratis, que es lo normal. */
  readonly trialClassPriceCents: number;
}

/**
 * Donde queda el local, que es lo primero que pregunta quien lo busca.
 *
 * Va aparte de `GymPricing` y con sus propias rutas porque no es plata: son dos
 * pantallas distintas del dueno y mezclarlas obligaria a mandar los cuatro
 * precios cada vez que corrige una coma de la direccion.
 */
export interface GymLocation {
  readonly address: string | null;
  /** Los dos, o ninguno. Media coordenada no lleva a nadie a ningun sitio. */
  readonly latitude: number | null;
  readonly longitude: number | null;
}

/** Lo minimo que se acepta: «Lima» son cuatro letras y no lleva a una puerta. */
const ADDRESS_MIN = 10;
const ADDRESS_MAX = 240;

@Injectable()
export class GymSettingsService {
  constructor(@InjectDb() private readonly db: Database) {}

  async readLocation(tenantId: string): Promise<GymLocation> {
    return withTenant(this.db, tenantId, async (tx) => {
      const [row] = await tx
        .select({
          address: schema.tenants.address,
          latitude: schema.tenants.latitude,
          longitude: schema.tenants.longitude,
        })
        .from(schema.tenants)
        .where(eq(schema.tenants.id, tenantId))
        .limit(1);

      if (row === undefined) throw new NotFoundException('Ese gimnasio no existe.');
      return row;
    });
  }

  async writeLocation(tenantId: string, input: GymLocation): Promise<GymLocation> {
    const address = (input.address ?? '').trim();
    if (address.length < ADDRESS_MIN) {
      throw new BadRequestException(
        'Escribe dónde queda tu gimnasio: calle, número y distrito. Es lo primero que mira quien te busca.',
      );
    }
    if (address.length > ADDRESS_MAX) {
      throw new BadRequestException(
        `La dirección no puede pasar de ${ADDRESS_MAX} caracteres.`,
      );
    }

    /**
     * O las dos coordenadas o ninguna.
     *
     * Media coordenada no es medio dato: es un punto en el ecuador o en
     * Greenwich, y el mapa lo dibujaria sin dudar. El CHECK de la base dice lo
     * mismo; aqui se dice antes para que el mensaje sea del producto.
     */
    const hasPin = input.latitude !== null && input.longitude !== null;
    if (!hasPin && (input.latitude !== null || input.longitude !== null)) {
      throw new BadRequestException('El punto del mapa necesita latitud y longitud.');
    }
    if (
      hasPin &&
      (Math.abs(input.latitude!) > 90 || Math.abs(input.longitude!) > 180)
    ) {
      throw new BadRequestException('Ese punto no está en el mapa.');
    }

    return withTenant(this.db, tenantId, async (tx) => {
      const [row] = await tx
        .update(schema.tenants)
        .set({
          address,
          latitude: hasPin ? input.latitude : null,
          longitude: hasPin ? input.longitude : null,
        })
        .where(eq(schema.tenants.id, tenantId))
        .returning({
          address: schema.tenants.address,
          latitude: schema.tenants.latitude,
          longitude: schema.tenants.longitude,
        });

      if (row === undefined) throw new NotFoundException('Ese gimnasio no existe.');
      return row;
    });
  }

  async read(tenantId: string): Promise<GymPricing> {
    return withTenant(this.db, tenantId, async (tx) => {
      const [row] = await tx
        .select({
          enrollmentFeeCents: schema.tenants.enrollmentFeeCents,
          dropInPriceCents: schema.tenants.dropInPriceCents,
          quotaOverflowPolicy: schema.tenants.quotaOverflowPolicy,
          trialClassEnabled: schema.tenants.trialClassEnabled,
          trialClassPriceCents: schema.tenants.trialClassPriceCents,
        })
        .from(schema.tenants)
        .where(eq(schema.tenants.id, tenantId))
        .limit(1);

      if (row === undefined) throw new NotFoundException('Ese gimnasio no existe.');
      return row;
    });
  }

  async write(tenantId: string, input: GymPricing): Promise<GymPricing> {
    this.assertValid(input);

    return withTenant(this.db, tenantId, async (tx) => {
      const [row] = await tx
        .update(schema.tenants)
        .set({
          enrollmentFeeCents: input.enrollmentFeeCents,
          dropInPriceCents: input.dropInPriceCents,
          quotaOverflowPolicy: input.quotaOverflowPolicy,
          trialClassEnabled: input.trialClassEnabled,
          trialClassPriceCents: input.trialClassPriceCents,
        })
        .where(eq(schema.tenants.id, tenantId))
        .returning({
          enrollmentFeeCents: schema.tenants.enrollmentFeeCents,
          dropInPriceCents: schema.tenants.dropInPriceCents,
          quotaOverflowPolicy: schema.tenants.quotaOverflowPolicy,
          trialClassEnabled: schema.tenants.trialClassEnabled,
          trialClassPriceCents: schema.tenants.trialClassPriceCents,
        });

      if (row === undefined) throw new NotFoundException('Ese gimnasio no existe.');
      return row;
    });
  }

  private assertValid(input: GymPricing): void {
    for (const [label, cents] of [
      ['La matrícula', input.enrollmentFeeCents],
      ['La clase suelta', input.dropInPriceCents],
      ['La clase de prueba', input.trialClassPriceCents],
    ] as const) {
      if (cents === null) continue;
      if (!Number.isInteger(cents)) throw new BadRequestException(`${label} va en céntimos enteros.`);
      if (cents < 0) throw new BadRequestException(`${label} no puede ser negativa.`);
      if (cents > PLAN_PRICE_MAX_CENTS) {
        throw new BadRequestException(
          `${label} no puede pasar de S/ ${PLAN_PRICE_MAX_CENTS / 100}. ¿La escribiste en céntimos?`,
        );
      }
    }

    /**
     * Ofrecer clase suelta sin precio deja a la recepcionista inventandolo.
     *
     * La puerta le dice "cobrar clase suelta" con el alumno delante y sin
     * cantidad — es el defecto que el QA visual encuentra siempre: una accion
     * que invita a algo que despues no se puede hacer. O hay precio, o no se
     * ofrece.
     */
    if (input.quotaOverflowPolicy === 'offer_drop_in' && input.dropInPriceCents === null) {
      throw new BadRequestException(
        'Si dejas entrar pagando clase suelta, ponle precio: la puerta se lo va a pedir al mostrador.',
      );
    }
  }
}
