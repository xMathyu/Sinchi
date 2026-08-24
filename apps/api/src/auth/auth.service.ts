/**
 * Emisión de sesiones.
 *
 * PENDIENTE: la autenticación de verdad es por SMS (el alumno se identifica con
 * su celular, que es único en `users`). No está implementada porque exige elegir
 * proveedor y presupuesto de mensajes, y eso no se ha decidido.
 *
 * Mientras tanto hay una sola puerta, `devLogin`, que:
 *  - solo funciona con `ALLOW_DEV_LOGIN=true`;
 *  - se niega a arrancar con esa bandera en producción (ver `config/env.ts`);
 *  - no verifica NADA: si conoces el celular, entras.
 *
 * Está aislada en un método con ese nombre para que nadie la confunda con
 * autenticación real al leer el código.
 */
import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import type { AppRole } from '@sinchi/shared';
import { InjectDb } from '../db/db.module';
import { withUser, withoutTenantIsolation, type Database } from '../db/client';
import { schema } from '../db/client';
import { loadEnv } from '../config/env';
import type { SessionClaims } from './session';

export interface IssuedSession {
  readonly accessToken: string;
  readonly expiresInSeconds: number;
  readonly role: AppRole;
  readonly userId: string;
  readonly tenantId: string | null;
}

/**
 * Una semana.
 *
 * El alumno abre la app en la puerta del gimnasio, muchas veces sin datos: una
 * sesión corta lo dejaría fuera justo cuando la necesita. El QR es de vida
 * corta y firmado, así que la sesión larga no relaja el control de acceso.
 */
const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

@Injectable()
export class AuthService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly jwt: JwtService,
  ) {}

  async devLogin(phone: string): Promise<IssuedSession> {
    if (!loadEnv().ALLOW_DEV_LOGIN) {
      throw new ServiceUnavailableException(
        'El login de desarrollo está desactivado. La autenticación por SMS todavía no existe.',
      );
    }

    const normalized = phone.trim();

    // Paso 1: la identidad. `users` vive fuera del tenant y no lleva RLS.
    const [user] = await withoutTenantIsolation(this.db, (tx) =>
      tx
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.phone, normalized))
        .limit(1),
    );

    if (user === undefined) {
      throw new UnauthorizedException(`No hay ningún usuario con el celular ${normalized}.`);
    }

    // Paso 2: el rol. Va en una transacción aparte y con contexto de IDENTIDAD,
    // no de gimnasio: el gimnasio es justamente lo que se está averiguando. La
    // política de `staff` permite leer la propia fila (ver migración 0001).
    //
    // Dos llamadas seguidas y no una anidada: anidar `withUser` dentro de otra
    // transacción tomaría una segunda conexión del pool sin necesidad.
    const [staffRow] = await withUser(this.db, user.id, (tx) =>
      tx
        .select({
          id: schema.staff.id,
          tenantId: schema.staff.tenantId,
          role: schema.staff.role,
        })
        .from(schema.staff)
        .where(eq(schema.staff.userId, user.id))
        .limit(1),
    );

    // El mismo binario sirve a los tres roles (MD 4.6) y el rol lo define la
    // sesión, no una preferencia de la persona.
    const claims: SessionClaims =
      staffRow === undefined
        ? { sub: user.id, role: 'student' }
        : {
            sub: user.id,
            role: staffRow.role === 'owner' ? 'owner' : 'front_desk',
            tenantId: staffRow.tenantId,
            staffId: staffRow.id,
          };

    return {
      accessToken: await this.jwt.signAsync(claims, { expiresIn: TOKEN_TTL_SECONDS }),
      expiresInSeconds: TOKEN_TTL_SECONDS,
      role: claims.role,
      userId: claims.sub,
      tenantId: claims.tenantId ?? null,
    };
  }

  /**
   * Sesión de alumno para una persona que es staff.
   *
   * El dueño de un dojo también entrena en él. Sin esto tendría que cerrar
   * sesión para ver su propia billetera.
   */
  async switchToStudent(userId: string): Promise<IssuedSession> {
    const claims: SessionClaims = { sub: userId, role: 'student' };
    return {
      accessToken: await this.jwt.signAsync(claims, { expiresIn: TOKEN_TTL_SECONDS }),
      expiresInSeconds: TOKEN_TTL_SECONDS,
      role: 'student',
      userId,
      tenantId: null,
    };
  }
}
