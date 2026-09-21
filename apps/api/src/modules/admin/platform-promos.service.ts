/**
 * Códigos de promoción desde el panel.
 *
 * Lo mismo que `npm run saas:promo`, con dos cosas que la línea de comandos no
 * daba: quién creó cada código —`saas_promo_codes` nunca lo supo— y quién lo
 * canjeó, que es la pregunta que se hace cuando una campaña no cuadra.
 *
 * Un código no descuenta el precio: mueve `free_until` hacia adelante. El motor
 * de cobro sigue sin saber que las promociones existen, y por eso esto puede
 * escribir en la tabla sin tocar nada de `SaasService`.
 *
 * El tope de usos NO se comprueba aquí. Vive en el `UPDATE ... WHERE
 * redeemed_count < max_redemptions` del canje: dos gimnasios canjeando el último
 * uso en el mismo segundo leen los dos «9 de 10» y con un `if` entrarían los dos.
 */
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import {
  checkPromoDraft,
  normalizePromoCode,
  parsePlainDate,
  promoDraftDenialMessage,
  type PlainDate,
} from '@sinchi/shared';
import { InjectDb } from '../../db/db.module';
import { schema, withoutTenantIsolation, type Database } from '../../db/client';
import { Clock } from '../../common/clock';
import { loadEnv } from '../../config/env';
import { PlatformAdminService } from './platform-admin.service';

export interface PromoView {
  readonly id: string;
  readonly code: string;
  readonly freeMonths: number;
  readonly maxRedemptions: number | null;
  readonly redeemedCount: number;
  readonly expiresOn: string | null;
  readonly active: boolean;
  readonly note: string | null;
  readonly createdAt: string;
  /** Qué gimnasios lo usaron. Vacío mientras nadie lo haya canjeado. */
  readonly redemptions: readonly {
    readonly tenantName: string;
    readonly tenantSlug: string;
    readonly createdAt: string;
  }[];
}

export interface CreatePromoInput {
  readonly code: string;
  readonly freeMonths: number;
  /** `null` = sin tope, y tiene que ser una decisión escrita. */
  readonly maxRedemptions: number | null;
  readonly expiresOn: string | null;
  readonly note: string | null;
}

@Injectable()
export class PlatformPromosService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly clock: Clock,
    private readonly admins: PlatformAdminService,
  ) {}

  /**
   * Todos los códigos con sus canjes.
   *
   * Dos consultas y no una por código: los canjes se traen de golpe y se reparten
   * en memoria. Con un `select` por fila, una lista de veinte códigos son
   * veintiún viajes a Neon para pintar una tabla.
   */
  async list(): Promise<readonly PromoView[]> {
    const { codes, redemptions } = await withoutTenantIsolation(this.db, async (tx) => ({
      codes: await tx
        .select()
        .from(schema.saasPromoCodes)
        .orderBy(desc(schema.saasPromoCodes.createdAt)),
      redemptions: await tx
        .select({
          promoCodeId: schema.saasRedemptions.promoCodeId,
          tenantName: schema.tenants.name,
          tenantSlug: schema.tenants.slug,
          createdAt: schema.saasRedemptions.createdAt,
        })
        .from(schema.saasRedemptions)
        .innerJoin(schema.tenants, eq(schema.tenants.id, schema.saasRedemptions.tenantId))
        .orderBy(desc(schema.saasRedemptions.createdAt)),
    }));

    const byCode = new Map<string, PromoView['redemptions'][number][]>();
    for (const row of redemptions) {
      const list = byCode.get(row.promoCodeId) ?? [];
      list.push({
        tenantName: row.tenantName,
        tenantSlug: row.tenantSlug,
        createdAt: row.createdAt.toISOString(),
      });
      byCode.set(row.promoCodeId, list);
    }

    return codes.map((code) => ({
      id: code.id,
      code: code.code,
      freeMonths: code.freeMonths,
      maxRedemptions: code.maxRedemptions,
      redeemedCount: code.redeemedCount,
      expiresOn: code.expiresOn,
      active: code.active,
      note: code.note,
      createdAt: code.createdAt.toISOString(),
      redemptions: byCode.get(code.id) ?? [],
    }));
  }

  async create(adminId: string, input: CreatePromoInput): Promise<PromoView> {
    const expiresOn: PlainDate | null =
      input.expiresOn === null || input.expiresOn.length === 0
        ? null
        : parsePlainDate(input.expiresOn);

    const draft = {
      code: input.code,
      freeMonths: input.freeMonths,
      maxRedemptions: input.maxRedemptions,
      expiresOn,
    };

    // La misma función que apaga el botón en el panel. Que la api la vuelva a
    // correr no es desconfianza del panel: es que el panel no es el único
    // cliente posible de esta ruta.
    const denial = checkPromoDraft(draft, this.clock.today(loadEnv().DEFAULT_TIMEZONE));
    if (denial !== null) throw new BadRequestException(promoDraftDenialMessage(denial));

    const code = normalizePromoCode(input.code);

    const id = await withoutTenantIsolation(this.db, async (tx) => {
      const inserted = await tx
        .insert(schema.saasPromoCodes)
        .values({
          code,
          freeMonths: input.freeMonths,
          maxRedemptions: input.maxRedemptions,
          expiresOn: input.expiresOn === null || input.expiresOn.length === 0 ? null : input.expiresOn,
          note: input.note === null || input.note.trim().length === 0 ? null : input.note.trim(),
        })
        .onConflictDoNothing()
        .returning({ id: schema.saasPromoCodes.id });

      // Sin `onConflictDoUpdate`: reescribir un código que ya existe cambiaría
      // las condiciones de una promoción que alguien ya está repartiendo.
      if (inserted.length === 0) throw new ConflictException(`El código ${code} ya existe.`);

      await this.admins.record(tx, {
        adminId,
        action: 'promo.create',
        subject: code,
        detail: {
          freeMonths: input.freeMonths,
          maxRedemptions: input.maxRedemptions,
          expiresOn: input.expiresOn,
          note: input.note,
        },
      });

      return inserted[0]!.id;
    });

    return (await this.list()).find((promo) => promo.id === id)!;
  }

  /**
   * Apaga un código. No se borra.
   *
   * Los canjes apuntan a él (`saas_redemptions.promo_code_id`), así que borrarlo
   * dejaría a los gimnasios que lo usaron sin poder explicar de dónde salieron
   * sus meses gratis. Apagado deja de canjear y sigue contando su historia.
   */
  async setActive(adminId: string, promoId: string, active: boolean): Promise<PromoView> {
    const updated = await withoutTenantIsolation(this.db, async (tx) => {
      const [row] = await tx
        .update(schema.saasPromoCodes)
        .set({ active })
        .where(eq(schema.saasPromoCodes.id, promoId))
        .returning({ id: schema.saasPromoCodes.id, code: schema.saasPromoCodes.code });

      if (row === undefined) throw new NotFoundException('Ese código no existe.');

      await this.admins.record(tx, {
        adminId,
        // Encender un código apagado es lo bastante raro como para no inventarle
        // su propia acción: se registra como lo que deshace, con el detalle.
        action: 'promo.disable',
        subject: row.code,
        detail: { active },
      });

      return row;
    });

    return (await this.list()).find((promo) => promo.id === updated.id)!;
  }
}
