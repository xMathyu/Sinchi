/**
 * Refresco diario de la suscripcion de los gimnasios a Sinchi.
 *
 * Hermano del de morosidad del alumno, y por la misma razon: el estado se
 * calcula en cada lectura, asi que un cache desactualizado no le regala un mes a
 * nadie ni corta a quien pago. Lo que el calculo en vivo no puede hacer es tener
 * un MOMENTO del dia en que el vencimiento ocurre — que es cuando hay que
 * avisarle al dueno, antes de que se entere chocando contra un alta bloqueada.
 *
 * Va cinco minutos despues del de morosidad para no pelear con el por el mismo
 * arranque en frio de Cloud Run.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { loadEnv } from '../config/env';
import { SaasService, type SaasRefreshReport } from '../modules/saas/saas.service';

@Injectable()
export class RefreshSaasJob {
  private readonly logger = new Logger(RefreshSaasJob.name);

  constructor(private readonly saas: SaasService) {}

  /** 06:05 en Lima = 11:05 UTC. */
  @Cron('5 11 * * *', { name: 'refresh-saas' })
  async runScheduled(): Promise<void> {
    // Con `external` dispara Cloud Scheduler contra `/v1/jobs/...`. El decorador
    // se registra igual —no se puede condicionar— asi que va aqui.
    if (loadEnv().SCHEDULER_MODE === 'external') return;
    await this.run();
  }

  async run(): Promise<SaasRefreshReport> {
    const report = await this.saas.refreshAll();
    this.logger.log(
      `Suscripciones a Sinchi: ${report.reviewed} revisadas, ${report.changed} cambios ` +
        `(${report.enteredGrace} en gracia, ${report.readOnly} en solo lectura, ` +
        `${report.reactivated} reactivadas).`,
    );
    return report;
  }
}
