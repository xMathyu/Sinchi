/**
 * El logo del gimnasio: guardarlo, quitarlo y servirlo.
 *
 * La imagen llega ya achicada por el teléfono (`gymLogoTargetSize`), pero aquí
 * no se le cree a nadie: el tipo y el tamaño salen de los BYTES
 * (`readImageHeader`) y se juzgan con la misma regla del dominio que usó el
 * teléfono, `checkGymLogo`. Lo que el cliente declara no entra en la decisión.
 *
 * Va en la base y no en el bucket de los videos. El porqué está en la migración
 * 0025; lo corto es que el bucket en producción no existe y un logo pesa
 * decenas de KB.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { checkGymLogo, gymLogoDenialMessage, type GymLogoContentType } from '@sinchi/shared';
import { InjectDb } from '../../db/db.module';
import {
  adoptTenant,
  schema,
  withTenant,
  withoutTenantIsolation,
  type Database,
} from '../../db/client';
import { readImageHeader } from './image-header';

export interface GymLogoRef {
  /** `null` = el gimnasio no tiene logo y se ven sus iniciales. */
  readonly logoId: string | null;
}

export interface GymLogoFile {
  readonly contentType: GymLogoContentType;
  readonly bytes: Buffer;
}

@Injectable()
export class GymLogoService {
  constructor(@InjectDb() private readonly db: Database) {}

  async read(tenantId: string): Promise<GymLogoRef> {
    return withTenant(this.db, tenantId, async (tx) => {
      const [row] = await tx
        .select({ logoId: schema.tenants.logoId })
        .from(schema.tenants)
        .where(eq(schema.tenants.id, tenantId))
        .limit(1);
      if (row === undefined) throw new NotFoundException('Ese gimnasio no existe.');
      return row;
    });
  }

  /**
   * Pone un logo nuevo, o cambia el que había.
   *
   * Cambiar es BORRAR el viejo y crear otro con otro id, nunca actualizar la
   * fila: el id va en la dirección de la imagen, y es lo que deja al teléfono
   * guardarla en caché para siempre. Con la misma dirección y otra imagen, el
   * alumno seguiría viendo el logo viejo hasta reinstalar la app.
   */
  async replace(tenantId: string, bytes: Buffer): Promise<GymLogoRef> {
    const header = readImageHeader(bytes);
    if (header === null) {
      throw new BadRequestException(gymLogoDenialMessage({ code: 'unsupported_type' }));
    }
    const denial = checkGymLogo({
      contentType: header.contentType,
      sizeBytes: bytes.length,
      width: header.width,
      height: header.height,
    });
    if (denial !== null) throw new BadRequestException(gymLogoDenialMessage(denial));

    return withTenant(this.db, tenantId, async (tx) => {
      // Primero se borra: el índice único deja uno por gimnasio, y la clave de
      // `tenants` pone su puntero en `null` sola. Todo en la misma transacción,
      // así que nadie llega a ver el gimnasio sin logo a mitad del cambio.
      await tx.delete(schema.gymLogos).where(eq(schema.gymLogos.tenantId, tenantId));

      const [logo] = await tx
        .insert(schema.gymLogos)
        .values({
          tenantId,
          contentType: header.contentType,
          bytes,
          width: header.width,
          height: header.height,
        })
        .returning({ id: schema.gymLogos.id });

      const [tenant] = await tx
        .update(schema.tenants)
        .set({ logoId: logo!.id })
        .where(eq(schema.tenants.id, tenantId))
        .returning({ logoId: schema.tenants.logoId });

      if (tenant === undefined) throw new NotFoundException('Ese gimnasio no existe.');
      return tenant;
    });
  }

  /** Quita el logo. El gimnasio vuelve a sus iniciales. */
  async remove(tenantId: string): Promise<GymLogoRef> {
    return withTenant(this.db, tenantId, async (tx) => {
      await tx.delete(schema.gymLogos).where(eq(schema.gymLogos.tenantId, tenantId));
      return { logoId: null };
    });
  }

  /**
   * La imagen, para quien sea. `null` si ese logo ya no es de nadie.
   *
   * Sin sesión, porque el logo sale en el directorio a quien todavía no tiene
   * cuenta. Pero `gym_logos` tiene RLS como cualquier tabla del gimnasio, así que
   * se hace lo mismo que el directorio: se busca de quién es en `tenants`, que es
   * global, y se entra con el contexto de ese gimnasio. Sin abrir ningún hueco
   * en el aislamiento para servir una imagen.
   *
   * Solo se sirve el logo VIGENTE: el que se reemplazó ya no está en ningún
   * `tenants.logo_id`, y su dirección vieja responde 404.
   */
  async serve(logoId: string): Promise<GymLogoFile | null> {
    return withoutTenantIsolation(this.db, async (tx) => {
      const [owner] = await tx
        .select({ id: schema.tenants.id })
        .from(schema.tenants)
        .where(eq(schema.tenants.logoId, logoId))
        .limit(1);
      if (owner === undefined) return null;

      await adoptTenant(tx, owner.id);
      const [logo] = await tx
        .select({ contentType: schema.gymLogos.contentType, bytes: schema.gymLogos.bytes })
        .from(schema.gymLogos)
        .where(and(eq(schema.gymLogos.id, logoId), eq(schema.gymLogos.tenantId, owner.id)))
        .limit(1);
      if (logo === undefined) return null;

      // El CHECK de la base ya lo garantiza; el estrechamiento de tipo no.
      return { contentType: logo.contentType as GymLogoContentType, bytes: logo.bytes };
    });
  }
}
