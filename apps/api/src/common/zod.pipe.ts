/**
 * Validacion de entrada con Zod.
 *
 * Se usa Zod y no class-validator porque los DTO ya se describen una vez en
 * `@sinchi/shared` como tipos, y Zod deriva el tipo del esquema: un solo sitio
 * donde puede quedar desincronizado, en vez de dos.
 */
import { BadRequestException, PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;

    throw new BadRequestException({
      // Una regla nuestra (`custom`) trae su frase en español, y la app solo
      // enseña `message`: sin esto, «Un celular de Perú tiene 9 dígitos» llegaba
      // a la pantalla como «Datos invalidos.». Los mensajes por defecto de Zod
      // no suben: están en inglés y hablan de tipos, no de la persona.
      message:
        result.error.issues.find((issue) => issue.code === 'custom')?.message ??
        'Datos invalidos.',
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
}

export const parseWith = <T>(schema: ZodType<T>) => new ZodPipe(schema);
