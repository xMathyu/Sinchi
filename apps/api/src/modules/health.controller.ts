/**
 * Salud.
 *
 * Dos rutas distintas a proposito: `/health` responde si el proceso vive
 * (liveness) y `/health/ready` si ademas puede hablar con la base (readiness).
 * Mezclarlas hace que un balanceador reinicie la api por una caida de Neon, que
 * es justo lo que no ayuda.
 */
import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Public } from '../auth/auth.guard';
import { InjectDb } from '../db/db.module';
import type { Database } from '../db/client';

@Controller('health')
export class HealthController {
  constructor(@InjectDb() private readonly db: Database) {}

  @Public()
  @Get()
  live() {
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()) };
  }

  @Public()
  @Get('ready')
  async ready() {
    const started = Date.now();
    try {
      await this.db.execute(sql`select 1`);
    } catch (error) {
      throw new ServiceUnavailableException({
        status: 'degraded',
        database: 'unreachable',
        detail: error instanceof Error ? error.message : 'error desconocido',
      });
    }
    return { status: 'ok', database: 'ok', latencyMs: Date.now() - started };
  }
}
