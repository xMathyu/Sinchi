/**
 * Módulo de base de datos.
 *
 * Un solo pool para todo el proceso, cerrado en el apagado. Global porque casi
 * todos los módulos lo necesitan y pasarlo por importaciones no aporta nada.
 */
import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';
import { createDatabase, createPool, type Database } from './client';
import { loadEnv } from '../config/env';

export const PG_POOL = Symbol('PG_POOL');
export const DATABASE = Symbol('DATABASE');

/** Inyecta la instancia de Drizzle. */
export const InjectDb = () => Inject(DATABASE);

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      useFactory: (): Pool => {
        const env = loadEnv();
        return createPool(env.DATABASE_URL, { max: env.DB_POOL_MAX });
      },
    },
    {
      provide: DATABASE,
      inject: [PG_POOL],
      useFactory: (pool: Pool): Database => createDatabase(pool),
    },
  ],
  exports: [PG_POOL, DATABASE],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    // Neon cobra por tiempo de compute activo: dejar conexiones colgando tras
    // un despliegue mantiene el compute despierto sin motivo.
    await this.pool.end();
  }
}
