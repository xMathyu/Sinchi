/**
 * Piezas transversales: reloj y caja de secretos.
 *
 * Global porque las necesitan casi todos los modulos, y encadenarlas por
 * importaciones solo agrega ruido.
 */
import { Global, Module } from '@nestjs/common';
import { Clock } from './clock';
import { SecretBox } from './secret-box';
import { loadEnv } from '../config/env';

@Global()
@Module({
  providers: [
    Clock,
    {
      provide: SecretBox,
      useFactory: () => new SecretBox(loadEnv().ENCRYPTION_KEY),
    },
  ],
  exports: [Clock, SecretBox],
})
export class CommonModule {}
