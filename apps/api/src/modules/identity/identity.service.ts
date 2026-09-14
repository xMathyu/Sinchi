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
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, ne, sql } from 'drizzle-orm';
import {
  TOTP_DIGITS,
  TOTP_PERIOD_SECONDS,
  accountDetailsDenialMessage,
  checkAccountDetails,
  normalizePhoneNumber,
  type AccountDetailsDraft,
  type User,
} from '@sinchi/shared';
import { InjectDb } from '../../db/db.module';
import {
  schema,
  withTenant,
  withUser,
  withoutTenantIsolation,
  type Database,
} from '../../db/client';
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
   * Corrige el nombre y el celular de la persona.
   *
   * Los ven todos sus gimnasios, y es a propósito: la identidad es una sola para
   * toda la red (MD 5), y un padrón que conservara el nombre viejo seguiría
   * llamando «Jose» a quien se llama «José». El documento no pasa por aquí: lo lee
   * el gimnasio del carné, y es lo que ancla quién es quién.
   *
   * La regla es la misma `checkAccountDetails` que apaga el botón en la app, así
   * que un 400 de aquí dice lo mismo que la pantalla ya decía.
   */
  async updateDetails(userId: string, draft: AccountDetailsDraft): Promise<User> {
    const denial = checkAccountDetails(draft);
    if (denial !== null) throw new BadRequestException(accountDetailsDenialMessage(denial));

    const name = draft.name.trim();
    const phone = normalizePhoneNumber(draft.phone);

    const updated = await withoutTenantIsolation(this.db, async (tx) => {
      // El celular es la llave con la que el padrón reconoce a alguien, y es único
      // en toda la red. Se compara normalizado: el mostrador lo teclea con
      // espacios y la app no, y el índice único solo ve el texto tal cual.
      const [taken] = await tx
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(
          and(
            ne(schema.users.id, userId),
            sql`regexp_replace(${schema.users.phone}, '[^0-9+]', '', 'g') = ${phone}`,
          ),
        )
        .limit(1);
      if (taken !== undefined) {
        throw new ConflictException(
          'Ese celular ya es de otra persona en Sinchi. Si es tuyo, avísale a tu gimnasio.',
        );
      }

      const [row] = await tx
        .update(schema.users)
        .set({ name, phone })
        .where(eq(schema.users.id, userId))
        .returning();
      return row;
    });

    if (updated === undefined) throw new NotFoundException('Usuario no encontrado.');

    /**
     * Y su nombre en los locales donde trabaja.
     *
     * Es el que sale en la cabecera del mostrador y el que firma sus mensajes, y
     * se quedaba con el viejo. Local por local porque la política de `staff`
     * deja leer la fila propia sin gimnasio, pero escribirla exige estar en él.
     */
    const posts = await withUser(this.db, userId, (tx) =>
      tx
        .select({ id: schema.staff.id, tenantId: schema.staff.tenantId })
        .from(schema.staff)
        .where(eq(schema.staff.userId, userId)),
    );
    for (const post of posts) {
      await withTenant(this.db, post.tenantId, (tx) =>
        tx.update(schema.staff).set({ displayName: name }).where(eq(schema.staff.id, post.id)),
      );
    }

    return toUser(updated);
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
