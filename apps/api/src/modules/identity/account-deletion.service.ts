/**
 * Baja de cuenta pedida por la propia persona.
 *
 * Google Play la exige por dos caminos para cualquier app con registro: uno
 * dentro de la app y una URL publica. La URL es sinchi.fit/eliminar-cuenta;
 * esto es lo que atiende el boton del telefono.
 *
 * Es una SOLICITUD, no un borrado en el acto, y la razon esta en la migracion
 * 0016: la ficha vive en el gimnasio, los cobros son sus asientos contables y
 * el historial de asistencias es de los dos. Un `DELETE` en cascada disparado
 * desde un boton borraria en casa ajena sin que nadie lo revise.
 *
 * Lo que si es inmediato es el compromiso: queda la fila con su fecha, y el
 * plazo de 30 dias que promete la politica publicada empieza a correr ahi.
 */
import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { InjectDb } from '../../db/db.module';
import { schema, withoutTenantIsolation, type Database } from '../../db/client';

export interface DeletionRequest {
  readonly id: string;
  readonly status: 'pending' | 'done' | 'canceled';
  readonly requestedAt: string;
  readonly reason: string | null;
}

@Injectable()
export class AccountDeletionService {
  constructor(@InjectDb() private readonly db: Database) {}

  /** La pendiente, si la hay. Es lo que la pantalla necesita para no ofrecer dos veces lo mismo. */
  async pendiente(userId: string): Promise<DeletionRequest | null> {
    const found = await withoutTenantIsolation(this.db, async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.accountDeletionRequests)
        .where(
          and(
            eq(schema.accountDeletionRequests.userId, userId),
            eq(schema.accountDeletionRequests.status, 'pending'),
          ),
        )
        .limit(1);
      return row;
    });

    return found === undefined ? null : mapear(found);
  }

  /**
   * Pide la baja.
   *
   * IDEMPOTENTE: si ya hay una pendiente devuelve esa misma en vez de crear
   * otra. No es cortesia — el indice unico parcial de la migracion rechazaria
   * la segunda, y quien toca el boton dos veces porque la red tardo no merece
   * un error rojo por haber sido paciente.
   */
  async request(userId: string, reason: string | null): Promise<DeletionRequest> {
    const alreadyPending = await this.pendiente(userId);
    if (alreadyPending !== null) return alreadyPending;

    const found = await withoutTenantIsolation(this.db, async (tx) => {
      const [row] = await tx
        .insert(schema.accountDeletionRequests)
        .values({ userId, reason: reason === null || reason.trim() === '' ? null : reason.trim() })
        // La carrera que el `select` de arriba no cubre: dos peticiones a la vez
        // pasan las dos por `pendiente()` antes de que ninguna inserte.
        .onConflictDoNothing()
        .returning();
      if (row !== undefined) return row;

      const [existente] = await tx
        .select()
        .from(schema.accountDeletionRequests)
        .where(
          and(
            eq(schema.accountDeletionRequests.userId, userId),
            eq(schema.accountDeletionRequests.status, 'pending'),
          ),
        )
        .limit(1);
      return existente;
    });

    if (found === undefined) {
      // No deberia ocurrir: o inserto, o la perdio contra otra que si inserto.
      throw new Error('No se pudo registrar la solicitud de baja.');
    }
    return mapear(found);
  }

  /**
   * Se arrepiente.
   *
   * Play no lo pide, pero treinta dias son muchos para no poder desdecirse, y
   * la alternativa —escribir al soporte para frenar algo que se pidio con un
   * boton— es peor que no haber puesto el boton.
   */
  async cancelar(userId: string): Promise<boolean> {
    const rows = await withoutTenantIsolation(this.db, async (tx) =>
      tx
        .update(schema.accountDeletionRequests)
        .set({ status: 'canceled', resolvedAt: new Date() })
        .where(
          and(
            eq(schema.accountDeletionRequests.userId, userId),
            eq(schema.accountDeletionRequests.status, 'pending'),
          ),
        )
        .returning({ id: schema.accountDeletionRequests.id }),
    );
    return rows.length > 0;
  }
}

function mapear(found: typeof schema.accountDeletionRequests.$inferSelect): DeletionRequest {
  return {
    id: found.id,
    status: found.status,
    requestedAt: found.requestedAt.toISOString(),
    reason: found.reason,
  };
}
