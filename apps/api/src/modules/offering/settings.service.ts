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

@Injectable()
export class GymSettingsService {
  constructor(@InjectDb() private readonly db: Database) {}

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
