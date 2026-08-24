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
      message: 'Datos invalidos.',
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
}

export const parseWith = <T>(schema: ZodType<T>) => new ZodPipe(schema);
