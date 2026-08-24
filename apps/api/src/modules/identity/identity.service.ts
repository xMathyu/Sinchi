/**
 * Identidad global del alumno.
 *
 * Todo lo que no pertenece a un gimnasio: su nombre, su documento y el secreto
 * con el que su dispositivo genera códigos de acceso.
 *
 * El secreto es global a propósito. Un solo código identifica al alumno en
 * cualquier local de la red y el servidor resuelve contra qué membresía
 * validarlo (MD 4.6). Si el secreto fuera por gimnasio, el alumno tendría un QR
 * distinto por local y la billetera dejaría de tener sentido.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { TOTP_DIGITS, TOTP_PERIOD_SECONDS, type User } from '@sinchi/shared';
import { InjectDb } from '../../db/db.module';
import { schema, withoutTenantIsolation, type Database } from '../../db/client';
import { toUser } from '../../common/mappers';
import { SecretBox, generateTotpSecret } from '../../common/secret-box';

export interface DeviceLink {
  /** Secreto en base64. Se entrega UNA vez y el dispositivo lo guarda. */
  readonly secret: string;
  readonly algorithm: 'HMAC-SHA256';
  readonly digits: number;
  readonly periodSeconds: number;
  /** Payload que el dispositivo debe construir al mostrar el QR. */
  readonly payloadFormat: string;
  readonly userId: string;
}

@Injectable()
export class IdentityService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly secrets: SecretBox,
  ) {}

  async me(userId: string): Promise<User> {
    const user = await withoutTenantIsolation(this.db, async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .limit(1);
      return row;
    });

    if (user === undefined) throw new NotFoundException('Usuario no encontrado.');
    return toUser(user);
  }

  /**
   * Vincula un dispositivo y entrega el secreto TOTP.
   *
   * `rotate` fuerza un secreto nuevo, que es lo que hay que hacer cuando el
   * alumno pierde el celular: invalida de inmediato todos los códigos que ese
   * teléfono podía generar.
   *
   * Sin `rotate`, vincular dos veces devuelve el mismo secreto, para que el
   * alumno pueda tener la app en el celular y en la tablet de casa sin que una
   * anule a la otra.
   */
  async linkDevice(userId: string, rotate = false): Promise<DeviceLink> {
    return withoutTenantIsolation(this.db, async (tx) => {
      const [row] = await tx
        .select({ id: schema.users.id, secret: schema.users.totpSecretEncrypted })
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .limit(1);

      if (row === undefined) throw new NotFoundException('Usuario no encontrado.');

      let secret: Uint8Array;
      if (row.secret === null || rotate) {
        secret = generateTotpSecret();
        await tx
          .update(schema.users)
          .set({ totpSecretEncrypted: this.secrets.encrypt(secret) })
          .where(eq(schema.users.id, userId));
      } else {
        secret = this.secrets.decrypt(row.secret);
      }

      return {
        secret: Buffer.from(secret).toString('base64'),
        algorithm: 'HMAC-SHA256' as const,
        digits: TOTP_DIGITS,
        periodSeconds: TOTP_PERIOD_SECONDS,
        payloadFormat: 'SINCHI1:u:<userId>:<code>',
        userId,
      };
    });
  }
}
