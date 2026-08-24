/**
 * Trabajos programados, disparados desde afuera.
 *
 * En Cloud Run con `min-instances=0` el contenedor se apaga cuando no hay
 * tráfico. A las 06:00 —la hora de refrescar la morosidad— no hay nadie usando
 * la app, así que no hay contenedor y el cron interno no corre. El fallo es
 * silencioso: nadie ve un error, y solo se nota semanas después cuando el panel
 * lista morosos que ya pagaron.
 *
 * La solución es invertir quién llama: Cloud Scheduler despierta el contenedor
 * con una petición HTTP. Estas rutas son ese punto de entrada.
 *
 * No van con `@Public()`. Van con su propia autenticación —un secreto
 * compartido— porque quien las llama no es una persona con sesión, es una
 * máquina. Si `JOBS_TOKEN` no está configurado, las rutas quedan APAGADAS:
 * preferible un trabajo que no corre a un endpoint que cualquiera dispara.
 */
import {
  Controller,
  ForbiddenException,
  Headers,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Public } from '../auth/auth.guard';
import { loadEnv } from '../config/env';
import { safeEquals } from '../common/secret-box';
import { RefreshDelinquencyJob, type RefreshReport } from './refresh-delinquency.job';

export const JOBS_TOKEN_HEADER = 'x-jobs-token';

@Public()
@Controller('jobs')
export class JobsController {
  constructor(private readonly refreshDelinquency: RefreshDelinquencyJob) {}

  /**
   * Refresca el caché de morosidad de todos los gimnasios.
   *
   * Idempotente: recalcula desde `evaluateDelinquency` y escribe solo lo que
   * cambió. Dispararlo dos veces el mismo día no hace daño, así que Cloud
   * Scheduler puede reintentar sin cuidado.
   */
  @Post('refresh-delinquency')
  async runRefreshDelinquency(
    @Headers(JOBS_TOKEN_HEADER) token: string | undefined,
  ): Promise<RefreshReport & { readonly ranAt: string }> {
    this.assertAuthorized(token);
    const report = await this.refreshDelinquency.run();
    return { ...report, ranAt: new Date().toISOString() };
  }

  private assertAuthorized(token: string | undefined): void {
    const expected = loadEnv().JOBS_TOKEN;

    if (expected === undefined) {
      throw new ServiceUnavailableException(
        'Las rutas de /jobs están apagadas: falta JOBS_TOKEN.',
      );
    }
    // Comparación en tiempo constante: un compare con corto circuito filtra el
    // secreto byte por byte a quien mida los tiempos de respuesta.
    if (token === undefined || !safeEquals(token, expected)) {
      throw new ForbiddenException('Token de trabajos inválido.');
    }
  }
}
